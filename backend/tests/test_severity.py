"""Severity scoring. Numbers are pinned verbatim — see docs/architecture/business-rules.md §1.

A tuning change should fail these tests and force a deliberate edit to the doc in the same commit.
"""

import pytest

from app.domain.enums import Severity
from app.domain.severity import (
    CUSTOMER_TIER_MULTIPLIER,
    ISSUE_TYPE_WEIGHTS,
    PRODUCT_RISK,
    band_for,
    classify_severity,
)


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
