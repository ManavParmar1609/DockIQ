from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query
from fastapi import status as http
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.deps import RealtimeDep, SessionDep, get_or_404
from app.db import utcnow
from app.domain.cost import estimate_cost_impact
from app.domain.dock import DockEvent, transition
from app.domain.enums import Confidence, IssueStatus, Severity
from app.domain.recurrence import RECURRENCE_WINDOW_DAYS, carrier_pattern, dock_pattern
from app.domain.retrieval import find_resolution
from app.domain.severity import classify_severity
from app.models import Carrier, Company, DockDoor, Issue, Product, User
from app.queries import count_recent_issues, issue_select, load_kb_entries
from app.schemas import (
    IssueCreate,
    IssueCreated,
    IssueOut,
    IssueSelfResolve,
    IssueSupervisorResolve,
    StatusOut,
)

router = APIRouter(prefix="/issues", tags=["issues"])

ACTIVE_STATUSES = (IssueStatus.ESCALATED, IssueStatus.RESOLUTION_IN_PROGRESS)


async def _issue_out(session: AsyncSession, issue_id: int) -> IssueOut:
    row = (await session.execute(issue_select().where(Issue.id == issue_id))).first()
    if row is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Issue not found")
    return IssueOut.model_validate(dict(row._mapping))


@router.get("")
async def list_issues(
    session: SessionDep,
    status: Annotated[str | None, Query(description="An issue status, or 'active'")] = None,
    operator_id: int | None = None,
    severity: Severity | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[IssueOut]:
    stmt = issue_select().order_by(Issue.created_at.desc()).limit(limit)
    if status == "active":
        stmt = stmt.where(Issue.status.in_(ACTIVE_STATUSES))
    elif status is not None:
        try:
            stmt = stmt.where(Issue.status == IssueStatus(status))
        except ValueError:
            raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown status '{status}'") from None
    if operator_id is not None:
        stmt = stmt.where(Issue.operator_id == operator_id)
    if severity is not None:
        stmt = stmt.where(Issue.severity == severity)
    return [IssueOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.get("/{issue_id}")
async def get_issue(issue_id: int, session: SessionDep) -> IssueOut:
    return await _issue_out(session, issue_id)


@router.post("", status_code=http.HTTP_200_OK)
async def create_issue(body: IssueCreate, session: SessionDep, events: RealtimeDep) -> IssueCreated:
    dock = await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
    await get_or_404(session, User, body.operator_id, "Operator")
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

    scored = classify_severity(
        body.issue_type,
        product_category=product.category.value if product else None,
        customer_tier=company.tier if company else None,
        temp_reading=body.temp_reading,
        temp_threshold_max=body.temp_threshold_max,
        count_expected=body.count_expected,
        count_actual=body.count_actual,
        is_allergen=product.is_allergen if product else False,
    )
    # KNOWN DEFECT (roadmap 2C): company_name is not passed, so the company bonus never applies.
    resolution = find_resolution(
        await load_kb_entries(session),
        body.issue_type,
        body.description,
        product_category=product.category.value if product else None,
    )
    cost = estimate_cost_impact(
        product.case_value if product else None, body.quantity_affected or 1, body.issue_type
    )

    now = utcnow()
    since = now - timedelta(days=RECURRENCE_WINDOW_DAYS)
    patterns: list[dict[str, Any]] = []
    dock_count = await count_recent_issues(session, body.issue_type, since, dock_door_id=dock.id)
    if found := dock_pattern(dock_count, body.issue_type, dock.door_number, RECURRENCE_WINDOW_DAYS):
        patterns.append(found)
    if carrier is not None:
        carrier_count = await count_recent_issues(session, body.issue_type, since, carrier_id=carrier.id)
        if found := carrier_pattern(carrier_count, body.issue_type, carrier.name, RECURRENCE_WINDOW_DAYS):
            patterns.append(found)

    issue = Issue(
        order_id=body.order_id,
        dock_door_id=dock.id,
        operator_id=body.operator_id,
        issue_type=body.issue_type,
        description=body.description,
        quick_tags=body.quick_tags,
        severity=scored.severity,
        severity_score=scored.score,
        severity_reason=scored.reason,
        status=IssueStatus.RESOLUTION_IN_PROGRESS,
        ai_resolution=resolution,
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

    await events.broadcast(
        realtime.new_issue(
            {
                "id": issue.id,
                "issue_type": issue.issue_type,
                "severity": issue.severity,
                "severity_score": issue.severity_score,
                "dock_door_id": issue.dock_door_id,
                "operator_id": issue.operator_id,
                "description": issue.description,
                "created_at": issue.created_at,
                "estimated_cost_impact": issue.estimated_cost_impact,
            }
        )
    )
    return IssueCreated(
        id=issue.id,
        severity=scored.severity,
        severity_score=scored.score,
        severity_reason=scored.reason,
        ai_resolution=resolution,
        estimated_cost_impact=cost,
        recurring_patterns=patterns,
    )


async def _resolve_dock(session: AsyncSession, issue: Issue) -> None:
    if issue.dock_door_id is None:
        return
    dock = await get_or_404(session, DockDoor, issue.dock_door_id, "Dock")
    dock.status, dock.lifecycle_phase = transition(
        dock.status, dock.lifecycle_phase, DockEvent.ISSUE_RESOLVED
    )


@router.put("/{issue_id}/self-resolve")
async def self_resolve_issue(
    issue_id: int, body: IssueSelfResolve, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    issue = await get_or_404(session, Issue, issue_id, "Issue")
    issue.status = IssueStatus.SELF_RESOLVED
    issue.resolution_type = body.resolution_type
    issue.resolution_notes = body.resolution_notes
    issue.resolved_at = utcnow()
    await _resolve_dock(session, issue)
    await session.commit()
    await events.broadcast(realtime.issue_resolved(issue_id, IssueStatus.SELF_RESOLVED.value))
    return StatusOut(status=IssueStatus.SELF_RESOLVED.value)


@router.put("/{issue_id}/escalate")
async def escalate_issue(issue_id: int, session: SessionDep, events: RealtimeDep) -> StatusOut:
    issue = await get_or_404(session, Issue, issue_id, "Issue")
    issue.status = IssueStatus.ESCALATED
    issue.escalated_at = utcnow()
    if issue.dock_door_id is not None:
        dock = await get_or_404(session, DockDoor, issue.dock_door_id, "Dock")
        dock.status, dock.lifecycle_phase = transition(
            dock.status, dock.lifecycle_phase, DockEvent.ISSUE_ESCALATED, severity=issue.severity
        )
    await session.commit()
    escalated = await _issue_out(session, issue_id)
    await events.broadcast(realtime.issue_escalated(escalated.model_dump()))
    return StatusOut(status=IssueStatus.ESCALATED.value)


@router.put("/{issue_id}/supervisor-resolve")
async def supervisor_resolve_issue(
    issue_id: int, body: IssueSupervisorResolve, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    issue = await get_or_404(session, Issue, issue_id, "Issue")
    await get_or_404(session, User, body.supervisor_id, "Supervisor")
    now = utcnow()
    issue.status = IssueStatus.SUPERVISOR_RESOLVED
    issue.supervisor_id = body.supervisor_id
    issue.resolution_type = body.resolution_type
    issue.supervisor_notes = body.supervisor_notes
    issue.acknowledged_at = now
    issue.resolved_at = now
    await _resolve_dock(session, issue)
    await session.commit()
    await events.broadcast(realtime.issue_resolved(issue_id, IssueStatus.SUPERVISOR_RESOLVED.value))
    return StatusOut(status=IssueStatus.SUPERVISOR_RESOLVED.value)
