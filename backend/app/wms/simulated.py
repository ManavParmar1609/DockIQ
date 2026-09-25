"""SimulatedWms: the WmsClient the live simulator stands behind. See business-rules §12.

Everything it serves is a function of the simulation seed and clock — the yard board is the planned
shift joined to the orders the engine has materialised; stock, tasks, shipments and the movement
ledger are the warehouse tables the engine keeps (§12.7–§12.10). It goes offline exactly when the plan
(or an injected scenario) says the WMS is down.
"""

from collections import Counter
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Database, utcnow
from app.domain.enums import MovementKind, TaskKind, TaskStatus
from app.models import Carrier, Order, User, WmsShipment, WmsStock, WmsTask, WmsTransaction, WmsYardEvent
from app.wms import rooms as climate
from app.wms.client import (
    ColdRoom,
    CrewProductivity,
    GateEvent,
    LedgerEntry,
    Pallet,
    RoomReading,
    ShipmentLine,
    ShipmentRecord,
    StockRecord,
    WarehouseTask,
    WmsStatus,
    WmsUnavailable,
    YardEntry,
)
from app.wms.clock import SHIFT_MINUTES, shift_of, time_of
from app.wms.engine import SimulationEngine
from app.wms.layout import ROOM_NAMES, ROOMS, SLOTS_PER_ROOM, Area
from app.wms.plan import DETENTION_AFTER
from app.wms.warehouse import CREW, CREW_BY_CODE, SYSTEM, productivity

YARD_LOOKAHEAD_MINUTES = 90
YARD_DEPARTED_SHOWN = 6


def _time(minute: float | None) -> str | None:
    return time_of(minute) if minute is not None else None


class SimulatedWms:
    def __init__(self, database: Database, engine: SimulationEngine) -> None:
        self._database = database
        self._engine = engine

    async def _online(self) -> tuple[bool, int]:
        async with self._database.sessionmaker() as session:
            clock = await self._engine.clock(session)
            minute = clock.minutes_at(utcnow())
            reference = await self._engine.reference(session)
            plan = self._engine.plan(reference, clock.seed, shift_of(minute))
            online = not await self._engine.outage_active(session, clock, plan, minute)
            await session.commit()
            return online, clock.seed

    async def status(self) -> WmsStatus:
        online, _ = await self._online()
        return WmsStatus(
            mode="simulated",
            online=online,
            message="Simulated WMS online" if online else "Simulated WMS offline: use the paper load sheet",
        )

    async def _require_online(self) -> int:
        online, seed = await self._online()
        if not online:
            raise WmsUnavailable("The WMS is not responding")
        return seed

    async def _ready(self) -> None:
        """Online, and the warehouse opened (the first read of a fresh simulator opens it)."""
        await self._require_online()
        await self._engine.ensure_ledger()

    async def _minute(self, session: AsyncSession) -> float:
        return (await self._engine.clock(session)).minutes_at(utcnow())

    async def appointments(self) -> list[YardEntry]:
        await self._require_online()
        async with self._database.sessionmaker() as session:
            clock = await self._engine.clock(session)
            minute = clock.minutes_at(utcnow())
            reference = await self._engine.reference(session)
            plan = self._engine.plan(reference, clock.seed, shift_of(minute))
            orders = {
                order.external_ref: order
                for order in await session.scalars(
                    select(Order).where(Order.external_ref.in_([a.key for a in plan.appointments]))
                )
            }
            carriers = {code: carrier.name for code, carrier in reference.carriers.items()}
            entries: list[YardEntry] = []
            for appointment in plan.appointments:
                order = orders.get(appointment.key)
                state = SimulationEngine.yard_state(appointment, order, minute)
                arrived = appointment.arrival <= minute
                left = order.sim_departed_minute if order is not None else None
                dwell = ((left if left is not None else minute) - appointment.arrival) if arrived else None
                if state == "scheduled" and appointment.arrival - minute > YARD_LOOKAHEAD_MINUTES:
                    continue
                entries.append(
                    YardEntry(
                        ref=appointment.key,
                        order_number=appointment.order_number,
                        door=appointment.door,
                        type=appointment.type,
                        customer=appointment.customer,
                        carrier=carriers.get(appointment.carrier, appointment.carrier),
                        trailer=appointment.trailer,
                        state=state,
                        due_in_minutes=round(appointment.arrival - minute, 1)
                        if state == "scheduled"
                        else None,
                        simulated=True,
                        scheduled_at=time_of(appointment.scheduled),
                        arrived_at=time_of(appointment.arrival) if arrived else None,
                        late_minutes=round(appointment.arrival - appointment.scheduled, 1)
                        if arrived
                        else None,
                        reefer_setpoint=appointment.reefer_setpoint,
                        yard_spot=appointment.yard_spot if state == "in_yard" else None,
                        dwell_minutes=round(dwell, 1) if dwell is not None else None,
                        detention=dwell is not None and dwell > DETENTION_AFTER,
                    )
                )
            departed = [entry for entry in entries if entry.state == "departed"][-YARD_DEPARTED_SHOWN:]
            return [entry for entry in entries if entry.state != "departed"] + departed

    # ── Stock: read from the ledger's on-hand table ──

    async def _storage(self, **match: str) -> list[Pallet]:
        await self._ready()
        query = select(WmsStock).where(WmsStock.area == Area.STORAGE.value)
        for column, value in match.items():
            query = query.where(getattr(WmsStock, column) == value)
        async with self._database.sessionmaker() as session:
            rows = await session.scalars(
                query.order_by(WmsStock.best_before, WmsStock.location, WmsStock.lpn)
            )
            return [Pallet(r.lpn, r.sku, r.location, r.cases, r.lot, r.best_before) for r in rows]

    async def inventory(self, sku: str) -> list[Pallet]:
        """Pickable stock of a SKU, first-expiring first (FEFO)."""
        return await self._storage(sku=sku)

    async def find_pallet(self, pallet_id: str) -> Pallet | None:
        stored = await self._storage(lpn=pallet_id)
        if stored:
            return stored[0]
        async with self._database.sessionmaker() as session:
            row = await session.scalar(
                select(WmsStock).where(WmsStock.lpn == pallet_id).order_by(WmsStock.location).limit(1)
            )
        return Pallet(row.lpn, row.sku, row.location, row.cases, row.lot, row.best_before) if row else None

    async def confirm_order(self, order_ref: str, counts: dict[str, int]) -> None:
        await self._require_online()

    async def stock(self, room: str | None, sku: str | None, limit: int) -> list[StockRecord]:
        await self._ready()
        query = select(WmsStock)
        if room is not None:
            query = query.where(WmsStock.room == room)
        if sku is not None:
            query = query.where(WmsStock.sku == sku)
        async with self._database.sessionmaker() as session:
            rows = await session.scalars(
                query.order_by(WmsStock.best_before, WmsStock.location, WmsStock.lpn).limit(limit)
            )
            return [
                StockRecord(r.lpn, r.sku, r.location, r.area, r.room, r.cases, r.lot, r.best_before, True)
                for r in rows
            ]

    # ── Tasks, productivity, the ledger, shipments ──

    async def _order_numbers(self, session: AsyncSession, refs: Sequence[str | None]) -> dict[str, str]:
        keys = {ref for ref in refs if ref}
        if not keys:
            return {}
        rows = await session.execute(
            select(WmsShipment.key, WmsShipment.order_number).where(WmsShipment.key.in_(keys))
        )
        return {key: number for key, number in rows}

    async def _names(self, session: AsyncSession, codes: Sequence[str]) -> dict[str, str]:
        names = {member.code: member.name for member in CREW} | {SYSTEM: "System"}
        people = {code for code in codes if code not in names}
        if people:
            rows = await session.execute(
                select(User.employee_id, User.name).where(User.employee_id.in_(people))
            )
            names |= {employee_id: name for employee_id, name in rows}
        return names

    async def tasks(self, status: str | None, kind: str | None, limit: int) -> list[WarehouseTask]:
        await self._ready()
        query = select(WmsTask)
        if status is not None:
            query = query.where(WmsTask.status == TaskStatus(status))
        if kind is not None:
            query = query.where(WmsTask.kind == TaskKind(kind))
        async with self._database.sessionmaker() as session:
            rows = list(
                await session.scalars(
                    query.order_by(WmsTask.created_minute.desc(), WmsTask.id.desc()).limit(limit)
                )
            )
            numbers = await self._order_numbers(session, [row.ref for row in rows])
        return [
            WarehouseTask(
                key=row.key,
                kind=row.kind.value,
                status=row.status.value,
                sku=row.sku,
                pallet_id=row.lpn,
                from_location=row.from_location,
                to_location=row.to_location,
                cases=row.cases,
                assignee=row.assignee,
                assignee_name=CREW_BY_CODE[row.assignee].name
                if row.assignee in CREW_BY_CODE
                else row.assignee,
                queued_at=time_of(row.created_minute),
                started_at=time_of(row.assigned_minute),
                finished_at=time_of(row.done_minute),
                standard_minutes=round(row.done_minute - row.assigned_minute, 1),
                order_number=numbers.get(row.ref or ""),
                counted_cases=row.counted_cases,
                note=row.note,
                simulated=row.simulated,
            )
            for row in rows
        ]

    async def productivity(self) -> list[CrewProductivity]:
        await self._ready()
        async with self._database.sessionmaker() as session:
            minute = await self._minute(session)
            start = shift_of(minute) * SHIFT_MINUTES
            elapsed = minute - start
            worked = list(
                await session.scalars(
                    select(WmsTask).where(
                        WmsTask.done_minute > start,
                        WmsTask.assigned_minute < minute,
                        WmsTask.status != TaskStatus.CANCELLED,
                    )
                )
            )
            moves = list(
                await session.execute(
                    select(WmsTransaction.actor, func.count(), func.sum(WmsTransaction.cases))
                    .where(
                        WmsTransaction.kind.in_((MovementKind.RECEIVE, MovementKind.LOAD)),
                        WmsTransaction.minute >= start,
                        WmsTransaction.minute <= minute,
                        WmsTransaction.actor != SYSTEM,
                    )
                    .group_by(WmsTransaction.actor)
                )
            )
            names = await self._names(session, [actor for actor, _, _ in moves])
        done: Counter[str] = Counter()
        cases: Counter[str] = Counter()
        busy: Counter[str] = Counter()
        for task in worked:
            busy[task.assignee] += min(task.done_minute, minute) - max(task.assigned_minute, start)
            if task.status is TaskStatus.DONE and task.done_minute <= minute:
                done[task.assignee] += 1
                if task.kind is not TaskKind.CYCLE_COUNT:
                    cases[task.assignee] += task.cases
        rows: list[CrewProductivity] = []
        for member in CREW:
            per_hour, cases_per_hour, busy_percent = productivity(
                done[member.code], cases[member.code], busy[member.code], elapsed
            )
            rows.append(
                CrewProductivity(
                    member.code,
                    member.name,
                    "warehouse",
                    done[member.code],
                    cases[member.code],
                    per_hour,
                    cases_per_hour,
                    busy_percent,
                    True,
                )
            )
        for actor, count, total in sorted(moves):
            per_hour, cases_per_hour, _ = productivity(count, total or 0, 0.0, elapsed)
            rows.append(
                CrewProductivity(
                    actor,
                    names.get(actor, actor),
                    "dock",
                    count,
                    total or 0,
                    per_hour,
                    cases_per_hour,
                    None,
                    True,
                )
            )
        return rows

    async def transactions(
        self, limit: int, before_id: int | None, sku: str | None, pallet_id: str | None
    ) -> list[LedgerEntry]:
        await self._ready()
        query = select(WmsTransaction)
        if before_id is not None:
            query = query.where(WmsTransaction.id < before_id)
        if sku is not None:
            query = query.where(WmsTransaction.sku == sku)
        if pallet_id is not None:
            query = query.where(WmsTransaction.lpn == pallet_id)
        async with self._database.sessionmaker() as session:
            rows = list(await session.scalars(query.order_by(WmsTransaction.id.desc()).limit(limit)))
            numbers = await self._order_numbers(session, [row.ref for row in rows])
            names = await self._names(session, sorted({row.actor for row in rows}))
        return [
            LedgerEntry(
                id=row.id,
                kind=row.kind.value,
                minute=row.minute,
                time=time_of(row.minute),
                pallet_id=row.lpn,
                sku=row.sku,
                lot=row.lot,
                best_before=row.best_before,
                from_location=row.from_location,
                to_location=row.to_location,
                cases=row.cases,
                actor=row.actor,
                actor_name=names.get(row.actor, row.actor),
                order_number=numbers.get(row.ref or ""),
                simulated=row.simulated,
            )
            for row in rows
        ]

    @staticmethod
    def _shipment(row: WmsShipment) -> ShipmentRecord:
        lines = tuple(ShipmentLine(**line) for line in row.lines)
        return ShipmentRecord(
            ref=row.key,
            direction=row.direction.value,
            order_number=row.order_number,
            customer=row.customer,
            carrier=row.carrier,
            trailer=row.trailer,
            door=row.door,
            wave=row.wave,
            status=row.status.value,
            created_at=time_of(row.created_minute),
            arrived_at=_time(row.arrived_minute),
            completed_at=_time(row.completed_minute),
            seal=row.seal,
            confirmation=row.confirmation,
            pallets=row.pallets,
            cases_expected=sum(line.expected for line in lines),
            cases_allocated=sum(line.allocated for line in lines),
            cases_done=sum(line.done for line in lines),
            lines=lines,
            simulated=row.simulated,
        )

    async def shipments(self, direction: str | None, limit: int) -> list[ShipmentRecord]:
        await self._ready()
        query = select(WmsShipment)
        if direction is not None:
            query = query.where(WmsShipment.direction == direction)
        async with self._database.sessionmaker() as session:
            rows = await session.scalars(
                query.order_by(WmsShipment.created_minute.desc(), WmsShipment.id.desc()).limit(limit)
            )
            return [self._shipment(row) for row in rows]

    async def shipment(self, ref: str) -> ShipmentRecord | None:
        await self._ready()
        async with self._database.sessionmaker() as session:
            row = await session.scalar(
                select(WmsShipment).where((WmsShipment.key == ref) | (WmsShipment.order_number == ref))
            )
            return self._shipment(row) if row is not None else None

    # ── The gate and the cold rooms ──

    async def gate_log(self, limit: int) -> list[GateEvent]:
        await self._ready()
        async with self._database.sessionmaker() as session:
            rows = list(
                await session.scalars(
                    select(WmsYardEvent)
                    .order_by(WmsYardEvent.minute.desc(), WmsYardEvent.id.desc())
                    .limit(limit)
                )
            )
            numbers = await self._order_numbers(session, [row.ref for row in rows])
            carriers = {
                code: name for code, name in await session.execute(select(Carrier.code, Carrier.name))
            }
        return [
            GateEvent(
                id=row.id,
                kind=row.kind.value,
                minute=row.minute,
                time=time_of(row.minute),
                order_number=numbers.get(row.ref),
                trailer=row.trailer,
                carrier=carriers.get(row.carrier, row.carrier),
                door=row.door,
                yard_spot=row.yard_spot,
                seal=row.seal,
                reefer_temp=row.reefer_temp,
                dwell_minutes=row.dwell_minutes,
                late=row.late,
                detention=row.detention,
                simulated=row.simulated,
            )
            for row in rows
        ]

    async def rooms(self, readings: int) -> list[ColdRoom]:
        await self._ready()
        async with self._database.sessionmaker() as session:
            clock = await self._engine.clock(session)
            minute = clock.minutes_at(utcnow())
            stored = {
                room: (occupied, pallets, cases or 0)
                for room, occupied, pallets, cases in await session.execute(
                    select(
                        WmsStock.room,
                        func.count(func.distinct(WmsStock.location)),
                        func.count(func.distinct(WmsStock.lpn)),
                        func.sum(WmsStock.cases),
                    )
                    .where(WmsStock.area == Area.STORAGE.value)
                    .group_by(WmsStock.room)
                )
            }
            held = {
                room: cases or 0
                for room, cases in await session.execute(
                    select(WmsStock.room, func.sum(WmsStock.cases))
                    .where(WmsStock.area == Area.HOLD.value)
                    .group_by(WmsStock.room)
                )
            }
        found: list[ColdRoom] = []
        for room in ROOMS:
            setpoint, limit = climate.CLIMATE[room]
            recent = climate.recent(clock.seed, room, minute, readings)
            current = (
                recent[-1][1] if recent else climate.reading(clock.seed, room, climate.sample_minute(minute))
            )
            excursion = climate.excursion(clock.seed, room, shift_of(minute))
            alarm = (
                excursion is not None
                and excursion.alarm_at is not None
                and excursion.alarm_at <= minute <= excursion.end
            )
            occupied, pallets, cases = stored.get(room, (0, 0, 0))
            found.append(
                ColdRoom(
                    code=room,
                    name=ROOM_NAMES[room],
                    setpoint=setpoint,
                    limit=limit,
                    temp=current,
                    over_limit=current > limit,
                    alarm=alarm,
                    readings=tuple(RoomReading(m, time_of(m), t) for m, t in recent),
                    slots=SLOTS_PER_ROOM,
                    occupied=occupied,
                    pallets=pallets,
                    cases=cases,
                    on_hold_cases=held.get(room, 0),
                    simulated=True,
                )
            )
        return found
