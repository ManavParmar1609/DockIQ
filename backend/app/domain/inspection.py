"""Trailer inspection pass rule. See docs/architecture/business-rules.md §4.6."""

from collections.abc import Iterable
from dataclasses import dataclass

# Used only when the load carries no temperature-controlled product (or no order is attached).
DEFAULT_MAX_INTERIOR_TEMP_F = 45.0


@dataclass(frozen=True, slots=True)
class InspectionOutcome:
    passed: bool
    temperature_limit: float
    failed_checks: tuple[str, ...]


def interior_temperature_limit(product_temp_maxes: Iterable[float | None]) -> float:
    """The strictest product limit on the load: a frozen line makes the whole trailer a freezer."""
    limits = [limit for limit in product_temp_maxes if limit is not None]
    return min(limits) if limits else DEFAULT_MAX_INTERIOR_TEMP_F


def evaluate_inspection(
    seal_condition: str,
    interior_cleanliness: str,
    visible_damage: str,
    interior_temperature: float | None,
    temperature_limit: float = DEFAULT_MAX_INTERIOR_TEMP_F,
) -> InspectionOutcome:
    failed: list[str] = []
    if seal_condition != "intact":
        failed.append("seal")
    if interior_cleanliness != "clean":
        failed.append("cleanliness")
    if visible_damage != "none":
        failed.append("damage")
    if interior_temperature is not None and interior_temperature > temperature_limit:
        failed.append("temperature")
    return InspectionOutcome(
        passed=not failed, temperature_limit=temperature_limit, failed_checks=tuple(failed)
    )
