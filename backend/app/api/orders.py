from fastapi import APIRouter, HTTPException
from fastapi import status as http
from sqlalchemy import select

from app import realtime
from app.api.deps import RealtimeDep, SessionDep, get_or_404
from app.db import utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import OrderStatus
from app.models import DockDoor, Order, OrderItem
from app.queries import order_items_select, order_select
from app.schemas import OrderComplete, OrderDetailOut, OrderItemOut, OrderItemUpdate, OrderOut, StatusOut

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("")
async def list_orders(
    session: SessionDep, status: OrderStatus | None = None, operator_id: int | None = None
) -> list[OrderOut]:
    stmt = order_select().order_by(Order.created_at.desc())
    if status is not None:
        stmt = stmt.where(Order.status == status)
    if operator_id is not None:
        stmt = stmt.where(Order.operator_id == operator_id)
    return [OrderOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.get("/{order_id}")
async def get_order(order_id: int, session: SessionDep) -> OrderDetailOut:
    row = (await session.execute(order_select().where(Order.id == order_id))).first()
    if row is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Order not found")
    items = [
        OrderItemOut.model_validate(dict(item._mapping))
        for item in await session.execute(order_items_select(order_id))
    ]
    return OrderDetailOut.model_validate({**row._mapping, "items": items})


@router.put("/{order_id}/items")
async def update_order_item(order_id: int, body: OrderItemUpdate, session: SessionDep) -> StatusOut:
    item = await session.scalar(
        select(OrderItem).where(OrderItem.order_id == order_id, OrderItem.product_id == body.product_id)
    )
    if item is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Order item not found")
    item.actual_quantity = body.actual_quantity
    item.verified = True
    await session.commit()
    return StatusOut(status="updated")


@router.post("/{order_id}/complete")
async def complete_order(
    order_id: int, body: OrderComplete, session: SessionDep, events: RealtimeDep
) -> StatusOut:
    order = await get_or_404(session, Order, order_id, "Order")
    now = utcnow()
    order.status = OrderStatus.COMPLETE
    order.seal_number = body.seal_number
    order.notes = body.notes
    order.completed_at = now
    if order.dock_door_id is not None:
        dock = await get_or_404(session, DockDoor, order.dock_door_id, "Dock")
        dock.status, dock.lifecycle_phase = transition(
            dock.status, dock.lifecycle_phase, DockEvent.ORDER_COMPLETED
        )
        dock.last_activity_at = now
    await session.commit()
    await events.broadcast(realtime.order_complete(order_id))
    return StatusOut(status="completed")
