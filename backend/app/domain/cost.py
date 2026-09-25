"""Dollar-impact estimate for an issue. See docs/architecture/business-rules.md §2."""

COST_MULTIPLIERS: dict[str, float] = {
    "Temperature Deviation": 1.0,  # full loss likely
    "Product Quality Concern": 0.8,  # most product lost
    "Damaged Pallet": 0.3,  # partial damage
    "SKU Mismatch": 0.1,  # re-work cost, not product loss
    "Count Discrepancy": 1.0,  # direct loss (overage subtypes excepted below)
    "Lot/Expiry Issue": 1.0,  # full rejection
    "Seal/Trailer Condition": 0.5,  # potential full rejection
    "Barcode Issue": 0.0,
    "Equipment Failure": 0.0,
    "Paperwork Mismatch": 0.0,
    "Safety Incident": 0.0,  # the cost is human, not product; not modelled in dollars
    "WMS/System Issue": 0.0,
}
DEFAULT_COST_MULTIPLIER = 0.2

# Subtype exceptions: extra product is not a product loss.
SUBTYPE_COST_MULTIPLIERS: dict[tuple[str, str], float] = {
    ("Count Discrepancy", "Overage"): 0.0,
    ("Count Discrepancy", "Extra pallet not on load"): 0.0,
}


def estimate_cost_impact(
    case_value: float | None,
    quantity_affected: int,
    issue_type: str,
    issue_subtype: str | None = None,
) -> float:
    """`case_value` is None when no product is attached; the impact is then unknown, i.e. 0."""
    if case_value is None:
        return 0.0
    multiplier = SUBTYPE_COST_MULTIPLIERS.get(
        (issue_type, issue_subtype or ""), COST_MULTIPLIERS.get(issue_type, DEFAULT_COST_MULTIPLIER)
    )
    return round(case_value * quantity_affected * multiplier, 2)
