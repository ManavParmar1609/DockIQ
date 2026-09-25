"""Receiving rules: the probe-temperature check and count reconciliation.
See docs/architecture/business-rules.md §4.2 and §11.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum

# Same bands as the severity temperature modifier (§1.4) so the guidance and the score agree.
MARGINAL_ABOVE = 0.0
WARNING_ABOVE = 5.0
CRITICAL_ABOVE = 10.0


class TemperatureStatus(StrEnum):
    NOT_APPLICABLE = "not_applicable"  # nothing on the load has a temperature limit
    OK = "ok"
    MARGINAL = "marginal"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass(frozen=True, slots=True)
class TemperatureCheck:
    status: TemperatureStatus
    reading: float
    limit: float | None
    delta: float | None
    guidance: str


def check_probe_temperature(reading: float, product_temp_maxes: Iterable[float | None]) -> TemperatureCheck:
    """Judge a probe reading against the strictest limit of any product on the load."""
    limits = [limit for limit in product_temp_maxes if limit is not None]
    if not limits:
        return TemperatureCheck(
            TemperatureStatus.NOT_APPLICABLE, reading, None, None, "No temperature requirement for this load."
        )
    limit = min(limits)
    delta = round(reading - limit, 1)
    if delta > CRITICAL_ABOVE:
        return TemperatureCheck(
            TemperatureStatus.CRITICAL,
            reading,
            limit,
            delta,
            "DO NOT UNLOAD. Close the trailer doors now. Do not sign the BOL. Report it.",
        )
    if delta > WARNING_ABOVE:
        return TemperatureCheck(
            TemperatureStatus.WARNING,
            reading,
            limit,
            delta,
            "Close the doors to stop further warming and re-probe the centre of a case in 10 minutes.",
        )
    if delta > MARGINAL_ABOVE:
        return TemperatureCheck(
            TemperatureStatus.MARGINAL,
            reading,
            limit,
            delta,
            "Slightly above the limit. Monitor closely and re-probe before continuing.",
        )
    return TemperatureCheck(TemperatureStatus.OK, reading, limit, delta, "Within the limit. Proceed.")


@dataclass(frozen=True, slots=True)
class CountLine:
    product_id: int
    expected: int
    actual: int


@dataclass(frozen=True, slots=True)
class Discrepancy:
    product_id: int
    subtype: str  # a Count Discrepancy subtype
    expected: int
    actual: int

    @property
    def difference(self) -> int:
        return abs(self.actual - self.expected)


def count_discrepancies(lines: Sequence[CountLine], tolerance: float) -> list[Discrepancy]:
    """Lines whose received count is off by more than the customer's tolerance (a fraction)."""
    found: list[Discrepancy] = []
    for line in lines:
        if line.expected <= 0:
            continue
        deviation = abs(line.actual - line.expected) / line.expected
        if deviation > tolerance:
            subtype = "Short count" if line.actual < line.expected else "Overage"
            found.append(Discrepancy(line.product_id, subtype, line.expected, line.actual))
    return found
