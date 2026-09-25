"""Trailer load planning: where every pallet of an order goes. See docs/architecture/business-rules.md §10.

A 53-ft reefer holds two pallets across. How many rows fit depends on how each 48×40 pallet is
turned; the customer's rules then decide stack height, what sits on the bottom, and which pallets
go in first (the nose, by the reefer unit) and last (the doors).
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum


class FloorPattern(StrEnum):
    STRAIGHT = "straight"  # 48" side along the trailer: 13 rows × 2
    TURNED = "turned"  # 40" side along the trailer: 15 rows × 2
    PINWHEEL = "pinwheel"  # alternating orientation, interlocked: 14 rows × 2


class LoadSequence(StrEnum):
    HEAVIEST_TO_NOSE = "heaviest_to_nose"
    BY_CATEGORY = "by_category"  # coldest product nearest the reefer unit
    REVERSE_STOP_ORDER = "reverse_stop_order"  # last delivery loaded first


ROWS: dict[FloorPattern, int] = {
    FloorPattern.STRAIGHT: 13,
    FloorPattern.TURNED: 15,
    FloorPattern.PINWHEEL: 14,
}
PALLETS_ACROSS = 2
PALLET_TARE_LBS = 50
COLD_FIRST = ("Frozen", "Refrigerated", "Produce", "Dry")


@dataclass(frozen=True, slots=True)
class LoadRules:
    max_height: int = 1
    heavy_bottom: bool = True
    slip_sheets: bool = False
    label_direction: str = "facing_out"
    floor_pattern: FloorPattern = FloorPattern.STRAIGHT
    sequence: LoadSequence = LoadSequence.HEAVIEST_TO_NOSE
    segregate_categories: bool = False
    max_pallets: int | None = None
    special: str = ""


@dataclass(frozen=True, slots=True)
class OrderLine:
    sku: str
    product_name: str
    category: str
    cases_per_pallet: int
    weight_per_case: float
    expected_quantity: int


@dataclass(frozen=True, slots=True)
class Pallet:
    sku: str
    product_name: str
    category: str
    cases: int
    weight_lbs: float
    partial: bool
    stop: int  # 1-based position of the line on the order (delivery stop for multi-stop loads)


@dataclass(frozen=True, slots=True)
class PlacedPallet:
    load_sequence: int  # 1 = loaded first, at the nose
    row: int  # 0 = nose
    side: str  # "left" | "right", looking from the doors toward the nose
    level: int  # 0 = on the floor
    orientation: str  # "lengthwise" (48" along the trailer) | "crosswise"
    pallet: Pallet


@dataclass(frozen=True, slots=True)
class LoadPlan:
    rules: LoadRules
    rows: int
    floor_positions: int
    stacks_used: int
    placed: tuple[PlacedPallet, ...]
    total_weight_lbs: float
    checklist: tuple[str, ...]
    warnings: tuple[str, ...] = field(default=())


def pallets_for(lines: Sequence[OrderLine]) -> list[Pallet]:
    pallets: list[Pallet] = []
    for stop, line in enumerate(lines, start=1):
        per_pallet = max(line.cases_per_pallet, 1)
        full, remainder = divmod(max(line.expected_quantity, 0), per_pallet)
        for cases, partial in [(per_pallet, False)] * full + ([(remainder, True)] if remainder else []):
            pallets.append(
                Pallet(
                    sku=line.sku,
                    product_name=line.product_name,
                    category=line.category,
                    cases=cases,
                    weight_lbs=round(cases * line.weight_per_case + PALLET_TARE_LBS, 1),
                    partial=partial,
                    stop=stop,
                )
            )
    return pallets


def _group(pallets: list[Pallet], rules: LoadRules) -> list[list[Pallet]]:
    """Ordered groups, nose first. Stacks never span groups when categories must be segregated."""
    heaviest = sorted(pallets, key=lambda p: -p.weight_lbs)
    match rules.sequence:
        case LoadSequence.REVERSE_STOP_ORDER:
            stops = sorted({p.stop for p in pallets}, reverse=True)
            return [[p for p in heaviest if p.stop == stop] for stop in stops]
        case LoadSequence.BY_CATEGORY:
            order = [c for c in COLD_FIRST if any(p.category == c for p in pallets)]
            order += sorted({p.category for p in pallets} - set(order))
            groups = [[p for p in heaviest if p.category == category] for category in order]
            return groups if rules.segregate_categories else [[p for g in groups for p in g]]
        case _:
            if rules.segregate_categories:
                categories = sorted({p.category for p in pallets}, key=COLD_FIRST.index)
                return [[p for p in heaviest if p.category == c] for c in categories]
            return [heaviest]


def _stack(group: list[Pallet], height: int, heavy_bottom: bool) -> list[list[Pallet]]:
    """Heaviest pallets form the bottom layer across all stacks, not one heavy stack at the nose."""
    stacks = math.ceil(len(group) / height)
    if not heavy_bottom:
        return [group[i * height : (i + 1) * height] for i in range(stacks)]
    columns: list[list[Pallet]] = [[] for _ in range(stacks)]
    for index, pallet in enumerate(group):
        columns[index % stacks].append(pallet)
    return columns


def plan_load(lines: Sequence[OrderLine], rules: LoadRules) -> LoadPlan:
    height = max(rules.max_height, 1)
    stacks = [
        stack
        for group in _group(pallets_for(lines), rules)
        for stack in _stack(group, height, rules.heavy_bottom)
    ]
    rows = ROWS[rules.floor_pattern]
    floor_positions = rows * PALLETS_ACROSS

    placed: list[PlacedPallet] = []
    sequence = 0
    for position, stack in enumerate(stacks):
        row, across = divmod(position, PALLETS_ACROSS)
        if rules.floor_pattern is FloorPattern.STRAIGHT:
            orientation = "lengthwise"
        elif rules.floor_pattern is FloorPattern.TURNED:
            orientation = "crosswise"
        else:
            orientation = "lengthwise" if (row + across) % 2 == 0 else "crosswise"
        for level, pallet in enumerate(stack):
            sequence += 1
            placed.append(
                PlacedPallet(
                    load_sequence=sequence,
                    row=row,
                    side="left" if across == 0 else "right",
                    level=level,
                    orientation=orientation,
                    pallet=pallet,
                )
            )

    warnings: list[str] = []
    if len(stacks) > floor_positions:
        warnings.append(
            f"Needs {len(stacks)} floor positions; a {rules.floor_pattern.value} load "
            f"fits {floor_positions}. Split the load across trailers."
        )
    if rules.max_pallets is not None and len(placed) > rules.max_pallets:
        warnings.append(
            f"{len(placed)} pallets exceeds this customer's limit of {rules.max_pallets} per trailer."
        )

    return LoadPlan(
        rules=rules,
        rows=rows,
        floor_positions=floor_positions,
        stacks_used=len(stacks),
        placed=tuple(placed),
        total_weight_lbs=round(sum(p.pallet.weight_lbs for p in placed), 1),
        checklist=tuple(checklist(rules)),
        warnings=tuple(warnings),
    )


def checklist(rules: LoadRules) -> list[str]:
    items = [
        f"Max {rules.max_height} pallet{'s' if rules.max_height != 1 else ''} high",
        {
            FloorPattern.STRAIGHT: 'Straight load — 48" side along the trailer',
            FloorPattern.TURNED: 'Turned load — 40" side along the trailer',
            FloorPattern.PINWHEEL: "Pinwheel — alternate orientation to lock the load",
        }[rules.floor_pattern],
        {
            LoadSequence.HEAVIEST_TO_NOSE: "Heaviest pallets to the nose",
            LoadSequence.BY_CATEGORY: "Coldest product nearest the reefer unit",
            LoadSequence.REVERSE_STOP_ORDER: "Last stop loaded first",
        }[rules.sequence],
    ]
    if rules.heavy_bottom:
        items.append("Heavy on the bottom, light on top")
    if rules.slip_sheets:
        items.append("Slip sheet between every layer")
    if rules.segregate_categories:
        items.append("Never mix categories in one stack")
    items.append("Labels facing out" if rules.label_direction == "facing_out" else "Any label direction")
    if rules.max_pallets is not None:
        items.append(f"No more than {rules.max_pallets} pallets per trailer")
    return items


def rules_from_pattern(load_pattern: dict[str, object]) -> LoadRules:
    """Build rules from a company's `load_pattern` JSON, tolerating older records without the new keys."""

    def get(key: str, default: object) -> object:
        value = load_pattern.get(key)
        return default if value is None else value

    return LoadRules(
        max_height=int(get("max_height", 1)),  # type: ignore[call-overload]
        heavy_bottom=get("weight_placement", "heavy_bottom") == "heavy_bottom",
        slip_sheets=bool(get("slip_sheets", False)),
        label_direction=str(get("label_direction", "facing_out")),
        floor_pattern=FloorPattern(str(get("floor_pattern", FloorPattern.STRAIGHT.value))),
        sequence=LoadSequence(str(get("sequence", LoadSequence.HEAVIEST_TO_NOSE.value))),
        segregate_categories=bool(get("segregate_categories", False)),
        max_pallets=None if (cap := load_pattern.get("max_pallets")) is None else int(cap),  # type: ignore[call-overload]
        special=str(get("special", "")),
    )
