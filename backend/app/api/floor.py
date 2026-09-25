"""Floor operations: trailer inspections, quick requests, broadcasts, shift handoffs."""

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi import status as http
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from sqlalchemy.orm.util import AliasedClass

from app import realtime
from app.api.access import request_scope, supervisor_of, team_audience, visible_order
from app.api.deps import CurrentUser, Operator, PathId, RealtimeDep, SessionDep, Supervisor, get_or_404
from app.db import utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import RequestStatus, Role
from app.domain.inspection import evaluate_inspection, interior_temperature_limit
from app.domain.taxonomy import REQUEST_TYPES
from app.models import (
    Broadcast,
    DockDoor,
    OrderItem,
    Product,
    QuickRequest,
    ShiftHandoff,
    TrailerInspection,
    User,
)
from app.queries import request_select
from app.schemas import (
    BroadcastCreate,
    BroadcastOut,
    Created,
    InspectionCreate,
    InspectionResult,
    QuickRequestCreate,
    QuickRequestCreated,
    QuickRequestOut,
    ShiftHandoffCreate,
    ShiftHandoffOut,
    StatusOut,
)

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
        realtime.new_request(request.id, request.request_type),
    )
    return QuickRequestCreated(id=request.id, status=request.status)


@router.put("/requests/{request_id}/fulfill")
async def fulfill_request(request_id: PathId, user: Supervisor, session: SessionDep) -> StatusOut:
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
    return StatusOut(status=RequestStatus.FULFILLED.value)


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


@router.get("/shift-handoffs")
async def list_handoffs(user: CurrentUser, session: SessionDep) -> list[ShiftHandoffOut]:
    stmt, author = _author_select(ShiftHandoff, 10)
    if user.role is not Role.QUALITY:
        stmt = stmt.where(author.zone == await _zone_of(session, user))
    return [ShiftHandoffOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/shift-handoffs")
async def create_handoff(body: ShiftHandoffCreate, user: Supervisor, session: SessionDep) -> StatusOut:
    session.add(ShiftHandoff(supervisor_id=user.id, shift=body.shift, notes=body.notes, created_at=utcnow()))
    await session.commit()
    return StatusOut(status="created")
