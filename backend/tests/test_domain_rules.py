"""Cost, retrieval, recurrence, inspection and dock-transition rules.
See docs/architecture/business-rules.md §2–§5.
"""

import pytest

from app.domain.barcodes import decide_scan, demo_gtin, gs1_check_digit, is_valid_gtin, normalize_code
from app.domain.cost import COST_MULTIPLIERS, estimate_cost_impact
from app.domain.dock import DockEvent, transition
from app.domain.enums import DockStatus, IssueStatus, LifecyclePhase, ScanResult, Severity
from app.domain.evidence import sniff_image_type
from app.domain.inspection import evaluate_inspection, interior_temperature_limit
from app.domain.lifecycle import can_transition
from app.domain.receiving import CountLine, TemperatureStatus, check_probe_temperature, count_discrepancies
from app.domain.recurrence import carrier_pattern, dock_pattern
from app.domain.retrieval import FALLBACK_RESOLUTION, KbEntry, find_resolution
from app.domain.severity import ISSUE_TYPE_WEIGHTS
from app.domain.taxonomy import ISSUE_TAXONOMY, ISSUE_TYPES, is_quality_relevant, is_valid_subtype

# ── Cost ──


def test_cost_multipliers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §2
    assert COST_MULTIPLIERS == {
        "Temperature Deviation": 1.0,
        "Product Quality Concern": 0.8,
        "Damaged Pallet": 0.3,
        "SKU Mismatch": 0.1,
        "Count Discrepancy": 1.0,
        "Lot/Expiry Issue": 1.0,
        "Seal/Trailer Condition": 0.5,
        "Barcode Issue": 0.0,
        "Equipment Failure": 0.0,
        "Paperwork Mismatch": 0.0,
        "Safety Incident": 0.0,
        "WMS/System Issue": 0.0,
    }


def test_overage_is_not_a_product_loss() -> None:
    assert estimate_cost_impact(20.0, 10, "Count Discrepancy", "Short count") == 200.0
    assert estimate_cost_impact(20.0, 10, "Count Discrepancy", "Overage") == 0.0


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
    assert evaluate_inspection(**CLEAN, interior_temperature=None).passed


@pytest.mark.parametrize(("temperature", "passes"), [(45.0, True), (45.1, False), (-10.0, True)])
def test_default_temperature_gate_is_45f(temperature: float, passes: bool) -> None:
    assert evaluate_inspection(**CLEAN, interior_temperature=temperature).passed is passes


def test_the_strictest_product_on_the_load_sets_the_limit() -> None:
    # A frozen line (0°F) and a refrigerated line (40°F): the trailer must be a freezer.
    assert interior_temperature_limit([40.0, 0.0, None]) == 0.0
    assert interior_temperature_limit([None, None]) == 45.0
    outcome = evaluate_inspection(**CLEAN, interior_temperature=40.0, temperature_limit=0.0)
    assert (outcome.passed, outcome.failed_checks) == (False, ("temperature",))


@pytest.mark.parametrize(
    ("failure", "check"),
    [
        ({"seal_condition": "broken"}, "seal"),
        ({"interior_cleanliness": "dirty"}, "cleanliness"),
        ({"visible_damage": "minor"}, "damage"),
    ],
)
def test_each_failed_condition_is_named(failure: dict[str, str], check: str) -> None:
    outcome = evaluate_inspection(**{**CLEAN, **failure}, interior_temperature=None)
    assert (outcome.passed, outcome.failed_checks) == (False, (check,))


# ── Taxonomy ──


def test_taxonomy_covers_every_weighted_type_and_the_docx_categories() -> None:
    assert set(ISSUE_TYPES) == set(ISSUE_TYPE_WEIGHTS)
    # The DOCX lists ~111 scenarios across issues and discrepancies; merged duplicates leave 87.
    assert sum(len(spec.subtypes) for spec in ISSUE_TAXONOMY) == 87
    assert "Employee injury" in ISSUE_TYPES["Safety Incident"].subtypes
    assert "WMS offline or not responding" in ISSUE_TYPES["WMS/System Issue"].subtypes


def test_subtype_must_belong_to_its_type() -> None:
    assert is_valid_subtype("Count Discrepancy", "Overage")
    assert is_valid_subtype("Count Discrepancy", None)
    assert not is_valid_subtype("Barcode Issue", "Overage")


def test_quality_relevance() -> None:
    assert is_quality_relevant("Temperature Deviation", Severity.LOW)
    assert is_quality_relevant("Barcode Issue", Severity.CRITICAL)
    assert not is_quality_relevant("Barcode Issue", Severity.HIGH)


# ── Lifecycle ──


def test_resolved_issues_are_terminal() -> None:
    assert can_transition(IssueStatus.RESOLUTION_IN_PROGRESS, IssueStatus.ESCALATED)
    assert can_transition(IssueStatus.ESCALATED, IssueStatus.SUPERVISOR_RESOLVED)
    assert not can_transition(IssueStatus.ESCALATED, IssueStatus.SELF_RESOLVED)
    assert not can_transition(IssueStatus.SELF_RESOLVED, IssueStatus.ESCALATED)


# ── Barcodes and evidence ──


def test_demo_gtins_are_valid_and_restricted_circulation() -> None:
    gtin = demo_gtin(1)
    assert (len(gtin), gtin[1]) == (14, "2")
    assert is_valid_gtin(gtin)
    assert gs1_check_digit("629104150021") == "3"  # GS1's published worked example


def test_scanner_output_normalizes_to_one_form() -> None:
    gtin = demo_gtin(7)
    assert normalize_code(gtin[1:]) == gtin  # EAN-13 -> GTIN-14
    assert normalize_code(" crm-fz-1001 ") == "CRM-FZ-1001"


def test_scan_decision() -> None:
    expected = ["CRM-FZ-1001", "CRM-RF-1002"]
    assert decide_scan("CRM-FZ-1001", expected).outcome is ScanResult.MATCH
    assert decide_scan("BHC-RF-2002", expected).outcome is ScanResult.MISMATCH
    assert decide_scan(None, expected).outcome is ScanResult.UNKNOWN


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (b"\xff\xd8\xff\xe0rest", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\nrest", "image/png"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
        (b"<svg onload=alert(1)>", None),
        (b"GIF89a", None),
    ],
)
def test_image_type_is_sniffed_from_bytes(data: bytes, expected: str | None) -> None:
    assert sniff_image_type(data) == expected


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


# ── Receiving ──


@pytest.mark.parametrize(
    ("reading", "status"),
    [
        (0.0, TemperatureStatus.OK),
        (0.1, TemperatureStatus.MARGINAL),
        (5.1, TemperatureStatus.WARNING),
        (10.1, TemperatureStatus.CRITICAL),
    ],
)
def test_probe_bands_match_the_severity_modifier(reading: float, status: TemperatureStatus) -> None:
    assert check_probe_temperature(reading, [0.0, 40.0]).status is status


def test_probe_on_a_dry_load_is_not_applicable() -> None:
    assert check_probe_temperature(70.0, [None]).status is TemperatureStatus.NOT_APPLICABLE


def test_count_discrepancies_respect_the_tolerance_both_ways() -> None:
    lines = [CountLine(1, 100, 97), CountLine(2, 100, 96), CountLine(3, 100, 105), CountLine(4, 0, 3)]
    found = count_discrepancies(lines, tolerance=0.03)
    assert [(d.product_id, d.subtype, d.difference) for d in found] == [
        (2, "Short count", 4),
        (3, "Overage", 5),
    ]


# ── Guardrails (business-rules §7.1) ──


def test_only_critical_requires_a_supervisor() -> None:
    from app.domain.enums import IssueStatus, Severity
    from app.domain.lifecycle import can_self_resolve, requires_supervisor

    assert [requires_supervisor(s) for s in Severity] == [s is Severity.CRITICAL for s in Severity]
    assert can_self_resolve(IssueStatus.RESOLUTION_IN_PROGRESS, Severity.HIGH)
    assert not can_self_resolve(IssueStatus.RESOLUTION_IN_PROGRESS, Severity.CRITICAL)
    assert not can_self_resolve(IssueStatus.ESCALATED, Severity.LOW)


def test_completion_blockers() -> None:
    from app.domain.lifecycle import completion_blockers

    assert completion_blockers(0, inspection_failed=False, inspection_cleared=False) == []
    assert completion_blockers(0, inspection_failed=True, inspection_cleared=True) == []
    assert len(completion_blockers(2, inspection_failed=True, inspection_cleared=False)) == 2
    assert completion_blockers(2, False, False)[0].startswith("2 critical issues are still open")
