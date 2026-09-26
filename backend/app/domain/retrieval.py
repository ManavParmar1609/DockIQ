"""Knowledge-base retrieval: keyword substring scoring, not embeddings.
See docs/architecture/business-rules.md §3.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.domain.enums import Confidence

CATEGORY_BONUS = 2
COMPANY_BONUS = 1
BAND_BONUS = 2  # the reading's temperature band matches the procedure's (§3.2)
HIGH_CONFIDENCE_AT = 4
MEDIUM_CONFIDENCE_AT = 2

INBOUND = "inbound"  # receiving: the trailer is being unloaded
OUTBOUND = "outbound"  # loading: the trailer is being loaded

# Procedures written for one direction of work, by scenario (business-rules §3.1). The knowledge base
# has no direction column; a scenario not listed here applies to both. When the direction is known,
# the other direction's procedures are never offered: a loading job must not be told to "continue
# unloading" or to "partial accept".
SCENARIO_DIRECTION: dict[str, str] = {
    "Less than 5% of cases damaged": INBOUND,
    "More than 5% of cases damaged": INBOUND,
    "Packaging is punctured on food items": INBOUND,
    "Temperature within 5°F of threshold (marginal)": INBOUND,
    "Temperature more than 5°F above threshold": INBOUND,
    "BOL doesn't match physical product": INBOUND,
    "Count is within customer tolerance": INBOUND,
    "Count exceeds customer tolerance": INBOUND,
    "Overage — received more than expected": INBOUND,
    "Damaged cases found while loading": OUTBOUND,
    "Punctured or open food packaging found while loading": OUTBOUND,
    "Product within 5°F of its limit while loading (marginal)": OUTBOUND,
    "Product more than 5°F above its limit while loading": OUTBOUND,
    "Staged count does not match the order": OUTBOUND,
    "Missing or extra pallet": OUTBOUND,
}

# Temperature procedures written for one band of reading (business-rules §3.2): within MARGINAL_BAND_MAX
# °F over the limit is marginal (close up, re-probe); beyond it is critical (do not unload or load).
MARGINAL = "marginal"
CRITICAL = "critical"
MARGINAL_BAND_MAX = 5.0
SCENARIO_TEMPERATURE_BAND: dict[str, str] = {
    "Temperature within 5°F of threshold (marginal)": MARGINAL,
    "Temperature more than 5°F above threshold": CRITICAL,
    "Product within 5°F of its limit while loading (marginal)": MARGINAL,
    "Product more than 5°F above its limit while loading": CRITICAL,
}
TEMPERATURE_BANDS: tuple[str, ...] = (MARGINAL, CRITICAL)

FALLBACK_RESOLUTION: dict[str, Any] = {
    "found": False,
    "confidence": Confidence.LOW.value,
    "message": "No specific procedure found for this issue type. Recommend escalating to supervisor.",
    "steps": [
        "Document the issue clearly with as much detail as possible",
        "Take note of product, location, and what you observed",
        "This issue should be escalated to your supervisor for guidance",
        "Do not proceed until you receive supervisor direction",
    ],
    "source": "General Escalation Procedure",
}


@dataclass(frozen=True, slots=True)
class KbEntry:
    issue_type: str
    scenario: str
    keywords: Sequence[str]
    resolution_steps: Sequence[str]
    confidence: str
    source_reference: str
    applicable_categories: Sequence[str] = ()
    applicable_companies: Sequence[str] = ()


def keyword_hits(keywords: Sequence[str], text: str) -> int:
    lowered = text.lower()
    return sum(1 for keyword in keywords if keyword.strip().lower() in lowered)


def confidence_for(score: int) -> Confidence:
    if score >= HIGH_CONFIDENCE_AT:
        return Confidence.HIGH
    if score >= MEDIUM_CONFIDENCE_AT:
        return Confidence.MEDIUM
    return Confidence.LOW


def temperature_band(delta: float | None) -> str | None:
    """The band of a reading `delta` °F over its limit; None when there is no reading or it is within."""
    if delta is None or delta <= 0:
        return None
    return MARGINAL if delta <= MARGINAL_BAND_MAX else CRITICAL


def applies(entry: KbEntry, direction: str | None, temp_band: str | None) -> bool:
    entry_direction = SCENARIO_DIRECTION.get(entry.scenario)
    if direction is not None and entry_direction is not None and entry_direction != direction:
        return False
    entry_band = SCENARIO_TEMPERATURE_BAND.get(entry.scenario)
    return temp_band is None or entry_band is None or entry_band == temp_band


def find_resolution(
    entries: Sequence[KbEntry],
    issue_type: str,
    description: str | None = "",
    product_category: str | None = None,
    company_name: str | None = None,
    direction: str | None = None,
    temp_band: str | None = None,
) -> dict[str, Any]:
    """`direction` is the order's type (inbound or outbound); `temp_band` comes from temperature_band()."""
    candidates = [
        entry for entry in entries if entry.issue_type == issue_type and applies(entry, direction, temp_band)
    ]
    if not candidates:
        return {**FALLBACK_RESOLUTION, "steps": list(FALLBACK_RESOLUTION["steps"])}

    scored: list[tuple[int, KbEntry]] = []
    for entry in candidates:
        score = keyword_hits(entry.keywords, description or "")
        if product_category and product_category in entry.applicable_categories:
            score += CATEGORY_BONUS
        if company_name and (
            company_name in entry.applicable_companies or "all" in entry.applicable_companies
        ):
            score += COMPANY_BONUS
        if temp_band is not None and SCENARIO_TEMPERATURE_BAND.get(entry.scenario) == temp_band:
            score += BAND_BONUS
        scored.append((score, entry))

    # Stable sort: ties keep knowledge-base order, as before.
    best_score, best = max(scored, key=lambda pair: pair[0])
    return {
        "found": True,
        "confidence": confidence_for(best_score).value,
        "scenario": best.scenario,
        "steps": list(best.resolution_steps),
        "source": best.source_reference,
        "issue_type": best.issue_type,
    }
