"""The simulated warehouse behind the WMS: licence-plated stock, a movement ledger, a task queue,
inbound receipts, outbound waves and the gate. See docs/architecture/business-rules.md §12.7–§12.11.

Pure: nothing here reads a database or the wall clock. `Warehouse.run(trailers, until)` applies every
event whose simulated minute falls in (`minute`, `until`] **in time order** and records what changed;
the engine loads the state before and persists the changes after. Every event's time and effect
depend only on the events before it, and every event still pending can be re-derived from the stored
state (the tasks' planned minutes, the trailers' timelines, the watermark) — so stepping a shift in one
jump or in many small steps writes exactly the same ledger.
"""

import heapq
import random
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from app.domain.enums import MovementKind, ShipmentStatus, TaskKind, TaskStatus, YardEventKind
from app.wms import rooms
from app.wms.clock import SHIFT_MINUTES, shift_of
from app.wms.layout import (
    OPENING_LANE,
    ROOM_NAMES,
    ROOMS,
    Area,
    area_of,
    dock_lane,
    hold_area,
    nearest_free,
    overflow,
    pick_faces,
    room_of,
    stage_lane,
)
from app.wms.plan import (
    DETENTION_AFTER,
    ON_TIME_WINDOW,
    OPENING_SERIALS,
    SHELF_LIFE_DAYS,
    STORAGE_ZONE,
    Appointment,
    ProductRef,
    calendar_day,
    inventory,
    lpn,
)

NEVER = float("-inf")
SYSTEM = "system"  # the actor on movements no person made (the opening stock, the dispatch)

# ── §12.8 Inbound ──
ASN_LEAD_MINUTES = 120.0  # an advance ship notice arrives this long before the appointment

# ── §12.9 Outbound ──
WAVE_INTERVAL_MINUTES = 30.0  # waves release on the half hour from the start of the shift…
WAVE_LEAD_MINUTES = 60.0  # …each carrying the loads booked 60–90 minutes after it
REPLENISH_BELOW = 0.25  # a pick face is replenished when it holds less than this share of a pallet

# ── §12.10 Task queue: standard minutes per task, before the room and crew factors ──
STANDARD_MINUTES: dict[TaskKind, float] = {
    TaskKind.PUTAWAY: 3.0,
    TaskKind.PICK: 2.5,  # a whole pallet
    TaskKind.REPLENISH: 3.0,
    TaskKind.CYCLE_COUNT: 4.0,
}
CASE_PICK_MINUTES = (1.5, 0.05)  # a partial pallet: fixed + per case
ROOM_FACTOR: dict[str, float] = {"F": 1.3, "C": 1.1, "P": 1.1, "D": 1.0}  # cold rooms are slower work
CREW_FACTOR: dict[str, float] = {"senior": 0.85, "experienced": 1.0, "new": 1.2}
CYCLE_COUNT_EVERY = 30.0  # one location counted every half hour of the shift

# ── §12.8 The gate ──
REEFER_READING_SPREAD = 1.5  # °F either side of the set-point at check-in

# ── §12.13 Organic exceptions: the chance per event, drawn from the seed and the event's key ──
SHORT_PICK_CHANCE = 0.02  # per pick: the location holds fewer cases than the ledger says
SHORT_PICK_MAX = 6  # cases missing, at most
NOT_AT_LOCATION_CHANCE = 0.01  # per pick or replenishment: the pallet is not where the ledger says
RECEIVING_DAMAGE_CHANCE = 0.02  # per pallet received: damaged cases set aside on quality hold
DAMAGED_CASES_MAX = 6
COUNT_VARIANCE_CHANCE = 0.05  # per cycle count: the count comes up short
COUNT_VARIANCE_MAX = 4


@dataclass(frozen=True, slots=True)
class CrewMember:
    code: str
    name: str
    experience: str
    equipment: str


# Fictional warehouse crew: they put away, pick, replenish and count. The dock crew (simulated users)
# receive and load at the doors.
CREW: tuple[CrewMember, ...] = (
    CrewMember("WH-01", "Ines Albescu", "senior", "Reach truck"),
    CrewMember("WH-02", "Kofi Mensah", "experienced", "Reach truck"),
    CrewMember("WH-03", "Rosa Delgado", "experienced", "Pallet jack"),
    CrewMember("WH-04", "Stellan Berg", "new", "Pallet jack"),
)
CREW_BY_CODE: dict[str, CrewMember] = {member.code: member for member in CREW}

OPEN_STATUSES = (TaskStatus.OPEN, TaskStatus.ASSIGNED)


# ── State ──


@dataclass(slots=True)
class StockLine:
    lpn: str
    sku: str
    lot: str
    best_before: date
    location: str
    cases: int


@dataclass(frozen=True, slots=True)
class Movement:
    key: str
    kind: MovementKind
    minute: float
    lpn: str
    sku: str
    lot: str
    best_before: date
    from_location: str | None
    to_location: str | None
    cases: int
    actor: str
    ref: str | None


@dataclass(slots=True)
class Task:
    key: str
    kind: TaskKind
    status: TaskStatus
    sku: str
    lpn: str | None
    from_location: str | None
    to_location: str | None
    cases: int
    assignee: str
    created: float
    assigned: float  # when the crew member starts it
    done: float  # when they finish it (planned when queued)
    ref: str | None = None  # the shipment it serves
    counted: int | None = None  # cycle counts: what was found
    cleared: float | None = None  # picks: when the pallet left the staging lane
    note: str | None = None


@dataclass(slots=True)
class ShipmentLine:
    sku: str
    expected: int
    allocated: int = 0
    done: int = 0  # received, or shipped


@dataclass(slots=True)
class Shipment:
    key: str  # the appointment key
    direction: str  # inbound | outbound
    order_number: str
    customer: str
    carrier: str
    trailer: str
    door: int  # the booked door (the staging lane)
    status: ShipmentStatus
    created: float
    lines: list[ShipmentLine]
    wave: str | None = None
    arrived: float | None = None
    completed: float | None = None
    seal: str | None = None
    confirmation: str | None = None
    pallets: int = 0  # received, or loaded

    def line(self, sku: str) -> ShipmentLine:
        found = next((line for line in self.lines if line.sku == sku), None)
        if found is None:
            found = ShipmentLine(sku, 0)
            self.lines.append(found)
        return found


@dataclass(frozen=True, slots=True)
class YardEvent:
    key: str
    ref: str
    kind: YardEventKind
    minute: float
    trailer: str
    carrier: str
    door: int | None = None
    yard_spot: str | None = None
    seal: str | None = None
    reefer_temp: float | None = None
    dwell_minutes: float | None = None
    late: bool = False
    detention: bool = False


@dataclass(frozen=True, slots=True)
class IssueRequest:
    """A problem the warehouse found, for the engine to file through the ordinary issue path."""

    key: str
    minute: float
    issue_type: str
    subtype: str
    description: str
    sku: str | None = None
    quantity: int = 1
    temp_reading: float | None = None
    temp_limit: float | None = None
    count_expected: int | None = None
    count_actual: int | None = None
    ref: str | None = None  # the appointment it concerns
    door: int | None = None  # whose zone's crew reports it
    kind: str = "stock_exception"  # or "room_excursion"
    room_minutes_over_limit: float | None = None  # a room excursion: how long it has been over
    room: str | None = None  # a room excursion: which room
    held: tuple[str, ...] = ()  # licence plates put on quality hold for it


@dataclass(frozen=True, slots=True)
class Trailer:
    """One appointment and what the dock has done with it so far (from the materialised orders)."""

    appointment: Appointment
    at_door: float | None = None
    door: int | None = None  # the door it actually used
    work_start: float | None = None
    work_minutes: float | None = None
    departed: float | None = None
    operator: str | None = None  # the dock crew member's employee ID
    managed: bool = True  # False once a person has taken the trailer over
    exception_at: float | None = None


# ── Pure rules ──


def room_for(category: str) -> str:
    return STORAGE_ZONE.get(category, "D")


# A quality hold takes plates from these areas; plates on hold, on a trailer or gone stay where they are.
HOLDABLE_AREAS = (Area.STORAGE, Area.DOCK, Area.STAGE)


def select_for_hold(
    stock: Iterable[StockLine],
    products: Mapping[str, ProductRef],
    *,
    plates: Iterable[str] = (),
    sku: str | None = None,
    same_lot: bool = False,
    room: str | None = None,
    above: float | None = None,
) -> list[StockLine]:
    """The plates a quality hold takes (business-rules §7.3), in plate order:

    - the named `plates` (an order's receipts or picks) still in storage, on a dock lane or staged —
      only those of `sku` when one is given;
    - with `same_lot`, every other plate in storage of the same SKU and lot as those;
    - with `room` and `above` (a cold-room alarm), every plate stored in that room whose product's
      limit is below the reading `above`.
    """
    holdable = [line for line in stock if area_of(line.location) in HOLDABLE_AREAS]
    named = set(plates)
    chosen = {
        (line.lpn, line.location): line
        for line in holdable
        if line.lpn in named and (sku is None or line.sku == sku)
    }
    if same_lot:
        lots = {(line.sku, line.lot) for line in chosen.values()}
        for line in holdable:
            if area_of(line.location) is Area.STORAGE and (line.sku, line.lot) in lots:
                chosen[(line.lpn, line.location)] = line
    if room is not None and above is not None:
        for line in holdable:
            product = products.get(line.sku)
            if (
                area_of(line.location) is Area.STORAGE
                and room_of(line.location) == room
                and product is not None
                and product.temp_max is not None
                and product.temp_max < above
            ):
                chosen[(line.lpn, line.location)] = line
    return [chosen[key] for key in sorted(chosen)]


def task_minutes(kind: TaskKind, cases: int, whole_pallet: bool, room: str, experience: str) -> float:
    if kind is TaskKind.PICK and not whole_pallet:
        base = CASE_PICK_MINUTES[0] + CASE_PICK_MINUTES[1] * cases
    else:
        base = STANDARD_MINUTES[kind]
    return base * ROOM_FACTOR.get(room, 1.0) * CREW_FACTOR.get(experience, 1.0)


def wave_of(appointment: Appointment) -> tuple[int, float]:
    """(wave number, release minute) for an outbound appointment: the last half-hour wave at least
    WAVE_LEAD_MINUTES before it, never before the start of its shift."""
    base = appointment.shift * SHIFT_MINUTES
    number = max(0, int((appointment.scheduled - base - WAVE_LEAD_MINUTES) // WAVE_INTERVAL_MINUTES))
    return number, base + number * WAVE_INTERVAL_MINUTES


def asn_minute(appointment: Appointment) -> float:
    return max(appointment.shift * SHIFT_MINUTES, appointment.scheduled - ASN_LEAD_MINUTES)


def inbound_pallets(
    appointment: Appointment, products: Mapping[str, ProductRef]
) -> tuple[list[tuple[str, int]], tuple[str, int] | None]:
    """The pallets a trailer unloads into stock, in order, and the cases set aside on quality hold.

    A planned short count arrives short; a planned damage or temperature problem puts its cases on
    hold instead of into stock (§12.8)."""
    totals = dict(appointment.lines)
    hold: tuple[str, int] | None = None
    exc = appointment.exception
    if exc is not None and exc.sku in totals:
        if exc.count_actual is not None:
            totals[exc.sku] = min(totals[exc.sku], exc.count_actual)
        elif exc.issue_type in ("Damaged Pallet", "Temperature Deviation"):
            held = min(exc.quantity, totals[exc.sku])
            if held > 0:
                hold = (exc.sku, held)
                totals[exc.sku] -= held
    pallets: list[tuple[str, int]] = []
    for sku, _ in appointment.lines:
        remaining, full = totals[sku], products[sku].cases_per_pallet
        while remaining > 0:
            pallets.append((sku, min(full, remaining)))
            remaining -= full
    return pallets, hold


def receipt_minutes(trailer: Trailer, count: int) -> list[float]:
    """Pallet k comes off the trailer (k + 1)/count of the way through the unloading."""
    if trailer.work_start is None or trailer.work_minutes is None or count == 0:
        return []
    return [trailer.work_start + (k + 1) / count * trailer.work_minutes for k in range(count)]


def productivity(tasks: int, cases: int, busy: float, elapsed: float) -> tuple[float, float, float]:
    """(tasks per hour, cases per hour, % of the elapsed shift busy); at least a quarter hour."""
    hours = max(elapsed / 60, 0.25)
    return (
        round(tasks / hours, 1),
        round(cases / hours, 1),
        round(min(busy / max(elapsed, 15.0) * 100, 100.0), 1),
    )


# ── The simulation ──


@dataclass(order=True)
class _Event:
    minute: float
    seq: int
    key: str
    action: Callable[[], None] = field(compare=False)


# Order of events that fall on the same minute.
(
    SEQ_SHIFT,
    SEQ_ASN,
    SEQ_WAVE,
    SEQ_GATE_IN,
    SEQ_YARD,
    SEQ_RECEIVE,
    SEQ_TASK,
    SEQ_LOAD,
    SEQ_DEPART,
    SEQ_COUNT,
    SEQ_ROOM,
) = range(11)


class Warehouse:
    def __init__(
        self,
        seed: int,
        minute: float,
        next_serial: int,
        products: Mapping[str, ProductRef],
        stock: Iterable[StockLine] = (),
        tasks: Iterable[Task] = (),
        shipments: Iterable[Shipment] = (),
        crew_free: Mapping[str, float] | None = None,
    ) -> None:
        self.seed = seed
        self.minute = minute
        self.next_serial = next_serial
        self.products = products
        by_room: dict[str, list[str]] = {}
        for product in products.values():
            by_room.setdefault(room_for(product.category), []).append(product.sku)
        self.faces = {sku: slot.code for sku, slot in pick_faces(by_room).items()}
        self._face_slots = pick_faces(by_room)
        self.stock: dict[tuple[str, str], StockLine] = {}
        self._by_sku: dict[str, set[tuple[str, str]]] = {}
        self._occupied: Counter[str] = Counter()
        for line in stock:
            self._put(line)
        self.tasks: dict[str, Task] = {task.key: task for task in tasks}
        self.shipments: dict[str, Shipment] = {shipment.key: shipment for shipment in shipments}
        self.crew_free: dict[str, float] = {m.code: (crew_free or {}).get(m.code, NEVER) for m in CREW}
        self._reserved: Counter[tuple[str, str]] = Counter()
        self._incoming: set[str] = set()
        for task in self.tasks.values():
            if task.status in OPEN_STATUSES:
                self._claim(task)
        # What changed, for the engine to persist.
        self.movements: list[Movement] = []
        self.stock_touched: set[tuple[str, str]] = set()
        self.tasks_touched: set[str] = set()
        self.shipments_touched: set[str] = set()
        self.yard: list[YardEvent] = []
        self.issues: list[IssueRequest] = []
        self._heap: list[_Event] = []
        self._trailers: dict[str, Trailer] = {}
        self._load_at: dict[str, float] = {}
        self._until = minute

    @property
    def changed(self) -> bool:
        return bool(
            self.movements or self.tasks_touched or self.shipments_touched or self.yard or self.issues
        )

    # ── Stock bookkeeping ──

    def _put(self, line: StockLine) -> None:
        key = (line.lpn, line.location)
        self.stock[key] = line
        self._by_sku.setdefault(line.sku, set()).add(key)
        self._occupied[line.location] += 1

    def _drop(self, key: tuple[str, str]) -> None:
        line = self.stock.pop(key)
        self._by_sku[line.sku].discard(key)
        self._occupied[line.location] -= 1
        if self._occupied[line.location] <= 0:
            del self._occupied[line.location]

    def _move(
        self,
        kind: MovementKind,
        key: str,
        minute: float,
        lpn_id: str,
        source: str | None,
        target: str | None,
        cases: int,
        actor: str,
        ref: str | None,
        *,
        sku: str | None = None,
        lot: str | None = None,
        best_before: date | None = None,
    ) -> int:
        """Move `cases` of a licence plate between locations (None = outside the building) and record
        the movement. Returns the cases actually moved: never more than the source holds."""
        if source is not None:
            held = self.stock.get((lpn_id, source))
            if held is None:
                return 0
            cases = min(cases, held.cases)
            sku, lot, best_before = held.sku, held.lot, held.best_before
            if cases <= 0:
                return 0
            held.cases -= cases
            self.stock_touched.add((lpn_id, source))
            if held.cases == 0:
                self._drop((lpn_id, source))
        if sku is None or lot is None or best_before is None or cases <= 0:
            return 0
        if target is not None:
            existing = self.stock.get((lpn_id, target))
            if existing is None:
                self._put(StockLine(lpn_id, sku, lot, best_before, target, cases))
            else:
                existing.cases += cases
            self.stock_touched.add((lpn_id, target))
        self.movements.append(
            Movement(key, kind, minute, lpn_id, sku, lot, best_before, source, target, cases, actor, ref)
        )
        return cases

    def _new_lpn(self) -> str:
        serial = self.next_serial
        self.next_serial += 1
        return lpn(self.seed, serial)

    def _available(self, sku: str) -> list[tuple[StockLine, int]]:
        """Pickable stock of a SKU not already promised to a task, first-expiring first — the pick face
        before reserve on the same date."""
        face = self.faces.get(sku)
        found: list[tuple[StockLine, int]] = []
        for key in self._by_sku.get(sku, ()):
            line = self.stock[key]
            if area_of(line.location) is not Area.STORAGE:
                continue
            free = line.cases - self._reserved[key]
            if free > 0:
                found.append((line, free))
        found.sort(
            key=lambda item: (item[0].best_before, item[0].location != face, item[0].location, item[0].lpn)
        )
        return found

    def _free_slot(self, sku: str) -> str:
        return nearest_free(self._face_slots[sku], set(self._occupied) | self._incoming)

    # ── Tasks ──

    def _claim(self, task: Task) -> None:
        if task.kind in (TaskKind.PICK, TaskKind.REPLENISH) and task.lpn and task.from_location:
            self._reserved[(task.lpn, task.from_location)] += task.cases
        if task.kind is TaskKind.PUTAWAY and task.to_location:
            self._incoming.add(task.to_location)

    def _unclaim(self, task: Task) -> None:
        if task.kind in (TaskKind.PICK, TaskKind.REPLENISH) and task.lpn and task.from_location:
            key = (task.lpn, task.from_location)
            self._reserved[key] -= task.cases
            if self._reserved[key] <= 0:
                del self._reserved[key]
        if task.kind is TaskKind.PUTAWAY and task.to_location:
            self._incoming.discard(task.to_location)

    def _task(
        self,
        kind: TaskKind,
        key: str,
        minute: float,
        sku: str,
        lpn_id: str | None,
        source: str | None,
        target: str | None,
        cases: int,
        *,
        ref: str | None = None,
        whole_pallet: bool = True,
    ) -> Task:
        """Queue a task for whichever crew member can start it first (ties: the lower code)."""
        room = room_for(self.products[sku].category) if sku in self.products else "D"
        start, code = min((max(minute, self.crew_free[m.code]), m.code) for m in CREW)
        done = start + task_minutes(kind, cases, whole_pallet, room, CREW_BY_CODE[code].experience)
        self.crew_free[code] = done
        task = Task(
            key, kind, TaskStatus.OPEN, sku, lpn_id, source, target, cases, code, minute, start, done, ref
        )
        self.tasks[key] = task
        self.tasks_touched.add(key)
        self._claim(task)
        self._push(done, SEQ_TASK, key, lambda: self._complete(task))
        return task

    def _cancel(self, task: Task, note: str) -> None:
        if task.status not in OPEN_STATUSES:
            return
        self._unclaim(task)
        task.status = TaskStatus.CANCELLED
        task.note = note
        self.tasks_touched.add(task.key)

    def _dice(self, key: str) -> random.Random:
        return random.Random(f"dockiq-exc:{self.seed}:{key}")

    def _complete(self, task: Task) -> None:
        if task.status not in OPEN_STATUSES:
            return  # cancelled while queued
        if (
            task.kind in (TaskKind.PICK, TaskKind.REPLENISH)
            and task.lpn
            and task.from_location
            and self._dice(f"{task.key}:lost").random() < NOT_AT_LOCATION_CHANCE
        ):
            self._not_at_location(task)
            return
        self._unclaim(task)
        task.status = TaskStatus.DONE
        self.tasks_touched.add(task.key)
        match task.kind:
            case TaskKind.PUTAWAY | TaskKind.REPLENISH:
                kind = MovementKind.PUTAWAY if task.kind is TaskKind.PUTAWAY else MovementKind.REPLENISH
                if task.lpn and task.from_location:
                    self._move(
                        kind,
                        task.key,
                        task.done,
                        task.lpn,
                        task.from_location,
                        task.to_location,
                        task.cases,
                        task.assignee,
                        task.ref,
                    )
            case TaskKind.PICK:
                missing = self._short_pick(task)
                if task.lpn and task.from_location:
                    task.cases = self._move(
                        MovementKind.PICK,
                        task.key,
                        task.done,
                        task.lpn,
                        task.from_location,
                        task.to_location,
                        task.cases,
                        task.assignee,
                        task.ref,
                    )
                self._picked(task)
                if missing:
                    self._reallocate(task, missing)
                self._check_replenishment(task.sku, task.done)
            case TaskKind.CYCLE_COUNT:
                if task.from_location:
                    self._count(task, task.from_location)

    def _issue(self, minute: float, tag: str, **fields: Any) -> None:
        self.issues.append(IssueRequest(key=f"s{shift_of(minute)}-{tag}", minute=minute, **fields))

    def _door_of(self, ref: str | None) -> int | None:
        shipment = self.shipments.get(ref or "")
        return shipment.door if shipment is not None else None

    def _short_pick(self, task: Task) -> int:
        """Fewer cases at the location than the ledger says: the difference is written off, the
        pick takes what is there, and the line is allocated again (§12.13)."""
        dice = self._dice(f"{task.key}:short")
        if task.cases < 2 or not task.lpn or not task.from_location or dice.random() >= SHORT_PICK_CHANCE:
            return 0
        missing = self._move(
            MovementKind.ADJUST,
            f"{task.key}:short",
            task.done,
            task.lpn,
            task.from_location,
            None,
            dice.randint(1, min(SHORT_PICK_MAX, task.cases - 1)),
            task.assignee,
            task.ref,
        )
        if missing:
            found = task.cases - missing
            task.note = f"Short pick: {found} of {task.cases} cases"
            self._issue(
                task.done,
                f"short:{task.key}",
                issue_type="Count Discrepancy",
                subtype="Short count",
                description=(
                    f"Short pick at {task.from_location}: {found} of {task.cases} cases of {task.sku} "
                    f"({CREW_BY_CODE[task.assignee].name})"
                ),
                sku=task.sku,
                quantity=missing,
                count_expected=task.cases,
                count_actual=found,
                ref=task.ref,
                door=self._door_of(task.ref),
            )
        return missing

    def _reallocate(self, task: Task, cases: int) -> None:
        shipment = self.shipments.get(task.ref or "")
        if shipment is None or shipment.status in (ShipmentStatus.SHIPPED, ShipmentStatus.CANCELLED):
            return
        line = shipment.line(task.sku)
        line.allocated -= cases
        self._allocate(shipment, line, task.done)

    def _not_at_location(self, task: Task) -> None:
        """The pallet is not where the ledger says. It is written off as missing, every task that was
        counting on it is cancelled and its line allocated again, and the location is recounted."""
        plate, place, minute = task.lpn or "", task.from_location or "", task.done
        affected = [
            other
            for other in self.tasks.values()
            if other.status in OPEN_STATUSES
            and other.kind in (TaskKind.PICK, TaskKind.REPLENISH)
            and other.lpn == plate
            and other.from_location == place
        ]
        for other in affected:
            self._cancel(other, "Pallet not at location")
        held = self.stock.get((plate, place))
        lost = held.cases if held else 0
        if lost:
            self._move(
                MovementKind.ADJUST,
                f"{task.key}:lost",
                minute,
                task.lpn,
                place,
                None,
                lost,
                task.assignee,
                task.ref,
            )
        self._issue(
            minute,
            f"lost:{task.key}",
            issue_type="WMS/System Issue",
            subtype="WMS shows a different location",
            description=(
                f"Pallet {plate} ({task.sku}, {lost} cases) not at {place} "
                f"({CREW_BY_CODE[task.assignee].name}); written off pending a recount"
            ),
            sku=task.sku,
            quantity=max(lost, 1),
            ref=task.ref,
            door=self._door_of(task.ref),
        )
        self._task(TaskKind.CYCLE_COUNT, f"{task.key}:recount", minute, task.sku, None, place, place, 0)
        for other in affected:
            if other.kind is TaskKind.PICK:
                self._reallocate(other, other.cases)
        self._check_replenishment(task.sku, minute)

    def _count(self, task: Task, place: str) -> None:
        lines = sorted(
            (line for line in self.stock.values() if line.location == place), key=lambda line: line.lpn
        )
        dice = self._dice(f"{task.key}:variance")
        if lines and dice.random() < COUNT_VARIANCE_CHANCE:
            first = lines[0]
            short = self._move(
                MovementKind.ADJUST,
                f"{task.key}:variance",
                task.done,
                first.lpn,
                place,
                None,
                dice.randint(1, min(COUNT_VARIANCE_MAX, first.cases)),
                task.assignee,
                None,
            )
            task.note = f"Count variance: {short} cases short, adjusted"
        task.counted = sum(line.cases for line in self.stock.values() if line.location == place)

    def _check_replenishment(self, sku: str, minute: float) -> None:
        face = self.faces.get(sku)
        product = self.products.get(sku)
        if face is None or product is None:
            return
        if any(
            t.kind is TaskKind.REPLENISH and t.sku == sku and t.status in OPEN_STATUSES
            for t in self.tasks.values()
        ):
            return
        on_face = sum(free for line, free in self._available(sku) if line.location == face)
        if on_face >= REPLENISH_BELOW * product.cases_per_pallet:
            return
        source = next(
            (line for line, free in self._available(sku) if line.location != face and free == line.cases),
            None,
        )
        if source is not None:
            self._task(
                TaskKind.REPLENISH,
                f"rpl:{source.lpn}",
                minute,
                sku,
                source.lpn,
                source.location,
                face,
                source.cases,
            )

    # ── The event loop ──

    def _push(self, minute: float, seq: int, key: str, action: Callable[[], None]) -> None:
        if minute <= self._until:
            heapq.heappush(self._heap, _Event(minute, seq, key, action))

    def open(self, at: float) -> None:
        """The opening stock, received and put away before the shift at `at` begins (§12.7)."""
        for record in inventory(self.seed, list(self.products.values())):
            self._move(
                MovementKind.RECEIVE,
                f"open:{record.pallet_id}:receive",
                at,
                record.pallet_id,
                None,
                OPENING_LANE,
                record.cases,
                SYSTEM,
                None,
                sku=record.sku,
                lot=record.lot,
                best_before=record.best_before,
            )
            self._move(
                MovementKind.PUTAWAY,
                f"open:{record.pallet_id}:putaway",
                at,
                record.pallet_id,
                OPENING_LANE,
                record.location,
                record.cases,
                SYSTEM,
                None,
            )
        self.next_serial = max(self.next_serial, OPENING_SERIALS)
        # The watermark sits just before the shift, so its first events (wave 0, the ASNs) still run.
        self.minute = at - 1.0

    def run(self, trailers: Sequence[Trailer], until: float) -> None:
        since = self.minute
        if until <= since:
            return
        self._until = until
        self._trailers = {trailer.appointment.key: trailer for trailer in trailers}

        def due(minute: float) -> bool:
            return since < minute <= until

        for shift in range(shift_of(since), shift_of(until) + 1):
            base = shift * SHIFT_MINUTES
            if due(base):
                self._push(base, SEQ_SHIFT, f"s{shift}:start", lambda s=shift, b=base: self._rollover(s, b))
            count = 1
            while base + count * CYCLE_COUNT_EVERY < base + SHIFT_MINUTES:
                at = base + count * CYCLE_COUNT_EVERY
                if due(at):
                    self._push(
                        at,
                        SEQ_COUNT,
                        f"s{shift}-cc{count:02d}",
                        lambda s=shift, n=count, m=at: self._cycle_count(s, n, m),
                    )
                count += 1

            for room in ROOMS:
                found = rooms.excursion(self.seed, room, shift)
                if found is not None and found.alarm_at is not None and due(found.alarm_at):
                    self._push(
                        found.alarm_at, SEQ_ROOM, f"s{shift}-room-{room}", lambda e=found: self._room_alarm(e)
                    )

        waves: dict[tuple[int, int], list[Trailer]] = {}
        for trailer in trailers:
            a = trailer.appointment
            if a.type == "inbound" and due(asn_minute(a)):
                self._push(asn_minute(a), SEQ_ASN, f"{a.key}:asn", lambda t=trailer: self._asn(t))
            if a.type == "outbound":
                number, release = wave_of(a)
                if due(release):
                    waves.setdefault((a.shift, number), []).append(trailer)
            if due(a.arrival):
                self._push(a.arrival, SEQ_GATE_IN, f"{a.key}:gate-in", lambda t=trailer: self._gate_in(t))
            if trailer.at_door is not None and due(trailer.at_door):
                self._push(trailer.at_door, SEQ_YARD, f"{a.key}:yard", lambda t=trailer: self._yard_move(t))
            if a.type == "inbound" and trailer.managed:
                self._schedule_receipts(trailer, due)
            if trailer.departed is not None and due(trailer.departed):
                self._push(trailer.departed, SEQ_DEPART, f"{a.key}:depart", lambda t=trailer: self._depart(t))
        for (shift, number), members in waves.items():
            release = shift * SHIFT_MINUTES + number * WAVE_INTERVAL_MINUTES
            self._push(
                release,
                SEQ_WAVE,
                f"s{shift}-w{number:02d}",
                lambda s=shift, n=number, m=members, r=release: self._release_wave(s, n, m, r),
            )
        for task in list(self.tasks.values()):
            if task.status in OPEN_STATUSES:
                self._push(task.done, SEQ_TASK, task.key, lambda t=task: self._complete(t))
        for shipment in list(self.shipments.values()):
            self._schedule_load(shipment)

        while self._heap:
            heapq.heappop(self._heap).action()

        for task in self.tasks.values():
            if task.status is TaskStatus.OPEN and task.assigned <= until:
                task.status = TaskStatus.ASSIGNED
                self.tasks_touched.add(task.key)
        self.minute = until

    # ── Events ──

    def _rollover(self, shift: int, minute: float) -> None:
        """A new shift: loads from an earlier shift whose trailer never reached a door are cancelled
        and anything already picked for them goes back to stock."""
        for shipment in list(self.shipments.values()):
            trailer = self._trailers.get(shipment.key)
            if shipment.status in (ShipmentStatus.SHIPPED, ShipmentStatus.RECEIVED, ShipmentStatus.CANCELLED):
                continue
            if trailer is not None and (trailer.appointment.shift >= shift or trailer.at_door is not None):
                continue
            self._close_outbound(shipment, minute, "Trailer did not arrive in its shift")
            shipment.status, shipment.completed = ShipmentStatus.CANCELLED, minute
            self.shipments_touched.add(shipment.key)

    def _asn(self, trailer: Trailer) -> Shipment:
        a = trailer.appointment
        shipment = self.shipments.get(a.key)
        if shipment is None:
            shipment = Shipment(
                key=a.key,
                direction=a.type,
                order_number=a.order_number,
                customer=a.customer,
                carrier=a.carrier,
                trailer=a.trailer,
                door=a.door,
                status=ShipmentStatus.EXPECTED,
                created=asn_minute(a) if a.type == "inbound" else wave_of(a)[1],
                lines=[ShipmentLine(sku, cases) for sku, cases in a.lines],
            )
            self.shipments[a.key] = shipment
            self.shipments_touched.add(a.key)
        return shipment

    def _release_wave(self, shift: int, number: int, members: list[Trailer], minute: float) -> None:
        skus: set[str] = set()
        for trailer in sorted(members, key=lambda t: (t.appointment.scheduled, t.appointment.key)):
            a = trailer.appointment
            if a.key in self.shipments:
                continue
            shipment = self._asn(trailer)
            shipment.wave = f"W{shift + 1}-{number + 1:02d}"
            shipment.status = ShipmentStatus.RELEASED
            for line in shipment.lines:
                self._allocate(shipment, line, minute)
                skus.add(line.sku)
        for sku in sorted(skus):
            self._check_replenishment(sku, minute)

    def _allocate(self, shipment: Shipment, line: ShipmentLine, minute: float) -> None:
        """First-expiring-first: take what each licence plate has free until the line is covered."""
        need = line.expected - line.allocated
        for stock, free in self._available(line.sku):
            if need <= 0:
                break
            key = f"{shipment.key}:pick:{stock.lpn}"
            if key in self.tasks:
                continue
            take = min(need, free)
            self._task(
                TaskKind.PICK,
                key,
                minute,
                line.sku,
                stock.lpn,
                stock.location,
                stage_lane(shipment.door),
                take,
                ref=shipment.key,
                whole_pallet=take == stock.cases,
            )
            line.allocated += take
            need -= take
        self.shipments_touched.add(shipment.key)

    def _gate_in(self, trailer: Trailer) -> None:
        a = trailer.appointment
        reading = None
        if a.reefer_setpoint is not None:
            spread = random.Random(f"dockiq-reefer:{self.seed}:{a.key}").uniform(
                -REEFER_READING_SPREAD, REEFER_READING_SPREAD
            )
            reading = round(a.reefer_setpoint + spread, 1)
        self.yard.append(
            YardEvent(
                key=f"{a.key}:gate-in",
                ref=a.key,
                kind=YardEventKind.GATE_IN,
                minute=a.arrival,
                trailer=a.trailer,
                carrier=a.carrier,
                yard_spot=a.yard_spot,
                seal=a.seal if a.type == "inbound" else None,  # an outbound trailer arrives empty
                reefer_temp=reading,
                late=a.arrival - a.scheduled > ON_TIME_WINDOW,
            )
        )
        if a.type == "inbound":
            shipment = self._asn(trailer)
            shipment.status, shipment.arrived = ShipmentStatus.ARRIVED, a.arrival
            self.shipments_touched.add(a.key)
        elif (shipment := self.shipments.get(a.key)) is not None:
            shipment.arrived = a.arrival
            self.shipments_touched.add(a.key)

    def _yard_move(self, trailer: Trailer) -> None:
        a = trailer.appointment
        at_door = trailer.at_door if trailer.at_door is not None else a.arrival
        self.yard.append(
            YardEvent(
                key=f"{a.key}:yard",
                ref=a.key,
                kind=YardEventKind.YARD_MOVE,
                minute=at_door,
                trailer=a.trailer,
                carrier=a.carrier,
                door=trailer.door,
                yard_spot=a.yard_spot,
                dwell_minutes=round(at_door - a.arrival, 1),
            )
        )

    def _schedule_receipts(self, trailer: Trailer, due: Callable[[float], bool]) -> None:
        a = trailer.appointment
        if trailer.work_start is None:
            return
        pallets, hold = inbound_pallets(a, self.products)
        for k, (minute, (sku, cases)) in enumerate(
            zip(receipt_minutes(trailer, len(pallets)), pallets, strict=True)
        ):
            if due(minute):
                self._push(
                    minute,
                    SEQ_RECEIVE,
                    f"{a.key}:rcv:{k:02d}",
                    lambda t=trailer, n=k, s=sku, c=cases, m=minute: self._receive(t, n, s, c, m),
                )
        if hold is not None and trailer.exception_at is not None and due(trailer.exception_at):
            sku, cases = hold
            self._push(
                trailer.exception_at,
                SEQ_RECEIVE,
                f"{a.key}:rcv:hold",
                lambda t=trailer, s=sku, c=cases, m=trailer.exception_at: self._receive(t, None, s, c, m),
            )

    def _lot(self, a: Appointment, sku: str) -> tuple[str, date]:
        rng = random.Random(f"dockiq-lot:{self.seed}:{a.key}:{sku}")
        category = self.products[sku].category
        shortest, longest = SHELF_LIFE_DAYS.get(category, (90, 365))
        lot = f"L{rng.randint(2600, 2699)}{chr(65 + rng.randint(0, 25))}"
        return lot, calendar_day(a.shift) + timedelta(days=rng.randint(shortest, longest))

    def _receive(
        self, trailer: Trailer, k: int | None, sku: str, cases: int, minute: float, tag: str | None = None
    ) -> str:
        """One pallet off the trailer onto the door's dock lane, and a put-away task for it. `k` None
        is the quality-hold pallet (§12.8). Returns its licence plate."""
        a = trailer.appointment
        tag = tag or ("hold" if k is None else f"{k:02d}")
        dice = self._dice(f"{a.key}:rcv:{tag}:damage")
        if k is not None and cases > 1 and dice.random() < RECEIVING_DAMAGE_CHANCE:
            damaged = dice.randint(1, min(DAMAGED_CASES_MAX, cases - 1))
            damaged_plate = self._receive(trailer, None, sku, damaged, minute, tag=f"{tag}:damaged")
            self._issue(
                minute,
                f"damage:{a.key}:{tag}",
                issue_type="Damaged Pallet",
                subtype="Damaged cartons or packaging",
                description=f"{damaged} damaged cases of {sku} found at receipt, set aside on quality hold",
                sku=sku,
                quantity=damaged,
                ref=a.key,
                door=trailer.door or a.door,
                held=(damaged_plate,),
            )
            cases -= damaged
        shipment = self._asn(trailer)
        lot, best_before = self._lot(a, sku)
        plate = self._new_lpn()
        lane = dock_lane(trailer.door or a.door)
        self._move(
            MovementKind.RECEIVE,
            f"{a.key}:rcv:{tag}",
            minute,
            plate,
            None,
            lane,
            cases,
            trailer.operator or SYSTEM,
            a.key,
            sku=sku,
            lot=lot,
            best_before=best_before,
        )
        shipment.line(sku).done += cases
        shipment.pallets += 1
        shipment.status = ShipmentStatus.RECEIVING
        self.shipments_touched.add(a.key)
        room = room_for(self.products[sku].category)
        target = hold_area(room) if k is None else self._free_slot(sku)
        self._task(TaskKind.PUTAWAY, f"{a.key}:put:{tag}", minute, sku, plate, lane, target, cases, ref=a.key)
        return plate

    def _picked(self, task: Task) -> None:
        shipment = self.shipments.get(task.ref or "")
        if shipment is None or shipment.status in (ShipmentStatus.SHIPPED, ShipmentStatus.CANCELLED):
            return
        waiting = any(
            t.ref == shipment.key and t.kind is TaskKind.PICK and t.status in OPEN_STATUSES
            for t in self.tasks.values()
        )
        if not waiting and shipment.status is ShipmentStatus.RELEASED:
            shipment.status = ShipmentStatus.STAGED
            self.shipments_touched.add(shipment.key)
        self._schedule_load(shipment)

    def _staged(self, shipment: Shipment, start: float) -> list[Task]:
        return sorted(
            (
                t
                for t in self.tasks.values()
                if t.ref == shipment.key
                and t.kind is TaskKind.PICK
                and t.status is TaskStatus.DONE
                and t.cleared is None
            ),
            key=lambda t: (max(t.done, start), t.key),
        )

    def _next_load(self, shipment: Shipment) -> tuple[float, Task] | None:
        """The next pallet onto the trailer and when: the dock crew loads at their pace (the trailer's
        work window split evenly over its planned pallets), never before the pallet is staged."""
        trailer = self._trailers.get(shipment.key)
        if (
            trailer is None
            or not trailer.managed
            or trailer.work_start is None
            or trailer.work_minutes is None
            or shipment.status in (ShipmentStatus.SHIPPED, ShipmentStatus.CANCELLED)
        ):
            return None
        staged = self._staged(shipment, trailer.work_start)
        if not staged:
            return None
        planned = max(trailer.appointment.pallets, 1)
        slot = trailer.work_start + min(shipment.pallets + 1, planned) / planned * trailer.work_minutes
        return max(slot, staged[0].done, trailer.work_start), staged[0]

    def _schedule_load(self, shipment: Shipment) -> None:
        upcoming = self._next_load(shipment)
        if upcoming is None or self._load_at.get(shipment.key) == upcoming[0]:
            return
        at = upcoming[0]
        self._load_at[shipment.key] = at
        self._push(
            at, SEQ_LOAD, f"{shipment.key}:load:{shipment.pallets:03d}", lambda: self._load(shipment, at)
        )

    def _load(self, shipment: Shipment, at: float) -> None:
        if self._load_at.get(shipment.key) != at:
            return  # superseded
        del self._load_at[shipment.key]
        upcoming = self._next_load(shipment)
        trailer = self._trailers.get(shipment.key)
        if upcoming is None or trailer is None:
            return
        _, pick = upcoming
        if pick.lpn and pick.to_location:
            self._move(
                MovementKind.LOAD,
                f"{shipment.key}:load:{pick.lpn}",
                at,
                pick.lpn,
                pick.to_location,
                trailer.appointment.trailer,
                pick.cases,
                trailer.operator or SYSTEM,
                shipment.key,
            )
        pick.cleared, pick.note = at, "loaded"
        self.tasks_touched.add(pick.key)
        shipment.pallets += 1
        shipment.status = ShipmentStatus.LOADING
        self.shipments_touched.add(shipment.key)
        self._schedule_load(shipment)

    def _close_outbound(self, shipment: Shipment, minute: float, why: str) -> None:
        """Stop the picking for a load and send back to stock whatever is still on its staging lane."""
        for task in list(self.tasks.values()):
            if task.ref != shipment.key or task.kind is not TaskKind.PICK:
                continue
            if task.status in OPEN_STATUSES:
                self._cancel(task, why)
            elif task.status is TaskStatus.DONE and task.cleared is None and task.lpn and task.to_location:
                task.cleared, task.note = minute, "returned to stock"
                self.tasks_touched.add(task.key)
                self._task(
                    TaskKind.PUTAWAY,
                    f"{shipment.key}:return:{task.lpn}",
                    minute,
                    task.sku,
                    task.lpn,
                    task.to_location,
                    self._free_slot(task.sku),
                    task.cases,
                    ref=shipment.key,
                )

    def _depart(self, trailer: Trailer) -> None:
        a = trailer.appointment
        departed = trailer.departed if trailer.departed is not None else a.arrival
        shipment = self.shipments.get(a.key)
        if shipment is not None and a.type == "outbound":
            self._close_outbound(shipment, departed, "Trailer left before the pick")
            shipped: Counter[str] = Counter()
            for (plate, location), line in sorted(self.stock.items()):
                if location == a.trailer:
                    moved = self._move(
                        MovementKind.SHIP,
                        f"{a.key}:ship:{plate}",
                        departed,
                        plate,
                        location,
                        None,
                        line.cases,
                        trailer.operator or SYSTEM,
                        a.key,
                    )
                    shipped[line.sku] += moved
            for line in shipment.lines:
                line.done = shipped[line.sku]
            shipment.status = ShipmentStatus.SHIPPED
            shipment.seal = a.seal
            shipment.confirmation = f"SC-{a.order_number.removeprefix('SIM-')}"
        elif shipment is not None:
            shipment.status = ShipmentStatus.RECEIVED
            shipment.confirmation = f"RC-{a.order_number.removeprefix('SIM-')}"
        if shipment is not None:
            shipment.completed = departed
            self.shipments_touched.add(a.key)
        dwell = departed - a.arrival
        self.yard.append(
            YardEvent(
                key=f"{a.key}:gate-out",
                ref=a.key,
                kind=YardEventKind.GATE_OUT,
                minute=departed,
                trailer=a.trailer,
                carrier=a.carrier,
                door=trailer.door,
                seal=a.seal if a.type == "outbound" else None,
                dwell_minutes=round(dwell, 1),
                detention=dwell > DETENTION_AFTER,
            )
        )

    def _cycle_count(self, shift: int, number: int, minute: float) -> None:
        locations = sorted(
            {line.location for line in self.stock.values() if area_of(line.location) is Area.STORAGE}
        )
        if not locations:
            return
        location = random.Random(f"dockiq-count:{self.seed}:{shift}:{number}").choice(locations)
        lines = sorted(
            (line for line in self.stock.values() if line.location == location), key=lambda line: line.lpn
        )
        self._task(
            TaskKind.CYCLE_COUNT,
            f"s{shift}-cc{number:02d}",
            minute,
            lines[0].sku,
            lines[0].lpn,
            location,
            location,
            sum(line.cases for line in lines),
        )

    def _room_alarm(self, excursion: rooms.Excursion) -> None:
        """A cold room over its limit long enough to alarm: filed once, against the most
        temperature-sensitive product stored there (§12.12)."""
        minute = excursion.alarm_at if excursion.alarm_at is not None else excursion.start
        room = excursion.room
        _, limit = rooms.CLIMATE[room]
        stored: Counter[str] = Counter()
        for line in self.stock.values():
            if line.location.startswith(f"{room}-"):
                stored[line.sku] += line.cases
        sensitive = sorted(
            (
                (product.temp_max, sku)
                for sku in stored
                if (product := self.products.get(sku)) is not None and product.temp_max is not None
            ),
        )
        sku = sensitive[0][1] if sensitive else None
        reading = rooms.reading(self.seed, room, minute)
        tag = f"s{shift_of(minute)}-room-{room}"
        exposed = select_for_hold(self.stock.values(), self.products, room=room, above=reading)
        held = self.hold(exposed, minute, SYSTEM, tag, tag)
        self._issue(
            minute,
            f"room-{room}",
            issue_type="Temperature Deviation",
            subtype=rooms.EXCURSION_CAUSES[excursion.cause],
            description=(
                f"{ROOM_NAMES[room]} reads {reading}°F, over its {limit}°F limit for "
                f"{rooms.ALARM_AFTER:.0f} min ({rooms.CAUSE_TEXT[excursion.cause]})"
            ),
            sku=sku,
            quantity=min(stored[sku], self.products[sku].cases_per_pallet) if sku else 1,
            temp_reading=reading,
            temp_limit=limit,
            kind="room_excursion",
            room_minutes_over_limit=rooms.ALARM_AFTER,
            room=room,
            held=tuple(held),
        )

    # ── Quality hold and disposition (business-rules §7.3) ──

    def hold(self, lines: Sequence[StockLine], minute: float, actor: str, ref: str, tag: str) -> list[str]:
        """Move each plate to its room's quality hold. Tasks counting on it are cancelled; a pick it
        served (queued, or already staged) is allocated again from pickable stock — never held stock.
        Returns the plates moved, in plate order."""
        held: list[str] = []
        again: list[Task] = []
        skus: set[str] = set()
        for chosen in lines:
            place = (chosen.lpn, chosen.location)
            line = self.stock.get(place)
            if line is None or area_of(line.location) not in HOLDABLE_AREAS:
                continue
            for task in list(self.tasks.values()):
                if task.lpn != line.lpn:
                    continue
                if task.status in OPEN_STATUSES and task.from_location == line.location:
                    self._cancel(task, "Quality hold")
                    if task.kind is TaskKind.PICK:
                        again.append(task)
                elif (
                    task.kind is TaskKind.PICK
                    and task.status is TaskStatus.DONE
                    and task.cleared is None
                    and task.to_location == line.location
                ):
                    task.cleared, task.note = minute, "quality hold"
                    self.tasks_touched.add(task.key)
                    again.append(task)
            product = self.products.get(line.sku)
            room = room_for(product.category) if product is not None else (room_of(line.location) or "D")
            moved = self._move(
                MovementKind.HOLD,
                f"{tag}:hold:{line.lpn}:{line.location}",
                minute,
                line.lpn,
                line.location,
                hold_area(room),
                line.cases,
                actor,
                ref,
            )
            if moved and line.lpn not in held:
                held.append(line.lpn)
                skus.add(line.sku)
        for task in again:
            self._reallocate(task, task.cases)
        for sku in sorted(skus):
            self._check_replenishment(sku, minute)
        return sorted(held)

    def dispose(
        self, plates: Iterable[str], action: str, minute: float, actor: str, ref: str, tag: str
    ) -> list[str]:
        """Quality's call on held plates: `release` to the nearest free reserve slot (a pickable
        location again), or `destroy` / `return_to_vendor` out of the building as an adjustment."""
        wanted = set(plates)
        moved: list[str] = []
        for (plate, location), line in sorted(self.stock.items()):
            if plate not in wanted or area_of(location) is not Area.HOLD:
                continue
            if action == "release":
                slot = self._face_slots.get(line.sku)
                target = (
                    nearest_free(slot, set(self._occupied) | self._incoming)
                    if slot
                    else overflow(location[0])
                )
                done = self._move(
                    MovementKind.RELEASE,
                    f"{tag}:release:{plate}",
                    minute,
                    plate,
                    location,
                    target,
                    line.cases,
                    actor,
                    ref,
                )
            else:
                done = self._move(
                    MovementKind.ADJUST,
                    f"{tag}:{action}:{plate}",
                    minute,
                    plate,
                    location,
                    None,
                    line.cases,
                    actor,
                    ref,
                )
            if done and plate not in moved:
                moved.append(plate)
        return sorted(moved)
