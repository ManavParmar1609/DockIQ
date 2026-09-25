from fastapi import APIRouter, HTTPException
from fastapi import status as http
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.access import ensure, issue_audience, order_scope, supervisor_of, visible_order
from app.api.deps import CurrentUser, Operator, RealtimeDep, SessionDep, WmsDep, get_or_404
from app.db import utcnow
from app.domain.barcodes import decide_scan, normalize_code
from app.domain.dock import DockEvent, transition
from app.domain.enums import IssueStatus, OrderStatus, OrderType, ScanResult, Severity
from app.domain.lifecycle import OPEN_STATUSES, completion_blockers
from app.domain.load_plan import OrderLine, plan_load, rules_from_pattern
from app.domain.receiving import CountLine, check_probe_temperature, count_discrepancies
from app.models import (
    Company,
    DockDoor,
    Issue,
    Order,
    OrderItem,
    Product,
    ScanEvent,
    TrailerInspection,
    User,
)
from app.queries import issue_select, order_items_select, order_select
from app.schemas import (
    IssueCreate,
    IssueOut,
    LoadPlanOut,
    OrderComplete,
    OrderCompleted,
    OrderDetailOut,
    OrderItemOut,
    OrderItemUpdate,
    OrderOut,
    PlacedPalletOut,
    ScanCreate,
    ScanOut,
    StatusOut,
    TemperatureCheckCreate,
    TemperatureCheckOut,
)
from app.services.issue_filing import file_issue
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
    user: CurrentUser, session: SessionDep, status: OrderStatus | None = None, operator_id: int | None = None
) -> list[OrderOut]:
    stmt = order_select().where(order_scope(user)).order_by(Order.created_at.desc())
    if status is not None:
        stmt = stmt.where(Order.status == status)
    if operator_id is not None:
        stmt = stmt.where(Order.operator_id == operator_id)
    return [OrderOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


async def _blockers(session: AsyncSession, order_id: int) -> list[str]:
    """What stops sign-off: open critical issues, or a failed inspection no supervisor has cleared."""
    open_critical = await session.scalar(
        select(func.count(Issue.id)).where(
            Issue.order_id == order_id, Issue.severity == Severity.CRITICAL, Issue.status.in_(OPEN_STATUSES)
        )
    )
    inspection = await session.scalar(
        select(TrailerInspection)
        .where(TrailerInspection.order_id == order_id)
        .order_by(TrailerInspection.created_at.desc(), TrailerInspection.id.desc())
        .limit(1)
    )
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
    return completion_blockers(open_critical or 0, failed, cleared)


@router.get("/{order_id}")
async def get_order(order_id: int, user: CurrentUser, session: SessionDep) -> OrderDetailOut:
    await visible_order(session, user, order_id)
    row = (await session.execute(order_select().where(Order.id == order_id))).one()
    return OrderDetailOut.model_validate(
        {
            **row._mapping,
            "items": await _items(session, order_id),
            "completion_blockers": await _blockers(session, order_id),
        }
    )


@router.get("/{order_id}/load-plan")
async def load_plan(order_id: int, user: CurrentUser, session: SessionDep) -> LoadPlanOut:
    """Where every pallet of this order goes in the trailer, by this customer's loading rules."""
    order = await visible_order(session, user, order_id)
    company = await get_or_404(session, Company, order.company_id, "Company")
    rows = await session.execute(
        select(OrderItem.expected_quantity, Product)
        .join(Product, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id == order_id)
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
    rules = rules_from_pattern(company.load_pattern)
    plan = plan_load(lines, rules)
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
    order_id: int, body: OrderItemUpdate, user: Operator, session: SessionDep
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
async def scan(order_id: int, body: ScanCreate, user: Operator, session: SessionDep) -> ScanOut:
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


@router.post("/{order_id}/temperature-check")
async def temperature_check(
    order_id: int, body: TemperatureCheckCreate, user: Operator, session: SessionDep
) -> TemperatureCheckOut:
    """Judge a probe reading against the strictest product limit on this load (business-rules §11)."""
    await visible_order(session, user, order_id)
    limits = await session.scalars(
        select(Product.temp_max)
        .join(OrderItem, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id == order_id)
    )
    result = check_probe_temperature(body.reading, list(limits))
    return TemperatureCheckOut(
        status=result.status.value,
        reading=result.reading,
        limit=result.limit,
        delta=result.delta,
        guidance=result.guidance,
    )


@router.post("/{order_id}/complete")
async def complete_order(
    order_id: int,
    body: OrderComplete,
    user: Operator,
    session: SessionDep,
    events: RealtimeDep,
    wms: WmsDep,
) -> OrderCompleted:
    """Sign the order off. On an inbound order, every line outside the customer's count tolerance is
    filed as a Count Discrepancy issue in the same transaction (business-rules §11)."""
    order = await _open_order(session, user, order_id)
    if blockers := await _blockers(session, order_id):
        raise HTTPException(http.HTTP_409_CONFLICT, " ".join(blockers))
    now = utcnow()
    filed = []
    if order.type is OrderType.INBOUND:
        company = await get_or_404(session, Company, order.company_id, "Company")
        items = list(await session.scalars(select(OrderItem).where(OrderItem.order_id == order_id)))
        lines = [CountLine(item.product_id, item.expected_quantity, item.actual_quantity) for item in items]
        for found in count_discrepancies(lines, company.count_tolerance):
            filed.append(
                await file_issue(
                    session,
                    user.id,
                    IssueCreate(
                        order_id=order.id,
                        dock_door_id=order.dock_door_id or 0,
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
