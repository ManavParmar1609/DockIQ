from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, UploadFile
from fastapi import status as http
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.access import ensure, issue_audience, issue_scope, supervisor_of, visible_issue
from app.api.deps import CurrentUser, Operator, RealtimeDep, SessionDep, Supervisor, get_or_404
from app.db import utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import IssueStatus, Role, Severity
from app.domain.evidence import MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ISSUE, sniff_image_type
from app.domain.lifecycle import OPEN_STATUSES, can_transition
from app.domain.taxonomy import OPERATOR_RESOLUTIONS, SUPERVISOR_DECISIONS
from app.models import DockDoor, Issue, IssuePhoto
from app.queries import issue_select
from app.schemas import (
    IssueCreate,
    IssueCreated,
    IssueOut,
    IssueSelfResolve,
    IssueSupervisorResolve,
    PhotoOut,
    StatusOut,
)
from app.services.issue_filing import file_issue

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
    issue = await file_issue(session, user.id, body)
    await session.commit()
    created = await _issue_out(session, issue.id)
    await events.send(await issue_audience(session, issue), realtime.new_issue(created.model_dump()))
    return IssueCreated(
        id=issue.id,
        severity=issue.severity,
        severity_score=issue.severity_score or 0,
        severity_reason=issue.severity_reason or "",
        ai_resolution=issue.ai_resolution or {},
        estimated_cost_impact=issue.estimated_cost_impact,
        recurring_patterns=issue.recurring_patterns,
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
