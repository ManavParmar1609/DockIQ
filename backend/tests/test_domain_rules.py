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
from app.domain.retrieval import (
    BAND_BONUS,
    FALLBACK_RESOLUTION,
    INBOUND,
    MARGINAL_BAND_MAX,
    OUTBOUND,
    SCENARIO_DIRECTION,
    SCENARIO_TEMPERATURE_BAND,
    KbEntry,
    find_resolution,
    temperature_band,
)
from app.domain.severity import ISSUE_TYPE_WEIGHTS
from app.domain.taxonomy import ISSUE_TAXONOMY, ISSUE_TYPES, is_quality_relevant, is_valid_subtype
from app.seed import load as load_seed

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


# ── Retrieval by direction and temperature band — see docs/architecture/business-rules.md §3.1–§3.3 ──


def seeded_kb() -> list[KbEntry]:
    return [
        KbEntry(
            issue_type=row["issue_type"],
            scenario=row["scenario"],
            keywords=row["keywords"],
            resolution_steps=row["resolution_steps"],
            confidence=row["confidence"],
            source_reference=row["source_reference"],
            applicable_categories=row["applicable_categories"],
            applicable_companies=row["applicable_companies"],
        )
        for row in load_seed("knowledge_base")
    ]


def test_direction_and_band_tables_name_real_knowledge_base_scenarios() -> None:
    # The knowledge base has no direction column: these tables must not drift from its scenarios.
    scenarios = {entry.scenario: entry.issue_type for entry in seeded_kb()}
    assert set(SCENARIO_DIRECTION) <= set(scenarios)
    assert set(SCENARIO_DIRECTION.values()) == {INBOUND, OUTBOUND}
    assert set(SCENARIO_TEMPERATURE_BAND) <= set(scenarios)
    assert {scenarios[name] for name in SCENARIO_TEMPERATURE_BAND} == {"Temperature Deviation"}


def test_the_knowledge_base_has_47_entries() -> None:
    # see docs/architecture/business-rules.md §4: 41 before, + 6 in §3.1–§3.3
    assert len(seeded_kb()) == 47


def test_marginal_band_boundary_and_bonus_are_pinned() -> None:
    # see docs/architecture/business-rules.md §3.2
    assert (MARGINAL_BAND_MAX, BAND_BONUS) == (5.0, 2)


@pytest.mark.parametrize(
    ("delta", "band"),
    [
        (None, None),
        (-2.0, None),
        (0.0, None),
        (0.1, "marginal"),
        (5.0, "marginal"),
        (5.1, "critical"),
    ],
)
def test_temperature_band_boundaries(delta: float | None, band: str | None) -> None:
    assert temperature_band(delta) == band


def test_a_loading_job_never_gets_a_receiving_procedure() -> None:
    found = find_resolution(
        seeded_kb(),
        "Damaged Pallet",
        "two cases crushed",
        product_category="Frozen",
        direction=OUTBOUND,
    )
    assert found["scenario"] == "Damaged cases found while loading"
    assert not any("unloading" in step.lower() or "partial accept" in step.lower() for step in found["steps"])


def test_a_receiving_job_gets_the_receiving_procedure() -> None:
    found = find_resolution(
        seeded_kb(),
        "Damaged Pallet",
        "two cases crushed",
        product_category="Frozen",
        direction=INBOUND,
    )
    assert found["scenario"] == "Less than 5% of cases damaged"


def test_a_short_count_while_loading_is_reconciled_not_signed_for() -> None:
    found = find_resolution(seeded_kb(), "Count Discrepancy", "Short count", direction=OUTBOUND)
    assert found["scenario"] == "Staged count does not match the order"
    assert not any("BOL" in step for step in found["steps"])


@pytest.mark.parametrize(
    "description",
    [
        "Torn or loose shrink wrap",
        "the shrink wrap is torn",
        "stretch wrap came loose on pallet 3",
        "torn wrap",
        "loose wrap on the top layer",
    ],
)
@pytest.mark.parametrize("direction", [INBOUND, OUTBOUND, None])
def test_torn_or_loose_wrap_is_rewrapped_not_rejected(description: str, direction: str | None) -> None:
    found = find_resolution(
        seeded_kb(),
        "Damaged Pallet",
        description,
        product_category="Frozen",
        company_name="Crestline Markets",
        direction=direction,
    )
    assert found["scenario"] == "Torn or loose shrink wrap"
    assert any(step.startswith("Re-wrap the pallet") for step in found["steps"])
    assert not any("reject" in step.lower() and "not a reason" not in step for step in found["steps"])


@pytest.mark.parametrize(
    ("direction", "band", "scenario"),
    [
        (INBOUND, "marginal", "Temperature within 5°F of threshold (marginal)"),
        (INBOUND, "critical", "Temperature more than 5°F above threshold"),
        (
            OUTBOUND,
            "marginal",
            "Product within 5°F of its limit while loading (marginal)",
        ),
        (OUTBOUND, "critical", "Product more than 5°F above its limit while loading"),
    ],
)
def test_the_reading_picks_the_temperature_procedure(direction: str, band: str, scenario: str) -> None:
    found = find_resolution(
        seeded_kb(),
        "Temperature Deviation",
        "Product temperature out of range",
        product_category="Frozen",
        direction=direction,
        temp_band=band,
    )
    assert found["scenario"] == scenario


def test_filters_that_leave_nothing_fall_back_to_escalation() -> None:
    inbound_only = kb("Less than 5% of cases damaged", ["crushed"])
    result = find_resolution([inbound_only], "Damaged Pallet", "crushed", direction=OUTBOUND)
    assert result["found"] is False
    assert result["source"] == FALLBACK_RESOLUTION["source"]


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


def test_probe_guidance_follows_the_direction() -> None:
    # see docs/architecture/business-rules.md §11.1: receiving stops the unload, loading holds the product
    from app.domain.enums import OrderType

    inbound = check_probe_temperature(12.0, [0.0], OrderType.INBOUND)
    outbound = check_probe_temperature(12.0, [0.0], OrderType.OUTBOUND)
    assert inbound.status is outbound.status is TemperatureStatus.CRITICAL
    assert inbound.guidance.startswith("DO NOT UNLOAD")
    assert outbound.guidance.startswith("DO NOT LOAD")
    assert "unload" not in outbound.guidance.lower()
    assert "Stop loading" in check_probe_temperature(6.0, [0.0], OrderType.OUTBOUND).guidance
    assert check_probe_temperature(0.0, [0.0]).guidance == "Within the limit. Proceed."  # inbound default


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


# ── Ordinals in the recurrence message (business-rules §6) ──


@pytest.mark.parametrize(
    ("count", "word"),
    [
        (1, "1st"),
        (2, "2nd"),
        (3, "3rd"),
        (4, "4th"),
        (11, "11th"),
        (12, "12th"),
        (13, "13th"),
        (21, "21st"),
        (22, "22nd"),
        (101, "101st"),
        (111, "111th"),
    ],
)
def test_recurrence_counts_read_as_english_ordinals(count: int, word: str) -> None:
    from app.domain.recurrence import ordinal

    assert ordinal(count) == word


def test_the_third_repeat_says_3rd_not_3th() -> None:
    assert "the 3rd 'Damaged Pallet'" in dock_pattern(3, "Damaged Pallet", 4, 7)["message"]  # type: ignore[index]
    assert "the 12th" in carrier_pattern(12, "Damaged Pallet", "FrostLine Carriers", 7)["message"]  # type: ignore[index]


# ── Decisions (business-rules §7.2) ──


def test_pending_decisions_put_an_issue_on_hold_and_keep_it_open() -> None:
    from app.domain.lifecycle import OPEN_STATUSES, decision_status

    assert decision_status("Contact Carrier") is IssueStatus.ON_HOLD
    assert decision_status("Request Re-inspection") is IssueStatus.ON_HOLD
    for final in ("Accept", "Partial Accept", "Full Reject", "Override — Accept Anyway", "Other"):
        assert decision_status(final) is IssueStatus.SUPERVISOR_RESOLVED
    assert IssueStatus.ON_HOLD in OPEN_STATUSES
    assert can_transition(IssueStatus.ESCALATED, IssueStatus.ON_HOLD)
    assert can_transition(IssueStatus.ON_HOLD, IssueStatus.ON_HOLD)
    assert can_transition(IssueStatus.ON_HOLD, IssueStatus.SUPERVISOR_RESOLVED)
    assert not can_transition(IssueStatus.ON_HOLD, IssueStatus.SELF_RESOLVED)
    assert not can_transition(IssueStatus.SUPERVISOR_RESOLVED, IssueStatus.ON_HOLD)


def test_accepting_product_on_a_critical_or_temperature_issue_needs_a_reason() -> None:
    from app.domain.lifecycle import decision_needs_notes

    for decision in ("Accept", "Partial Accept", "Override — Accept Anyway"):
        assert decision_needs_notes(decision, Severity.CRITICAL, "Damaged Pallet")
        assert decision_needs_notes(decision, Severity.LOW, "Temperature Deviation")
        assert not decision_needs_notes(decision, Severity.HIGH, "Damaged Pallet")
    assert not decision_needs_notes("Full Reject", Severity.CRITICAL, "Temperature Deviation")
    assert not decision_needs_notes("Contact Carrier", Severity.CRITICAL, "Temperature Deviation")


def test_decision_targets_are_pinned() -> None:
    # see docs/architecture/business-rules.md §7.4
    from app.domain.lifecycle import DECISION_TARGET_MINUTES

    assert DECISION_TARGET_MINUTES == {
        Severity.CRITICAL: 15,
        Severity.HIGH: 60,
        Severity.MEDIUM: 240,
        Severity.LOW: 480,
    }


def test_an_open_issue_is_overdue_past_its_target_and_a_pending_decision_stops_the_clock() -> None:
    from app.domain.lifecycle import is_overdue

    assert not is_overdue(IssueStatus.ESCALATED, Severity.CRITICAL, 15)
    assert is_overdue(IssueStatus.ESCALATED, Severity.CRITICAL, 15.5)
    assert is_overdue(IssueStatus.RESOLUTION_IN_PROGRESS, Severity.HIGH, 61)
    assert not is_overdue(IssueStatus.RESOLUTION_IN_PROGRESS, Severity.LOW, 479)
    assert not is_overdue(IssueStatus.ON_HOLD, Severity.CRITICAL, 600)
    assert not is_overdue(IssueStatus.SUPERVISOR_RESOLVED, Severity.CRITICAL, 600)


def test_a_rejected_load_and_a_pending_reinspection_block_sign_off() -> None:
    from app.domain.lifecycle import Rejection, completion_blockers

    blockers = completion_blockers(
        0,
        False,
        False,
        rejections=[Rejection("Sarah Mitchell", "Seal broken"), Rejection("Tom Bradley", None)],
        reinspection_requested_by=["Sarah Mitchell"],
    )
    assert blockers == [
        "Rejected by Sarah Mitchell — Seal broken",
        "Rejected by Tom Bradley.",
        "Re-inspection requested by Sarah Mitchell: a new trailer inspection must pass first.",
    ]


def test_a_rejected_load_keeps_the_door_flagged() -> None:
    state = transition(DockStatus.CRITICAL, LifecyclePhase.UNLOADING, DockEvent.LOAD_REJECTED)
    assert state == (DockStatus.ISSUE, LifecyclePhase.UNLOADING)


# ── Receiving evidence (business-rules §11.3) ──


def test_inbound_sign_off_needs_every_check_a_probe_and_no_open_critical_probe() -> None:
    from app.domain.receiving import receiving_gaps
    from app.domain.taxonomy import RECEIVING_CHECK_IDS

    assert receiving_gaps(RECEIVING_CHECK_IDS, RECEIVING_CHECK_IDS, 1, True) == []
    assert receiving_gaps(RECEIVING_CHECK_IDS, RECEIVING_CHECK_IDS, 0, False) == []  # a dry load
    assert receiving_gaps(RECEIVING_CHECK_IDS, ["pallets"], 1, True) == [
        "4 receiving checks are not answered yet."
    ]
    assert receiving_gaps(RECEIVING_CHECK_IDS, RECEIVING_CHECK_IDS[:-1], 0, True) == [
        "1 receiving check is not answered yet.",
        "No probe reading recorded: probe the centre of a case before sign-off.",
    ]
    assert receiving_gaps(RECEIVING_CHECK_IDS, RECEIVING_CHECK_IDS, 2, True, [(7, 14.5)]) == [
        "Critical probe reading 14.5°F: Temperature Deviation #7 must be resolved first."
    ]


def test_the_receiving_checks_are_pinned() -> None:
    from app.domain.taxonomy import RECEIVING_CHECKS, is_valid_subtype

    assert [check.id for check in RECEIVING_CHECKS] == ["pallets", "packaging", "labels", "bol", "lot"]
    for check in RECEIVING_CHECKS:  # a "No" is reported as a real taxonomy entry
        assert is_valid_subtype(check.issue_type, check.issue_subtype)


def test_only_product_issues_need_an_order() -> None:
    from app.domain.taxonomy import needs_order

    assert needs_order("Damaged Pallet")
    assert needs_order("Temperature Deviation")
    assert not needs_order("Safety Incident")
    assert not needs_order("Equipment Failure")
    assert not needs_order("WMS/System Issue")


# ── Quality hold and disposition (business-rules §7.3) ──


def test_hold_scope_and_final_dispositions() -> None:
    from app.domain.enums import Disposition
    from app.domain.quality_hold import can_dispose, holds_stock, lot_wide

    assert holds_stock("Temperature Deviation")
    assert holds_stock("Product Quality Concern")
    assert not holds_stock("Damaged Pallet")
    assert lot_wide("Product Quality Concern")
    assert not lot_wide("Temperature Deviation")
    assert can_dispose(None, Disposition.RELEASE)
    assert can_dispose(Disposition.HOLD, Disposition.HOLD)
    assert can_dispose(Disposition.HOLD, Disposition.DESTROY)
    for final in (Disposition.RELEASE, Disposition.DESTROY, Disposition.RETURN_TO_VENDOR):
        assert not can_dispose(final, Disposition.HOLD)
