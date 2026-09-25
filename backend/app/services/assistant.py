"""Facility knowledge the assistant can answer without a model: locations, temperature thresholds,
and a keyword search of the knowledge base. The agent (`app.services.agent`) uses these for its
rules-based router and puts FACILITY_INFO in the model's system prompt.
"""

from collections.abc import Sequence

from app.domain.retrieval import KbEntry, keyword_hits

FACILITY_INFO = (
    "Facility Info: Slip sheets in Aisle 14 Bay C. Pallet wrap at each dock + extras in Aisle 12 Bay A. "
    "Scanner charging station in Bay 2 near supervisor office. "
    "Forklift battery swap in Dock Area C Aisle 20. "
    "Damage/quarantine area in Zone D Rows 1-3. Break room end of Aisle 25. "
    "Temperature thresholds: Frozen ≤0°F, Refrigerated 33-40°F, Produce 32-65°F (varies), Dry N/A. "
    "Always probe center of case, not edge."
)

LOCATION_ANSWERS = {
    "slip sheet": "Slip sheets are in **Aisle 14, Bay C, bottom shelf**. Thin cardboard sheets (48×40 in). "
    "Place flat on top of each pallet layer.",
    "pallet": "Empty pallets at the **pallet stack area** at the end of each dock row. GMA (48×40) on left, "
    "oversized on right.",
    "wrap": "Pallet wrap at **each dock station**. Extra rolls in **Aisle 12, Bay A**.",
    "scanner": "Backup scanners at **charging station in Bay 2**, near supervisor office. Top shelf.",
    "battery": "Forklift battery swap station in **Dock Area C, Aisle 20**.",
}

TEMPERATURE_ANSWER = (
    "**Temperature thresholds:**\n\n• **Frozen:** ≤ 0°F\n• **Refrigerated:** 33–40°F\n"
    "• **Produce:** 32–65°F (varies)\n• **Dry:** N/A\n\nAlways probe center of case, not edge."
)


def keyword_answer(message: str, entries: Sequence[KbEntry]) -> dict[str, str]:
    lowered = message.lower()
    if any(word in lowered for word in ("where", "location", "find", "located")):
        for key, answer in LOCATION_ANSWERS.items():
            if key in lowered:
                return {"response": answer, "source": "Facility Layout Guide", "confidence": "high"}

    if any(word in lowered for word in ("temp", "temperature", "threshold")):
        return {"response": TEMPERATURE_ANSWER, "source": "Cold Chain SOP Section 2", "confidence": "high"}

    best: KbEntry | None = None
    best_score = 0
    for entry in entries:
        score = keyword_hits(entry.keywords, lowered)
        if score > best_score:
            best, best_score = entry, score
    if best is not None:
        steps = "\n".join(f"  {i + 1}. {step}" for i, step in enumerate(best.resolution_steps))
        return {
            "response": f"**{best.issue_type} — {best.scenario}:**\n\n{steps}",
            "source": best.source_reference,
            "confidence": best.confidence,
        }

    return {
        "response": "I can help with **temperature thresholds**, **load patterns**, **issue resolution**, "
        "**equipment locations**, and **customer SOPs**. Try asking about one of those topics.",
        "source": "DockIQ Help",
        "confidence": "low",
    }
