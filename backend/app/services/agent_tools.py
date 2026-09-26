"""The assistant's tools: what it can look up, check and draft — always as the signed-in person.

Every read goes through the same row scope as the API (`app.api.access`), so the assistant can never
show someone data their own screens would not. Every number comes from a deterministic function in
`app.domain` (severity, temperature, retrieval); the model only chooses which tool to call and phrases
the answer. Nothing here writes to the database: `draft_*` tools return a draft that the person
confirms with a button, which calls the ordinary endpoint.

Tool descriptions follow the tool-use guidance for agents: what the tool does, when to use it (and
when not), what each parameter means, and what it does not return.
"""

import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import issue_scope, order_scope
from app.db import MAX_ID
from app.domain.enums import IssueStatus, OrderStatus, ProductCategory, Role, Severity
from app.domain.lifecycle import OPEN_STATUSES, can_self_resolve, requires_supervisor
from app.domain.receiving import check_probe_temperature
from app.domain.retrieval import (
    CRITICAL,
    INBOUND,
    MARGINAL,
    OUTBOUND,
    TEMPERATURE_BANDS,
    find_resolution,
    temperature_band,
)
from app.domain.taxonomy import ISSUE_TYPES, OPERATOR_RESOLUTIONS, is_valid_subtype
from app.models import Carrier, Company, DockDoor, Issue, Order, OrderItem, Product, User
from app.queries import load_kb_entries
from app.schemas import (
    AgentAction,
    AgentCard,
    BroadcastDraft,
    HandoffDraft,
    IssueCreate,
    IssueDraft,
    IssueLine,
    IssuesCard,
    OrderCard,
    OrderLine,
    ProcedureCard,
    RoomLine,
    RoomsCard,
    SelfResolveDraft,
    StockCard,
    StockPallet,
    TemperatureCard,
    TraceCard,
    TraceMove,
)
from app.services.issue_filing import find_procedure_for, score_issue
from app.wms.client import WmsClient, WmsUnavailable

MAX_LIST = 8
SUMMARY_HOURS = 12
BROADCAST_MAX = 280
HANDOFF_MAX = 2000


class ToolError(Exception):
    """A tool could not do what was asked. The message goes back to the model so it can recover."""


@dataclass
class ToolContext:
    session: AsyncSession
    user: User
    wms: WmsClient
    now: datetime


@dataclass
class ToolOutcome:
    data: dict[str, Any]  # compact, high-signal: what the model reads
    summary: str  # one line for the person: what was checked
    cards: list[AgentCard] = field(default_factory=list)
    actions: list[AgentAction] = field(default_factory=list)


# ── Shared lookups ──


async def _active_order(ctx: ToolContext) -> Order | None:
    return await ctx.session.scalar(
        select(Order)
        .where(Order.operator_id == ctx.user.id, Order.status == OrderStatus.IN_PROGRESS)
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(1)
    )


async def _order_card(ctx: ToolContext, order: Order) -> OrderCard:
    rows = await ctx.session.execute(
        select(Product.sku, Product.name, OrderItem.actual_quantity, OrderItem.expected_quantity)
        .join(Product, Product.id == OrderItem.product_id)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id)
    )
    company = await ctx.session.get(Company, order.company_id)
    dock = await ctx.session.get(DockDoor, order.dock_door_id) if order.dock_door_id else None
    return OrderCard(
        order_id=order.id,
        order_number=order.order_number,
        customer=company.name if company else "Unknown",
        type=order.type,
        door=dock.door_number if dock else None,
        status=order.status,
        lines=[
            OrderLine(sku=sku, name=name, counted=counted, expected=expected)
            for sku, name, counted, expected in rows
        ],
        simulated=order.simulated,
    )


def _order_data(card: OrderCard, company: Company | None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "order_number": card.order_number,
        "type": card.type.value,
        "customer": card.customer,
        "door": card.door,
        "status": card.status.value,
        "lines": [line.model_dump() for line in card.lines],
    }
    if company is not None:
        data["customer_rules"] = {
            "tier": company.tier,
            "count_tolerance_percent": round(company.count_tolerance * 100),
            "load_pattern": company.load_pattern,
            "sop": company.sop_rules,
        }
    return data


async def _issue_lines(ctx: ToolContext, *conditions: Any) -> list[IssueLine]:
    rows = await ctx.session.execute(
        select(Issue, DockDoor.door_number)
        .outerjoin(DockDoor, DockDoor.id == Issue.dock_door_id)
        .where(issue_scope(ctx.user), *conditions)
        .order_by(Issue.created_at.desc(), Issue.id.desc())
        .limit(MAX_LIST)
    )
    return [
        IssueLine(
            id=issue.id,
            severity=issue.severity,
            title=issue.issue_subtype or issue.issue_type,
            door=door,
            status=issue.status,
            minutes_open=max(0, int((ctx.now - issue.created_at).total_seconds() // 60)),
        )
        for issue, door in rows
    ]


OPEN = tuple(OPEN_STATUSES)  # the lifecycle owns what counts as open (includes on_hold)


def open_for(minutes: int) -> str:
    """How long, the way a person says it: "45 minutes", "3 hours", "12 days"."""
    if minutes < 90:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    if minutes < 48 * 60:
        return f"{round(minutes / 60)} hours"
    return f"{round(minutes / 1440)} days"


def _line_data(line: IssueLine) -> dict[str, Any]:
    """What the model reads about an issue: readable durations, never raw minute counts."""
    data = line.model_dump(mode="json", exclude={"minutes_open"})
    data["open_for"] = open_for(line.minutes_open)
    return data


# ── Tools ──


async def my_work(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    if ctx.user.role is Role.OPERATOR:
        order = await _active_order(ctx)
        mine = await _issue_lines(ctx, Issue.status.in_(OPEN))
        cards: list[AgentCard] = []
        data: dict[str, Any] = {"open_issues_you_reported": [_line_data(line) for line in mine]}
        if order is not None:
            card = await _order_card(ctx, order)
            cards.append(card)
            data["active_order"] = _order_data(card, await ctx.session.get(Company, order.company_id))
        else:
            data["active_order"] = None
        if mine:
            cards.append(IssuesCard(title="Your open issues", issues=mine))
        summary = f"Your order {order.order_number}" if order else "No active order"
        return ToolOutcome(data, summary, cards)

    escalated = await _issue_lines(ctx, Issue.status == IssueStatus.ESCALATED)
    working = await _issue_lines(ctx, Issue.status == IssueStatus.RESOLUTION_IN_PROGRESS)
    active = await ctx.session.scalar(
        select(func.count(Order.id)).where(order_scope(ctx.user), Order.status == OrderStatus.IN_PROGRESS)
    )
    title = "Escalated to you" if ctx.user.role is Role.SUPERVISOR else "Open quality issues"
    cards = [IssuesCard(title=title, issues=escalated or working)] if escalated or working else []
    data = {
        "escalated": [_line_data(line) for line in escalated],
        "being_resolved_at_the_dock": [_line_data(line) for line in working],
        "trailers_being_worked": active or 0,
    }
    return ToolOutcome(data, f"{len(escalated)} escalated, {len(working)} in progress", cards)


QUOTE_RULE = (
    "Give these steps word for word, in this order, with the source. Do not add, merge, reword or "
    "generalise steps."
)
LOW_MATCH_NOTE = (
    "Weak match: this procedure may not fit. Say so, give only these steps, and add nothing of your own."
)
BAND_APPLIES = {
    MARGINAL: "reading 0–5°F over the product's limit",
    CRITICAL: "reading more than 5°F over the product's limit",
}


def _procedure_card(found: dict[str, Any], fallback_title: str) -> ProcedureCard:
    return ProcedureCard(
        title=str(found.get("scenario") or fallback_title),
        steps=[str(step) for step in found.get("steps", [])],
        source=str(found.get("source") or "DockIQ knowledge base"),
        confidence=found.get("confidence", "low"),
    )


async def _order_limit(ctx: ToolContext, order: Order) -> float | None:
    """The strictest temperature limit of any product on the order."""
    limits = await ctx.session.scalars(
        select(Product.temp_max)
        .join(OrderItem, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id == order.id)
    )
    return min((limit for limit in limits if limit is not None), default=None)


async def find_procedure(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    issue_type = str(args.get("issue_type") or "")
    if issue_type not in ISSUE_TYPES:
        raise ToolError(f"Unknown issue_type. Use one of: {', '.join(ISSUE_TYPES)}")
    description = str(args.get("description") or "")
    order: Order | None = None
    if number := args.get("order_number"):
        order = await ctx.session.scalar(
            select(Order).where(Order.order_number == str(number).upper(), order_scope(ctx.user))
        )
        if order is None:
            raise ToolError(f"No order {number} that you can see")
    elif ctx.user.role is Role.OPERATOR:
        order = await _active_order(ctx)
    company = await ctx.session.get(Company, order.company_id) if order else None
    direction = args.get("direction") if args.get("direction") in (INBOUND, OUTBOUND) else None
    if direction is None and order is not None:
        direction = order.type.value

    # A reading picks the temperature band; without one, both bands' procedures come back, each
    # labelled with when it applies, so the answer never has to bridge the gap itself.
    bands: tuple[str | None, ...] = (None,)
    reading = _number(args.get("reading_f"))
    limit = await _order_limit(ctx, order) if order is not None else None
    if issue_type == "Temperature Deviation":
        band = temperature_band(reading - limit) if reading is not None and limit is not None else None
        bands = (band,) if band is not None else TEMPERATURE_BANDS
    entries = await load_kb_entries(ctx.session)
    cards: list[ProcedureCard] = []
    procedures: list[dict[str, Any]] = []
    for band in bands:
        found = find_resolution(
            entries,
            issue_type,
            description,
            product_category=args.get("product_category"),
            company_name=company.name if company else None,
            direction=direction,
            temp_band=band,
        )
        card = _procedure_card(found, issue_type)
        if any(existing.title == card.title for existing in cards):
            continue
        cards.append(card)
        procedure = card.model_dump(exclude={"kind"})
        if band is not None and len(bands) > 1:
            procedure["applies_when"] = BAND_APPLIES[band]
        if card.confidence == "low":
            procedure["note"] = LOW_MATCH_NOTE
        procedures.append(procedure)

    data: dict[str, Any] = (
        dict(procedures[0])
        if len(procedures) == 1
        else {
            "procedures": procedures,
            "choose": "Ask for the reading, or give each procedure with when it applies.",
        }
    )
    data["how_to_answer"] = QUOTE_RULE
    if direction is not None:
        data["direction"] = "loading (outbound)" if direction == OUTBOUND else "receiving (inbound)"
    if reading is not None and limit is not None:
        data["reading_over_limit_f"] = round(reading - limit, 1)
    if company is not None:
        data["this_customer_sop"] = company.sop_rules
    return ToolOutcome(data, f"Procedure: {' / '.join(card.title for card in cards)}", list(cards))


async def check_temperature(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    try:
        reading = float(args["reading_f"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ToolError("reading_f must be the probe reading in °F, as a number") from exc
    if not math.isfinite(reading):
        raise ToolError("reading_f must be the probe reading in °F, as a number")
    order: Order | None = None
    if number := args.get("order_number"):
        order = await ctx.session.scalar(
            select(Order).where(Order.order_number == str(number), order_scope(ctx.user))
        )
        if order is None:
            raise ToolError(f"No order {number} that you can see")
    elif ctx.user.role is Role.OPERATOR:
        order = await _active_order(ctx)
    if order is None:
        raise ToolError("No order to check against. Ask for the order number.")
    limits = await ctx.session.scalars(
        select(Product.temp_max)
        .join(OrderItem, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id == order.id)
    )
    result = check_probe_temperature(reading, list(limits), order.type)
    card = TemperatureCard(
        status=result.status.value,
        reading=result.reading,
        limit=result.limit,
        delta=result.delta,
        guidance=result.guidance,
        order_number=order.order_number,
    )
    return ToolOutcome(
        card.model_dump(exclude={"kind"}), f"{reading}°F on {order.order_number}: {card.status}", [card]
    )


SKU_PATTERN = re.compile(r"\b[A-Z]{2,4}-[A-Z]{2}-\d{3,5}\b")


async def locate_stock(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    query = str(args.get("sku_or_name") or "").strip()
    if not query:
        raise ToolError("Give a SKU (like CRM-FZ-1001) or part of a product name")
    product = await ctx.session.scalar(select(Product).where(Product.sku == query.upper()))
    if product is None:
        product = await ctx.session.scalar(
            select(Product).where(Product.name.ilike(f"%{query}%")).order_by(Product.name).limit(1)
        )
    if product is None:
        raise ToolError(f"No product matches '{query}'")
    try:
        pallets = await ctx.wms.inventory(product.sku)
        online = True
    except WmsUnavailable:
        pallets, online = [], False
    card = StockCard(
        sku=product.sku,
        product_name=product.name,
        pallets=[
            StockPallet(
                pallet_id=p.pallet_id,
                location=p.location,
                cases=p.cases,
                lot=p.lot,
                best_before=p.best_before,
            )
            for p in pallets[:MAX_LIST]
        ],
        wms_online=online,
    )
    data = card.model_dump(exclude={"kind"})
    if not online:
        data["note"] = "The WMS is offline. Tell the person to use the paper pick list."
    summary = f"{product.sku}: {len(pallets)} pallets" if online else f"{product.sku}: WMS offline"
    return ToolOutcome(data, summary, [card])


async def look_up(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    kind = args.get("kind")
    reference = str(args.get("reference") or "").strip().lstrip("#")
    if not reference:
        raise ToolError("reference is required")
    match kind:
        case "order":
            order = await ctx.session.scalar(
                select(Order).where(Order.order_number == reference.upper(), order_scope(ctx.user))
            )
            if order is None and (order_id := _record_id(reference)) is not None:
                order = await ctx.session.scalar(
                    select(Order).where(Order.id == order_id, order_scope(ctx.user))
                )
            if order is None:
                raise ToolError(f"No order '{reference}' that you can see")
            card = await _order_card(ctx, order)
            data = _order_data(card, await ctx.session.get(Company, order.company_id))
            return ToolOutcome(data, f"Order {order.order_number}", [card])
        case "issue":
            issue_id = _record_id(reference)
            if issue_id is None:
                raise ToolError("An issue reference is its number, like 42")
            issue = await ctx.session.scalar(select(Issue).where(Issue.id == issue_id, issue_scope(ctx.user)))
            if issue is None:
                raise ToolError(f"No issue #{reference} that you can see")
            resolution = issue.ai_resolution or {}
            data = {
                "id": issue.id,
                "type": issue.issue_type,
                "subtype": issue.issue_subtype,
                "description": issue.description,
                "severity": issue.severity.value,
                "severity_reason": issue.severity_reason,
                "status": issue.status.value,
                "procedure_steps": resolution.get("steps", []),
                "procedure_source": resolution.get("source"),
                "simulated": issue.simulated,
            }
            lines = await _issue_lines(ctx, Issue.id == issue.id)
            return ToolOutcome(
                data, f"Issue #{issue.id}", [IssuesCard(title=f"Issue #{issue.id}", issues=lines)]
            )
        case "product":
            product = await ctx.session.scalar(select(Product).where(Product.sku == reference.upper()))
            if product is None:
                product = await ctx.session.scalar(
                    select(Product)
                    .where(Product.name.ilike(f"%{reference}%"))
                    .order_by(Product.name)
                    .limit(1)
                )
            if product is None:
                raise ToolError(f"No product matches '{reference}'")
            data = {
                "sku": product.sku,
                "name": product.name,
                "category": product.category.value,
                "temp_max_f": product.temp_max,
                "temp_min_f": product.temp_min,
                "is_allergen": product.is_allergen,
                "cases_per_pallet": product.cases_per_pallet,
                "weight_per_case_lb": product.weight_per_case,
            }
            return ToolOutcome(data, f"Product {product.sku}")
    raise ToolError("kind must be one of: order, issue, product")


async def draft_issue_report(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    issue_type = str(args.get("issue_type") or "")
    spec = ISSUE_TYPES.get(issue_type)
    if spec is None:
        raise ToolError(f"Unknown issue_type. Use one of: {', '.join(ISSUE_TYPES)}")
    subtype = args.get("issue_subtype") or None
    if not is_valid_subtype(issue_type, subtype):
        raise ToolError(f"issue_subtype must be one of: {'; '.join(spec.subtypes)}")
    order = await _active_order(ctx)
    if order is None or order.dock_door_id is None:
        raise ToolError(
            "You have no order at a door. Tell the person to use the Report screen and pick the dock."
        )

    product: Product | None = None
    if sku := args.get("product_sku"):
        product = await ctx.session.scalar(
            select(Product)
            .join(OrderItem, OrderItem.product_id == Product.id)
            .where(OrderItem.order_id == order.id, Product.sku == str(sku).upper())
        )
        if product is None:
            raise ToolError(f"{sku} is not on order {order.order_number}")
    temp_reading = _number(args.get("temp_reading_f"))
    temp_limit: float | None = None
    if temp_reading is not None:
        temp_limit = product.temp_max if product is not None else await _order_limit(ctx, order)
    count_expected, count_actual = _integer(args.get("count_expected")), _integer(args.get("count_actual"))
    payload = IssueCreate(
        order_id=order.id,
        dock_door_id=order.dock_door_id,
        issue_type=issue_type,
        issue_subtype=subtype,
        description=str(args.get("description") or "")[:500],
        product_id=product.id if product else None,
        company_id=order.company_id,
        carrier_id=order.carrier_id,
        # Only what the person said: an unstated quantity is not "1 case" (business-rules §1.9).
        quantity_affected=_integer(args.get("quantity_affected")),
        temp_reading=temp_reading,
        temp_threshold_max=temp_limit,
        count_expected=count_expected,
        count_actual=count_actual,
    )

    # The same inputs and formula filing uses — a preview, recomputed by the server when filed.
    company = await ctx.session.get(Company, order.company_id)
    dock = await ctx.session.get(DockDoor, order.dock_door_id)
    scored = await score_issue(ctx.session, payload, product=product, company=company, dock=dock, now=ctx.now)
    found = await find_procedure_for(ctx.session, payload, product=product, company=company)
    draft = IssueDraft(
        payload=payload,
        severity=scored.severity,
        severity_score=scored.score,
        severity_reason=scored.reason,
        steps=[str(step) for step in found.get("steps", [])],
        source=str(found.get("source") or "DockIQ knowledge base"),
    )
    data = {
        "draft_ready": True,
        "not_filed_yet": "The person must press File report to submit it.",
        "severity_preview": scored.severity.value,
        "severity_reason": scored.reason,
        "first_steps": draft.steps[:3],
        "source": draft.source,
    }
    return ToolOutcome(data, f"Drafted: {subtype or issue_type} ({scored.severity.value})", actions=[draft])


async def shift_summary(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    since = ctx.now - timedelta(hours=SUMMARY_HOURS)
    base = (issue_scope(ctx.user), Issue.created_at >= since)
    by_severity = dict(
        (row[0].value, row[1])
        for row in await ctx.session.execute(
            select(Issue.severity, func.count()).where(*base).group_by(Issue.severity)
        )
    )
    by_type = [
        {"type": row[0], "count": row[1]}
        for row in await ctx.session.execute(
            select(Issue.issue_type, func.count().label("n"))
            .where(*base)
            .group_by(Issue.issue_type)
            .order_by(func.count().desc())
            .limit(5)
        )
    ]
    by_status = dict(
        (row[0].value, row[1])
        for row in await ctx.session.execute(
            select(Issue.status, func.count()).where(*base).group_by(Issue.status)
        )
    )
    carriers = [
        {"carrier": row[0], "issues": row[1]}
        for row in await ctx.session.execute(
            select(Carrier.name, func.count(Issue.id))
            .join(Issue, Issue.carrier_id == Carrier.id)
            .where(*base)
            .group_by(Carrier.name)
            .order_by(func.count(Issue.id).desc())
            .limit(3)
        )
    ]
    escalated = await _issue_lines(ctx, Issue.status == IssueStatus.ESCALATED)
    data = {
        "window_hours": SUMMARY_HOURS,
        "by_severity": by_severity,
        "by_status": by_status,
        "top_types": by_type,
        "top_carriers": carriers,
        "still_escalated": [_line_data(line) for line in escalated],
    }
    cards: list[AgentCard] = [IssuesCard(title="Still escalated", issues=escalated)] if escalated else []
    total = sum(by_severity.values())
    return ToolOutcome(data, f"Last {SUMMARY_HOURS} h: {total} issues", cards)


async def draft_broadcast(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    message = " ".join(str(args.get("message") or "").split())
    if not message:
        raise ToolError("message is required")
    if len(message) > BROADCAST_MAX:
        raise ToolError(f"Keep it under {BROADCAST_MAX} characters; tablets show it as one banner")
    draft = BroadcastDraft(message=message)
    data = {"draft_ready": True, "not_sent_yet": "The supervisor must press Send to the team."}
    return ToolOutcome(data, "Drafted a broadcast", actions=[draft])


async def draft_handoff(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    notes = str(args.get("notes") or "").strip()
    if len(notes) < 20:
        raise ToolError("Write the handoff notes (at least a sentence), based on shift_summary")
    draft = HandoffDraft(notes=notes[:HANDOFF_MAX])
    data = {
        "draft_ready": True,
        "not_saved_yet": "The supervisor edits it on the Handoff screen and submits.",
    }
    return ToolOutcome(data, "Drafted the handoff note", actions=[draft])


# ── Self-resolve: the worker closes their own issue, with a button (business-rules §7, §7.1) ──


def _why_not_self_resolve(status: IssueStatus, severity: Severity) -> str | None:
    if can_self_resolve(status, severity):
        return None
    if status not in OPEN_STATUSES:
        return "Already resolved."
    if requires_supervisor(severity):
        return "Critical: your supervisor decides. A critical issue cannot be resolved on your own."
    return "It is with your supervisor now, and they close it."


async def my_open_issues(ctx: ToolContext, _: dict[str, Any]) -> ToolOutcome:
    lines = await _issue_lines(ctx, Issue.status.in_(OPEN_STATUSES))
    issues = []
    for line in lines:
        issue = _line_data(line)
        issue["can_self_resolve"] = can_self_resolve(line.status, line.severity)
        if why := _why_not_self_resolve(line.status, line.severity):
            issue["why_not"] = why
        issues.append(issue)
    resolvable = sum(1 for issue in issues if issue["can_self_resolve"])
    data = {
        "open_issues": issues,
        "resolution_options": list(OPERATOR_RESOLUTIONS),
        "next": "To close one, use draft_self_resolve; the person confirms it with a button.",
    }
    cards: list[AgentCard] = [IssuesCard(title="Your open issues", issues=lines)] if lines else []
    return ToolOutcome(data, f"{len(lines)} open, {resolvable} you can resolve", cards)


async def draft_self_resolve(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    issue_id = _record_id(str(args.get("issue_id") or "").strip().lstrip("#"))
    if issue_id is None:
        raise ToolError("issue_id is the issue's number, like 42. Call my_open_issues to find it.")
    issue = await ctx.session.scalar(select(Issue).where(Issue.id == issue_id, issue_scope(ctx.user)))
    if issue is None:
        raise ToolError(f"No issue #{issue_id} that you reported")
    resolution = args.get("resolution_type") or None
    if resolution is not None and resolution not in OPERATOR_RESOLUTIONS:
        raise ToolError(f"resolution_type must be one of: {', '.join(OPERATOR_RESOLUTIONS)}")
    title = issue.issue_subtype or issue.issue_type
    if why := _why_not_self_resolve(issue.status, issue.severity):
        # Nothing to confirm: a critical or escalated issue is the supervisor's decision.
        data = {"issue": issue.id, "can_self_resolve": False, "why": why, "offer_nothing_to_confirm": True}
        return ToolOutcome(data, f"#{issue.id} cannot be resolved by you")
    draft = SelfResolveDraft(
        issue_id=issue.id,
        title=title,
        severity=issue.severity,
        resolution_type=resolution,
        resolution_notes=" ".join(str(args.get("note") or "").split())[:500],
    )
    data = {
        "draft_ready": True,
        "not_resolved_yet": "The person must press Resolve to close it.",
        "issue": issue.id,
        "resolution_type": resolution or "not chosen: the person picks one on the card",
    }
    return ToolOutcome(data, f"Drafted: resolve #{issue.id}", actions=[draft])


# ── Quality and supervisors: the cold rooms and lot trace, from the WMS ──

ROOM_WORDS = {
    "F": ("freezer", "frozen"),
    "C": ("cooler", "chiller", "refrigerated"),
    "P": ("produce",),
    "D": ("dry",),
}
TRACE_SCAN = 500  # WMS rows read per trace; the answer shows at most MAX_LIST of each kind
TRACE_KINDS = ("receive", "ship", "adjust")


def _room_code(value: Any) -> str | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    for code, words in ROOM_WORDS.items():
        if text == code.lower() or any(word in text for word in words):
            return code
    raise ToolError("room must be one of: freezer, cooler, produce, dry")


async def room_status(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    wanted = _room_code(args.get("room"))
    try:
        rooms = [room for room in await ctx.wms.rooms(1) if wanted is None or room.code == wanted]
    except WmsUnavailable:
        card = RoomsCard(rooms=[], wms_online=False, simulated=False)
        data = {"wms_online": False, "note": "The WMS is offline: read the room displays directly."}
        return ToolOutcome(data, "Cold rooms: WMS offline", [card])
    lines = [
        RoomLine(
            code=room.code,
            name=room.name,
            temp=room.temp,
            limit=room.limit,
            setpoint=room.setpoint,
            over_limit=room.over_limit,
            alarm=room.alarm,
            on_hold_cases=room.on_hold_cases,
        )
        for room in rooms
    ]
    card = RoomsCard(rooms=lines, wms_online=True, simulated=any(room.simulated for room in rooms))
    data = {
        "rooms": [
            {
                "room": line.name,
                "temp_f": line.temp,
                "limit_f": line.limit,
                "setpoint_f": line.setpoint,
                "over_limit": line.over_limit,
                "alarm": line.alarm,
                "cases_on_quality_hold": line.on_hold_cases,
            }
            for line in lines
        ],
        "simulated": card.simulated,
    }
    alarms = [line.name for line in lines if line.alarm]
    summary = f"Alarm: {', '.join(alarms)}" if alarms else f"{len(lines)} rooms, no alarm"
    return ToolOutcome(data, summary, [card])


async def trace_lot(ctx: ToolContext, args: dict[str, Any]) -> ToolOutcome:
    query = str(args.get("sku_or_name") or "").strip()
    if not query:
        raise ToolError("Give the SKU (like CRM-FZ-1001) or part of the product name, and the lot if known")
    product = await ctx.session.scalar(select(Product).where(Product.sku == query.upper()))
    if product is None:
        product = await ctx.session.scalar(
            select(Product).where(Product.name.ilike(f"%{query}%")).order_by(Product.name).limit(1)
        )
    if product is None:
        raise ToolError(f"No product matches '{query}'")
    lot = str(args.get("lot") or "").strip().upper() or None
    try:
        stock = [s for s in await ctx.wms.stock(None, product.sku, TRACE_SCAN) if lot in (None, s.lot)]
        moves = [
            m
            for m in await ctx.wms.transactions(TRACE_SCAN, None, product.sku, None)
            if lot in (None, m.lot) and (m.kind in TRACE_KINDS or (m.to_location or "").endswith("-HOLD"))
        ]
    except WmsUnavailable:
        card = TraceCard(
            sku=product.sku,
            product_name=product.name,
            lot=lot,
            on_hand=[],
            movements=[],
            wms_online=False,
            simulated=False,
        )
        data = {"wms_online": False, "note": "The WMS is offline: trace from the paper receiving log."}
        return ToolOutcome(data, f"{product.sku}: WMS offline", [card])
    card = TraceCard(
        sku=product.sku,
        product_name=product.name,
        lot=lot,
        on_hand=[
            StockPallet(
                pallet_id=s.pallet_id,
                location=s.location,
                cases=s.cases,
                lot=s.lot,
                best_before=s.best_before,
            )
            for s in stock[:MAX_LIST]
        ],
        movements=[
            TraceMove(
                time=m.time,
                kind=m.kind,
                pallet_id=m.pallet_id,
                lot=m.lot,
                cases=m.cases,
                from_location=m.from_location,
                to_location=m.to_location,
                order_number=m.order_number,
            )
            for m in moves[:MAX_LIST]
        ],
        wms_online=True,
        simulated=any(s.simulated for s in stock) or any(m.simulated for m in moves),
    )
    data = {
        "sku": product.sku,
        "product": product.name,
        "lot": lot or "all lots",
        "cases_on_hand": sum(s.cases for s in stock),
        "on_hold": [s.pallet_id for s in stock if s.area == "hold"][:MAX_LIST],
        "lots_on_hand": sorted({s.lot for s in stock})[:MAX_LIST],
        "received_on": sorted({m.order_number for m in moves if m.kind == "receive" and m.order_number})[
            :MAX_LIST
        ],
        "shipped_on": sorted({m.order_number for m in moves if m.kind == "ship" and m.order_number})[
            :MAX_LIST
        ],
        "on_screen": "The card lists the pallets and movements; name orders from these lists only.",
        "simulated": card.simulated,
    }
    return ToolOutcome(data, f"Trace {product.sku}{f' lot {lot}' if lot else ''}", [card])


def _record_id(reference: str) -> int | None:
    """A record number as the database can hold it; anything else is not a record number."""
    if not reference.isdecimal():
        return None
    try:
        value = int(reference)
    except ValueError:  # longer than Python will parse
        return None
    return value if 1 <= value <= MAX_ID else None


def _number(value: Any) -> float | None:
    try:
        number = None if value is None or value == "" else float(value)
    except (TypeError, ValueError):
        return None
    if number is not None and not math.isfinite(number):
        raise ToolError("Numbers must be ordinary finite values")
    return number


def _integer(value: Any) -> int | None:
    """A count: negatives read as 0; beyond what the database holds is an error, not a 500."""
    number = _number(value)
    if number is None:
        return None
    if number > MAX_ID:
        raise ToolError(f"Counts must be at most {MAX_ID}")
    return max(0, int(number))


# ── The catalogue: schemas the model sees, and who may use each tool ──

Handler = Callable[[ToolContext, dict[str, Any]], Awaitable[ToolOutcome]]


@dataclass(frozen=True)
class Tool:
    name: str
    label: str  # what the person sees while it runs
    description: str
    parameters: dict[str, Any]
    handler: Handler
    roles: frozenset[Role]

    def spec(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
        }


EVERYONE = frozenset(Role)
STAFF = frozenset({Role.SUPERVISOR, Role.QUALITY})
NO_ARGS: dict[str, Any] = {"type": "object", "properties": {}}

TOOLS: tuple[Tool, ...] = (
    Tool(
        "my_work",
        "Checking your work",
        "Returns what the signed-in person is working on right now. For a dock operator: their active "
        "order (number, customer, door, each product line with cases counted vs expected, and the "
        "customer's load pattern and SOP rules) and the issues they reported that are still open. For a "
        "supervisor: their team's escalated issues and issues being resolved, oldest first. For Quality: "
        "open quality issues. Use it for 'what's next', 'my order', 'what needs me' or before any answer "
        "that depends on their current load. Takes no parameters.",
        NO_ARGS,
        my_work,
        EVERYONE,
    ),
    Tool(
        "find_procedure",
        "Finding the procedure",
        "Finds the standard operating procedure for a dock problem in the warehouse knowledge base and "
        "returns its steps, the SOP source to cite, and a confidence of high, medium or low. Procedures "
        "differ for loading (outbound) and receiving (inbound): for an operator the direction comes from "
        "their active order. For a temperature problem, give the reading if known: without one it returns "
        "the marginal and the critical procedure, each with when it applies. For an operator it also "
        "returns this customer's specific SOP rules. Quote the steps exactly as returned; never add to "
        "them. Use it for any 'how do I handle…' question. It does not score severity or file anything.",
        {
            "type": "object",
            "properties": {
                "issue_type": {
                    "type": "string",
                    "enum": list(ISSUE_TYPES),
                    "description": "The problem category.",
                },
                "description": {
                    "type": "string",
                    "description": "The situation in the person's words; picks the best-matching procedure.",
                },
                "product_category": {
                    "type": "string",
                    "enum": [category.value for category in ProductCategory],
                    "description": "Optional: the product category, if known.",
                },
                "direction": {
                    "type": "string",
                    "enum": [INBOUND, OUTBOUND],
                    "description": "Optional: outbound = loading, inbound = receiving. Default: the order's.",
                },
                "reading_f": {
                    "type": "number",
                    "description": "Optional: the probe reading in °F, for a temperature problem.",
                },
                "order_number": {
                    "type": "string",
                    "description": "Optional, like ORD-2026-4521: the order it concerns (staff).",
                },
            },
            "required": ["issue_type", "description"],
        },
        find_procedure,
        EVERYONE,
    ),
    Tool(
        "check_temperature",
        "Checking the temperature",
        "Judges a probe reading against the strictest temperature limit of any product on an order, using "
        "the warehouse's fixed rule, and returns the status (ok, marginal, warning or critical), the limit, "
        "how far over it is, and what to do. Use it whenever someone gives a temperature. Defaults to the "
        "operator's active order; pass order_number otherwise. It never decides acceptance itself: repeat "
        "its guidance as given.",
        {
            "type": "object",
            "properties": {
                "reading_f": {"type": "number", "description": "The probe reading in degrees Fahrenheit."},
                "order_number": {"type": "string", "description": "Optional, like ORD-2026-4521."},
            },
            "required": ["reading_f"],
        },
        check_temperature,
        EVERYONE,
    ),
    Tool(
        "locate_stock",
        "Asking the WMS",
        "Asks the warehouse management system where a product is stored: pallet locations (aisle-bay-level) "
        "and cases per pallet. Use it for 'where is…' questions about product. Accepts a SKU like "
        "CRM-FZ-1001 or part of a product name. If the WMS is offline it says so; then the person should "
        "use the paper pick list. It does not know about supplies like pallet wrap.",
        {
            "type": "object",
            "properties": {
                "sku_or_name": {"type": "string", "description": "A SKU or part of a product name."}
            },
            "required": ["sku_or_name"],
        },
        locate_stock,
        EVERYONE,
    ),
    Tool(
        "look_up",
        "Looking it up",
        "Looks up one record the person is allowed to see: an order (by number like ORD-2026-4521 or "
        "SIM-1-004), an issue (by number, like 42) or a product (by SKU or name). Returns its current "
        "details: order lines and customer rules; issue severity, status and procedure; product limits "
        "and allergen flag. Use it when a specific record is mentioned. Records outside the person's team "
        "come back as not found.",
        {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["order", "issue", "product"]},
                "reference": {
                    "type": "string",
                    "description": "The order number, issue number, or SKU/name.",
                },
            },
            "required": ["kind", "reference"],
        },
        look_up,
        EVERYONE,
    ),
    Tool(
        "draft_issue_report",
        "Drafting the report",
        "Prepares an issue report for the operator's active order, WITHOUT filing it. Returns a severity "
        "preview from DockIQ's fixed scoring formula and the first procedure steps. The operator reviews "
        "the draft on screen and presses File report to submit it. Use it when an operator describes a "
        "problem at their dock and wants it reported. issue_subtype must be one of the subtypes of the "
        "chosen type; if unsure, leave it out. Include numbers the person gave (temperature, counts, "
        "cases affected) and never invent them.",
        {
            "type": "object",
            "properties": {
                "issue_type": {"type": "string", "enum": list(ISSUE_TYPES)},
                "issue_subtype": {
                    "type": "string",
                    "description": "Optional: an exact subtype of issue_type.",
                },
                "description": {
                    "type": "string",
                    "description": "One or two plain sentences, in the operator's words.",
                },
                "product_sku": {
                    "type": "string",
                    "description": "Optional: the SKU affected, if on the order.",
                },
                "quantity_affected": {"type": "integer", "description": "Optional: cases affected."},
                "temp_reading_f": {"type": "number", "description": "Optional: probe reading in °F."},
                "count_expected": {"type": "integer", "description": "Optional: cases expected."},
                "count_actual": {"type": "integer", "description": "Optional: cases actually counted."},
            },
            "required": ["issue_type", "description"],
        },
        draft_issue_report,
        frozenset({Role.OPERATOR}),
    ),
    Tool(
        "shift_summary",
        "Summarising the shift",
        f"Summarises the last {SUMMARY_HOURS} hours of issues the person can see: counts by severity and "
        "status, the most frequent issue types, the carriers with the most issues, and what is still "
        "escalated. Use it for 'how is the shift going', handoff notes, or spotting a pattern. It reports "
        "counts only; do not add numbers it did not return.",
        NO_ARGS,
        shift_summary,
        frozenset({Role.SUPERVISOR, Role.QUALITY}),
    ),
    Tool(
        "draft_broadcast",
        "Drafting a broadcast",
        "Prepares a short message for every tablet in the supervisor's team, WITHOUT sending it. The "
        f"supervisor reviews it and presses Send. Keep it under {BROADCAST_MAX} characters, one clear "
        "instruction, plain words. Use it when a supervisor asks to tell, warn or remind the team.",
        {
            "type": "object",
            "properties": {"message": {"type": "string", "description": "The message, as it should appear."}},
            "required": ["message"],
        },
        draft_broadcast,
        frozenset({Role.SUPERVISOR}),
    ),
    Tool(
        "draft_handoff",
        "Drafting the handoff",
        "Prepares the end-of-shift handoff note for the incoming supervisor, WITHOUT saving it. Call "
        "shift_summary first and write only from what it returned: what is still escalated (with issue "
        "numbers and doors), notable patterns, and anything the next shift must watch. Plain sentences, "
        "no more than 8 lines. The supervisor edits the draft on the Handoff screen and submits it.",
        {
            "type": "object",
            "properties": {"notes": {"type": "string", "description": "The handoff note text."}},
            "required": ["notes"],
        },
        draft_handoff,
        frozenset({Role.SUPERVISOR}),
    ),
    Tool(
        "my_open_issues",
        "Checking your open issues",
        "Lists the issues the signed-in operator reported that are still open, newest first, each with "
        "can_self_resolve and, when false, why not (critical issues and escalated issues are the "
        "supervisor's decision), plus the resolution options an operator may choose. Use it when an "
        "operator wants to close, resolve or finish an issue, or says they fixed something. Read-only.",
        NO_ARGS,
        my_open_issues,
        frozenset({Role.OPERATOR}),
    ),
    Tool(
        "draft_self_resolve",
        "Drafting the resolution",
        "Prepares closing one of the operator's own open issues, WITHOUT closing it. The operator checks "
        "the card, picks or confirms the resolution, and presses Resolve. Only for issues my_open_issues "
        "marks can_self_resolve; for a critical or escalated issue it returns why not and there is nothing "
        "to confirm: tell the person the supervisor decides. resolution_type must be one of the "
        "resolution options, matched to what the person said they did; leave it out if unclear.",
        {
            "type": "object",
            "properties": {
                "issue_id": {"type": "integer", "description": "The issue number, like 42."},
                "resolution_type": {
                    "type": "string",
                    "enum": list(OPERATOR_RESOLUTIONS),
                    "description": "Optional: what the operator did.",
                },
                "note": {"type": "string", "description": "Optional: one plain sentence in their words."},
            },
            "required": ["issue_id"],
        },
        draft_self_resolve,
        frozenset({Role.OPERATOR}),
    ),
    Tool(
        "room_status",
        "Reading the cold rooms",
        "Reads the warehouse's temperature rooms from the WMS: each room's current temperature, set-point "
        "and alarm limit, whether it is over the limit or in alarm, and cases on quality hold there. Use it "
        "for freezer, cooler or room temperature questions. Optional room: freezer, cooler, produce, dry. "
        "Says so when the WMS is offline.",
        {
            "type": "object",
            "properties": {
                "room": {
                    "type": "string",
                    "enum": ["freezer", "cooler", "produce", "dry"],
                    "description": "Optional: one room; all rooms when left out.",
                }
            },
        },
        room_status,
        STAFF,
    ),
    Tool(
        "trace_lot",
        "Tracing the lot",
        "Traces a product (and optionally one lot) through the WMS: the pallets on hand and where (quality "
        "hold included), and the latest receipts, shipments and adjustments with their orders, at most "
        f"{MAX_LIST} of each. Use it for recalls, holds and 'where did lot … go' questions. Takes a SKU or "
        "part of a product name, and the lot code if known. Name orders only from what it returns.",
        {
            "type": "object",
            "properties": {
                "sku_or_name": {"type": "string", "description": "A SKU or part of a product name."},
                "lot": {"type": "string", "description": "Optional: the lot code, like L2634K."},
            },
            "required": ["sku_or_name"],
        },
        trace_lot,
        STAFF,
    ),
)

TOOLS_BY_NAME = {tool.name: tool for tool in TOOLS}


def tools_for(role: Role) -> list[Tool]:
    return [tool for tool in TOOLS if role in tool.roles]
