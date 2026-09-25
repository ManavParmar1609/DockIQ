"""Deterministic severity scoring. See docs/architecture/business-rules.md §1.

This is a weighted formula on purpose: every score can be re-derived by hand from the reason text.
No model output may feed into it.
"""

from dataclasses import dataclass

from app.domain.enums import Severity
from app.domain.taxonomy import PEOPLE_RISK_TYPES, severity_floor

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
) -> SeverityResult:
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

    severity = band_for(score)
    floor = severity_floor(issue_type, issue_subtype)
    if floor is not None and SEVERITY_RANK[floor] > SEVERITY_RANK[severity]:
        severity = floor
        label = f"'{issue_subtype}'" if issue_subtype else f"'{issue_type}'"
        reasons.append(f"Floor: {label} is never below {floor.value.upper()}")

    reason = f"Score: {score:.1f} → {severity.value.upper()}. Factors: " + "; ".join(reasons)
    return SeverityResult(severity=severity, score=round(score, 1), reason=reason)
