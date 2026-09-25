"""Chat assistant: an LLM answer grounded in knowledge-base context, with a keyword fallback.

The LLM is used here and nowhere else. Its output is text to display — it never feeds a severity,
cost or acceptance decision.
"""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from openai import AsyncOpenAI, OpenAIError

from app.config import Settings
from app.domain.retrieval import KbEntry, keyword_hits, rank_for_chat

logger = logging.getLogger(__name__)

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

SYSTEM_PROMPT = (
    "You are DockIQ AI Assistant, a helpful warehouse dock-door operations assistant. "
    "You help forklift operators with loading/unloading procedures, temperature checks, "
    "issue resolution, equipment locations, customer SOPs, and safety procedures.\n\n"
    "RULES:\n"
    "- Give clear, concise, actionable answers\n"
    "- Use bullet points and numbered steps\n"
    "- Always cite the source (SOP section, procedure name) when available\n"
    "- If unsure, say so and suggest escalating to a supervisor\n"
    "- Keep answers short — operators are on the dock floor, not reading essays\n"
    "- Use bold (**text**) for emphasis on key info\n\n"
    "CONTEXT FROM WAREHOUSE DATABASE:\n{context}"
)


@dataclass(frozen=True, slots=True)
class CompanyContext:
    name: str
    tier: int
    count_tolerance: float
    load_pattern: dict[str, Any]
    sop_rules: dict[str, Any]


def build_context(
    message: str,
    entries: Sequence[KbEntry],
    company: CompanyContext | None,
    product_category: str | None,
) -> str:
    parts: list[str] = []
    if company:
        lp, sop = company.load_pattern, company.sop_rules
        parts.append(
            f"Current Customer: {company.name} (Tier {company.tier}, "
            f"Count Tolerance: ±{company.count_tolerance * 100:.0f}%)\n"
            f"Load Pattern: max height={lp.get('max_height')}, weight={lp.get('weight_placement')}, "
            f"slip_sheets={'required' if lp.get('slip_sheets') else 'not required'}, "
            f"labels={lp.get('label_direction')}, special={lp.get('special')}\n"
            f"SOP: Receiving={sop.get('receiving')}, Shipping={sop.get('shipping')}, "
            f"Rejection={sop.get('rejection_criteria')}, Temp Check={sop.get('temp_check')}"
        )
    if product_category:
        parts.append(f"Product Category: {product_category}")
    for entry in rank_for_chat(entries, message):
        parts.append(
            f"Knowledge Base — {entry.issue_type}: {entry.scenario}\n"
            f"Steps: {'; '.join(entry.resolution_steps)}\n"
            f"Source: {entry.source_reference} (Confidence: {entry.confidence})"
        )
    parts.append(FACILITY_INFO)
    return "\n\n".join(parts)


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


class Assistant:
    def __init__(self, settings: Settings) -> None:
        self._model = settings.nvidia_model
        self._client: AsyncOpenAI | None = None
        if settings.nvidia_api_key is not None:
            self._client = AsyncOpenAI(
                base_url=settings.nvidia_base_url,
                api_key=settings.nvidia_api_key.get_secret_value(),
                timeout=20.0,
                max_retries=1,
            )
        else:
            logger.info("NVIDIA_API_KEY not set; chat uses the keyword fallback")

    async def answer(
        self,
        message: str,
        entries: Sequence[KbEntry],
        company: CompanyContext | None = None,
        product_category: str | None = None,
    ) -> dict[str, str]:
        if self._client is None:
            return keyword_answer(message, entries)

        context = build_context(message, entries, company, product_category)
        try:
            completion = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT.format(context=context)},
                    {"role": "user", "content": message},
                ],
                temperature=0.3,
                max_tokens=512,
            )
        except OpenAIError:
            # Never log the message body — it is whatever a user typed.
            logger.warning("LLM request failed; falling back to keyword answer", exc_info=True)
            return keyword_answer(message, entries)

        text = completion.choices[0].message.content or ""
        source = f"DockIQ AI + {company.name} SOP" if company else "DockIQ AI (LLM + Knowledge Base)"
        return {"response": text, "source": source, "confidence": "high"}
