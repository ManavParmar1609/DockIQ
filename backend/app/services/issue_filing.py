"""Filing an issue: score it, find its procedure, cost it, detect patterns, flag the dock.

Shared by the report endpoint and by receiving (which files count discrepancies automatically), so a
discrepancy found at the dock is scored exactly like one an operator reports by hand. The caller owns
the transaction (this adds to the session and flushes, it never commits) and the caller owns scope:
the report endpoint checks the named order against the person's orders and its dock before calling.
"""

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from fastapi import status as http
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base, utcnow
from app.domain.cost import estimate_cost_impact
from app.domain.dock import DockEvent
from app.domain.enums import Confidence, IssueStatus
from app.domain.lifecycle import requires_supervisor
from app.domain.recurrence import RECURRENCE_WINDOW_DAYS, carrier_pattern, dock_pattern
from app.domain.retrieval import find_resolution, temperature_band
from app.domain.severity import SeverityResult, classify_severity
from app.domain.taxonomy import ISSUE_TYPES, is_valid_subtype
from app.models import Carrier, Company, DockDoor, Issue, Order, OrderItem, Product
from app.queries import count_recent_issues, load_kb_entries
from app.schemas import IssueCreate
from app.services.dock_status import apply_issue_event


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, detail)


async def get_or_404[ModelT: Base](
    session: AsyncSession, model: type[ModelT], ident: int, label: str
) -> ModelT:
    """As `app.api.deps.get_or_404`, kept here so services never import the API layer (the assistant's
    tools import this module, and `deps` imports the assistant)."""
    instance = await session.get(model, ident)
    if instance is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, f"{label} not found")
    return instance


class SystemFiling(IssueCreate):
    """An issue DockIQ files itself. Unlike a person's report it may have no dock: an inbound order
    signed off before it was given a door still records its count discrepancies."""

    # A cold-room excursion: the whole room, not one load. Minutes the room has read over its limit.
    room_minutes_over_limit: float | None = None


def given_quantity(body: IssueCreate) -> int | None:
    """Cases affected as the person stated them. The schema's default of 1 is not a statement, so an
    unstated quantity never scales a score down (business-rules §1.9)."""
    return body.quantity_affected if "quantity_affected" in body.model_fields_set else None


async def score_issue(
    session: AsyncSession,
    body: IssueCreate,
    *,
    product: Product | None,
    company: Company | None,
    dock: DockDoor | None,
    now: datetime,
) -> SeverityResult:
    """The severity inputs, built one way for a filing and for the assistant's preview of one."""
    dwell_minutes = (
        int((now - dock.trailer_arrived_at).total_seconds() // 60)
        if dock is not None and dock.trailer_arrived_at is not None
        else None
    )
    line_cases = (
        await session.scalar(
            select(OrderItem.expected_quantity).where(
                OrderItem.order_id == body.order_id, OrderItem.product_id == product.id
            )
        )
        if body.order_id is not None and product is not None
        else None
    )
    return classify_severity(
        body.issue_type,
        product_category=product.category.value if product else None,
        customer_tier=company.tier if company else None,
        temp_reading=body.temp_reading,
        temp_threshold_max=body.temp_threshold_max,
        count_expected=body.count_expected,
        count_actual=body.count_actual,
        is_allergen=product.is_allergen if product else False,
        trailer_dwell_minutes=dwell_minutes,
        issue_subtype=body.issue_subtype,
        quantity_affected=given_quantity(body),
        cases_per_pallet=product.cases_per_pallet if product else None,
        line_cases=line_cases,
        room_minutes_over_limit=body.room_minutes_over_limit if isinstance(body, SystemFiling) else None,
    )


async def find_procedure_for(
    session: AsyncSession, body: IssueCreate, *, product: Product | None, company: Company | None
) -> dict[str, Any]:
    """The knowledge-base procedure for this report: its words, its product, customer, the order's
    direction (loading or receiving) and the band of any temperature reading (business-rules §3)."""
    order = await session.get(Order, body.order_id) if body.order_id is not None else None
    delta = (
        body.temp_reading - body.temp_threshold_max
        if body.temp_reading is not None and body.temp_threshold_max is not None
        else None
    )
    return find_resolution(
        await load_kb_entries(session),
        body.issue_type,
        " ".join(filter(None, [body.issue_subtype, body.description])),
        product_category=product.category.value if product else None,
        company_name=company.name if company else None,
        direction=order.type.value if order is not None else None,
        temp_band=temperature_band(delta),
    )


async def file_issue(
    session: AsyncSession,
    reporter_id: int,
    body: IssueCreate,
    *,
    simulated: bool = False,
    sim_minute: float | None = None,
) -> Issue:
    """`sim_minute`: the simulated minute a simulated issue happened at, so its record lines up with
    the WMS clock."""
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
    order = await get_or_404(session, Order, body.order_id, "Order") if body.order_id is not None else None

    now = utcnow()
    scored = await score_issue(session, body, product=product, company=company, dock=dock, now=now)
    resolution = await find_procedure_for(session, body, product=product, company=company)
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
        # The record as reported, and the order as it is now: traceable if the order later goes.
        temp_reading=body.temp_reading,
        temp_limit=body.temp_threshold_max,
        quantity_affected=given_quantity(body),
        lot=body.lot,
        order_number=order.order_number if order is not None else None,
        trailer_number=order.trailer_number if order is not None else None,
        bol_number=order.bol_number if order is not None else None,
        sim_minute=sim_minute,
        held_pallets=[],
        client_key=body.client_key,
    )
    session.add(issue)
    if requires_supervisor(issue.severity):  # critical: straight to the supervisor (§7.1)
        issue.status = IssueStatus.ESCALATED
        issue.escalated_at = now
    if dock is not None:
        # The door reads everything open on it, this report included: a second, lesser report never
        # downgrades a critical door (business-rules §7.7).
        event = (
            DockEvent.ISSUE_ESCALATED if issue.status is IssueStatus.ESCALATED else DockEvent.ISSUE_REPORTED
        )
        await apply_issue_event(session, dock, event, issue.severity)
        dock.last_activity_at = now
    await session.flush()
    return issue
