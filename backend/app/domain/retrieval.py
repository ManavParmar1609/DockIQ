"""Knowledge-base retrieval: keyword substring scoring, not embeddings.
See docs/architecture/business-rules.md §3.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from app.domain.enums import Confidence

CATEGORY_BONUS = 2
COMPANY_BONUS = 1
HIGH_CONFIDENCE_AT = 4
MEDIUM_CONFIDENCE_AT = 2

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


def find_resolution(
    entries: Sequence[KbEntry],
    issue_type: str,
    description: str | None = "",
    product_category: str | None = None,
    company_name: str | None = None,
) -> dict[str, Any]:
    candidates = [entry for entry in entries if entry.issue_type == issue_type]
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
