"""Severity scoring. Numbers are pinned verbatim — see docs/architecture/business-rules.md §1.

A tuning change should fail these tests and force a deliberate edit to the doc in the same commit.
"""

from typing import Any

import pytest

from app.domain.enums import Severity
from app.domain.severity import (
    CUSTOMER_TIER_MULTIPLIER,
    ISSUE_TYPE_WEIGHTS,
    PRODUCT_RISK,
    QUANTITY_SHARE_FACTORS,
    ROOM_ALARM_MINUTES,
    TEMPERATURE_FLOORS,
    band_for,
    classify_severity,
)
from app.domain.taxonomy import QUANTITY_SCALED_SUBTYPES
from app.wms.rooms import ALARM_AFTER


def test_issue_type_weights_are_pinned() -> None:
    # see docs/architecture/business-rules.md §1.1
    assert ISSUE_TYPE_WEIGHTS == {
        "Temperature Deviation": 5,
        "Product Quality Concern": 4,
        "Damaged Pallet": 4,
        "Seal/Trailer Condition": 4,
        "SKU Mismatch": 3,
        "Lot/Expiry Issue": 3,
        "Count Discrepancy": 2,
        "Paperwork Mismatch": 2,
        "Barcode Issue": 1,
        "Equipment Failure": 2,
        "Safety Incident": 5,
        "WMS/System Issue": 3,
    }


def test_product_risk_multipliers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §1.2
    assert PRODUCT_RISK == {"Frozen": 3.0, "Refrigerated": 2.5, "Produce": 2.0, "Dry": 1.0}


def test_customer_tier_multipliers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §1.3
    assert CUSTOMER_TIER_MULTIPLIER == {1: 1.5, 2: 1.2, 3: 1.0}


@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0, Severity.LOW),
        (5.9, Severity.LOW),
        (6, Severity.MEDIUM),
        (11.9, Severity.MEDIUM),
        (12, Severity.HIGH),
        (17.9, Severity.HIGH),
        (18, Severity.CRITICAL),
        (40, Severity.CRITICAL),
    ],
)
def test_band_boundaries(score: float, expected: Severity) -> None:
    assert band_for(score) == expected


def test_unknown_issue_type_scores_default_weight() -> None:
    assert classify_severity("Something New").score == 2


def test_product_category_and_tier_multiply_the_base_weight() -> None:
    result = classify_severity("Damaged Pallet", product_category="Frozen", customer_tier=1)
    assert result.score == 4 * 3.0 * 1.5
    assert result.severity == Severity.CRITICAL


@pytest.mark.parametrize(
    ("reading", "added"),
    [(40.0, 0), (40.1, 1), (45.0, 1), (45.1, 3), (50.0, 3), (50.1, 5)],
)
def test_temperature_delta_modifier_steps(reading: float, added: int) -> None:
    result = classify_severity("Barcode Issue", temp_reading=reading, temp_threshold_max=40.0)
    assert result.score == pytest.approx(1 + added)


def test_temperature_modifier_needs_both_reading_and_threshold() -> None:
    assert classify_severity("Barcode Issue", temp_reading=90.0).score == 1


@pytest.mark.parametrize(("actual", "added"), [(98, 0), (97, 1), (95, 1), (94, 3)])
def test_count_shortage_modifier_steps(actual: int, added: int) -> None:
    result = classify_severity("Barcode Issue", count_expected=100, count_actual=actual)
    assert result.score == 1 + added


def test_total_non_delivery_scores_shortage_modifier() -> None:
    # Fixed in Phase 2: 0 received is the worst shortage, not "no count given".
    result = classify_severity("Count Discrepancy", count_expected=100, count_actual=0)
    assert result.score == 2 + 3


def test_overage_does_not_raise_severity() -> None:
    assert classify_severity("Count Discrepancy", count_expected=100, count_actual=120).score == 2


def test_zero_expected_does_not_divide_by_zero() -> None:
    assert classify_severity("Count Discrepancy", count_expected=0, count_actual=5).score == 2


def test_allergen_adds_two() -> None:
    assert classify_severity("Barcode Issue", is_allergen=True).score == 3


@pytest.mark.parametrize(("minutes", "added"), [(None, 0), (30, 0), (31, 2)])
def test_trailer_dwell_modifier(minutes: int | None, added: int) -> None:
    assert classify_severity("Barcode Issue", trailer_dwell_minutes=minutes).score == 1 + added


# ── Phase 2: people risk and severity floors — see docs/architecture/business-rules.md §1.8 ──


def test_safety_ignores_product_and_customer_multipliers() -> None:
    result = classify_severity("Safety Incident", product_category="Frozen", customer_tier=1)
    assert result.score == 5
    assert "People risk" in result.reason


@pytest.mark.parametrize(
    ("subtype", "expected"),
    [
        ("Employee injury", Severity.CRITICAL),
        ("Near miss", Severity.HIGH),
        ("Pedestrian in loading area", Severity.HIGH),
        ("Unsafe trailer condition", Severity.HIGH),
        ("Product spill", Severity.MEDIUM),
        (None, Severity.MEDIUM),
    ],
)
def test_safety_severity_floors(subtype: str | None, expected: Severity) -> None:
    assert classify_severity("Safety Incident", issue_subtype=subtype).severity == expected


def test_a_floor_never_lowers_a_higher_score() -> None:
    result = classify_severity(
        "Safety Incident", issue_subtype="Product spill", trailer_dwell_minutes=60, is_allergen=True
    )
    assert result.score == 9  # 5 + 2 dwell + 2 allergen
    assert result.severity == Severity.MEDIUM
    assert "Floor" not in result.reason


def test_modifiers_stack_after_multiplication() -> None:
    result = classify_severity(
        "Temperature Deviation",
        product_category="Refrigerated",
        customer_tier=2,
        temp_reading=52.0,
        temp_threshold_max=40.0,
        is_allergen=True,
    )
    # 5 × 2.5 × 1.2 = 15, +5 temperature, +2 allergen
    assert result.score == 22
    assert result.severity == Severity.CRITICAL


def test_reason_text_shows_the_derivation() -> None:
    result = classify_severity("Damaged Pallet", product_category="Dry", customer_tier=3, is_allergen=True)
    assert result.reason.startswith("Score: 6.0 → MEDIUM. Factors: ")
    assert "Issue type 'Damaged Pallet' (weight: 4)" in result.reason
    assert "Allergen-sensitive product (+2)" in result.reason


# ── Proportional damage and scope floors — see docs/architecture/business-rules.md §1.9, §1.10 ──


def test_quantity_share_factors_are_pinned() -> None:
    # see docs/architecture/business-rules.md §1.9
    assert QUANTITY_SHARE_FACTORS == ((0.05, 0.4), (0.25, 0.7))


def test_quantity_scaled_subtypes_are_pinned() -> None:
    # see docs/architecture/business-rules.md §1.9
    scaled = dict(QUANTITY_SCALED_SUBTYPES)
    assert scaled == {
        "Damaged Pallet": frozenset(
            {None, "Damaged cartons or packaging", "Torn or loose shrink wrap", "Product fallen off pallet"}
        ),
        "Product Quality Concern": frozenset({"Water damage from condensation"}),
    }


def test_scope_floor_numbers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §1.10
    assert ROOM_ALARM_MINUTES == 15
    assert TEMPERATURE_FLOORS == ((10.0, Severity.CRITICAL), (5.0, Severity.HIGH))


def test_the_room_floor_waits_as_long_as_the_warehouse_alarm() -> None:
    # The severity rule and the simulated WMS must agree on when a room is "in alarm" (§12.12).
    assert ROOM_ALARM_MINUTES == ALARM_AFTER


@pytest.mark.parametrize(
    ("cases", "factor"),
    [(0, 0.4), (5, 0.4), (6, 0.7), (25, 0.7), (26, 1.0), (100, 1.0), (150, 1.0)],
)
def test_damage_scales_with_the_share_of_the_pallet(cases: int, factor: float) -> None:
    result = classify_severity(
        "Damaged Pallet",
        issue_subtype="Damaged cartons or packaging",
        quantity_affected=cases,
        cases_per_pallet=100,
    )
    assert result.score == pytest.approx(round(4 * factor, 1))
    assert f"{cases} of 100 cases on the pallet" in result.reason


def test_the_order_line_is_the_reference_when_smaller_than_a_pallet() -> None:
    result = classify_severity(
        "Damaged Pallet", quantity_affected=2, cases_per_pallet=48, line_cases=10, issue_subtype=None
    )
    assert result.score == pytest.approx(4 * 0.7)  # 2 of 10 = 20%
    assert "2 of 10 cases on the order line (20.0%) (×0.7)" in result.reason


def test_an_unstated_quantity_never_scales_the_score() -> None:
    result = classify_severity(
        "Damaged Pallet", product_category="Frozen", customer_tier=1, cases_per_pallet=48
    )
    assert result.score == 18
    assert "cases on the" not in result.reason


@pytest.mark.parametrize(
    "subtype",
    ["Crushed or collapsed pallet", "Leaning or unstable load", "Cannot safely remove or place pallet"],
)
def test_structural_damage_is_never_scaled(subtype: str) -> None:
    result = classify_severity(
        "Damaged Pallet",
        product_category="Frozen",
        customer_tier=1,
        issue_subtype=subtype,
        quantity_affected=1,
        cases_per_pallet=48,
    )
    assert (result.score, result.severity) == (18, Severity.CRITICAL)


def test_a_temperature_deviation_on_a_load_is_never_scaled_by_quantity() -> None:
    # Food safety: product over its limit is judged by the product and the reading, not the case count.
    result = classify_severity(
        "Temperature Deviation",
        product_category="Frozen",
        customer_tier=1,
        temp_reading=3.0,
        temp_threshold_max=0.0,
        quantity_affected=1,
        cases_per_pallet=48,
    )
    assert (result.score, result.severity) == (23.5, Severity.CRITICAL)


def test_worked_example_two_torn_cases_of_frozen_chicken() -> None:
    # business-rules §1.11 example A: OP-001 loading Crestline (tier 1) chicken, 2 of a 48-case pallet,
    # trailer at the door 111 min. Before §1.9: 4 × 3.0 × 1.5 + 2 = 20.0 → CRITICAL.
    before = classify_severity(
        "Damaged Pallet",
        product_category="Frozen",
        customer_tier=1,
        trailer_dwell_minutes=111,
        issue_subtype="Damaged cartons or packaging",
    )
    assert (before.score, before.severity) == (20.0, Severity.CRITICAL)
    after = classify_severity(
        "Damaged Pallet",
        product_category="Frozen",
        customer_tier=1,
        trailer_dwell_minutes=111,
        issue_subtype="Damaged cartons or packaging",
        quantity_affected=2,
        cases_per_pallet=48,
        line_cases=200,
    )
    # 4 × 3.0 × 1.5 = 18 × 0.4 (2 of 48 = 4.2%, within the 5% allowance) = 7.2, + 2 dwell = 9.2
    assert (after.score, after.severity) == (9.2, Severity.MEDIUM)


def test_worked_example_produce_room_compressor_trip() -> None:
    # business-rules §1.11 example B: the produce room (limit 45°F) reads 48°F for 15 min; the most
    # sensitive product stored there is a tier-1 customer's produce. Before §1.10: 5 × 2.0 × 1.5 + 1 = 16.0
    # → HIGH, below two torn cases of chicken.
    inputs: dict[str, Any] = {
        "product_category": "Produce",
        "customer_tier": 1,
        "temp_reading": 48.0,
        "temp_threshold_max": 45.0,
        "issue_subtype": "Cold chain compromised",
        "quantity_affected": 40,
        "cases_per_pallet": 40,
    }
    before = classify_severity("Temperature Deviation", **inputs)
    assert (before.score, before.severity) == (16.0, Severity.HIGH)
    after = classify_severity("Temperature Deviation", room_minutes_over_limit=15, **inputs)
    assert (after.score, after.severity) == (16.0, Severity.CRITICAL)
    assert "Floor: a cold room over its limit for 15 min is never below CRITICAL" in after.reason


def test_a_room_excursion_is_at_least_high_before_the_alarm() -> None:
    result = classify_severity(
        "Temperature Deviation",
        product_category="Produce",
        customer_tier=3,
        temp_reading=46.0,
        temp_threshold_max=45.0,
        room_minutes_over_limit=5,
    )
    assert (result.score, result.severity) == (11.0, Severity.HIGH)  # 5 × 2.0 + 1 = 11 → floor HIGH


def test_a_room_back_within_its_limit_is_high_not_critical() -> None:
    result = classify_severity(
        "Temperature Deviation", temp_reading=44.0, temp_threshold_max=45.0, room_minutes_over_limit=30
    )
    assert result.severity == Severity.HIGH


@pytest.mark.parametrize(
    ("reading", "expected"),
    [(5.0, Severity.MEDIUM), (5.1, Severity.HIGH), (10.0, Severity.HIGH), (10.1, Severity.CRITICAL)],
)
def test_product_far_over_its_limit_has_a_floor(reading: float, expected: Severity) -> None:
    # No product category (5 × 1.0 × 1.0): the score alone would stay medium. §1.10, mirroring §11.1.
    result = classify_severity("Temperature Deviation", temp_reading=reading, temp_threshold_max=0.0)
    assert result.severity == expected


def test_the_highest_floor_is_the_one_recorded() -> None:
    result = classify_severity(
        "Temperature Deviation", temp_reading=12.0, temp_threshold_max=0.0, room_minutes_over_limit=20
    )
    assert result.severity == Severity.CRITICAL
    assert result.reason.count("Floor:") == 1
