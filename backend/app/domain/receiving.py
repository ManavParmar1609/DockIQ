"""Receiving rules: the probe-temperature check, count reconciliation and the sign-off evidence.
See docs/architecture/business-rules.md §4.2 and §11.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.domain.enums import OrderType

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


# What to do at each band, by direction: receiving stops the unload; loading holds the product off the
# trailer. Same bands either way (§11.1).
GUIDANCE: dict[OrderType, dict[TemperatureStatus, str]] = {
    OrderType.INBOUND: {
        TemperatureStatus.CRITICAL: (
            "DO NOT UNLOAD. Close the trailer doors now. Do not sign the BOL. Report it."
        ),
        TemperatureStatus.WARNING: (
            "Close the doors to stop further warming and re-probe the centre of a case in 10 minutes."
        ),
        TemperatureStatus.MARGINAL: (
            "Slightly above the limit. Monitor closely and re-probe before continuing."
        ),
        TemperatureStatus.OK: "Within the limit. Proceed.",
    },
    OrderType.OUTBOUND: {
        TemperatureStatus.CRITICAL: (
            "DO NOT LOAD. Hold the product at the dock, off the trailer, and keep it cold. "
            "Do not release the trailer. Report it."
        ),
        TemperatureStatus.WARNING: (
            "Stop loading this product. Move it back into the cold and re-probe the centre of a case "
            "in 10 minutes."
        ),
        TemperatureStatus.MARGINAL: (
            "Slightly above the limit. Monitor closely and re-probe before loading more."
        ),
        TemperatureStatus.OK: "Within the limit. Proceed.",
    },
}


def check_probe_temperature(
    reading: float,
    product_temp_maxes: Iterable[float | None],
    direction: OrderType = OrderType.INBOUND,
) -> TemperatureCheck:
    """Judge a probe reading against the strictest limit of any product on the load. `direction` picks
    the guidance: an inbound load is not unloaded, an outbound one is not loaded."""
    limits = [limit for limit in product_temp_maxes if limit is not None]
    if not limits:
        return TemperatureCheck(
            TemperatureStatus.NOT_APPLICABLE, reading, None, None, "No temperature requirement for this load."
        )
    limit = min(limits)
    delta = round(reading - limit, 1)
    if delta > CRITICAL_ABOVE:
        status = TemperatureStatus.CRITICAL
    elif delta > WARNING_ABOVE:
        status = TemperatureStatus.WARNING
    elif delta > MARGINAL_ABOVE:
        status = TemperatureStatus.MARGINAL
    else:
        status = TemperatureStatus.OK
    return TemperatureCheck(status, reading, limit, delta, GUIDANCE[direction][status])


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


# ── Sign-off evidence (§11.3) ──


def receiving_gaps(
    required_checks: Sequence[str],
    answered: Iterable[str],
    probes: int,
    needs_probe: bool,
    open_probe_issues: Sequence[tuple[int, float]] = (),
) -> list[str]:
    """What an inbound order still lacks before sign-off — empty when it has everything.

    `needs_probe`: the load has a temperature-controlled product, so at least one probe reading is
    required. `open_probe_issues`: (issue id, reading) of each critical probe whose Temperature
    Deviation is still open.
    """
    gaps: list[str] = []
    missing = [check for check in required_checks if check not in set(answered)]
    if missing:
        noun = "check is" if len(missing) == 1 else "checks are"
        gaps.append(f"{len(missing)} receiving {noun} not answered yet.")
    if needs_probe and probes == 0:
        gaps.append("No probe reading recorded: probe the centre of a case before sign-off.")
    for issue_id, reading in open_probe_issues:
        gaps.append(
            f"Critical probe reading {reading:g}°F: Temperature Deviation #{issue_id} must be resolved first."
        )
    return gaps
