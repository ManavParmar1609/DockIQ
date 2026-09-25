from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile
from fastapi import status as http
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.access import ensure, issue_audience, issue_scope, supervisor_of, visible_issue
from app.api.deps import CurrentUser, Operator, RealtimeDep, SessionDep, Supervisor, get_or_404
from app.db import utcnow
from app.domain.cost import estimate_cost_impact
from app.domain.dock import DockEvent, transition
from app.domain.enums import Confidence, IssueStatus, Role, Severity
from app.domain.evidence import MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ISSUE, sniff_image_type
from app.domain.lifecycle import OPEN_STATUSES, can_transition
from app.domain.recurrence import RECURRENCE_WINDOW_DAYS, carrier_pattern, dock_pattern
from app.domain.retrieval import find_resolution
from app.domain.severity import classify_severity
from app.domain.taxonomy import ISSUE_TYPES, OPERATOR_RESOLUTIONS, SUPERVISOR_DECISIONS, is_valid_subtype
from app.models import Carrier, Company, DockDoor, Issue, IssuePhoto, Product
from app.queries import count_recent_issues, issue_select, load_kb_entries
from app.schemas import (
    IssueCreate,
    IssueCreated,
    IssueOut,
    IssueSelfResolve,
    IssueSupervisorResolve,
    PhotoOut,
    StatusOut,
)

router = APIRouter(tags=["issues"])


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


@router.get("/issues")
async def list_issues(
    user: CurrentUser,
    session: SessionDep,
    status: Annotated[str | None, Query(description="An issue status, or 'active' for open issues")] = None,
    operator_id: int | None = None,
    severity: Severity | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[IssueOut]:
    stmt = issue_select().where(issue_scope(user)).order_by(Issue.created_at.desc()).limit(limit)
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
    return [IssueOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.get("/issues/{issue_id}")
async def get_issue(issue_id: int, user: CurrentUser, session: SessionDep) -> IssueOut:
    await visible_issue(session, user, issue_id)
    return await _issue_out(session, issue_id)


@router.post("/issues")
async def create_issue(
    body: IssueCreate, user: Operator, session: SessionDep, events: RealtimeDep
) -> IssueCreated:
    if body.issue_type not in ISSUE_TYPES:
        raise unprocessable(f"Unknown issue type '{body.issue_type}'")
    if not is_valid_subtype(body.issue_type, body.issue_subtype):
        raise unprocessable(f"'{body.issue_subtype}' is not a subtype of '{body.issue_type}'")

    dock = await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
    product = (
        await get_or_404(session, Product, body.product_id, "Product")
        if body.product_id is not None
        else None
    )
    company = (
        await get_or_404(session, Company, body.company_id, "Company")
        if body.company_id is not None
        else None
    )
    carrier = (
        await get_or_404(session, Carrier, body.carrier_id, "Carrier")
        if body.carrier_id is not None
        else None
    )

    now = utcnow()
    dwell_minutes = (
        int((now - dock.trailer_arrived_at).total_seconds() // 60)
        if dock.trailer_arrived_at is not None
        else None
    )
    category = product.category.value if product else None
    scored = classify_severity(
        body.issue_type,
        product_category=category,
        customer_tier=company.tier if company else None,
        temp_reading=body.temp_reading,
        temp_threshold_max=body.temp_threshold_max,
        count_expected=body.count_expected,
        count_actual=body.count_actual,
        is_allergen=product.is_allergen if product else False,
        trailer_dwell_minutes=dwell_minutes,
        issue_subtype=body.issue_subtype,
    )
    kb_query = " ".join(filter(None, [body.issue_subtype, body.description]))
    resolution = find_resolution(
        await load_kb_entries(session),
        body.issue_type,
        kb_query,
        product_category=category,
        company_name=company.name if company else None,
    )
    cost = estimate_cost_impact(
        product.case_value if product else None,
        body.quantity_affected or 1,
        body.issue_type,
        body.issue_subtype,
    )

    # Counts include this report: the 3rd issue in the window is the one that raises the pattern.
    since = now - timedelta(days=RECURRENCE_WINDOW_DAYS)
    patterns: list[dict[str, Any]] = []
    dock_count = await count_recent_issues(session, body.issue_type, since, dock_door_id=dock.id)
    if found := dock_pattern(dock_count + 1, body.issue_type, dock.door_number, RECURRENCE_WINDOW_DAYS):
        patterns.append(found)
    if carrier is not None:
        carrier_count = await count_recent_issues(session, body.issue_type, since, carrier_id=carrier.id)
        if found := carrier_pattern(carrier_count + 1, body.issue_type, carrier.name, RECURRENCE_WINDOW_DAYS):
            patterns.append(found)

    issue = Issue(
        order_id=body.order_id,
        dock_door_id=dock.id,
        operator_id=user.id,
        issue_type=body.issue_type,
        issue_subtype=body.issue_subtype,
        description=body.description,
        quick_tags=body.quick_tags,
        severity=scored.severity,
        severity_score=scored.score,
        severity_reason=scored.reason,
        status=IssueStatus.RESOLUTION_IN_PROGRESS,
        ai_resolution=resolution,
        recurring_patterns=patterns,
        ai_confidence=Confidence(resolution["confidence"]),
        product_id=body.product_id,
        company_id=body.company_id,
        carrier_id=body.carrier_id,
        estimated_cost_impact=cost,
        created_at=now,
    )
    session.add(issue)
    dock.status, dock.lifecycle_phase = transition(
        dock.status, dock.lifecycle_phase, DockEvent.ISSUE_REPORTED
    )
    dock.last_activity_at = now
    await session.commit()

    created = await _issue_out(session, issue.id)
    await events.send(await issue_audience(session, issue), realtime.new_issue(created.model_dump()))
    return IssueCreated(
        id=issue.id,
        severity=scored.severity,
        severity_score=scored.score,
        severity_reason=scored.reason,
        ai_resolution=resolution,
        estimated_cost_impact=cost,
        recurring_patterns=patterns,
    )


async def _reopen_dock(session: AsyncSession, issue: Issue) -> None:
    if issue.dock_door_id is None:
        return
    dock = await get_or_404(session, DockDoor, issue.dock_door_id, "Dock")
    dock.status, dock.lifecycle_phase = transition(
        dock.status, dock.lifecycle_phase, DockEvent.ISSUE_RESOLVED
    )


@router.put("/issues/{issue_id}/self-resolve")
async def self_resolve_issue(
    issue_id: int, body: IssueSelfResolve, user: Operator, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    issue = await visible_issue(session, user, issue_id)
    if body.resolution_type not in OPERATOR_RESOLUTIONS:
        raise unprocessable(f"Unknown resolution '{body.resolution_type}'")
    _move(issue, IssueStatus.SELF_RESOLVED)
    issue.resolution_type = body.resolution_type
    issue.resolution_notes = body.resolution_notes
    issue.resolved_at = utcnow()
    await _reopen_dock(session, issue)
    await session.commit()
    await events.send(
        await issue_audience(session, issue),
        realtime.issue_resolved(issue_id, IssueStatus.SELF_RESOLVED.value),
    )
    return StatusOut(status=IssueStatus.SELF_RESOLVED.value)


@router.put("/issues/{issue_id}/escalate")
async def escalate_issue(
    issue_id: int, user: CurrentUser, session: SessionDep, events: RealtimeDep
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


@router.put("/issues/{issue_id}/supervisor-resolve")
async def supervisor_resolve_issue(
    issue_id: int, body: IssueSupervisorResolve, user: Supervisor, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    issue = await visible_issue(session, user, issue_id)  # scoped: only this supervisor's team
    if body.resolution_type not in SUPERVISOR_DECISIONS:
        raise unprocessable(f"Unknown decision '{body.resolution_type}'")
    _move(issue, IssueStatus.SUPERVISOR_RESOLVED)
    now = utcnow()
    issue.supervisor_id = user.id
    issue.resolution_type = body.resolution_type
    issue.supervisor_notes = body.supervisor_notes
    issue.acknowledged_at = issue.acknowledged_at or now
    issue.resolved_at = now
    await _reopen_dock(session, issue)
    await session.commit()
    await events.send(
        await issue_audience(session, issue),
        realtime.issue_resolved(issue_id, IssueStatus.SUPERVISOR_RESOLVED.value),
    )
    return StatusOut(status=IssueStatus.SUPERVISOR_RESOLVED.value)


# ── Photo evidence ──


@router.post("/issues/{issue_id}/photos", status_code=http.HTTP_201_CREATED)
async def upload_photo(issue_id: int, file: UploadFile, user: CurrentUser, session: SessionDep) -> PhotoOut:
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
async def list_photos(issue_id: int, user: CurrentUser, session: SessionDep) -> list[PhotoOut]:
    await visible_issue(session, user, issue_id)
    photos = await session.scalars(
        select(IssuePhoto).where(IssuePhoto.issue_id == issue_id).order_by(IssuePhoto.id)
    )
    return [PhotoOut.model_validate(photo) for photo in photos]


@router.get("/photos/{photo_id}", response_class=Response)
async def get_photo(photo_id: int, user: CurrentUser, session: SessionDep) -> Response:
    photo = await get_or_404(session, IssuePhoto, photo_id, "Photo")
    await visible_issue(session, user, photo.issue_id)
    return Response(
        content=photo.data,
        media_type=photo.content_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
