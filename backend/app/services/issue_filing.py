"""Filing an issue: score it, find its procedure, cost it, detect patterns, flag the dock.

Shared by the report endpoint and by receiving (which files count discrepancies automatically), so a
discrepancy found at the dock is scored exactly like one an operator reports by hand. The caller owns
the transaction (this adds to the session and flushes, it never commits) and the caller owns scope:
the report endpoint checks the named order against the person's orders and its dock before calling.
"""

from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from fastapi import status as http
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_or_404
from app.db import utcnow
from app.domain.cost import estimate_cost_impact
from app.domain.dock import DockEvent, transition
from app.domain.enums import Confidence, IssueStatus
from app.domain.lifecycle import requires_supervisor
from app.domain.recurrence import RECURRENCE_WINDOW_DAYS, carrier_pattern, dock_pattern
from app.domain.retrieval import find_resolution
from app.domain.severity import classify_severity
from app.domain.taxonomy import ISSUE_TYPES, is_valid_subtype
from app.models import Carrier, Company, DockDoor, Issue, Product
from app.queries import count_recent_issues, load_kb_entries
from app.schemas import IssueCreate


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, detail)


class SystemFiling(IssueCreate):
    """An issue DockIQ files itself. Unlike a person's report it may have no dock: an inbound order
    signed off before it was given a door still records its count discrepancies."""

    dock_door_id: int | None = None  # type: ignore[assignment]


async def file_issue(
    session: AsyncSession, reporter_id: int, body: IssueCreate, *, simulated: bool = False
) -> Issue:
    if body.issue_type not in ISSUE_TYPES:
        raise _unprocessable(f"Unknown issue type '{body.issue_type}'")
    if not is_valid_subtype(body.issue_type, body.issue_subtype):
        raise _unprocessable(f"'{body.issue_subtype}' is not a subtype of '{body.issue_type}'")

    dock = (
        await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
        if body.dock_door_id is not None
        else None
    )
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
        if dock is not None and dock.trailer_arrived_at is not None
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
    if dock is not None:
        dock_count = await count_recent_issues(session, body.issue_type, since, dock_door_id=dock.id)
        if found := dock_pattern(dock_count + 1, body.issue_type, dock.door_number, RECURRENCE_WINDOW_DAYS):
            patterns.append(found)
    if carrier is not None:
        carrier_count = await count_recent_issues(session, body.issue_type, since, carrier_id=carrier.id)
        if found := carrier_pattern(carrier_count + 1, body.issue_type, carrier.name, RECURRENCE_WINDOW_DAYS):
            patterns.append(found)

    issue = Issue(
        order_id=body.order_id,
        dock_door_id=dock.id if dock is not None else None,
        operator_id=reporter_id,
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
        simulated=simulated,
        created_at=now,
    )
    session.add(issue)
    if requires_supervisor(issue.severity):  # critical: straight to the supervisor (§7.1)
        issue.status = IssueStatus.ESCALATED
        issue.escalated_at = now
    if dock is not None:
        dock.status, dock.lifecycle_phase = transition(
            dock.status, dock.lifecycle_phase, DockEvent.ISSUE_REPORTED
        )
        if issue.status is IssueStatus.ESCALATED:
            dock.status, dock.lifecycle_phase = transition(
                dock.status, dock.lifecycle_phase, DockEvent.ISSUE_ESCALATED, severity=issue.severity
            )
        dock.last_activity_at = now
    await session.flush()
    return issue
