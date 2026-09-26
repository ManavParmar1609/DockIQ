import csv
import io
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile
from fastapi import status as http
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.access import ensure, issue_audience, issue_scope, supervisor_of, visible_issue, visible_order
from app.api.deps import (
    CurrentUser,
    Operator,
    PathId,
    Quality,
    RealtimeDep,
    SessionDep,
    Supervisor,
    WmsDep,
    get_or_404,
)
from app.db import MAX_ID, utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import Disposition, IssueStatus, Role, Severity
from app.domain.evidence import MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ISSUE, sniff_image_type
from app.domain.lifecycle import (
    FULL_REJECT,
    OPEN_STATUSES,
    can_transition,
    decision_needs_notes,
    decision_status,
    requires_supervisor,
)
from app.domain.quality_hold import LEAVES_THE_BUILDING, can_dispose, holds_stock
from app.domain.taxonomy import OPERATOR_RESOLUTIONS, SUPERVISOR_DECISIONS, needs_order
from app.models import DockDoor, Issue, IssuePhoto, Order, Product, User
from app.queries import issue_select
from app.schemas import (
    IssueCreate,
    IssueCreated,
    IssueDispositionUpdate,
    IssueOut,
    IssueSelfResolve,
    IssueSupervisorResolve,
    PhotoOut,
    StatusOut,
)
from app.services.holds import hold_for_issue
from app.services.issue_filing import file_issue
from app.wms.client import WmsUnavailable

router = APIRouter(tags=["issues"])

EXPORT_LIMIT = 5000  # rows in one CSV export, at most


def unprocessable(detail: str) -> HTTPException:
    return HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, detail)


async def _issue_out(session: AsyncSession, issue_id: int) -> IssueOut:
    row = (await session.execute(issue_select().where(Issue.id == issue_id))).first()
    if row is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Issue not found")
    return IssueOut.model_validate(dict(row._mapping))


def _move(issue: Issue, target: IssueStatus) -> None:
    if not can_transition(issue.status, target):
        raise HTTPException(
            http.HTTP_409_CONFLICT, f"Issue is already {issue.status.value.replace('_', ' ')}"
        )
    issue.status = target


# ── Reading: the list, the CSV export, one issue ──

StatusFilter = Annotated[str | None, Query(description="An issue status, or 'active' for open issues")]
DockFilter = Annotated[int | None, Query(ge=1, le=999, description="A door number")]
IdFilter = Annotated[int | None, Query(ge=1, le=MAX_ID)]
FromFilter = Annotated[date | None, Query(alias="from", description="Filed on or after this day (UTC)")]
ToFilter = Annotated[date | None, Query(alias="to", description="Filed on or before this day (UTC)")]


def day_range(date_from: date | None, date_to: date | None) -> tuple[datetime | None, datetime | None]:
    """[start of `date_from`, start of the day after `date_to`) in UTC. 422 when they are reversed."""
    if date_from is not None and date_to is not None and date_from > date_to:
        raise unprocessable("'from' is after 'to'")
    start = datetime.combine(date_from, time.min, UTC) if date_from is not None else None
    end = datetime.combine(date_to + timedelta(days=1), time.min, UTC) if date_to is not None else None
    return start, end


def _filtered(
    user: User,
    status: str | None,
    operator_id: int | None,
    severity: Severity | None,
    dock: int | None,
    carrier_id: int | None,
    date_from: date | None,
    date_to: date | None,
) -> Select[Any]:
    stmt = issue_select().where(issue_scope(user)).order_by(Issue.created_at.desc(), Issue.id.desc())
    if status == "active":
        stmt = stmt.where(Issue.status.in_(OPEN_STATUSES))
    elif status is not None:
        try:
            stmt = stmt.where(Issue.status == IssueStatus(status))
        except ValueError:
            raise unprocessable(f"Unknown status '{status}'") from None
    if operator_id is not None:
        stmt = stmt.where(Issue.operator_id == operator_id)
    if severity is not None:
        stmt = stmt.where(Issue.severity == severity)
    if dock is not None:
        stmt = stmt.where(DockDoor.door_number == dock)
    if carrier_id is not None:
        stmt = stmt.where(Issue.carrier_id == carrier_id)
    start, end = day_range(date_from, date_to)
    if start is not None:
        stmt = stmt.where(Issue.created_at >= start)
    if end is not None:
        stmt = stmt.where(Issue.created_at < end)
    return stmt


@router.get("/issues")
async def list_issues(
    user: CurrentUser,
    session: SessionDep,
    status: StatusFilter = None,
    operator_id: IdFilter = None,
    severity: Severity | None = None,
    dock: DockFilter = None,
    carrier_id: IdFilter = None,
    date_from: FromFilter = None,
    date_to: ToFilter = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[IssueOut]:
    stmt = _filtered(user, status, operator_id, severity, dock, carrier_id, date_from, date_to).limit(limit)
    return [IssueOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


EXPORT_COLUMNS: tuple[str, ...] = (
    "id",
    "created_at",
    "status",
    "severity",
    "severity_score",
    "issue_type",
    "issue_subtype",
    "door_number",
    "order_number",
    "trailer_number",
    "bol_number",
    "company_name",
    "product_sku",
    "product_name",
    "lot",
    "quantity_affected",
    "temp_reading",
    "temp_limit",
    "room",
    "carrier_name",
    "operator_name",
    "escalated_at",
    "acknowledged_by_name",
    "acknowledged_at",
    "resolution_type",
    "supervisor_name",
    "resolved_at",
    "estimated_cost_impact",
    "held_pallets",
    "disposition",
    "disposition_by_name",
    "disposition_at",
    "simulated",
    "sim_time",
    "description",
)


def _cell(value: object) -> str | float | int:
    """One CSV cell. Text a spreadsheet would run as a formula is prefixed with an apostrophe."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        value = " ".join(str(item) for item in value)
    text = value.value if hasattr(value, "value") else str(value)
    return f"'{text}" if str(text).startswith(("=", "+", "-", "@", "\t", "\r")) else str(text)


@router.get("/issues/export.csv", response_class=Response)
async def export_issues(
    user: CurrentUser,
    session: SessionDep,
    status: StatusFilter = None,
    operator_id: IdFilter = None,
    severity: Severity | None = None,
    dock: DockFilter = None,
    carrier_id: IdFilter = None,
    date_from: FromFilter = None,
    date_to: ToFilter = None,
    limit: Annotated[int, Query(ge=1, le=EXPORT_LIMIT)] = 1000,
) -> Response:
    """The issue list as CSV: the same filters and the same scope, newest first, bounded."""
    stmt = _filtered(user, status, operator_id, severity, dock, carrier_id, date_from, date_to).limit(limit)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(EXPORT_COLUMNS)
    for row in await session.execute(stmt):
        issue = IssueOut.model_validate(dict(row._mapping)).model_dump()
        writer.writerow([_cell(issue.get(column)) for column in EXPORT_COLUMNS])
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="dockiq-issues-{utcnow():%Y%m%d-%H%M}.csv"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/issues/{issue_id}")
async def get_issue(issue_id: PathId, user: CurrentUser, session: SessionDep) -> IssueOut:
    await visible_issue(session, user, issue_id)
    return await _issue_out(session, issue_id)


# ── Reporting ──


@router.post("/issues")
async def create_issue(
    body: IssueCreate, user: Operator, session: SessionDep, events: RealtimeDep, wms: WmsDep
) -> IssueCreated:
    # The order must be one the operator may see (404 otherwise), and the report must be at its dock.
    order = await visible_order(session, user, body.order_id) if body.order_id is not None else None
    if order is None and needs_order(body.issue_type):
        raise unprocessable("A product issue is reported against its order: choose the order first")
    if order is not None:
        if body.dock_door_id is None:
            body = body.model_copy(update={"dock_door_id": order.dock_door_id})
        elif order.dock_door_id != body.dock_door_id:
            raise unprocessable("That order is not at this dock")
    issue = await file_issue(session, user.id, body)
    product = await session.get(Product, issue.product_id) if issue.product_id is not None else None
    if order is not None:
        order.sim_managed = False  # a person reporting on a simulated trailer takes it over (§12)
    await session.commit()
    if holds_stock(issue.issue_type) and order is not None:
        # The WMS is a system of its own: the hold is asked for once the report is on record, and
        # what it held is recorded on the report (business-rules §7.3).
        held = await hold_for_issue(wms, issue, order, product, user.employee_id)
        if held:
            issue.held_pallets = held
            await session.commit()
    created = await _issue_out(session, issue.id)
    await events.send(await issue_audience(session, issue), realtime.new_issue(created.model_dump()))
    return IssueCreated(
        id=issue.id,
        status=issue.status,
        severity=issue.severity,
        severity_score=issue.severity_score or 0,
        severity_reason=issue.severity_reason or "",
        ai_resolution=issue.ai_resolution or {},
        estimated_cost_impact=issue.estimated_cost_impact,
        recurring_patterns=issue.recurring_patterns,
    )


async def _dock_event(session: AsyncSession, issue: Issue, event: DockEvent) -> None:
    if issue.dock_door_id is None:
        return
    dock = await get_or_404(session, DockDoor, issue.dock_door_id, "Dock")
    dock.status, dock.lifecycle_phase = transition(dock.status, dock.lifecycle_phase, event)


# ── Resolving ──


@router.put("/issues/{issue_id}/self-resolve")
async def self_resolve_issue(
    issue_id: PathId, body: IssueSelfResolve, user: Operator, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    issue = await visible_issue(session, user, issue_id)
    if body.resolution_type not in OPERATOR_RESOLUTIONS:
        raise unprocessable(f"Unknown resolution '{body.resolution_type}'")
    if requires_supervisor(issue.severity):
        raise HTTPException(http.HTTP_409_CONFLICT, "A critical issue needs your supervisor's decision")
    _move(issue, IssueStatus.SELF_RESOLVED)
    issue.resolution_type = body.resolution_type
    issue.resolution_notes = body.resolution_notes
    issue.resolved_at = utcnow()
    await _dock_event(session, issue, DockEvent.ISSUE_RESOLVED)
    await session.commit()
    await events.send(
        await issue_audience(session, issue),
        realtime.issue_resolved(issue_id, IssueStatus.SELF_RESOLVED.value, body.resolution_type),
    )
    return StatusOut(status=IssueStatus.SELF_RESOLVED.value)


@router.put("/issues/{issue_id}/escalate")
async def escalate_issue(
    issue_id: PathId, user: CurrentUser, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    """The reporting operator (or their supervisor) hands the issue to the supervisor's queue."""
    ensure(user.role in (Role.OPERATOR, Role.SUPERVISOR))
    issue = await visible_issue(session, user, issue_id)
    _move(issue, IssueStatus.ESCALATED)
    issue.escalated_at = utcnow()
    if issue.dock_door_id is not None:
        dock = await get_or_404(session, DockDoor, issue.dock_door_id, "Dock")
        dock.status, dock.lifecycle_phase = transition(
            dock.status, dock.lifecycle_phase, DockEvent.ISSUE_ESCALATED, severity=issue.severity
        )
    await session.commit()
    escalated = await _issue_out(session, issue_id)
    await events.send(await issue_audience(session, issue), realtime.issue_escalated(escalated.model_dump()))
    return StatusOut(status=IssueStatus.ESCALATED.value)


@router.put("/issues/{issue_id}/acknowledge")
async def acknowledge_issue(
    issue_id: PathId, user: Supervisor, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    """ "On my way": the supervisor takes the issue and the operator is told who is coming. Who
    acknowledged is kept apart from who later decides (`acknowledged_by`, `supervisor_id`)."""
    issue = await visible_issue(session, user, issue_id)  # scoped: only this supervisor's team
    if issue.status not in OPEN_STATUSES:
        raise HTTPException(
            http.HTTP_409_CONFLICT, f"Issue is already {issue.status.value.replace('_', ' ')}"
        )
    if issue.acknowledged_at is None:
        issue.acknowledged_at = utcnow()
        issue.acknowledged_by = user.id
    dock = await session.get(DockDoor, issue.dock_door_id) if issue.dock_door_id is not None else None
    await session.commit()
    await events.send(
        await issue_audience(session, issue),
        realtime.issue_acknowledged(issue_id, user.name, dock.door_number if dock else None),
    )
    return StatusOut(status="acknowledged")


@router.put("/issues/{issue_id}/supervisor-resolve")
async def supervisor_resolve_issue(
    issue_id: PathId, body: IssueSupervisorResolve, user: Supervisor, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    """The supervisor's decision (business-rules §7.2). Accepting product on a critical or temperature
    issue needs a reason; Contact Carrier and Request Re-inspection put the issue `on_hold` (still
    open); Full Reject closes it and blocks the order's sign-off, and the door stays flagged."""
    issue = await visible_issue(session, user, issue_id)  # scoped: only this supervisor's team
    decision = body.resolution_type
    if decision not in SUPERVISOR_DECISIONS:
        raise unprocessable(f"Unknown decision '{decision}'")
    if (
        decision_needs_notes(decision, issue.severity, issue.issue_type)
        and not (body.supervisor_notes or "").strip()
    ):
        raise unprocessable(f"'{decision}' on a critical or temperature issue needs your reason in the notes")
    target = decision_status(decision)
    _move(issue, target)
    now = utcnow()
    issue.supervisor_id = user.id
    issue.resolution_type = decision
    issue.supervisor_notes = body.supervisor_notes
    if target is IssueStatus.ON_HOLD:
        issue.on_hold_at = now
    else:
        issue.resolved_at = now
        await _dock_event(
            session, issue, DockEvent.LOAD_REJECTED if decision == FULL_REJECT else DockEvent.ISSUE_RESOLVED
        )
    await session.commit()
    await events.send(
        await issue_audience(session, issue), realtime.issue_resolved(issue_id, target.value, decision)
    )
    return StatusOut(status=target.value)


# ── Quality: disposition of held product (business-rules §7.3) ──


@router.put("/issues/{issue_id}/disposition")
async def dispose_issue(
    issue_id: PathId, body: IssueDispositionUpdate, user: Quality, session: SessionDep, wms: WmsDep
) -> IssueOut:
    """Quality's decision on the product held for an issue: hold (applied again), release to storage,
    destroy, or return to the vendor. Supervisors read it; only Quality decides it."""
    issue = await visible_issue(session, user, issue_id)
    notes = body.notes.strip()
    if not notes:
        raise unprocessable("A disposition needs notes")
    if not can_dispose(issue.disposition, body.disposition):
        current = issue.disposition.value.replace("_", " ") if issue.disposition else "decided"
        raise HTTPException(http.HTTP_409_CONFLICT, f"This product's disposition is final: {current}")
    held = list(issue.held_pallets)
    if body.disposition is Disposition.HOLD:
        order = await session.get(Order, issue.order_id) if issue.order_id is not None else None
        product = await session.get(Product, issue.product_id) if issue.product_id is not None else None
        again = await hold_for_issue(wms, issue, order, product, user.employee_id)
        if again is None:
            raise HTTPException(http.HTTP_503_SERVICE_UNAVAILABLE, "The WMS is offline: nothing was held")
        held = again
    elif held:
        action = body.disposition.value if body.disposition in LEAVES_THE_BUILDING else "release"
        try:
            await wms.dispose_stock(held, action, f"ISSUE-{issue.id}", user.employee_id)
        except WmsUnavailable:
            raise HTTPException(
                http.HTTP_503_SERVICE_UNAVAILABLE, "The WMS is offline: the held stock was not moved"
            ) from None
    issue.held_pallets = held
    issue.disposition = body.disposition
    issue.disposition_notes = notes
    issue.disposition_by = user.id
    issue.disposition_at = utcnow()
    await session.commit()
    return await _issue_out(session, issue_id)


# ── Photo evidence ──


@router.post("/issues/{issue_id}/photos", status_code=http.HTTP_201_CREATED)
async def upload_photo(
    issue_id: PathId, file: UploadFile, user: CurrentUser, session: SessionDep
) -> PhotoOut:
    issue = await visible_issue(session, user, issue_id)
    ensure(user.id == issue.operator_id or user.id == await supervisor_of(session, issue.operator_id))
    existing = await session.scalar(select(func.count(IssuePhoto.id)).where(IssuePhoto.issue_id == issue.id))
    if (existing or 0) >= MAX_PHOTOS_PER_ISSUE:
        raise unprocessable(f"An issue holds at most {MAX_PHOTOS_PER_ISSUE} photos")
    data = await file.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(
            http.HTTP_413_CONTENT_TOO_LARGE, f"Photos are limited to {MAX_PHOTO_BYTES // 1000} kB"
        )
    content_type = sniff_image_type(data)
    if content_type is None:
        raise HTTPException(
            http.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only JPEG, PNG or WebP images are accepted"
        )
    photo = IssuePhoto(
        issue_id=issue.id,
        uploaded_by=user.id,
        content_type=content_type,
        size_bytes=len(data),
        data=data,
        created_at=utcnow(),
    )
    session.add(photo)
    await session.commit()
    return PhotoOut.model_validate(photo)


@router.get("/issues/{issue_id}/photos")
async def list_photos(issue_id: PathId, user: CurrentUser, session: SessionDep) -> list[PhotoOut]:
    await visible_issue(session, user, issue_id)
    # Metadata only: the image bytes are served one at a time by GET /photos/{id}.
    rows = await session.execute(
        select(*(IssuePhoto.__table__.c[name] for name in PhotoOut.model_fields))
        .where(IssuePhoto.issue_id == issue_id)
        .order_by(IssuePhoto.id)
    )
    return [PhotoOut.model_validate(dict(row._mapping)) for row in rows]


@router.get("/photos/{photo_id}", response_class=Response)
async def get_photo(photo_id: PathId, user: CurrentUser, session: SessionDep) -> Response:
    photo = await get_or_404(session, IssuePhoto, photo_id, "Photo")
    await visible_issue(session, user, photo.issue_id)
    return Response(
        content=photo.data,
        media_type=photo.content_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
