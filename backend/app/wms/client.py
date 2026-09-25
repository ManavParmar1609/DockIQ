"""The WMS boundary. See .claude/rules/architecture.md §4.

    routes  →  WmsClient (protocol)  →  SimulatedWms   ← this project's live simulator
                                     →  a real WMS     ← a pilot implements this protocol; config-only

Routes depend on this protocol and nothing behind it. Anything the app needs from a warehouse
management system — trailer appointments, inventory by location, order write-back, availability —
goes through here. Simulator concepts (seeds, virtual clocks) must never appear in a route handler.
"""

from dataclasses import dataclass
from datetime import date
from typing import Protocol


class WmsUnavailable(Exception):  # noqa: N818 — reads as a state, like `TimeoutError` does not
    """The WMS cannot be reached. Operators fall back to paper; the API answers 503."""


@dataclass(frozen=True, slots=True)
class WmsStatus:
    mode: str  # "simulated" | "none"
    online: bool
    message: str


@dataclass(frozen=True, slots=True)
class YardEntry:
    ref: str
    order_number: str
    door: int
    type: str
    customer: str
    carrier: str
    trailer: str
    state: str  # scheduled | in_yard | at_door | departed
    due_in_minutes: float | None  # for scheduled trailers
    simulated: bool
    scheduled_at: str  # the booked appointment, "HH:MM"
    arrived_at: str | None  # at the gate, "HH:MM"
    late_minutes: float | None  # against the appointment; negative = early
    reefer_setpoint: float | None  # °F
    yard_spot: str | None  # while waiting for a door
    dwell_minutes: float | None  # on site so far, or until departure
    detention: bool  # on site longer than the detention allowance


@dataclass(frozen=True, slots=True)
class Pallet:
    pallet_id: str
    sku: str
    location: str
    cases: int
    lot: str
    best_before: date


@dataclass(frozen=True, slots=True)
class StockRecord:
    """One licence plate at one location: what is on hand, where, and in what state."""

    pallet_id: str
    sku: str
    location: str
    area: str  # storage | hold | dock | stage | trailer
    room: str | None
    cases: int
    lot: str
    best_before: date
    simulated: bool


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    id: int
    kind: str  # receive | putaway | replenish | pick | load | ship | adjust
    minute: float
    time: str  # "HH:MM"
    pallet_id: str
    sku: str
    lot: str
    best_before: date
    from_location: str | None
    to_location: str | None
    cases: int
    actor: str
    actor_name: str
    order_number: str | None
    simulated: bool


@dataclass(frozen=True, slots=True)
class WarehouseTask:
    key: str
    kind: str  # putaway | pick | replenish | cycle_count
    status: str  # open | assigned | done | cancelled
    sku: str
    pallet_id: str | None
    from_location: str | None
    to_location: str | None
    cases: int
    assignee: str
    assignee_name: str
    queued_at: str
    started_at: str
    finished_at: str
    standard_minutes: float
    order_number: str | None
    counted_cases: int | None
    note: str | None
    simulated: bool


@dataclass(frozen=True, slots=True)
class CrewProductivity:
    code: str
    name: str
    role: str  # warehouse (tasks) | dock (receiving and loading)
    tasks_done: int
    cases: int
    tasks_per_hour: float
    cases_per_hour: float
    busy_percent: float | None
    simulated: bool


@dataclass(frozen=True, slots=True)
class ShipmentLine:
    sku: str
    expected: int
    allocated: int
    done: int


@dataclass(frozen=True, slots=True)
class ShipmentRecord:
    """An inbound advance ship notice and its receipt, or an outbound load from wave to ship
    confirmation."""

    ref: str
    direction: str
    order_number: str
    customer: str
    carrier: str
    trailer: str
    door: int
    wave: str | None
    status: str
    created_at: str
    arrived_at: str | None
    completed_at: str | None
    seal: str | None
    confirmation: str | None
    pallets: int
    cases_expected: int
    cases_allocated: int
    cases_done: int
    lines: tuple[ShipmentLine, ...]
    simulated: bool


@dataclass(frozen=True, slots=True)
class GateEvent:
    """The gate and the yard: check-in, the move from a yard spot to a door, check-out."""

    id: int
    kind: str  # gate_in | yard_move | gate_out
    minute: float
    time: str
    order_number: str | None
    trailer: str
    carrier: str
    door: int | None
    yard_spot: str | None
    seal: str | None
    reefer_temp: float | None
    dwell_minutes: float | None
    late: bool
    detention: bool
    simulated: bool


@dataclass(frozen=True, slots=True)
class RoomReading:
    minute: float
    time: str
    temp: float


@dataclass(frozen=True, slots=True)
class ColdRoom:
    code: str
    name: str
    setpoint: float
    limit: float
    temp: float
    over_limit: bool
    alarm: bool  # an excursion has lasted long enough to raise the alarm, and is not over
    readings: tuple[RoomReading, ...]
    slots: int
    occupied: int
    pallets: int
    cases: int
    on_hold_cases: int
    simulated: bool


class WmsClient(Protocol):
    async def status(self) -> WmsStatus: ...

    async def appointments(self) -> list[YardEntry]:
        """Trailers scheduled, waiting in the yard, at a door, and recently departed."""
        ...

    async def inventory(self, sku: str) -> list[Pallet]:
        """Where a SKU is stored. Raises WmsUnavailable when offline."""
        ...

    async def find_pallet(self, pallet_id: str) -> Pallet | None: ...

    async def confirm_order(self, order_ref: str, counts: dict[str, int]) -> None:
        """Write the final counts back. Raises WmsUnavailable when offline; the caller retries."""
        ...

    async def stock(self, room: str | None, sku: str | None, limit: int) -> list[StockRecord]:
        """On hand by licence plate and location, first-expiring first."""
        ...

    async def tasks(self, status: str | None, kind: str | None, limit: int) -> list[WarehouseTask]:
        """The task queue, most recently queued first."""
        ...

    async def productivity(self) -> list[CrewProductivity]:
        """This shift so far, per crew member."""
        ...

    async def transactions(
        self, limit: int, before_id: int | None, sku: str | None, pallet_id: str | None
    ) -> list[LedgerEntry]:
        """The movement ledger, newest first; `before_id` pages back."""
        ...

    async def shipments(self, direction: str | None, limit: int) -> list[ShipmentRecord]: ...

    async def shipment(self, ref: str) -> ShipmentRecord | None: ...

    async def gate_log(self, limit: int) -> list[GateEvent]:
        """Gate check-ins, yard moves and check-outs, newest first."""
        ...

    async def rooms(self, readings: int) -> list[ColdRoom]:
        """Each temperature room: its latest readings and what is stored in it."""
        ...


class NoWms:
    """WMS_MODE=none: no warehouse system connected. Everything reads as unavailable."""

    async def status(self) -> WmsStatus:
        return WmsStatus(mode="none", online=False, message="No WMS is connected")

    async def appointments(self) -> list[YardEntry]:
        raise WmsUnavailable("No WMS is connected")

    async def inventory(self, sku: str) -> list[Pallet]:
        raise WmsUnavailable("No WMS is connected")

    async def find_pallet(self, pallet_id: str) -> Pallet | None:
        raise WmsUnavailable("No WMS is connected")

    async def confirm_order(self, order_ref: str, counts: dict[str, int]) -> None:
        return None

    async def stock(self, room: str | None, sku: str | None, limit: int) -> list[StockRecord]:
        raise WmsUnavailable("No WMS is connected")

    async def tasks(self, status: str | None, kind: str | None, limit: int) -> list[WarehouseTask]:
        raise WmsUnavailable("No WMS is connected")

    async def productivity(self) -> list[CrewProductivity]:
        raise WmsUnavailable("No WMS is connected")

    async def transactions(
        self, limit: int, before_id: int | None, sku: str | None, pallet_id: str | None
    ) -> list[LedgerEntry]:
        raise WmsUnavailable("No WMS is connected")

    async def shipments(self, direction: str | None, limit: int) -> list[ShipmentRecord]:
        raise WmsUnavailable("No WMS is connected")

    async def shipment(self, ref: str) -> ShipmentRecord | None:
        raise WmsUnavailable("No WMS is connected")

    async def gate_log(self, limit: int) -> list[GateEvent]:
        raise WmsUnavailable("No WMS is connected")

    async def rooms(self, readings: int) -> list[ColdRoom]:
        raise WmsUnavailable("No WMS is connected")
