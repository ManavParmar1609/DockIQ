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
