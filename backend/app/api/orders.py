from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from fastapi import status as http
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.access import ensure, issue_audience, order_scope, supervisor_of, visible_order
from app.api.deps import CurrentUser, Operator, PathId, RealtimeDep, SessionDep, WmsDep, get_or_404
from app.db import MAX_ID, utcnow
from app.domain.barcodes import decide_scan, normalize_code
from app.domain.dock import DockEvent, transition
from app.domain.enums import IssueStatus, OrderStatus, OrderType, ScanResult, Severity
from app.domain.inspection import evaluate_inspection, interior_temperature_limit
from app.domain.lifecycle import (
    FULL_REJECT,
    OPEN_STATUSES,
    REQUEST_REINSPECTION,
    Rejection,
    completion_blockers,
)
from app.domain.load_plan import LoadPlan, OrderLine, plan_load, rules_from_pattern
from app.domain.quality_hold import holds_stock
from app.domain.receiving import (
    CountLine,
    TemperatureStatus,
    check_probe_temperature,
    count_discrepancies,
    receiving_gaps,
)
from app.domain.taxonomy import RECEIVING_CHECK_IDS, RECEIVING_CHECKS
from app.models import (
    Company,
    DockDoor,
    Issue,
    Order,
    OrderItem,
    Product,
    ReceivingCheck,
    ScanEvent,
    TemperatureCheck,
    TrailerInspection,
    User,
)
from app.queries import issue_select, order_items_select, order_select
from app.schemas import (
    InspectionSummary,
    IssueOut,
    LoadPlanOut,
    LoadStepOut,
    LoadStepUpdate,
    OrderComplete,
    OrderCompleted,
    OrderDetailOut,
    OrderItemOut,
    OrderItemUpdate,
    OrderOut,
    PlacedPalletOut,
    ReceivingCheckOut,
    ReceivingChecksOut,
    ReceivingChecksUpdate,
    ScanCreate,
    ScanOut,
    StatusOut,
    TemperatureCheckCreate,
    TemperatureCheckOut,
    TemperatureLogOut,
)
from app.services.holds import hold_for_issue
from app.services.issue_filing import SystemFiling, file_issue
from app.wms.client import WmsUnavailable

router = APIRouter(prefix="/orders", tags=["orders"])


async def _items(session: AsyncSession, order_id: int) -> list[OrderItemOut]:
    rows = await session.execute(order_items_select(order_id))
    return [OrderItemOut.model_validate(dict(row._mapping)) for row in rows]


async def _open_order(session: AsyncSession, user: User, order_id: int) -> Order:
    """An order the operator is assigned to, still open for counting. A person working a simulated
    trailer takes it over: the simulator stops driving it (business-rules §12)."""
    order = await visible_order(session, user, order_id)
    ensure(order.status is not OrderStatus.COMPLETE, "This order is already complete")
    order.sim_managed = False
    return order


@router.get("")
async def list_orders(
    user: CurrentUser,
    session: SessionDep,
    status: OrderStatus | None = None,
    operator_id: Annotated[int | None, Query(ge=1, le=MAX_ID)] = None,
) -> list[OrderOut]:
    stmt = order_select().where(order_scope(user)).order_by(Order.created_at.desc(), Order.id.desc())
    if status is not None:
        stmt = stmt.where(Order.status == status)
    if operator_id is not None:
        stmt = stmt.where(Order.operator_id == operator_id)
    return [OrderOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


async def _temperature_limits(session: AsyncSession, order_id: int) -> list[float | None]:
    return list(
        await session.scalars(
            select(Product.temp_max)
            .join(OrderItem, OrderItem.product_id == Product.id)
            .where(OrderItem.order_id == order_id)
        )
    )


async def _receiving_gaps(session: AsyncSession, order: Order) -> list[str]:
    """What an inbound order still lacks before sign-off: every check answered, a probe reading when
    the load is temperature-controlled, and no critical probe with its deviation still open (§11.3)."""
    if order.type is not OrderType.INBOUND:
        return []
    answered = await session.scalars(
        select(ReceivingCheck.check_id).where(ReceivingCheck.order_id == order.id)
    )
    probes = await session.scalar(
        select(func.count(TemperatureCheck.id)).where(TemperatureCheck.order_id == order.id)
    )
    open_probe_issues = await session.execute(
        select(Issue.id, func.max(TemperatureCheck.reading))
        .join(TemperatureCheck, TemperatureCheck.issue_id == Issue.id)
        .where(
            TemperatureCheck.order_id == order.id,
            TemperatureCheck.status == TemperatureStatus.CRITICAL.value,
            Issue.status.in_(OPEN_STATUSES),
        )
        .group_by(Issue.id)
        .order_by(Issue.id)
    )
    needs_probe = any(limit is not None for limit in await _temperature_limits(session, order.id))
    return receiving_gaps(
        RECEIVING_CHECK_IDS,
        list(answered),
        probes or 0,
        needs_probe,
        [(issue_id, reading) for issue_id, reading in open_probe_issues],
    )


async def _decision_blockers(session: AsyncSession, order_id: int) -> tuple[list[Rejection], list[str]]:
    """A Full Reject on the order, and re-inspections requested that no passing inspection has met."""
    rejections = [
        Rejection(by=name or "a supervisor", reason=notes)
        for name, notes in await session.execute(
            select(User.name, Issue.supervisor_notes)
            .outerjoin(User, Issue.supervisor_id == User.id)
            .where(
                Issue.order_id == order_id,
                Issue.status == IssueStatus.SUPERVISOR_RESOLVED,
                Issue.resolution_type == FULL_REJECT,
            )
            .order_by(Issue.resolved_at, Issue.id)
        )
    ]
    waiting: list[str] = []
    for name, since in list(
        await session.execute(
            select(User.name, Issue.on_hold_at)
            .outerjoin(User, Issue.supervisor_id == User.id)
            .where(
                Issue.order_id == order_id,
                Issue.status == IssueStatus.ON_HOLD,
                Issue.resolution_type == REQUEST_REINSPECTION,
            )
            .order_by(Issue.on_hold_at, Issue.id)
        )
    ):
        passed = await session.scalar(
            select(TrailerInspection.id)
            .where(
                TrailerInspection.order_id == order_id,
                TrailerInspection.overall_pass,
                TrailerInspection.created_at >= since,
            )
            .limit(1)
        )
        if passed is None:
            waiting.append(name or "a supervisor")
    return rejections, waiting


async def _latest_inspection(session: AsyncSession, order_id: int) -> TrailerInspection | None:
    return await session.scalar(
        select(TrailerInspection)
        .where(TrailerInspection.order_id == order_id)
        .order_by(TrailerInspection.created_at.desc(), TrailerInspection.id.desc())
        .limit(1)
    )


async def _inspection_summary(session: AsyncSession, order_id: int) -> InspectionSummary | None:
    """The latest inspection, with the checks it failed re-derived by the same pure rule (§4)."""
    inspection = await _latest_inspection(session, order_id)
    if inspection is None:
        return None
    outcome = evaluate_inspection(
        inspection.seal_condition,
        inspection.interior_cleanliness,
        inspection.visible_damage,
        inspection.interior_temperature,
        interior_temperature_limit(await _temperature_limits(session, order_id)),
    )
    return InspectionSummary(
        id=inspection.id,
        overall_pass=inspection.overall_pass,
        temperature_limit=outcome.temperature_limit,
        failed_checks=list(outcome.failed_checks),
        interior_temperature=inspection.interior_temperature,
        created_at=inspection.created_at,
    )


async def _blockers(session: AsyncSession, order: Order) -> list[str]:
    """What stops sign-off (business-rules §7.1, §7.2, §11.3): a rejected load, open critical issues, a
    failed inspection no supervisor has cleared, a re-inspection not yet passed, missing receiving
    evidence."""
    order_id = order.id
    open_critical = await session.scalar(
        select(func.count(Issue.id)).where(
            Issue.order_id == order_id, Issue.severity == Severity.CRITICAL, Issue.status.in_(OPEN_STATUSES)
        )
    )
    inspection = await _latest_inspection(session, order_id)
    failed = inspection is not None and not inspection.overall_pass
    cleared = failed and (
        await session.scalar(
            select(Issue.id)
            .where(
                Issue.order_id == order_id,
                Issue.status == IssueStatus.SUPERVISOR_RESOLVED,
                Issue.resolved_at >= inspection.created_at,
            )
            .limit(1)
        )
        is not None
    )
    rejections, waiting = await _decision_blockers(session, order_id)
    return completion_blockers(
        open_critical or 0,
        failed,
        cleared,
        rejections=rejections,
        reinspection_requested_by=waiting,
    ) + await _receiving_gaps(session, order)


@router.get("/{order_id}")
async def get_order(order_id: PathId, user: CurrentUser, session: SessionDep) -> OrderDetailOut:
    order = await visible_order(session, user, order_id)
    row = (await session.execute(order_select().where(Order.id == order_id))).one()
    return OrderDetailOut.model_validate(
        {
            **row._mapping,
            "items": await _items(session, order_id),
            "completion_blockers": await _blockers(session, order),
            "inspection": await _inspection_summary(session, order_id),
        }
    )


async def _plan(session: AsyncSession, order: Order) -> tuple[Company, LoadPlan]:
    company = await get_or_404(session, Company, order.company_id, "Company")
    rows = await session.execute(
        select(OrderItem.expected_quantity, Product)
        .join(Product, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id == order.id)
        .order_by(OrderItem.id)
    )
    lines = [
        OrderLine(
            sku=product.sku,
            product_name=product.name,
            category=product.category.value,
            cases_per_pallet=product.cases_per_pallet,
            weight_per_case=product.weight_per_case,
            expected_quantity=quantity,
        )
        for quantity, product in rows
    ]
    return company, plan_load(lines, rules_from_pattern(company.load_pattern))


@router.get("/{order_id}/load-plan")
async def load_plan(order_id: PathId, user: CurrentUser, session: SessionDep) -> LoadPlanOut:
    """Where every pallet of this order goes in the trailer, by this customer's loading rules."""
    order = await visible_order(session, user, order_id)
    company, plan = await _plan(session, order)
    rules = rules_from_pattern(company.load_pattern)
    return LoadPlanOut(
        order_id=order_id,
        company_name=company.name,
        floor_pattern=rules.floor_pattern.value,
        sequence=rules.sequence.value,
        max_height=rules.max_height,
        heavy_bottom=rules.heavy_bottom,
        slip_sheets=rules.slip_sheets,
        label_direction=rules.label_direction,
        segregate_categories=rules.segregate_categories,
        max_pallets=rules.max_pallets,
        special=rules.special,
        rows=plan.rows,
        floor_positions=plan.floor_positions,
        stacks_used=plan.stacks_used,
        total_pallets=len(plan.placed),
        total_weight_lbs=plan.total_weight_lbs,
        checklist=list(plan.checklist),
        warnings=list(plan.warnings),
        pallets=[
            PlacedPalletOut(
                load_sequence=p.load_sequence,
                row=p.row,
                side=p.side,
                level=p.level,
                orientation=p.orientation,
                sku=p.pallet.sku,
                product_name=p.pallet.product_name,
                category=p.pallet.category,
                cases=p.pallet.cases,
                weight_lbs=p.pallet.weight_lbs,
                partial=p.pallet.partial,
                stop=p.pallet.stop,
            )
            for p in plan.placed
        ],
    )


@router.put("/{order_id}/items")
async def update_order_item(
    order_id: PathId, body: OrderItemUpdate, user: Operator, session: SessionDep
) -> StatusOut:
    await _open_order(session, user, order_id)
    item = await session.scalar(
        select(OrderItem).where(OrderItem.order_id == order_id, OrderItem.product_id == body.product_id)
    )
    if item is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Order item not found")
    item.actual_quantity = body.actual_quantity
    item.verified = True
    await session.commit()
    return StatusOut(status="updated")


@router.post("/{order_id}/scan")
async def scan(order_id: PathId, body: ScanCreate, user: Operator, session: SessionDep) -> ScanOut:
    """Check one scanned case against the order. A match counts the case; anything else counts nothing.

    Every scan is recorded in `scan_events`, mismatches included.
    """
    await _open_order(session, user, order_id)
    code = normalize_code(body.code)
    product = await session.scalar(select(Product).where(or_(Product.gtin == code, Product.sku == code)))
    lines = list(
        await session.execute(
            select(OrderItem, Product.sku).join(Product).where(OrderItem.order_id == order_id)
        )
    )
    expected = [sku for _, sku in lines]
    decision = decide_scan(product.sku if product else None, expected)

    matched: OrderItem | None = None
    if decision.outcome is ScanResult.MATCH:
        matched = next(item for item, sku in lines if sku == decision.scanned_sku)
        matched.actual_quantity += 1
        matched.verified = True
    session.add(
        ScanEvent(
            order_id=order_id,
            user_id=user.id,
            code=code,
            result=decision.outcome,
            product_id=product.id if product else None,
            created_at=utcnow(),
        )
    )
    await session.commit()

    item_out = None
    if matched is not None:
        item_out = next(item for item in await _items(session, order_id) if item.id == matched.id)
    return ScanOut(
        result=decision.outcome,
        code=code,
        scanned_sku=decision.scanned_sku,
        scanned_product_name=product.name if product else None,
        expected_skus=expected,
        item=item_out,
    )


@router.put("/{order_id}/load-step")
async def set_load_step(
    order_id: PathId, body: LoadStepUpdate, user: Operator, session: SessionDep
) -> LoadStepOut:
    """Where the operator is in the load guide, kept on the server so it survives a tablet swap. With
    `count`, stepping on by one counts the pallet just loaded on its order line (never past the line's
    expected cases); stepping back by one takes it off again (never below zero)."""
    order = await _open_order(session, user, order_id)
    if order.type is not OrderType.OUTBOUND:
        raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, "Only an outbound order has a load guide")
    _, plan = await _plan(session, order)
    if body.step > len(plan.placed) + 1:
        raise HTTPException(
            http.HTTP_422_UNPROCESSABLE_CONTENT, f"The load guide has {len(plan.placed)} pallets"
        )
    current = order.load_step or 1
    counting = body.count and body.step != current
    sku: str | None = None
    if counting:
        if abs(body.step - current) != 1:
            raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, "Count one pallet at a time")
        forward = body.step > current
        sequence = current if forward else body.step
        pallet = next(p.pallet for p in plan.placed if p.load_sequence == sequence)
        sku = pallet.sku
        item = await session.scalar(
            select(OrderItem)
            .join(Product, OrderItem.product_id == Product.id)
            .where(OrderItem.order_id == order_id, Product.sku == pallet.sku)
        )
        if item is not None:
            change = pallet.cases if forward else -pallet.cases
            item.actual_quantity = min(item.expected_quantity, max(0, item.actual_quantity + change))
            item.verified = item.actual_quantity > 0
    order.load_step = body.step
    await session.commit()
    counted = (
        next((line for line in await _items(session, order_id) if line.sku == sku), None) if sku else None
    )
    return LoadStepOut(order_id=order_id, load_step=body.step, counted=counted)


@router.post("/{order_id}/temperature-check")
async def temperature_check(
    order_id: PathId,
    body: TemperatureCheckCreate,
    user: Operator,
    session: SessionDep,
    events: RealtimeDep,
    wms: WmsDep,
) -> TemperatureCheckOut:
    """Judge a probe reading against the strictest product limit on this load, and log it (the HACCP
    record). A critical reading files a Temperature Deviation through the ordinary scoring path — or
    joins the one a critical probe already filed that is still open — and holds sign-off until it is
    resolved (business-rules §11.1)."""
    order = await _open_order(session, user, order_id)
    products = list(
        await session.scalars(
            select(Product)
            .join(OrderItem, OrderItem.product_id == Product.id)
            .where(OrderItem.order_id == order_id)
            .order_by(Product.id)
        )
    )
    result = check_probe_temperature(body.reading, [product.temp_max for product in products], order.type)
    now = utcnow()
    filed: Issue | None = None
    issue_id: int | None = None
    if result.status is TemperatureStatus.CRITICAL and result.limit is not None:
        issue_id = await session.scalar(
            select(Issue.id)
            .join(TemperatureCheck, TemperatureCheck.issue_id == Issue.id)
            .where(
                TemperatureCheck.order_id == order_id,
                TemperatureCheck.status == TemperatureStatus.CRITICAL.value,
                Issue.status.in_(OPEN_STATUSES),
            )
            .order_by(Issue.id.desc())
            .limit(1)
        )
        if issue_id is None:
            strictest = min(
                (product for product in products if product.temp_max is not None),
                key=lambda product: (product.temp_max or 0.0, product.id),
            )
            filed = await file_issue(
                session,
                user.id,
                SystemFiling(
                    order_id=order.id,
                    dock_door_id=order.dock_door_id,
                    issue_type="Temperature Deviation",
                    issue_subtype="Product temperature out of range",
                    description=(
                        f"Probe read {result.reading:g}°F against a {result.limit:g}°F limit "
                        f"({result.delta or 0:g}°F over) at receiving"
                    ),
                    product_id=strictest.id,
                    company_id=order.company_id,
                    carrier_id=order.carrier_id,
                    temp_reading=result.reading,
                    temp_threshold_max=result.limit,
                ),
            )
            issue_id = filed.id
    check = TemperatureCheck(
        order_id=order_id,
        user_id=user.id,
        reading=result.reading,
        limit=result.limit,
        delta=result.delta,
        status=result.status.value,
        issue_id=issue_id,
        created_at=now,
    )
    session.add(check)
    await session.commit()
    if filed is not None:
        if holds_stock(filed.issue_type):
            product = next((p for p in products if p.id == filed.product_id), None)
            held = await hold_for_issue(wms, filed, order, product, user.employee_id)
            if held:
                filed.held_pallets = held
                await session.commit()
        row = (await session.execute(issue_select().where(Issue.id == filed.id))).one()
        payload = IssueOut.model_validate(dict(row._mapping)).model_dump()
        await events.send(await issue_audience(session, filed), realtime.new_issue(payload))
    return TemperatureCheckOut(
        status=result.status.value,
        reading=result.reading,
        limit=result.limit,
        delta=result.delta,
        guidance=result.guidance,
        id=check.id,
        issue_id=issue_id,
        created_at=now,
    )


@router.get("/{order_id}/temperature-checks")
async def temperature_log(
    order_id: PathId, user: CurrentUser, session: SessionDep
) -> list[TemperatureLogOut]:
    """The order's probe readings, oldest first: the HACCP log."""
    await visible_order(session, user, order_id)
    rows = await session.execute(
        select(*TemperatureCheck.__table__.c, User.name.label("operator_name"))
        .outerjoin(User, TemperatureCheck.user_id == User.id)
        .where(TemperatureCheck.order_id == order_id)
        .order_by(TemperatureCheck.created_at, TemperatureCheck.id)
    )
    return [TemperatureLogOut.model_validate(dict(row._mapping)) for row in rows]


async def _receiving_checks(session: AsyncSession, order: Order) -> ReceivingChecksOut:
    answers = {
        check.check_id: (check, name)
        for check, name in await session.execute(
            select(ReceivingCheck, User.name)
            .outerjoin(User, ReceivingCheck.user_id == User.id)
            .where(ReceivingCheck.order_id == order.id)
        )
    }
    probes = await session.scalar(
        select(func.count(TemperatureCheck.id)).where(TemperatureCheck.order_id == order.id)
    )
    checks: list[ReceivingCheckOut] = []
    for spec in RECEIVING_CHECKS:
        answer, name = answers.get(spec.id, (None, None))
        checks.append(
            ReceivingCheckOut(
                id=spec.id,
                question=spec.question,
                issue_type=spec.issue_type,
                issue_subtype=spec.issue_subtype,
                answer=answer.answer if answer is not None else None,
                answered_at=answer.answered_at if answer is not None else None,
                answered_by_name=name,
            )
        )
    return ReceivingChecksOut(
        order_id=order.id,
        checks=checks,
        all_answered=all(check.answer is not None for check in checks),
        probes=probes or 0,
        needs_probe=any(limit is not None for limit in await _temperature_limits(session, order.id)),
    )


@router.get("/{order_id}/receiving-checks")
async def get_receiving_checks(
    order_id: PathId, user: CurrentUser, session: SessionDep
) -> ReceivingChecksOut:
    order = await visible_order(session, user, order_id)
    return await _receiving_checks(session, order)


@router.put("/{order_id}/receiving-checks")
async def save_receiving_checks(
    order_id: PathId, body: ReceivingChecksUpdate, user: Operator, session: SessionDep
) -> ReceivingChecksOut:
    """Record answers to the receiving checks (business-rules §11.3). A "No" is evidence, not a
    report: the operator reports it as the issue the check names."""
    order = await _open_order(session, user, order_id)
    if order.type is not OrderType.INBOUND:
        raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, "Receiving checks are for inbound orders")
    unknown = sorted(set(body.answers) - set(RECEIVING_CHECK_IDS))
    if unknown:
        raise HTTPException(http.HTTP_422_UNPROCESSABLE_CONTENT, f"Unknown receiving check '{unknown[0]}'")
    existing = {
        check.check_id: check
        for check in await session.scalars(select(ReceivingCheck).where(ReceivingCheck.order_id == order_id))
    }
    now = utcnow()
    for check_id, answer in body.answers.items():
        row = existing.get(check_id)
        if row is None:
            session.add(
                ReceivingCheck(
                    order_id=order_id, check_id=check_id, answer=answer, user_id=user.id, answered_at=now
                )
            )
        elif row.answer != answer:
            row.answer, row.user_id, row.answered_at = answer, user.id, now
    await session.commit()
    return await _receiving_checks(session, order)


@router.post("/{order_id}/complete")
async def complete_order(
    order_id: PathId,
    body: OrderComplete,
    user: Operator,
    session: SessionDep,
    events: RealtimeDep,
    wms: WmsDep,
) -> OrderCompleted:
    """Sign the order off. On an inbound order, every line outside the customer's count tolerance is
    filed as a Count Discrepancy issue in the same transaction (business-rules §11)."""
    order = await _open_order(session, user, order_id)
    if blockers := await _blockers(session, order):
        raise HTTPException(http.HTTP_409_CONFLICT, " ".join(blockers))
    now = utcnow()
    filed = []
    # An order never given a door still files its discrepancies, as issues without a dock.
    if order.type is OrderType.INBOUND:
        company = await get_or_404(session, Company, order.company_id, "Company")
        items = list(await session.scalars(select(OrderItem).where(OrderItem.order_id == order_id)))
        lines = [CountLine(item.product_id, item.expected_quantity, item.actual_quantity) for item in items]
        for found in count_discrepancies(lines, company.count_tolerance):
            filed.append(
                await file_issue(
                    session,
                    user.id,
                    SystemFiling(
                        order_id=order.id,
                        dock_door_id=order.dock_door_id,
                        issue_type="Count Discrepancy",
                        issue_subtype=found.subtype,
                        description=f"Expected {found.expected}, received {found.actual}",
                        product_id=found.product_id,
                        company_id=order.company_id,
                        carrier_id=order.carrier_id,
                        quantity_affected=found.difference,
                        count_expected=found.expected,
                        count_actual=found.actual,
                    ),
                )
            )

    order.status = OrderStatus.COMPLETE
    order.seal_number = body.seal_number
    order.notes = body.notes
    order.completed_at = now
    counts = await session.execute(
        select(Product.sku, OrderItem.actual_quantity).join(Product).where(OrderItem.order_id == order_id)
    )
    try:
        final = {sku: quantity for sku, quantity in counts}
        await wms.confirm_order(order.external_ref or order.order_number, final)
        order.wms_synced = True
    except WmsUnavailable:
        order.wms_synced = False  # queued: written back when the WMS is reachable again
    if order.dock_door_id is not None:
        dock = await get_or_404(session, DockDoor, order.dock_door_id, "Dock")
        dock.status, dock.lifecycle_phase = transition(
            dock.status, dock.lifecycle_phase, DockEvent.ORDER_COMPLETED
        )
        dock.last_activity_at = now
    await session.commit()

    for issue in filed:
        row = (await session.execute(issue_select().where(Issue.id == issue.id))).one()
        payload = IssueOut.model_validate(dict(row._mapping)).model_dump()
        await events.send(await issue_audience(session, issue), realtime.new_issue(payload))
    await events.send({user.id, await supervisor_of(session, user.id)}, realtime.order_complete(order_id))
    return OrderCompleted(status="completed", discrepancy_issue_ids=[issue.id for issue in filed])
