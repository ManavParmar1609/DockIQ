"""Floor operations: trailer inspections, quick requests, broadcasts, shift handoffs."""

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi import status as http
from sqlalchemy import Select, and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.orm.util import AliasedClass

from app import realtime
from app.api.access import issue_scope, request_scope, supervisor_of, team_audience, visible_order
from app.api.deps import (
    CurrentUser,
    Operator,
    PathId,
    RealtimeDep,
    SessionDep,
    Supervisor,
    WmsDep,
    get_or_404,
)
from app.db import utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import IssueStatus, RequestStatus, Role, Severity
from app.domain.inspection import evaluate_inspection, interior_temperature_limit
from app.domain.lifecycle import OPEN_STATUSES
from app.domain.taxonomy import REQUEST_TYPES
from app.models import (
    Broadcast,
    DockDoor,
    Issue,
    OrderItem,
    Product,
    QuickRequest,
    ShiftHandoff,
    TrailerInspection,
    User,
)
from app.queries import issue_select, request_select
from app.schemas import (
    BroadcastCreate,
    BroadcastOut,
    Created,
    HandoffDecisionLine,
    HandoffDraftOut,
    HandoffIssueLine,
    HandoffRoomLine,
    HandoffTrailerLine,
    InspectionCreate,
    InspectionResult,
    IssueOut,
    QuickRequestCreate,
    QuickRequestCreated,
    QuickRequestOut,
    ShiftHandoffCreate,
    ShiftHandoffOut,
    StatusOut,
)
from app.wms.client import WmsUnavailable

HANDOFF_WINDOW_HOURS = 12  # "this shift" for a handoff draft: one shift-long sign-in

router = APIRouter(tags=["floor"])


@router.post("/inspections")
async def create_inspection(body: InspectionCreate, user: Operator, session: SessionDep) -> InspectionResult:
    dock = await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
    order_id = body.order_id if body.order_id is not None else dock.current_order_id
    limits: list[float | None] = []
    if order_id is not None:
        order = await visible_order(session, user, order_id)
        order.sim_managed = False  # a person is inspecting: the simulator hands this trailer over
        limits = list(
            await session.scalars(
                select(Product.temp_max)
                .join(OrderItem, OrderItem.product_id == Product.id)
                .where(OrderItem.order_id == order_id)
            )
        )
    outcome = evaluate_inspection(
        body.seal_condition,
        body.interior_cleanliness,
        body.visible_damage,
        body.interior_temperature,
        interior_temperature_limit(limits),
    )
    now = utcnow()
    inspection = TrailerInspection(
        order_id=order_id,
        dock_door_id=dock.id,
        operator_id=user.id,
        seal_condition=body.seal_condition,
        interior_cleanliness=body.interior_cleanliness,
        interior_temperature=body.interior_temperature,
        visible_damage=body.visible_damage,
        overall_pass=outcome.passed,
        notes=body.notes,
        created_at=now,
    )
    session.add(inspection)
    dock.status, dock.lifecycle_phase = transition(
        dock.status, dock.lifecycle_phase, DockEvent.INSPECTION_SUBMITTED
    )
    dock.last_activity_at = now
    await session.commit()
    return InspectionResult(
        id=inspection.id,
        overall_pass=outcome.passed,
        temperature_limit=outcome.temperature_limit,
        failed_checks=list(outcome.failed_checks),
    )


@router.get("/requests/mine")
async def my_requests(
    user: CurrentUser, session: SessionDep, status: RequestStatus | None = None
) -> list[QuickRequestOut]:
    """The requests you made, newest first, with their status: what you are still waiting for."""
    stmt = request_select().where(QuickRequest.operator_id == user.id)
    if status is not None:
        stmt = stmt.where(QuickRequest.status == status)
    return [QuickRequestOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.get("/requests")
async def list_requests(
    user: CurrentUser, session: SessionDep, status: RequestStatus | None = None
) -> list[QuickRequestOut]:
    stmt = request_select().where(request_scope(user))
    if status is not None:
        stmt = stmt.where(QuickRequest.status == status)
    return [QuickRequestOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/requests")
async def create_request(
    body: QuickRequestCreate, user: Operator, session: SessionDep, events: RealtimeDep
) -> QuickRequestCreated:
    if body.request_type not in REQUEST_TYPES:
        raise HTTPException(
            http.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown request type '{body.request_type}'"
        )
    if body.dock_door_id is not None:
        await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
    request = QuickRequest(
        dock_door_id=body.dock_door_id,
        operator_id=user.id,
        request_type=body.request_type,
        details=body.details,
        status=RequestStatus.PENDING,
        created_at=utcnow(),
    )
    session.add(request)
    await session.commit()
    await events.send(
        {user.id, await supervisor_of(session, user.id)},
        realtime.new_request(request.id, request.request_type, RequestStatus.PENDING.value),
    )
    return QuickRequestCreated(id=request.id, status=request.status)


@router.put("/requests/{request_id}/fulfill")
async def fulfill_request(
    request_id: PathId, user: Supervisor, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    """Mark a request done. The operator who asked is told (`new_request` with status `fulfilled`)."""
    request = await session.scalar(
        select(QuickRequest).where(QuickRequest.id == request_id, request_scope(user))
    )
    if request is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Request not found")
    if request.status is not RequestStatus.PENDING:  # keep the first fulfilment's time
        raise HTTPException(http.HTTP_409_CONFLICT, f"Request is already {request.status.value}")
    request.status = RequestStatus.FULFILLED
    request.fulfilled_at = utcnow()
    await session.commit()
    await events.send(
        {request.operator_id, user.id},
        realtime.new_request(request.id, request.request_type, RequestStatus.FULFILLED.value),
    )
    return StatusOut(status=RequestStatus.FULFILLED.value)


@router.put("/requests/{request_id}/cancel")
async def cancel_request(
    request_id: PathId, user: Operator, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    """The operator who asked withdraws a request still pending. Their supervisor's list drops it
    (`new_request` with status `cancelled`). Someone else's request is a 404."""
    request = await session.scalar(
        select(QuickRequest).where(QuickRequest.id == request_id, QuickRequest.operator_id == user.id)
    )
    if request is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Request not found")
    if request.status is not RequestStatus.PENDING:
        raise HTTPException(http.HTTP_409_CONFLICT, f"Request is already {request.status.value}")
    request.status = RequestStatus.CANCELLED
    request.cancelled_at = utcnow()
    await session.commit()
    await events.send(
        {user.id, await supervisor_of(session, user.id)},
        realtime.new_request(request.id, request.request_type, RequestStatus.CANCELLED.value),
    )
    return StatusOut(status=RequestStatus.CANCELLED.value)


def _author_select(
    model: type[Broadcast] | type[ShiftHandoff], limit: int
) -> tuple[Select[Any], AliasedClass[User]]:
    author = aliased(User)
    return (
        select(*model.__table__.c, author.name.label("supervisor_name"))
        .join(author, model.supervisor_id == author.id)
        .order_by(model.created_at.desc(), model.id.desc())
        .limit(limit),
        author,
    )


@router.get("/broadcasts")
async def list_broadcasts(user: CurrentUser, session: SessionDep) -> list[BroadcastOut]:
    """Operators hear their own supervisor; supervisors see their own; quality sees all."""
    stmt, _ = _author_select(Broadcast, 20)
    if user.role is Role.OPERATOR:
        stmt = stmt.where(Broadcast.supervisor_id == user.supervisor_id)
    elif user.role is Role.SUPERVISOR:
        stmt = stmt.where(Broadcast.supervisor_id == user.id)
    return [BroadcastOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/broadcasts")
async def create_broadcast(
    body: BroadcastCreate, user: Supervisor, session: SessionDep, events: RealtimeDep
) -> Created:
    broadcast = Broadcast(supervisor_id=user.id, message=body.message, created_at=utcnow())
    session.add(broadcast)
    await session.commit()
    await events.send(
        await team_audience(session, user.id), realtime.broadcast_message(broadcast.id, broadcast.message)
    )
    return Created(id=broadcast.id)


async def _zone_of(session: AsyncSession, user: User) -> str | None:
    """A handoff belongs to a zone: the supervisor's zone, or an operator's supervisor's zone."""
    if user.role is Role.SUPERVISOR:
        return user.zone
    if user.supervisor_id is None:
        return None
    return await session.scalar(select(User.zone).where(User.id == user.supervisor_id))


def _handoff_select(limit: int) -> tuple[Select[Any], AliasedClass[User]]:
    stmt, author = _author_select(ShiftHandoff, limit)
    reader = aliased(User)
    return stmt.add_columns(reader.name.label("read_by_name")).outerjoin(
        reader, ShiftHandoff.read_by == reader.id
    ), author


@router.get("/shift-handoffs")
async def list_handoffs(user: CurrentUser, session: SessionDep) -> list[ShiftHandoffOut]:
    stmt, author = _handoff_select(10)
    if user.role is not Role.QUALITY:
        stmt = stmt.where(author.zone == await _zone_of(session, user))
    return [ShiftHandoffOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/shift-handoffs")
async def create_handoff(body: ShiftHandoffCreate, user: Supervisor, session: SessionDep) -> StatusOut:
    session.add(ShiftHandoff(supervisor_id=user.id, shift=body.shift, notes=body.notes, created_at=utcnow()))
    await session.commit()
    return StatusOut(status="created")


def _issue_title(issue: IssueOut) -> str:
    return f"{issue.issue_type}: {issue.issue_subtype}" if issue.issue_subtype else issue.issue_type


def _draft_notes(draft: HandoffDraftOut) -> str:
    lines: list[str] = []
    if draft.open_criticals:
        lines.append("Open critical issues:")
        lines += [
            f"- #{i.id} {i.title}" + (f", door {i.door_number}" if i.door_number else "")
            for i in draft.open_criticals
        ]
    if draft.decisions:
        lines.append("Decisions this shift:")
        lines += [
            f"- #{d.id} {d.title}: {d.decision}"
            + (" (still pending)" if d.status is IssueStatus.ON_HOLD else "")
            for d in draft.decisions
        ]
    if draft.trailers:
        lines.append("Trailers in the yard, at a door or due:")
        lines += [
            f"- {t.trailer} ({t.carrier}) {t.state.replace('_', ' ')}, door {t.door}"
            + (" — on detention" if t.detention else "")
            for t in draft.trailers
        ]
    if draft.room_alarms:
        lines.append("Cold rooms out of range:")
        lines += [
            f"- {r.name} {r.temp:g}°F (limit {r.limit:g}°F)" + (" — alarm" if r.alarm else "")
            for r in draft.room_alarms
        ]
    if draft.pending_requests:
        lines.append("Requests still open:")
        lines += [
            f"- {r.request_type} for {r.operator_name or 'an operator'}"
            + (f" at door {r.door_number}" if r.door_number else "")
            for r in draft.pending_requests
        ]
    if not draft.wms_online:
        lines.append("The WMS was offline when this was drafted: check the yard and the rooms by hand.")
    return "\n".join(lines) or "Nothing open to hand over."


@router.get("/shift-handoffs/draft")
async def handoff_draft(user: Supervisor, session: SessionDep, wms: WmsDep) -> HandoffDraftOut:
    """A pre-filled handoff for the supervisor's team and zone: open critical issues, the decisions
    made this shift, trailers in the yard or due, cold rooms out of range, requests still open. Read
    only: the supervisor edits the notes and saves them with `POST /shift-handoffs`."""
    since: datetime = utcnow() - timedelta(hours=HANDOFF_WINDOW_HOURS)
    team = issue_scope(user)
    criticals = [
        IssueOut.model_validate(dict(row._mapping))
        for row in await session.execute(
            issue_select()
            .where(team, Issue.severity == Severity.CRITICAL, Issue.status.in_(OPEN_STATUSES))
            .order_by(Issue.created_at, Issue.id)
        )
    ]
    decided = [
        IssueOut.model_validate(dict(row._mapping))
        for row in await session.execute(
            issue_select()
            .where(
                team,
                or_(
                    and_(Issue.status == IssueStatus.SUPERVISOR_RESOLVED, Issue.resolved_at >= since),
                    and_(Issue.status == IssueStatus.ON_HOLD, Issue.on_hold_at >= since),
                ),
            )
            .order_by(Issue.id)
        )
    ]
    zone_doors = set(await session.scalars(select(DockDoor.door_number).where(DockDoor.zone == user.zone)))
    trailers: list[HandoffTrailerLine] = []
    rooms: list[HandoffRoomLine] = []
    wms_online = True
    try:
        for entry in await wms.appointments():
            if entry.state in ("scheduled", "in_yard", "at_door") and entry.door in zone_doors:
                trailers.append(
                    HandoffTrailerLine(
                        order_number=entry.order_number,
                        trailer=entry.trailer,
                        carrier=entry.carrier,
                        customer=entry.customer,
                        state=entry.state,  # type: ignore[arg-type]
                        door=entry.door,
                        due_in_minutes=entry.due_in_minutes,
                        detention=entry.detention,
                        simulated=entry.simulated,
                    )
                )
        rooms = [
            HandoffRoomLine(
                code=room.code,
                name=room.name,
                temp=room.temp,
                limit=room.limit,
                alarm=room.alarm,
                simulated=room.simulated,
            )
            for room in await wms.rooms(1)
            if room.alarm or room.over_limit
        ]
    except WmsUnavailable:
        wms_online = False
    pending = [
        QuickRequestOut.model_validate(dict(row._mapping))
        for row in await session.execute(
            request_select().where(request_scope(user), QuickRequest.status == RequestStatus.PENDING)
        )
    ]
    draft = HandoffDraftOut(
        zone=user.zone,
        since=since,
        open_criticals=[
            HandoffIssueLine(
                id=i.id,
                severity=i.severity,
                status=i.status,
                title=_issue_title(i),
                door_number=i.door_number,
                order_number=i.order_number,
                operator_name=i.operator_name,
                created_at=i.created_at,
            )
            for i in criticals
        ],
        decisions=[
            HandoffDecisionLine(
                id=i.id,
                title=_issue_title(i),
                decision=i.resolution_type or "",
                status=i.status,
                notes=i.supervisor_notes,
                decided_by=i.supervisor_name,
                decided_at=i.resolved_at or i.on_hold_at,
            )
            for i in decided
        ],
        trailers=trailers,
        room_alarms=rooms,
        pending_requests=pending,
        wms_online=wms_online,
        notes="",
    )
    draft.notes = _draft_notes(draft)
    return draft


@router.put("/shift-handoffs/{handoff_id}/read")
async def read_handoff(handoff_id: PathId, user: Supervisor, session: SessionDep) -> ShiftHandoffOut:
    """The incoming supervisor opened the handoff: the first to do so is its read receipt. A handoff
    from another zone is a 404; your own is a 409 (you cannot receive your own handoff)."""
    handoff = await get_or_404(session, ShiftHandoff, handoff_id, "Handoff")
    author_zone = await session.scalar(select(User.zone).where(User.id == handoff.supervisor_id))
    if author_zone != user.zone:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Handoff not found")
    if handoff.supervisor_id == user.id:
        raise HTTPException(http.HTTP_409_CONFLICT, "You wrote this handoff")
    if handoff.read_by is None:
        handoff.read_by, handoff.read_at = user.id, utcnow()
        await session.commit()
    stmt, _ = _handoff_select(1)
    row = (await session.execute(stmt.where(ShiftHandoff.id == handoff_id))).one()
    return ShiftHandoffOut.model_validate(dict(row._mapping))
