"""The simulated shift, as a pure function of (seed, shift). See docs/architecture/business-rules.md §12.

Nothing here reads a database or the wall clock: given the same seed and the same reference data it
produces the same trailers at the same doors with the same problems, every time. That is what makes a
demo rehearsable and a whole shift testable in milliseconds.
"""

import random
from collections.abc import Sequence
from dataclasses import dataclass

from app.wms.clock import SHIFT_MINUTES

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
    arrival: float  # simulated minutes since shift 0 started
    inspection_minutes: float
    lines: tuple[tuple[str, int], ...]  # (sku, cases)
    pallets: int
    exception: PlannedException | None


@dataclass(frozen=True, slots=True)
class ShiftPlan:
    shift: int
    appointments: tuple[Appointment, ...]
    outages: tuple[tuple[float, float], ...]  # (start, end) in simulated minutes


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
                    arrival=base + clock,
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


# ── Inventory: a per-seed snapshot the simulated WMS serves ──


@dataclass(frozen=True, slots=True)
class PalletRecord:
    pallet_id: str  # SSCC-style
    sku: str
    location: str
    cases: int


def inventory(seed: int, products: Sequence[ProductRef]) -> tuple[PalletRecord, ...]:
    rng = random.Random(f"dockiq-inventory:{seed}")
    records: list[PalletRecord] = []
    for index, product in enumerate(sorted(products, key=lambda p: p.sku)):
        for n in range(rng.randint(2, 5)):
            aisle = 10 + (index % 16)
            records.append(
                PalletRecord(
                    pallet_id=f"00286{seed % 1000:03d}{index:04d}{n:03d}",
                    sku=product.sku,
                    location=f"A{aisle}-B{rng.randint(1, 24):02d}-L{rng.randint(1, 4)}",
                    cases=product.cases_per_pallet,
                )
            )
    return tuple(records)
