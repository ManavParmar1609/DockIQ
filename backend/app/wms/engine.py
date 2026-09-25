"""The simulation engine: materialises the planned shift into the operational tables.

`advance(now)` applies every planned event whose simulated time has passed — a trailer arriving at a
free door, work starting, cases being counted, an exception surfacing, the operator resolving or
escalating it, the trailer leaving. Each event is recorded in `sim_events` under a unique key, so it
happens exactly once no matter how often, how late, or from how many processes `advance` runs.

Correctness comes from the clock, not from the loop that calls this: a host that slept for an hour
simply catches up on the next call. Orders a person touches (`sim_managed = False`) are left alone.
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import realtime
from app.api.access import issue_audience
from app.db import Database, utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import IssueStatus, OrderStatus, OrderType, Role, Severity
from app.models import (
    Carrier,
    Company,
    DockDoor,
    Issue,
    IssuePhoto,
    Order,
    OrderItem,
    Product,
    ScanEvent,
    SimEvent,
    SimState,
    TrailerInspection,
    User,
)
from app.queries import issue_select
from app.realtime import ConnectionManager
from app.schemas import IssueCreate, IssueOut
from app.services.issue_filing import file_issue
from app.wms.clock import SHIFT_MINUTES, Clock, clock_label, shift_of
from app.wms.plan import Appointment, CustomerRef, ProductRef, ShiftPlan, plan_shift, work_minutes

logger = logging.getLogger(__name__)

DEFAULT_SEED = 42
DEFAULT_SPEED = 15.0
INJECTED_OUTAGE_MINUTES = 8.0
NEVER = float("-inf")  # "free since before the simulation began"

# What an operator records when a simulated, non-serious issue is handled at the dock.
SELF_RESOLUTION: dict[str, str] = {
    "Damaged Pallet": "Product Segregated",
    "Count Discrepancy": "Partial Accept",
    "Barcode Issue": "Manual Entry",
    "Equipment Failure": "Equipment Swapped",
    "Temperature Deviation": "Temp Re-check OK",
    "SKU Mismatch": "Corrected and Continued",
    "Paperwork Mismatch": "Corrected and Continued",
}

INJECTABLE: dict[str, str] = {
    "temperature_emergency": "Frozen load 28°F over its limit (Scenario 2)",
    "wrong_product": "Wrong product staged for loading (Scenario 3)",
    "damaged_pallet": "Crushed pallet on the trailer (Scenario 1)",
    "injury": "Employee injury at a dock",
    "wms_outage": "WMS goes offline for 8 minutes",
}


@dataclass
class Reference:
    """Reference data the plan and the materialiser need, loaded once per call."""

    doors: dict[int, DockDoor]
    customers: list[CustomerRef]
    company_ids: dict[str, int]
    products: dict[str, Product]
    carriers: dict[str, Carrier]
    operators: list[User]
    zone_of_supervisor: dict[int, str | None]

    def lanes(self) -> list[int]:
        """The doors the plan books trailers onto: one per crew member, from the top of each zone, so
        planned work matches the crew that will do it. Trailers still reroute to any free door."""
        doors: list[int] = []
        for zone in sorted({door.zone for door in self.doors.values()}):
            in_zone = sorted((n for n, door in self.doors.items() if door.zone == zone), reverse=True)
            doors.extend(in_zone[: len(self.team(zone))])
        return sorted(doors)

    def team(self, zone: str) -> list[User]:
        return sorted(
            (op for op in self.operators if self.zone_of_supervisor.get(op.supervisor_id or -1) == zone),
            key=lambda op: op.employee_id,
        )


@dataclass
class Notices:
    new_issues: list[Issue] = field(default_factory=list)
    escalated: list[Issue] = field(default_factory=list)
    resolved: list[Issue] = field(default_factory=list)
    floor_changed: bool = False


def shift_from_ref(ref: str) -> int:
    """`s3-d7-41` → 3. Appointment keys carry the shift they were planned in."""
    return int(ref.split("-", 1)[0].removeprefix("s"))


class SimulationEngine:
    def __init__(self, database: Database, events: ConnectionManager | None) -> None:
        self._database = database
        self._events = events
        self._lock = asyncio.Lock()
        self._plans: dict[tuple[int, int], ShiftPlan] = {}

    # ── Clock ──

    async def clock(self, session: AsyncSession) -> Clock:
        """Read-only: an untouched simulator is paused at minute 0 without writing a row."""
        state = await session.get(SimState, 1)
        if state is None:
            return Clock(DEFAULT_SEED, DEFAULT_SPEED, False, utcnow(), 0.0)
        return Clock(state.seed, state.speed, state.running, state.anchor_real, state.anchor_minutes)

    async def _state(self, session: AsyncSession) -> SimState:
        state = await session.get(SimState, 1)
        if state is None:
            state = SimState(
                id=1,
                seed=DEFAULT_SEED,
                speed=DEFAULT_SPEED,
                running=False,
                anchor_real=utcnow(),
                anchor_minutes=0.0,
            )
            session.add(state)
            await session.flush()
        return state

    async def save_clock(self, session: AsyncSession, clock: Clock) -> None:
        state = await self._state(session)
        state.seed, state.speed, state.running = clock.seed, clock.speed, clock.running
        state.anchor_real, state.anchor_minutes = clock.anchor_real, clock.anchor_minutes

    async def outage_active(
        self, session: AsyncSession, clock: Clock, plan: ShiftPlan, minute: float
    ) -> bool:
        state = await session.get(SimState, 1)
        if state is not None and state.outage_until_minute is not None and minute < state.outage_until_minute:
            return True
        return any(start <= minute < end for start, end in plan.outages)

    # ── Reference data and plans ──

    async def reference(self, session: AsyncSession) -> Reference:
        doors = {dock.door_number: dock for dock in await session.scalars(select(DockDoor))}
        companies = list(await session.scalars(select(Company).order_by(Company.id)))
        products = list(await session.scalars(select(Product).order_by(Product.id)))
        by_company: dict[int, list[Product]] = {}
        for product in products:
            by_company.setdefault(product.company_id, []).append(product)
        customers = [
            CustomerRef(
                company.name,
                tuple(
                    ProductRef(p.sku, p.name, p.category.value, p.cases_per_pallet, p.temp_max)
                    for p in by_company.get(company.id, [])
                ),
            )
            for company in companies
            if by_company.get(company.id)
        ]
        users = list(await session.scalars(select(User).where(User.is_active)))
        return Reference(
            doors=doors,
            customers=customers,
            company_ids={company.name: company.id for company in companies},
            products={product.sku: product for product in products},
            carriers={carrier.code: carrier for carrier in await session.scalars(select(Carrier))},
            operators=[user for user in users if user.role is Role.OPERATOR and user.simulated],
            zone_of_supervisor={user.id: user.zone for user in users if user.role is Role.SUPERVISOR},
        )

    def plan(self, reference: Reference, seed: int, shift: int) -> ShiftPlan:
        cached = self._plans.get((seed, shift))
        if cached is None:
            cached = plan_shift(
                seed,
                shift,
                reference.lanes(),
                reference.customers,
                sorted((code, carrier.name) for code, carrier in reference.carriers.items()),
            )
            self._plans[(seed, shift)] = cached
        return cached

    # ── Advancing ──

    async def tick(self) -> None:
        """The background loop's entry: a paused clock has nothing to catch up on."""
        async with self._database.sessionmaker() as session:
            running = (await self.clock(session)).running
        if running:
            await self.advance()

    async def advance(self, now: datetime | None = None) -> None:
        now = now or utcnow()
        async with self._lock, self._database.sessionmaker() as session:
            notices = await self._advance(session, now)
            await session.commit()
            await self._notify(session, notices)

    async def _advance(self, session: AsyncSession, now: datetime) -> Notices:
        notices = Notices()
        clock = await self.clock(session)
        minute = clock.minutes_at(now)
        shift = shift_of(minute)
        reference = await self.reference(session)
        plan = self.plan(reference, clock.seed, shift)
        online = not await self.outage_active(session, clock, plan, minute)

        # Trailers still at a door from an earlier shift (usually waiting on a supervisor) carry over.
        carried = list(
            await session.scalars(
                select(Order).where(
                    Order.sim_managed,
                    Order.status == OrderStatus.IN_PROGRESS,
                    Order.external_ref.not_like(f"s{shift}-%"),
                )
            )
        )
        shifts = {shift} | {shift_from_ref(order.external_ref) for order in carried if order.external_ref}
        applied = set(
            await session.scalars(
                select(SimEvent.key).where(or_(*(SimEvent.key.like(f"s{s}-%") for s in shifts)))
            )
        )

        for number, (start, end) in enumerate(plan.outages):
            if minute >= start and f"s{shift}-outage{number}" not in applied:
                issue = await self._report_outage(session)
                self._record(session, f"s{shift}-outage{number}", "outage", minute, "WMS offline", issue)
                if issue is not None:
                    notices.new_issues.append(issue)
            if minute >= end and f"s{shift}-outage{number}-end" not in applied:
                reported = await self._event_issue(session, f"s{shift}-outage{number}")
                if reported is not None and reported.status is IssueStatus.RESOLUTION_IN_PROGRESS:
                    reported.status = IssueStatus.SELF_RESOLVED
                    reported.resolution_type = "Manual Entry"
                    reported.resolution_notes = "Paper sheet until the WMS came back (simulated)"
                    reported.resolved_at = utcnow()
                    notices.resolved.append(reported)
                self._record(
                    session, f"s{shift}-outage{number}-end", "outage", end, "WMS back online", reported
                )

        for order in carried:
            ref = order.external_ref or ""
            earlier = self.plan(reference, clock.seed, shift_from_ref(ref))
            appointment = next((a for a in earlier.appointments if a.key == ref), None)
            if appointment is not None:
                await self._progress(session, reference, appointment, order, minute, applied, online, notices)

        orders = {
            order.external_ref: order
            for order in await session.scalars(
                select(Order).where(Order.external_ref.in_([a.key for a in plan.appointments]))
            )
        }
        for appointment in plan.appointments:
            if appointment.arrival > minute:
                break
            order = orders.get(appointment.key)
            if order is None:
                order = await self._arrive(session, reference, appointment, minute)
                if order is None:
                    continue  # door busy or no free operator: the trailer waits in the yard
                orders[appointment.key] = order
                self._record(
                    session,
                    f"{appointment.key}:arrive",
                    "arrival",
                    order.sim_arrived_minute or minute,
                    f"{appointment.trailer} at door {await self._door_number(session, order)}",
                )
                notices.floor_changed = True
            if order.sim_managed and order.status is OrderStatus.IN_PROGRESS:
                await self._progress(session, reference, appointment, order, minute, applied, online, notices)

        queued = Order.status == OrderStatus.COMPLETE, Order.wms_synced.is_(False)
        if online and await session.scalar(select(Order.id).where(*queued).limit(1)) is not None:
            # write back every completion the outage queued, simulated or not
            await session.execute(update(Order).where(*queued).values(wms_synced=True))
        return notices

    def _record(
        self,
        session: AsyncSession,
        key: str,
        kind: str,
        minute: float,
        message: str,
        issue: Issue | None = None,
    ) -> None:
        session.add(
            SimEvent(
                key=key,
                kind=kind,
                minute=minute,
                message=message,
                issue_id=issue.id if issue else None,
                created_at=utcnow(),
            )
        )

    async def _door_free_at(self, session: AsyncSession, dock: DockDoor) -> float | None:
        """Simulated minute the door came free, or None while a trailer is at it."""
        if dock.current_order_id is None:
            return NEVER
        current = await session.get(Order, dock.current_order_id)
        if current is None:
            return NEVER
        if current.status is not OrderStatus.COMPLETE:
            return None
        return current.sim_departed_minute if current.sim_departed_minute is not None else NEVER

    async def _operator_free_at(self, session: AsyncSession, operator: User) -> float | None:
        """Simulated minute the operator finished their last trailer, or None while they work one."""
        busy = await session.scalar(
            select(Order.id)
            .where(Order.operator_id == operator.id, Order.status == OrderStatus.IN_PROGRESS)
            .limit(1)
        )
        if busy is not None:
            return None
        last = await session.scalar(
            select(func.max(Order.sim_departed_minute)).where(Order.operator_id == operator.id)
        )
        return last if last is not None else NEVER

    async def _arrive(
        self, session: AsyncSession, reference: Reference, appointment: Appointment, minute: float
    ) -> Order | None:
        """Bring the trailer in at the earliest moment a door and a crew member were both free.

        The planned door is preferred; when it is held (a person is working a trailer there), the yard
        sends the trailer to whichever door frees first — timed by simulated minutes, never by when
        this happens to run, so a coarse step and a fine one produce the same floor."""
        company_id = reference.company_ids.get(appointment.customer)
        carrier = reference.carriers.get(appointment.carrier)
        if company_id is None or carrier is None:
            return None
        options: list[tuple[float, bool, int, DockDoor, User]] = []
        for number, door in reference.doors.items():
            door_free = await self._door_free_at(session, door)
            if door_free is None:
                continue
            for crew in reference.team(door.zone):
                crew_free = await self._operator_free_at(session, crew)
                if crew_free is not None:
                    at = max(appointment.arrival, door_free, crew_free)
                    options.append((at, number != appointment.door, number, door, crew))
        if not options:
            return None
        arrival, _, _, dock, operator = min(options, key=lambda option: option[:3])
        if arrival > minute:
            return None

        order = Order(
            order_number=appointment.order_number,
            type=OrderType(appointment.type),
            company_id=company_id,
            carrier_id=carrier.id,
            trailer_number=appointment.trailer,
            bol_number=appointment.bol,
            dock_door_id=dock.id,
            operator_id=operator.id,
            status=OrderStatus.IN_PROGRESS,
            created_at=utcnow(),
            simulated=True,
            external_ref=appointment.key,
            sim_managed=True,
            sim_arrived_minute=arrival,
            wms_synced=True,
        )
        session.add(order)
        await session.flush()
        session.add_all(
            OrderItem(
                order_id=order.id,
                product_id=reference.products[sku].id,
                expected_quantity=cases,
                actual_quantity=0,
                verified=False,
            )
            for sku, cases in appointment.lines
        )
        dock.status, dock.lifecycle_phase = transition(
            dock.status, dock.lifecycle_phase, DockEvent.TRAILER_ARRIVED
        )
        dock.current_order_id = order.id
        dock.current_operator_id = operator.id
        dock.current_trailer = appointment.trailer
        dock.trailer_arrived_at = utcnow()
        dock.last_activity_at = utcnow()
        await session.flush()
        return order

    async def _progress(
        self,
        session: AsyncSession,
        reference: Reference,
        appointment: Appointment,
        order: Order,
        minute: float,
        applied: set[str],
        online: bool,
        notices: Notices,
    ) -> None:
        dock = await session.get(DockDoor, order.dock_door_id) if order.dock_door_id else None
        operator = await session.get(User, order.operator_id) if order.operator_id else None
        start = (order.sim_arrived_minute or appointment.arrival) + appointment.inspection_minutes
        duration = work_minutes(appointment.pallets, operator.experience_level if operator else None)
        end = start + duration
        if appointment.exception is not None:  # the operator settles the problem before the trailer leaves
            exc = appointment.exception
            end = max(end, start + exc.at_fraction * duration + exc.follow_up_minutes)
        if minute < start or dock is None or operator is None:
            return

        key = appointment.key
        door_number = dock.door_number
        if f"{key}:work" not in applied:
            dock.status, dock.lifecycle_phase = transition(
                dock.status, dock.lifecycle_phase, DockEvent.WORK_STARTED, order_type=order.type
            )
            self._record(
                session,
                f"{key}:work",
                "work",
                start,
                f"{'Loading' if order.type is OrderType.OUTBOUND else 'Unloading'} door {door_number}",
            )
            notices.floor_changed = True

        exception = appointment.exception
        exception_at = start + exception.at_fraction * duration if exception else None
        short_sku = exception.sku if exception and exception.count_actual is not None else None
        fraction = min(1.0, (minute - start) / duration) if duration else 1.0
        for item in await session.scalars(select(OrderItem).where(OrderItem.order_id == order.id)):
            product = await session.get(Product, item.product_id)
            target = round(item.expected_quantity * fraction)
            if (
                product
                and product.sku == short_sku
                and exception
                and exception_at is not None
                and minute >= exception_at
            ):
                target = min(target, exception.count_actual or 0)
            item.actual_quantity = target
            item.verified = target > 0

        issue: Issue | None = None
        if exception and exception_at is not None and minute >= exception_at:
            if f"{key}:exc" not in applied:
                product = reference.products.get(exception.sku) if exception.sku else None
                issue = await file_issue(
                    session,
                    operator.id,
                    IssueCreate(
                        order_id=order.id,
                        dock_door_id=dock.id,
                        issue_type=exception.issue_type,
                        issue_subtype=exception.subtype,
                        description=exception.description,
                        product_id=product.id if product else None,
                        company_id=order.company_id,
                        carrier_id=order.carrier_id,
                        quantity_affected=exception.quantity,
                        temp_reading=exception.temp_reading,
                        temp_threshold_max=exception.temp_limit,
                        count_expected=exception.count_expected,
                        count_actual=exception.count_actual,
                    ),
                    simulated=True,
                )
                self._record(
                    session,
                    f"{key}:exc",
                    "exception",
                    exception_at,
                    f"{exception.subtype} at door {door_number}",
                    issue,
                )
                notices.new_issues.append(issue)
                notices.floor_changed = True
            else:
                issue = await self._event_issue(session, f"{key}:exc")
            if (
                issue is not None
                and f"{key}:fu" not in applied
                and minute >= exception_at + exception.follow_up_minutes
            ):
                self._follow_up(issue, dock, notices)
                self._record(
                    session,
                    f"{key}:fu",
                    "follow_up",
                    exception_at + exception.follow_up_minutes,
                    f"Issue #{issue.id} {issue.status.value.replace('_', ' ')}",
                    issue,
                )

        if minute >= end and f"{key}:done" not in applied:
            if issue is not None and issue.status is IssueStatus.ESCALATED:
                return  # the trailer waits at the door for the supervisor's decision
            # A trailer held for a supervisor leaves when the decision is seen; otherwise on schedule.
            departed = minute if issue is not None and issue.escalated_at is not None else end
            order.sim_departed_minute = departed
            order.status = OrderStatus.COMPLETE
            order.completed_at = utcnow()
            order.seal_number = appointment.seal if order.type is OrderType.OUTBOUND else None
            order.wms_synced = online
            dock.status, dock.lifecycle_phase = transition(
                dock.status, dock.lifecycle_phase, DockEvent.ORDER_COMPLETED
            )
            dock.last_activity_at = utcnow()
            self._record(
                session,
                f"{key}:done",
                "departure",
                departed,
                f"{appointment.trailer} left door {door_number}",
            )
            notices.floor_changed = True

    async def _door_number(self, session: AsyncSession, order: Order) -> int | None:
        dock = await session.get(DockDoor, order.dock_door_id) if order.dock_door_id else None
        return dock.door_number if dock else None

    async def _event_issue(self, session: AsyncSession, key: str) -> Issue | None:
        issue_id = await session.scalar(select(SimEvent.issue_id).where(SimEvent.key == key))
        return await session.get(Issue, issue_id) if issue_id else None

    def _follow_up(self, issue: Issue, dock: DockDoor, notices: Notices) -> None:
        if issue.status is not IssueStatus.RESOLUTION_IN_PROGRESS:
            return  # someone already acted on it
        now = utcnow()
        serious = (
            issue.severity in (Severity.HIGH, Severity.CRITICAL) or issue.issue_type not in SELF_RESOLUTION
        )
        if serious:
            issue.status = IssueStatus.ESCALATED
            issue.escalated_at = now
            dock.status, dock.lifecycle_phase = transition(
                dock.status, dock.lifecycle_phase, DockEvent.ISSUE_ESCALATED, severity=issue.severity
            )
            notices.escalated.append(issue)
        else:
            issue.status = IssueStatus.SELF_RESOLVED
            issue.resolution_type = SELF_RESOLUTION[issue.issue_type]
            issue.resolution_notes = "Resolved at the dock with the suggested procedure (simulated)"
            issue.resolved_at = now
            dock.status, dock.lifecycle_phase = transition(
                dock.status, dock.lifecycle_phase, DockEvent.ISSUE_RESOLVED
            )
            notices.resolved.append(issue)

    async def _report_outage(self, session: AsyncSession) -> Issue | None:
        """A simulated crew member at a door reports the WMS as offline, as they would on the floor."""
        order = await session.scalar(
            select(Order).where(Order.status == OrderStatus.IN_PROGRESS, Order.sim_managed).order_by(Order.id)
        )
        if order is None or order.operator_id is None or order.dock_door_id is None:
            return None
        return await file_issue(
            session,
            order.operator_id,
            IssueCreate(
                order_id=order.id,
                dock_door_id=order.dock_door_id,
                issue_type="WMS/System Issue",
                issue_subtype="WMS offline or not responding",
                description="Handheld cannot reach the WMS; switching to the paper load sheet",
                company_id=order.company_id,
                carrier_id=order.carrier_id,
            ),
            simulated=True,
        )

    async def _notify(self, session: AsyncSession, notices: Notices) -> None:
        if self._events is None:
            return
        for issue in notices.new_issues:
            await self._events.send(
                await issue_audience(session, issue),
                realtime.new_issue(await self._issue_payload(session, issue.id)),
            )
        for issue in notices.escalated:
            await self._events.send(
                await issue_audience(session, issue),
                realtime.issue_escalated(await self._issue_payload(session, issue.id)),
            )
        for issue in notices.resolved:
            await self._events.send(
                await issue_audience(session, issue),
                realtime.issue_resolved(issue.id, IssueStatus.SELF_RESOLVED.value),
            )
        if notices.floor_changed or notices.new_issues or notices.escalated or notices.resolved:
            await self._events.send_all(realtime.floor_update())

    async def _issue_payload(self, session: AsyncSession, issue_id: int) -> dict[str, object]:
        row = (await session.execute(issue_select().where(Issue.id == issue_id))).one()
        return IssueOut.model_validate(dict(row._mapping)).model_dump()

    # ── Control ──

    async def change_clock(
        self, change: str, now: datetime | None = None, value: float | None = None
    ) -> None:
        now = now or utcnow()
        async with self._lock, self._database.sessionmaker() as session:
            clock = await self.clock(session)
            match change:
                case "play":
                    clock = clock.play(now)
                case "pause":
                    clock = clock.pause(now)
                case "speed":
                    clock = clock.with_speed(now, value or DEFAULT_SPEED)
                case "step":
                    clock = clock.step(now, value or 0.0)
                case "next_shift":
                    clock = clock.next_shift(now)
            await self.save_clock(session, clock)
            await session.commit()
        await self.advance(now)

    async def reset(self, seed: int | None = None, now: datetime | None = None) -> None:
        """Remove everything the simulator created and rewind to the start of shift 1, paused."""
        now = now or utcnow()
        async with self._lock, self._database.sessionmaker() as session:
            clock = await self.clock(session)
            sim_orders = select(Order.id).where(Order.simulated)
            sim_issues = select(Issue.id).where(Issue.simulated)
            await session.execute(
                update(DockDoor)
                .where(DockDoor.current_order_id.in_(sim_orders))
                .values(
                    current_order_id=None,
                    current_operator_id=None,
                    current_trailer=None,
                    trailer_arrived_at=None,
                )
            )
            await session.execute(delete(SimEvent))
            await session.execute(delete(IssuePhoto).where(IssuePhoto.issue_id.in_(sim_issues)))
            await session.execute(delete(Issue).where(Issue.simulated))
            await session.execute(delete(Issue).where(Issue.order_id.in_(sim_orders)))
            await session.execute(delete(TrailerInspection).where(TrailerInspection.order_id.in_(sim_orders)))
            await session.execute(delete(ScanEvent).where(ScanEvent.order_id.in_(sim_orders)))
            await session.execute(delete(Order).where(Order.simulated))
            # Doors the simulation left mid-visit go back to idle.
            for dock in await session.scalars(select(DockDoor).where(DockDoor.current_order_id.is_(None))):
                dock.status, dock.lifecycle_phase = transition(
                    dock.status, dock.lifecycle_phase, DockEvent.ORDER_COMPLETED
                )
            state = await session.get(SimState, 1)
            if state is not None:
                state.outage_until_minute = None
            await self.save_clock(
                session, Clock(seed if seed is not None else clock.seed, clock.speed, False, now, 0.0)
            )
            await session.commit()
        self._plans.clear()
        if self._events is not None:
            await self._events.send_all(realtime.floor_update())

    async def inject(self, kind: str, now: datetime | None = None) -> str:
        """Trigger a scenario on cue — a live demo does not have to wait for the dice."""
        now = now or utcnow()
        async with self._lock, self._database.sessionmaker() as session:
            clock = await self.clock(session)
            minute = clock.minutes_at(now)
            notices = Notices()
            message = await self._inject(session, kind, minute, notices)
            self._record(
                session,
                f"inject-{uuid.uuid4().hex[:12]}",
                "injected",
                minute,
                message,
                notices.new_issues[0] if notices.new_issues else None,
            )
            await session.commit()
            await self._notify(session, notices)
            return message

    async def _inject(self, session: AsyncSession, kind: str, minute: float, notices: Notices) -> str:
        if kind == "wms_outage":
            (await self._state(session)).outage_until_minute = minute + INJECTED_OUTAGE_MINUTES
            issue = await self._report_outage(session)
            if issue is not None:
                notices.new_issues.append(issue)
            return "WMS offline for 8 simulated minutes"

        want_inbound = kind == "temperature_emergency"
        want_outbound = kind == "wrong_product"
        # Only a simulated crew member's trailer: a scenario must never put words in a real person's mouth.
        candidates = list(
            await session.scalars(
                select(Order)
                .where(Order.status == OrderStatus.IN_PROGRESS, Order.sim_managed)
                .order_by(Order.id)
            )
        )
        order: Order | None = None
        product: Product | None = None
        for candidate in candidates:
            if want_outbound and candidate.type is not OrderType.OUTBOUND:
                continue
            items = list(await session.scalars(select(OrderItem).where(OrderItem.order_id == candidate.id)))
            products = [p for item in items if (p := await session.get(Product, item.product_id))]
            if not want_inbound:
                order, product = candidate, products[0] if products else None
                break
            # A temperature emergency goes to the coldest inbound load at a door (Scenario 2 is frozen).
            cold = [p for p in products if p.temp_max is not None]
            coldest = min(cold, key=lambda p: p.temp_max or 0.0, default=None)
            is_colder = product is None or (coldest and (coldest.temp_max or 0.0) < (product.temp_max or 0.0))
            if candidate.type is OrderType.INBOUND and coldest is not None and is_colder:
                order, product = candidate, coldest
        if order is None or order.operator_id is None or order.dock_door_id is None:
            raise LookupError(
                "No simulated trailer at a door fits this scenario yet. Press play or step the clock first."
            )

        base = {
            "order_id": order.id,
            "dock_door_id": order.dock_door_id,
            "company_id": order.company_id,
            "carrier_id": order.carrier_id,
        }
        match kind:
            case "temperature_emergency":
                limit = product.temp_max if product and product.temp_max is not None else 0.0
                body = IssueCreate(
                    **base,
                    issue_type="Temperature Deviation",
                    issue_subtype="Product temperature out of range",
                    description=f"Probe reads {limit + 28}°F against a {limit}°F limit",
                    product_id=product.id if product else None,
                    quantity_affected=24,
                    temp_reading=limit + 28,
                    temp_threshold_max=limit,
                )
            case "wrong_product":
                body = IssueCreate(
                    **base,
                    issue_type="SKU Mismatch",
                    issue_subtype="Wrong product staged",
                    description="Scanned case does not match the pick list — near-identical packaging",
                    product_id=product.id if product else None,
                    quantity_affected=12,
                )
            case "damaged_pallet":
                body = IssueCreate(
                    **base,
                    issue_type="Damaged Pallet",
                    issue_subtype="Crushed or collapsed pallet",
                    description="Pallet crushed on one side, about 8 cases damaged",
                    product_id=product.id if product else None,
                    quantity_affected=8,
                )
            case "injury":
                body = IssueCreate(
                    **base,
                    issue_type="Safety Incident",
                    issue_subtype="Employee injury",
                    description="Operator hurt a hand moving a pallet; first aid called",
                )
            case _:
                raise LookupError(f"Unknown scenario '{kind}'")

        order.sim_managed = False  # a person is now handling this trailer
        issue = await file_issue(session, order.operator_id, body, simulated=True)
        notices.new_issues.append(issue)
        if issue.severity in (Severity.HIGH, Severity.CRITICAL):
            dock = await session.get(DockDoor, order.dock_door_id)
            if dock is not None:
                self._follow_up(issue, dock, notices)
        notices.floor_changed = True
        return INJECTABLE[kind]

    # ── Read models for the control panel and the simulated WMS ──

    async def snapshot(self, session: AsyncSession, now: datetime | None = None) -> dict[str, object]:
        now = now or utcnow()
        clock = await self.clock(session)
        minute = clock.minutes_at(now)
        reference = await self.reference(session)
        plan = self.plan(reference, clock.seed, shift_of(minute))
        online = not await self.outage_active(session, clock, plan, minute)
        orders = {
            order.external_ref: order
            for order in await session.scalars(select(Order).where(Order.external_ref.is_not(None)))
        }
        states = {"scheduled": 0, "in_yard": 0, "at_door": 0, "departed": 0}
        for appointment in plan.appointments:
            states[self.yard_state(appointment, orders.get(appointment.key), minute)] += 1
        latest = select(SimEvent).order_by(SimEvent.minute.desc(), SimEvent.id.desc()).limit(15)
        events = list(await session.scalars(latest))
        return {
            "seed": clock.seed,
            "speed": clock.speed,
            "running": clock.running,
            "minute": minute,
            "clock": clock_label(minute),
            "shift": shift_of(minute) + 1,
            "shift_progress": round((minute % SHIFT_MINUTES) / SHIFT_MINUTES * 100, 1),
            "wms_online": online,
            "trailers": states,
            "events": [
                {
                    "minute": e.minute,
                    "clock": clock_label(e.minute),
                    "kind": e.kind,
                    "message": e.message,
                    "issue_id": e.issue_id,
                }
                for e in events
            ],
        }

    @staticmethod
    def yard_state(appointment: Appointment, order: Order | None, minute: float) -> str:
        if order is not None:
            return "departed" if order.status is OrderStatus.COMPLETE else "at_door"
        return "in_yard" if appointment.arrival <= minute else "scheduled"
