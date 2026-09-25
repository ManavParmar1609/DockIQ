"""The simulated shift, as a pure function of (seed, shift). See docs/architecture/business-rules.md §12.

Nothing here reads a database or the wall clock: given the same seed and the same reference data it
produces the same trailers at the same doors with the same problems, every time. That is what makes a
demo rehearsable and a whole shift testable in milliseconds.
"""

import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from app.wms.clock import SHIFT_MINUTES
from app.wms.layout import nearest_free, pick_faces

# Minutes of work per pallet by operator experience (the seeded `experience_level`).
MINUTES_PER_PALLET: dict[str, float] = {"senior": 2.0, "experienced": 2.6, "new": 3.4}
DEFAULT_MINUTES_PER_PALLET = 2.6
INSPECTION_MINUTES = (4, 9)
TURN_GAP_MINUTES = (12, 30)
FIRST_ARRIVAL_MINUTES = (4, 45)
LAST_ARRIVAL_BEFORE_END = 70
EXCEPTION_PROBABILITY = 0.3
OUTAGE_WINDOW = (90, 390)
OUTAGE_MINUTES = (5, 10)

# Carrier punctuality: (earliest, most likely, latest) minutes against the booked appointment, drawn
# from a triangular distribution. Each carrier keeps one profile for every shift of a seed's run.
PUNCTUALITY: dict[str, tuple[float, float, float]] = {
    "reliable": (-15.0, -3.0, 15.0),
    "average": (-10.0, 5.0, 40.0),
    "late": (-5.0, 18.0, 75.0),
}
ON_TIME_WINDOW = 15.0  # arriving up to this many minutes after the appointment is on time
DETENTION_AFTER = 120.0  # minutes on site before the carrier can bill detention
REEFER_BELOW_LIMIT = 5.0  # the reefer is set this many °F under the strictest product limit
YARD_SPOTS = 40

# Inventory: the temperature room each category is stored in, and its shelf life in days.
STORAGE_ZONE: dict[str, str] = {"Frozen": "F", "Refrigerated": "C", "Produce": "P", "Dry": "D"}
SHELF_LIFE_DAYS: dict[str, tuple[int, int]] = {
    "Frozen": (120, 365),
    "Refrigerated": (6, 21),
    "Produce": (3, 12),
    "Dry": (90, 540),
}
INVENTORY_DATE = date(2026, 9, 25)  # the simulation's calendar day for best-before dates


@dataclass(frozen=True, slots=True)
class ProductRef:
    sku: str
    name: str
    category: str
    cases_per_pallet: int
    temp_max: float | None


@dataclass(frozen=True, slots=True)
class CustomerRef:
    name: str
    products: tuple[ProductRef, ...]


@dataclass(frozen=True, slots=True)
class PlannedException:
    """A problem that will surface part-way through the work on a trailer."""

    at_fraction: float  # of the work time, 0–1
    issue_type: str
    subtype: str
    description: str
    sku: str | None = None
    quantity: int = 1
    temp_reading: float | None = None
    temp_limit: float | None = None
    count_expected: int | None = None
    count_actual: int | None = None
    follow_up_minutes: float = 6.0  # when the operator resolves or escalates it


@dataclass(frozen=True, slots=True)
class Appointment:
    """One booked trailer. `scheduled` is the appointment; `arrival` is when it actually reaches the
    gate (carrier punctuality applied). Both are simulated minutes since shift 0 started."""

    key: str
    shift: int
    door: int
    type: str  # inbound | outbound
    customer: str
    carrier: str
    order_number: str
    trailer: str
    bol: str
    seal: str
    scheduled: float
    arrival: float
    reefer_setpoint: float | None  # °F; None for a load with no temperature limit
    yard_spot: str  # where it parks if its door is busy
    inspection_minutes: float
    lines: tuple[tuple[str, int], ...]  # (sku, cases)
    pallets: int
    exception: PlannedException | None


@dataclass(frozen=True, slots=True)
class ShiftPlan:
    shift: int
    appointments: tuple[Appointment, ...]
    outages: tuple[tuple[float, float], ...]  # (start, end) in simulated minutes


def punctuality(seed: int, carrier_code: str) -> str:
    """The carrier's punctuality profile for this seed: reliable, average or late."""
    return random.Random(f"dockiq-carrier:{seed}:{carrier_code}").choices(
        list(PUNCTUALITY), weights=(4, 4, 2)
    )[0]


def work_minutes(pallets: int, experience: str | None) -> float:
    return pallets * MINUTES_PER_PALLET.get(experience or "", DEFAULT_MINUTES_PER_PALLET)


def _exception(
    rng: random.Random, kind: str, lines: tuple[tuple[str, int], ...], products: dict[str, ProductRef]
) -> PlannedException | None:
    sku, cases = rng.choice(lines)
    product = products[sku]
    fraction = rng.uniform(0.15, 0.85)
    follow = rng.uniform(3, 12)
    match kind:
        case "temperature":
            if product.temp_max is None:
                return None
            delta = rng.choice((2.5, 7.0, 14.0))
            reading = round(product.temp_max + delta, 1)
            return PlannedException(
                fraction,
                "Temperature Deviation",
                "Product temperature out of range",
                f"Probe reads {reading}°F on {product.name}",
                sku,
                rng.randint(4, 24),
                temp_reading=reading,
                temp_limit=product.temp_max,
                follow_up_minutes=follow,
            )
        case "damage":
            subtype = rng.choice(
                ("Crushed or collapsed pallet", "Damaged cartons or packaging", "Leaning or unstable load")
            )
            return PlannedException(
                fraction,
                "Damaged Pallet",
                subtype,
                f"{subtype}: {product.name}",
                sku,
                rng.randint(2, 10),
                follow_up_minutes=follow,
            )
        case "count":
            short = rng.randint(2, max(3, cases // 8))
            return PlannedException(
                fraction,
                "Count Discrepancy",
                "Short count",
                f"{cases - short} of {cases} cases of {product.name}",
                sku,
                short,
                count_expected=cases,
                count_actual=cases - short,
                follow_up_minutes=follow,
            )
        case "sku":
            return PlannedException(
                fraction,
                "SKU Mismatch",
                "Wrong product staged",
                f"Staged product is not {product.name}",
                sku,
                rng.randint(1, 6),
                follow_up_minutes=follow,
            )
        case "barcode":
            subtype = rng.choice(
                ("Barcode will not scan", "Barcode covered by frost, dirt or wrap", "Label missing")
            )
            return PlannedException(
                fraction,
                "Barcode Issue",
                subtype,
                f"{subtype} on {product.sku}",
                sku,
                1,
                follow_up_minutes=follow,
            )
        case "equipment":
            subtype = rng.choice(
                ("Scanner battery dead", "Forklift low battery or fuel", "Dock leveler not working")
            )
            return PlannedException(
                fraction, "Equipment Failure", subtype, subtype, None, 1, follow_up_minutes=follow
            )
        case "safety":
            subtype = rng.choice(
                ("Slip hazard (ice or water)", "Near miss", "Obstructed path or blocked exit")
            )
            return PlannedException(
                fraction, "Safety Incident", subtype, subtype, None, 1, follow_up_minutes=follow
            )
        case "paperwork":
            return PlannedException(
                fraction,
                "Paperwork Mismatch",
                "Paperwork does not match load",
                "BOL lines do not match the trailer",
                None,
                1,
                follow_up_minutes=follow,
            )
    return None


# Relative frequency of exception kinds (temperature only applies to inbound reefer loads).
EXCEPTION_KINDS: tuple[tuple[str, int], ...] = (
    ("damage", 25),
    ("temperature", 15),
    ("count", 15),
    ("sku", 10),
    ("barcode", 10),
    ("equipment", 10),
    ("safety", 8),
    ("paperwork", 7),
)


def plan_shift(
    seed: int,
    shift: int,
    doors: Sequence[int],
    customers: Sequence[CustomerRef],
    carriers: Sequence[tuple[str, str]],  # (code, name)
) -> ShiftPlan:
    rng = random.Random(f"dockiq:{seed}:{shift}")
    base = shift * SHIFT_MINUTES
    products = {product.sku: product for customer in customers for product in customer.products}
    appointments: list[Appointment] = []
    serial = 0

    for door in sorted(doors):
        clock = rng.uniform(*FIRST_ARRIVAL_MINUTES)
        while clock < SHIFT_MINUTES - LAST_ARRIVAL_BEFORE_END:
            serial += 1
            customer = rng.choice(customers)
            carrier_code, _ = rng.choice(carriers)
            order_type = rng.choice(("inbound", "outbound"))
            chosen = rng.sample(customer.products, k=min(len(customer.products), rng.randint(1, 3)))
            lines = tuple(
                (
                    product.sku,
                    rng.randint(2, 5) * product.cases_per_pallet - rng.choice((0, 0, rng.randint(1, 8))),
                )
                for product in chosen
            )
            pallets = sum(-(-cases // products[sku].cases_per_pallet) for sku, cases in lines)
            exception = None
            if rng.random() < EXCEPTION_PROBABILITY:
                kinds = [
                    kind for kind, _ in EXCEPTION_KINDS if kind != "temperature" or order_type == "inbound"
                ]
                weights = [weight for kind, weight in EXCEPTION_KINDS if kind in kinds]
                exception = _exception(rng, rng.choices(kinds, weights)[0], lines, products)
            inspection = rng.uniform(*INSPECTION_MINUTES)
            low, mode, high = PUNCTUALITY[punctuality(seed, carrier_code)]
            scheduled = base + clock
            limits = [products[sku].temp_max for sku, _ in lines if products[sku].temp_max is not None]
            appointments.append(
                Appointment(
                    key=f"s{shift}-d{door}-{serial}",
                    shift=shift,
                    door=door,
                    type=order_type,
                    customer=customer.name,
                    carrier=carrier_code,
                    order_number=f"SIM-{shift + 1}-{serial:03d}",
                    trailer=f"TRL-{carrier_code[:2]}-{rng.randint(1000, 9999)}",
                    bol=f"BOL-{rng.randint(100000, 999999)}",
                    seal=f"SL-{rng.randint(10000, 99999)}",
                    scheduled=scheduled,
                    arrival=max(float(base), scheduled + rng.triangular(low, high, mode)),
                    reefer_setpoint=min(limits) - REEFER_BELOW_LIMIT if limits else None,
                    yard_spot=f"Y-{rng.randint(1, YARD_SPOTS):02d}",
                    inspection_minutes=inspection,
                    lines=lines,
                    pallets=pallets,
                    exception=exception,
                )
            )
            # Paced for the slowest crew member, so a lane does not fall further behind every turn.
            clock += inspection + work_minutes(pallets, "new") + rng.uniform(*TURN_GAP_MINUTES)

    start = rng.uniform(*OUTAGE_WINDOW)
    outage = (base + start, base + start + rng.uniform(*OUTAGE_MINUTES))
    return ShiftPlan(
        shift=shift, appointments=tuple(sorted(appointments, key=lambda a: a.arrival)), outages=(outage,)
    )


# ── Inventory: the opening stock the ledger starts from (§12.7) ──

OPENING_PALLETS = (6, 10)  # per SKU
OPENING_SERIALS = 1_000_000  # opening licence plates use serials below this; receipts count up from it


@dataclass(frozen=True, slots=True)
class PalletRecord:
    pallet_id: str  # SSCC-style licence plate
    sku: str
    location: str  # room-aisle-bay-level, e.g. F-12-B04-2
    cases: int
    lot: str
    best_before: date


def lpn(seed: int, serial: int) -> str:
    """A licence plate: a fictional GS1-style prefix, the seed, then a serial."""
    return f"00286{seed % 1000:03d}{serial:07d}"


def calendar_day(shift: int) -> date:
    """The simulated date of a shift: one day shift per day, the first on INVENTORY_DATE."""
    return INVENTORY_DATE + timedelta(days=shift)


def inventory(seed: int, products: Sequence[ProductRef]) -> tuple[PalletRecord, ...]:
    """The opening stock: full pallets in their temperature room, listed first-expiring-first (FEFO).
    Each SKU's earliest-expiring pallet sits on its pick face; the rest fill the nearest free reserve
    slots."""
    rng = random.Random(f"dockiq-inventory:{seed}")
    by_room: dict[str, list[str]] = {}
    for product in products:
        by_room.setdefault(STORAGE_ZONE.get(product.category, "D"), []).append(product.sku)
    faces = pick_faces(by_room)
    taken: set[str] = set()
    records: list[PalletRecord] = []
    for index, product in enumerate(sorted(products, key=lambda p: p.sku)):
        shortest, longest = SHELF_LIFE_DAYS.get(product.category, (90, 365))
        dated = sorted(
            (INVENTORY_DATE + timedelta(days=rng.randint(shortest, longest)), n)
            for n in range(rng.randint(*OPENING_PALLETS))
        )
        face = faces[product.sku]
        for position, (best_before, n) in enumerate(dated):
            location = face.code if position == 0 else nearest_free(face, taken)
            taken.add(location)
            records.append(
                PalletRecord(
                    pallet_id=lpn(seed, index * 1000 + n),
                    sku=product.sku,
                    location=location,
                    cases=product.cases_per_pallet,
                    lot=f"L{rng.randint(2600, 2699)}{chr(65 + n)}",
                    best_before=best_before,
                )
            )
    return tuple(records)


def work_window(appointment: Appointment, at_door: float, experience: str | None) -> tuple[float, float]:
    """(start, duration) of the work on a trailer that reached its door at `at_door`: the inspection
    first, then the pallets at the crew member's rate."""
    return at_door + appointment.inspection_minutes, work_minutes(appointment.pallets, experience)


# ── Shift KPIs: what a WMS reports about the dock, from the plan and what happened ──


@dataclass(frozen=True, slots=True)
class Visit:
    """What happened to one appointment: when it reached a door and when it left (sim minutes)."""

    at_door: float | None
    departed: float | None


@dataclass(frozen=True, slots=True)
class ShiftKpis:
    arrived: int
    on_time_percent: float | None
    average_turn_minutes: float | None  # gate to departure, for trailers that have left
    on_detention: int
    pallets_per_hour: float
    door_utilization_percent: float


def shift_kpis(
    appointments: Sequence[Appointment],
    visits: Mapping[str, Visit],
    minute: float,
    doors: int,
    shift_start: float,
) -> ShiftKpis:
    arrived = [a for a in appointments if a.arrival <= minute]
    on_time = [a for a in arrived if a.arrival - a.scheduled <= ON_TIME_WINDOW]
    turns: list[float] = []
    detention = 0
    pallets_moved = 0
    occupied = 0.0
    for appointment in arrived:
        visit = visits.get(appointment.key)
        left = visit.departed if visit else None
        if (left if left is not None else minute) - appointment.arrival > DETENTION_AFTER:
            detention += 1
        if left is not None:
            turns.append(left - appointment.arrival)
            pallets_moved += appointment.pallets
        if visit and visit.at_door is not None:
            occupied += (left if left is not None else minute) - visit.at_door
    elapsed = max(minute - shift_start, 0.0)
    return ShiftKpis(
        arrived=len(arrived),
        on_time_percent=round(len(on_time) / len(arrived) * 100, 1) if arrived else None,
        average_turn_minutes=round(sum(turns) / len(turns), 1) if turns else None,
        on_detention=detention,
        pallets_per_hour=round(pallets_moved / max(elapsed / 60, 0.25), 1),
        door_utilization_percent=round(min(occupied / (doors * elapsed) * 100, 100.0), 1)
        if elapsed and doors
        else 0.0,
    )
