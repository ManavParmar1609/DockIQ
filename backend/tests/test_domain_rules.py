"""Cost, retrieval, recurrence, inspection and dock-transition rules.
See docs/architecture/business-rules.md §2–§5.
"""

import pytest

from app.domain.cost import COST_MULTIPLIERS, estimate_cost_impact
from app.domain.dock import DockEvent, transition
from app.domain.enums import DockStatus, LifecyclePhase, Severity
from app.domain.inspection import inspection_passes
from app.domain.recurrence import carrier_pattern, dock_pattern
from app.domain.retrieval import FALLBACK_RESOLUTION, KbEntry, find_resolution

# ── Cost ──


def test_cost_multipliers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §2
    assert COST_MULTIPLIERS == {
        "Temperature Deviation": 1.0,
        "Product Quality Concern": 0.8,
        "Damaged Pallet": 0.3,
        "SKU Mismatch": 0.1,
        "Count Shortage": 1.0,
        "Lot/Expiry Issue": 1.0,
        "Seal/Trailer Condition": 0.5,
        "Barcode Issue": 0.0,
        "Equipment Failure": 0.0,
        "Paperwork Mismatch": 0.0,
    }


def test_cost_is_case_value_times_quantity_times_multiplier() -> None:
    assert estimate_cost_impact(28.5, 10, "Damaged Pallet") == 85.5


def test_unknown_issue_type_uses_default_cost_multiplier() -> None:
    assert estimate_cost_impact(100.0, 1, "Something New") == 20.0


def test_no_product_means_no_cost() -> None:
    assert estimate_cost_impact(None, 50, "Temperature Deviation") == 0.0


# ── Retrieval ──


def kb(scenario: str, keywords: list[str], **kwargs: object) -> KbEntry:
    defaults: dict[str, object] = {
        "issue_type": "Damaged Pallet",
        "resolution_steps": [f"step for {scenario}"],
        "confidence": "high",
        "source_reference": f"SOP {scenario}",
    }
    return KbEntry(scenario=scenario, keywords=keywords, **{**defaults, **kwargs})  # type: ignore[arg-type]


def test_no_entry_for_issue_type_returns_the_escalation_fallback() -> None:
    result = find_resolution([kb("a", ["x"])], "Temperature Deviation", "hot")
    assert result == FALLBACK_RESOLUTION
    assert result["found"] is False


@pytest.mark.parametrize(
    ("description", "confidence"),
    [("", "low"), ("crushed", "low"), ("crushed torn", "medium"), ("crushed torn wet bent", "high")],
)
def test_confidence_thresholds_at_two_and_four(description: str, confidence: str) -> None:
    entry = kb("a", ["crushed", "torn", "wet", "bent"])
    assert find_resolution([entry], "Damaged Pallet", description)["confidence"] == confidence


def test_category_match_adds_two() -> None:
    entry = kb("a", ["crushed"], applicable_categories=["Frozen"])
    assert find_resolution([entry], "Damaged Pallet", "", product_category="Frozen")["confidence"] == "medium"


def test_company_bonus_matches_name_or_all_wildcard() -> None:
    named = kb("a", ["crushed"], applicable_companies=["Crestline Markets"])
    wildcard = kb("b", ["crushed"], applicable_companies=["all"])
    for entry in (named, wildcard):
        result = find_resolution([entry], "Damaged Pallet", "crushed", company_name="Crestline Markets")
        assert result["confidence"] == "medium"


def test_best_keyword_match_wins_and_ties_keep_kb_order() -> None:
    first = kb("first", ["crushed"])
    second = kb("second", ["crushed"])
    better = kb("better", ["crushed", "torn"])
    assert find_resolution([first, second], "Damaged Pallet", "crushed")["scenario"] == "first"
    assert find_resolution([first, better], "Damaged Pallet", "crushed torn")["scenario"] == "better"


def test_keywords_match_case_insensitively() -> None:
    assert (
        find_resolution([kb("a", ["crushed", "torn"])], "Damaged Pallet", "CRUSHED and Torn")["confidence"]
        == "medium"
    )


# ── Recurrence ──


@pytest.mark.parametrize(("count", "fires"), [(2, False), (3, True), (4, True)])
def test_recurrence_threshold_is_three(count: int, fires: bool) -> None:
    assert (dock_pattern(count, "Damaged Pallet", 4, 7) is not None) is fires
    assert (carrier_pattern(count, "Damaged Pallet", "FrostLine Carriers", 7) is not None) is fires


def test_recurrence_messages_name_the_dock_and_carrier() -> None:
    assert "Dock 4" in dock_pattern(3, "Damaged Pallet", 4, 7)["message"]  # type: ignore[index]
    assert "FrostLine Carriers" in carrier_pattern(3, "Damaged Pallet", "FrostLine Carriers", 7)["message"]  # type: ignore[index]


# ── Inspection ──

CLEAN = {"seal_condition": "intact", "interior_cleanliness": "clean", "visible_damage": "none"}


def test_clean_inspection_without_temperature_passes() -> None:
    assert inspection_passes(**CLEAN, interior_temperature=None)


@pytest.mark.parametrize(("temperature", "passes"), [(45.0, True), (45.1, False), (-10.0, True)])
def test_temperature_gate_is_45f(temperature: float, passes: bool) -> None:
    assert inspection_passes(**CLEAN, interior_temperature=temperature) is passes


@pytest.mark.parametrize(
    "failure",
    [{"seal_condition": "broken"}, {"interior_cleanliness": "dirty"}, {"visible_damage": "minor"}],
)
def test_any_failed_condition_fails_the_inspection(failure: dict[str, str]) -> None:
    assert not inspection_passes(**{**CLEAN, **failure}, interior_temperature=None)


# ── Dock transitions ──


def test_issue_lifecycle_moves_dock_status_and_keeps_phase() -> None:
    state = (DockStatus.ACTIVE, LifecyclePhase.LOADING)
    state = transition(*state, DockEvent.ISSUE_REPORTED)
    assert state == (DockStatus.ISSUE, LifecyclePhase.LOADING)
    assert transition(*state, DockEvent.ISSUE_ESCALATED, severity=Severity.CRITICAL)[0] == DockStatus.CRITICAL
    assert transition(*state, DockEvent.ISSUE_ESCALATED, severity=Severity.HIGH)[0] == DockStatus.ISSUE
    assert transition(*state, DockEvent.ISSUE_RESOLVED) == (DockStatus.ACTIVE, LifecyclePhase.LOADING)


def test_inspection_and_completion_move_the_phase() -> None:
    assert transition(DockStatus.ACTIVE, LifecyclePhase.IDLE, DockEvent.INSPECTION_SUBMITTED) == (
        DockStatus.ACTIVE,
        LifecyclePhase.INSPECTION,
    )
    assert transition(DockStatus.ACTIVE, LifecyclePhase.LOADING, DockEvent.ORDER_COMPLETED) == (
        DockStatus.IDLE,
        LifecyclePhase.COMPLETE,
    )
