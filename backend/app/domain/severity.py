"""Deterministic severity scoring. See docs/architecture/business-rules.md §1.

This is a weighted formula on purpose: every score can be re-derived by hand from the reason text.
No model output may feed into it.
"""

from dataclasses import dataclass

from app.domain.enums import Severity
from app.domain.taxonomy import PEOPLE_RISK_TYPES, is_quantity_scaled, severity_floor

ISSUE_TYPE_WEIGHTS: dict[str, int] = {
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
DEFAULT_ISSUE_WEIGHT = 2

PRODUCT_RISK: dict[str, float] = {
    "Frozen": 3.0,
    "Refrigerated": 2.5,
    "Produce": 2.0,
    "Dry": 1.0,
}

CUSTOMER_TIER_MULTIPLIER: dict[int, float] = {
    1: 1.5,
    2: 1.2,
    3: 1.0,
}

DWELL_LIMIT_MINUTES = 30

# The share of a pallet (or of the order line, when that is smaller) that damage touches → the factor
# on the base score. Upper bound of each band, smallest first; above the last band the factor is 1.0.
# 5% is the SOP's partial-accept allowance (business-rules §4.1). See business-rules §1.9.
QUANTITY_SHARE_FACTORS: tuple[tuple[float, float], ...] = (
    (0.05, 0.4),
    (0.25, 0.7),
)

# A cold room over its limit this long raises the alarm (the warehouse's rule, business-rules §12.12).
ROOM_ALARM_MINUTES = 15.0

# A Temperature Deviation with product more than this many °F over its limit is never below the
# severity — the probe check's warning and critical bands (business-rules §1.10, §11.1).
TEMPERATURE_FLOORS: tuple[tuple[float, Severity], ...] = (
    (10.0, Severity.CRITICAL),
    (5.0, Severity.HIGH),
)

# Lower bound of each band, highest first.
SEVERITY_BANDS: tuple[tuple[float, Severity], ...] = (
    (18, Severity.CRITICAL),
    (12, Severity.HIGH),
    (6, Severity.MEDIUM),
)


SEVERITY_RANK: dict[Severity, int] = {
    Severity.LOW: 0,
    Severity.MEDIUM: 1,
    Severity.HIGH: 2,
    Severity.CRITICAL: 3,
}


@dataclass(frozen=True, slots=True)
class SeverityResult:
    severity: Severity
    score: float
    reason: str


def band_for(score: float) -> Severity:
    for floor, severity in SEVERITY_BANDS:
        if score >= floor:
            return severity
    return Severity.LOW


def quantity_share_factor(share: float) -> float:
    for upper, factor in QUANTITY_SHARE_FACTORS:
        if share <= upper:
            return factor
    return 1.0


def reference_cases(cases_per_pallet: int | None, line_cases: int | None) -> int | None:
    """What damaged cases are a share of: a pallet, or the order line when that is smaller."""
    known = [cases for cases in (cases_per_pallet, line_cases) if cases is not None and cases > 0]
    return min(known) if known else None


def classify_severity(
    issue_type: str,
    product_category: str | None = None,
    customer_tier: int | None = None,
    temp_reading: float | None = None,
    temp_threshold_max: float | None = None,
    count_expected: int | None = None,
    count_actual: int | None = None,
    is_allergen: bool = False,
    trailer_dwell_minutes: int | None = None,
    issue_subtype: str | None = None,
    quantity_affected: int | None = None,
    cases_per_pallet: int | None = None,
    line_cases: int | None = None,
    room_minutes_over_limit: float | None = None,
) -> SeverityResult:
    """`quantity_affected`: the cases the person said are affected (None = not given, so no scaling).
    `room_minutes_over_limit`: set only for a cold-room excursion — the whole room, not one load — and
    says how long the room has read over its limit."""
    base_weight = ISSUE_TYPE_WEIGHTS.get(issue_type, DEFAULT_ISSUE_WEIGHT)
    reasons = [f"Issue type '{issue_type}' (weight: {base_weight})"]

    if issue_type in PEOPLE_RISK_TYPES:
        # The risk is to people: product and customer multipliers do not apply.
        product_multiplier = tier_multiplier = 1.0
        reasons.append("People risk — product and customer multipliers not applied")
    else:
        product_multiplier = PRODUCT_RISK.get(product_category, 1.0) if product_category else 1.0
        tier_multiplier = CUSTOMER_TIER_MULTIPLIER.get(customer_tier, 1.0) if customer_tier else 1.0
        if product_category:
            reasons.append(f"Product category '{product_category}' (risk: ×{product_multiplier})")
        if customer_tier:
            reasons.append(f"Customer Tier {customer_tier} (×{tier_multiplier})")
    score = base_weight * product_multiplier * tier_multiplier

    # Proportional damage: a few cases off a pallet are not a whole pallet (business-rules §1.9).
    reference = reference_cases(cases_per_pallet, line_cases)
    if (
        quantity_affected is not None
        and reference is not None
        and is_quantity_scaled(issue_type, issue_subtype)
    ):
        share = quantity_affected / reference
        factor = quantity_share_factor(share)
        score *= factor
        unit = "order line" if line_cases is not None and reference == line_cases else "pallet"
        reasons.append(
            f"{quantity_affected} of {reference} cases on the {unit} ({share * 100:.1f}%) (×{factor})"
        )

    delta: float | None = None
    if temp_reading is not None and temp_threshold_max is not None:
        delta = temp_reading - temp_threshold_max
        if delta > 10:
            score += 5
            reasons.append(f"Temperature delta {delta:.1f}°F above threshold (+5)")
        elif delta > 5:
            score += 3
            reasons.append(f"Temperature delta {delta:.1f}°F above threshold (+3)")
        elif delta > 0:
            score += 1
            reasons.append(f"Temperature delta {delta:.1f}°F above threshold (+1)")

    # Shortages only: an overage is recorded but does not raise severity (business-rules §1.4).
    if count_expected is not None and count_actual is not None and count_expected > 0:
        shortage_pct = (count_expected - count_actual) / count_expected * 100
        if shortage_pct > 5:
            score += 3
            reasons.append(f"Count shortage {shortage_pct:.1f}% exceeds 5% (+3)")
        elif shortage_pct > 2:
            score += 1
            reasons.append(f"Count shortage {shortage_pct:.1f}% (+1)")

    if is_allergen:
        score += 2
        reasons.append("Allergen-sensitive product (+2)")

    if trailer_dwell_minutes is not None and trailer_dwell_minutes > DWELL_LIMIT_MINUTES:
        score += 2
        reasons.append(f"Trailer dwell time {trailer_dwell_minutes} min > {DWELL_LIMIT_MINUTES} min (+2)")

    # Floors raise the band, never lower it; the highest that applies is the one recorded (§1.8, §1.10).
    severity = band_for(score)
    floors: list[tuple[Severity, str]] = []
    if (subtype_floor := severity_floor(issue_type, issue_subtype)) is not None:
        floors.append((subtype_floor, f"'{issue_subtype}'" if issue_subtype else f"'{issue_type}'"))
    if issue_type == "Temperature Deviation" and delta is not None:
        for above, temperature_floor in TEMPERATURE_FLOORS:
            if delta > above:
                floors.append((temperature_floor, f"product more than {above:.0f}°F over its limit"))
                break
    if room_minutes_over_limit is not None:
        alarmed = delta is not None and delta > 0 and room_minutes_over_limit >= ROOM_ALARM_MINUTES
        floors.append(
            (Severity.CRITICAL, f"a cold room over its limit for {ROOM_ALARM_MINUTES:.0f} min")
            if alarmed
            else (Severity.HIGH, "a cold-room excursion (the whole room)")
        )
    if floors:
        floor, label = max(floors, key=lambda pair: SEVERITY_RANK[pair[0]])
        if SEVERITY_RANK[floor] > SEVERITY_RANK[severity]:
            severity = floor
            reasons.append(f"Floor: {label} is never below {floor.value.upper()}")

    reason = f"Score: {score:.1f} → {severity.value.upper()}. Factors: " + "; ".join(reasons)
    return SeverityResult(severity=severity, score=round(score, 1), reason=reason)
