"""Trailer load planning. See docs/architecture/business-rules.md §10."""

from app.domain.load_plan import (
    ROWS,
    FloorPattern,
    LoadRules,
    LoadSequence,
    OrderLine,
    pallets_for,
    plan_load,
    rules_from_pattern,
)

FROZEN = OrderLine(
    "F-1", "Frozen fillets", "Frozen", cases_per_pallet=40, weight_per_case=30.0, expected_quantity=120
)
DRY = OrderLine("D-1", "Canned corn", "Dry", cases_per_pallet=60, weight_per_case=20.0, expected_quantity=150)


def test_floor_capacity_per_pattern_is_pinned() -> None:
    assert ROWS == {FloorPattern.STRAIGHT: 13, FloorPattern.TURNED: 15, FloorPattern.PINWHEEL: 14}


def test_pallets_are_built_from_cases_with_a_partial_last_pallet() -> None:
    pallets = pallets_for([DRY])
    assert [p.cases for p in pallets] == [60, 60, 30]
    assert [p.partial for p in pallets] == [False, False, True]
    assert pallets[0].weight_lbs == 60 * 20 + 50  # cases + pallet tare


def test_heavy_bottom_puts_the_heaviest_layer_on_the_floor_across_all_stacks() -> None:
    plan = plan_load([FROZEN, DRY], LoadRules(max_height=2, heavy_bottom=True))
    floor = [p.pallet.weight_lbs for p in plan.placed if p.level == 0]
    upper = [p.pallet.weight_lbs for p in plan.placed if p.level == 1]
    assert min(floor) >= max(upper)
    assert plan.stacks_used == 3  # 6 pallets, 2 high


def test_by_category_puts_the_coldest_product_at_the_nose_and_segregates() -> None:
    rules = LoadRules(max_height=3, sequence=LoadSequence.BY_CATEGORY, segregate_categories=True)
    plan = plan_load([DRY, FROZEN], rules)
    nose = [p for p in plan.placed if p.row == 0 and p.side == "left"]
    assert {p.pallet.category for p in nose} == {"Frozen"}
    stacks: dict[tuple[int, str], set[str]] = {}
    for placed in plan.placed:
        stacks.setdefault((placed.row, placed.side), set()).add(placed.pallet.category)
    assert all(len(categories) == 1 for categories in stacks.values())


def test_reverse_stop_order_loads_the_last_stop_first() -> None:
    plan = plan_load([FROZEN, DRY], LoadRules(max_height=1, sequence=LoadSequence.REVERSE_STOP_ORDER))
    assert plan.placed[0].pallet.stop == 2
    assert plan.placed[-1].pallet.stop == 1


def test_pinwheel_alternates_orientation() -> None:
    plan = plan_load([DRY], LoadRules(max_height=1, floor_pattern=FloorPattern.PINWHEEL))
    orientations = [p.orientation for p in plan.placed]
    assert orientations[:2] == ["lengthwise", "crosswise"]


def test_limits_produce_warnings_not_silent_overloads() -> None:
    big = OrderLine("B-1", "Bulk", "Dry", cases_per_pallet=1, weight_per_case=10.0, expected_quantity=40)
    plan = plan_load([big], LoadRules(max_height=1, max_pallets=22))
    assert any("floor positions" in w for w in plan.warnings)
    assert any("limit of 22" in w for w in plan.warnings)


def test_rules_tolerate_records_without_the_new_keys() -> None:
    rules = rules_from_pattern({"max_height": 2, "weight_placement": "heavy_bottom", "slip_sheets": True})
    assert (rules.floor_pattern, rules.sequence, rules.max_pallets) == (
        FloorPattern.STRAIGHT,
        LoadSequence.HEAVIEST_TO_NOSE,
        None,
    )
    assert "Slip sheet between every layer" in plan_load([DRY], rules).checklist
