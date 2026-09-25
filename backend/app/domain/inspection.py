"""Trailer inspection pass rule. See docs/architecture/business-rules.md §5."""

# KNOWN DEFECT (roadmap 2C): one fixed gate regardless of product category.
MAX_INTERIOR_TEMP_F = 45


def inspection_passes(
    seal_condition: str,
    interior_cleanliness: str,
    visible_damage: str,
    interior_temperature: float | None,
) -> bool:
    passed = seal_condition == "intact" and interior_cleanliness == "clean" and visible_damage == "none"
    if interior_temperature is not None:
        passed = passed and interior_temperature <= MAX_INTERIOR_TEMP_F
    return passed
