"""Loads the warehouse's state for `Warehouse.run` and writes back what it changed.

The pure simulation (`warehouse.py`) decides; this only moves rows. What it loads is exactly what the
simulation needs to re-derive every pending event: all stock, the open tasks and the picks still on a
staging lane, the open shipments, each crew member's last planned finish, and the watermark.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.domain.enums import OrderType, ShipmentStatus, TaskKind, TaskStatus
from app.models import SimState, WmsShipment, WmsStock, WmsTask, WmsTransaction, WmsYardEvent
from app.wms.layout import area_of, room_of
from app.wms.plan import OPENING_SERIALS, ProductRef
from app.wms.warehouse import Shipment, ShipmentLine, StockLine, Task, Warehouse

CLOSED_SHIPMENTS = (ShipmentStatus.SHIPPED, ShipmentStatus.RECEIVED, ShipmentStatus.CANCELLED)


@dataclass
class Loaded:
    warehouse: Warehouse
    opened: bool
    stock: dict[tuple[str, str], WmsStock]
    tasks: dict[str, WmsTask]
    shipments: dict[str, WmsShipment]


def _task(row: WmsTask) -> Task:
    return Task(
        key=row.key,
        kind=row.kind,
        status=row.status,
        sku=row.sku,
        lpn=row.lpn,
        from_location=row.from_location,
        to_location=row.to_location,
        cases=row.cases,
        assignee=row.assignee,
        created=row.created_minute,
        assigned=row.assigned_minute,
        done=row.done_minute,
        ref=row.ref,
        counted=row.counted_cases,
        cleared=row.cleared_minute,
        note=row.note,
    )


def _shipment(row: WmsShipment) -> Shipment:
    return Shipment(
        key=row.key,
        direction=row.direction.value,
        order_number=row.order_number,
        customer=row.customer,
        carrier=row.carrier,
        trailer=row.trailer,
        door=row.door,
        status=row.status,
        created=row.created_minute,
        lines=[ShipmentLine(**line) for line in row.lines],
        wave=row.wave,
        arrived=row.arrived_minute,
        completed=row.completed_minute,
        seal=row.seal,
        confirmation=row.confirmation,
        pallets=row.pallets,
    )


async def load(session: AsyncSession, state: SimState, products: Mapping[str, ProductRef]) -> Loaded:
    stock = {(row.lpn, row.location): row for row in await session.scalars(select(WmsStock))}
    tasks = {
        row.key: row
        for row in await session.scalars(
            select(WmsTask).where(
                or_(
                    WmsTask.status.in_((TaskStatus.OPEN, TaskStatus.ASSIGNED)),
                    (WmsTask.kind == TaskKind.PICK)
                    & (WmsTask.status == TaskStatus.DONE)
                    & WmsTask.cleared_minute.is_(None),
                )
            )
        )
    }
    shipments = {
        row.key: row
        for row in await session.scalars(
            select(WmsShipment).where(WmsShipment.status.not_in(CLOSED_SHIPMENTS))
        )
    }
    crew_free = {
        assignee: latest
        for assignee, latest in await session.execute(
            select(WmsTask.assignee, func.max(WmsTask.done_minute)).group_by(WmsTask.assignee)
        )
    }
    warehouse = Warehouse(
        seed=state.seed,
        minute=state.ledger_minute if state.ledger_minute is not None else 0.0,
        next_serial=max(state.next_lpn, OPENING_SERIALS),
        products=products,
        stock=[
            StockLine(row.lpn, row.sku, row.lot, row.best_before, row.location, row.cases)
            for row in stock.values()
        ],
        tasks=[_task(row) for row in tasks.values()],
        shipments=[_shipment(row) for row in shipments.values()],
        crew_free=crew_free,
    )
    return Loaded(warehouse, state.ledger_minute is not None, stock, tasks, shipments)


async def save(session: AsyncSession, loaded: Loaded, state: SimState) -> None:
    warehouse = loaded.warehouse
    now = utcnow()
    session.add_all(
        WmsTransaction(
            key=m.key,
            kind=m.kind,
            minute=m.minute,
            lpn=m.lpn,
            sku=m.sku,
            lot=m.lot,
            best_before=m.best_before,
            from_location=m.from_location,
            to_location=m.to_location,
            cases=m.cases,
            actor=m.actor,
            ref=m.ref,
            simulated=True,
            created_at=now,
        )
        for m in warehouse.movements
    )

    for key in sorted(warehouse.stock_touched):
        line, row = warehouse.stock.get(key), loaded.stock.get(key)
        if line is None:
            if row is not None:
                await session.delete(row)
                del loaded.stock[key]
            continue
        if row is None:
            row = WmsStock(
                lpn=line.lpn,
                location=line.location,
                area=area_of(line.location).value,
                room=room_of(line.location),
                sku=line.sku,
                lot=line.lot,
                best_before=line.best_before,
                cases=line.cases,
            )
            session.add(row)
            loaded.stock[key] = row
        row.cases = line.cases

    for key in sorted(warehouse.tasks_touched):
        task = warehouse.tasks[key]
        task_row = loaded.tasks.get(key)
        if task_row is None:
            task_row = WmsTask(key=key, simulated=True)
            session.add(task_row)
            loaded.tasks[key] = task_row
        task_row.kind, task_row.status, task_row.sku, task_row.lpn = (
            task.kind,
            task.status,
            task.sku,
            task.lpn,
        )
        task_row.from_location, task_row.to_location, task_row.cases = (
            task.from_location,
            task.to_location,
            task.cases,
        )
        task_row.assignee, task_row.ref, task_row.note = task.assignee, task.ref, task.note
        task_row.created_minute, task_row.assigned_minute, task_row.done_minute = (
            task.created,
            task.assigned,
            task.done,
        )
        task_row.counted_cases, task_row.cleared_minute = task.counted, task.cleared

    for key in sorted(warehouse.shipments_touched):
        shipment = warehouse.shipments[key]
        shipment_row = loaded.shipments.get(key)
        if shipment_row is None:
            shipment_row = WmsShipment(key=key, simulated=True)
            session.add(shipment_row)
            loaded.shipments[key] = shipment_row
        shipment_row.direction = OrderType(shipment.direction)
        shipment_row.order_number, shipment_row.customer = shipment.order_number, shipment.customer
        shipment_row.carrier, shipment_row.trailer, shipment_row.door = (
            shipment.carrier,
            shipment.trailer,
            shipment.door,
        )
        shipment_row.wave, shipment_row.status = shipment.wave, shipment.status
        shipment_row.created_minute, shipment_row.arrived_minute, shipment_row.completed_minute = (
            shipment.created,
            shipment.arrived,
            shipment.completed,
        )
        shipment_row.seal, shipment_row.confirmation = shipment.seal, shipment.confirmation
        shipment_row.pallets = shipment.pallets
        shipment_row.lines = [
            {"sku": line.sku, "expected": line.expected, "allocated": line.allocated, "done": line.done}
            for line in shipment.lines
        ]

    session.add_all(
        WmsYardEvent(
            key=event.key,
            ref=event.ref,
            kind=event.kind,
            minute=event.minute,
            trailer=event.trailer,
            carrier=event.carrier,
            door=event.door,
            yard_spot=event.yard_spot,
            seal=event.seal,
            reefer_temp=event.reefer_temp,
            dwell_minutes=event.dwell_minutes,
            late=event.late,
            detention=event.detention,
            simulated=True,
        )
        for event in warehouse.yard
    )
    state.ledger_minute = warehouse.minute
    state.next_lpn = warehouse.next_serial


async def clear(session: AsyncSession) -> None:
    """Everything in the warehouse is simulated: a reset empties it; the next advance reopens it."""
    for model in (WmsYardEvent, WmsShipment, WmsTask, WmsTransaction, WmsStock):
        await session.execute(delete(model))
    state = await session.get(SimState, 1)
    if state is not None:
        state.ledger_minute = None
        state.next_lpn = 0
