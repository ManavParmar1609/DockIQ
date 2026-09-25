import json
import os
from datetime import datetime
from openai import OpenAI

# ── NVIDIA LLM CLIENT ──
_llm_client = None
_embed_client = None

def get_llm_client():
    global _llm_client
    if _llm_client is None:
        api_key = os.environ.get("NVIDIA_API_KEY")
        if not api_key:
            # Raised inside chat_response's try, so chat degrades to keyword fallback.
            raise RuntimeError("NVIDIA_API_KEY is not set; using keyword fallback")
        _llm_client = OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=api_key
        )
    return _llm_client

def get_embed_client():
    global _embed_client
    if _embed_client is None:
        _embed_client = OpenAI(
            base_url="https://integrate.api.nvidia.com/v1",
            api_key=os.environ.get("NVIDIA_EMBED_API_KEY", os.environ.get("NVIDIA_API_KEY"))
        )
    return _embed_client


# ── SEVERITY CLASSIFICATION ENGINE ──

ISSUE_TYPE_WEIGHTS = {
    "Temperature Deviation": 5,
    "Product Quality Concern": 4,
    "Damaged Pallet": 4,
    "Seal/Trailer Condition": 4,
    "SKU Mismatch": 3,
    "Lot/Expiry Issue": 3,
    "Count Shortage": 2,
    "Paperwork Mismatch": 2,
    "Barcode Issue": 1,
    "Equipment Failure": 2,
}

PRODUCT_RISK = {
    "Frozen": 3.0,
    "Refrigerated": 2.5,
    "Produce": 2.0,
    "Dry": 1.0,
}

CUSTOMER_TIER_MULTIPLIER = {
    1: 1.5,
    2: 1.2,
    3: 1.0,
}


def classify_severity(issue_type, product_category=None, customer_tier=None,
                      temp_reading=None, temp_threshold_max=None,
                      count_expected=None, count_actual=None,
                      is_allergen=False, trailer_dwell_minutes=0):
    """
    Classify issue severity using weighted scoring.
    Returns (severity, score, reason_text)
    """
    base_weight = ISSUE_TYPE_WEIGHTS.get(issue_type, 2)
    product_multiplier = PRODUCT_RISK.get(product_category, 1.0) if product_category else 1.0
    tier_multiplier = CUSTOMER_TIER_MULTIPLIER.get(customer_tier, 1.0) if customer_tier else 1.0

    score = base_weight * product_multiplier * tier_multiplier

    reasons = [
        f"Issue type '{issue_type}' (weight: {base_weight})",
    ]
    if product_category:
        reasons.append(f"Product category '{product_category}' (risk: ×{product_multiplier})")
    if customer_tier:
        reasons.append(f"Customer Tier {customer_tier} (×{tier_multiplier})")

    # Modifiers
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

    if count_expected and count_actual:
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

    if trailer_dwell_minutes > 30:
        score += 2
        reasons.append(f"Trailer dwell time {trailer_dwell_minutes} min > 30 min (+2)")

    # Map score to severity
    if score >= 18:
        severity = "critical"
    elif score >= 12:
        severity = "high"
    elif score >= 6:
        severity = "medium"
    else:
        severity = "low"

    reason_text = f"Score: {score:.1f} → {severity.upper()}. Factors: " + "; ".join(reasons)

    return severity, round(score, 1), reason_text


# ── RAG RESOLUTION ENGINE ──

def find_resolution(db_conn, issue_type, description="", product_category=None, company_name=None):
    """
    Search knowledge base for matching resolution steps.
    Returns list of matching entries with confidence.
    """
    c = db_conn.cursor()

    # First: exact issue_type match
    rows = c.execute(
        "SELECT * FROM knowledge_base WHERE issue_type = ?", (issue_type,)
    ).fetchall()

    if not rows:
        return {
            "found": False,
            "confidence": "low",
            "message": "No specific procedure found for this issue type. Recommend escalating to supervisor.",
            "steps": [
                "Document the issue clearly with as much detail as possible",
                "Take note of product, location, and what you observed",
                "This issue should be escalated to your supervisor for guidance",
                "Do not proceed until you receive supervisor direction"
            ],
            "source": "General Escalation Procedure"
        }

    # Score and rank matches
    description_lower = (description or "").lower()
    scored = []
    for row in rows:
        row_dict = dict(row)
        keywords = row_dict["keywords"].lower().split(",")
        match_score = sum(1 for kw in keywords if kw.strip() in description_lower)

        # Category match bonus
        if product_category and row_dict.get("applicable_categories"):
            cats = json.loads(row_dict["applicable_categories"])
            if product_category in cats:
                match_score += 2

        # Company match bonus
        if company_name and row_dict.get("applicable_companies"):
            companies = json.loads(row_dict["applicable_companies"])
            if company_name in companies or "all" in companies:
                match_score += 1

        scored.append((match_score, row_dict))

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_match = scored[0]

    # Determine confidence based on match quality
    if best_score >= 4:
        confidence = "high"
    elif best_score >= 2:
        confidence = "medium"
    else:
        confidence = "low"

    steps = json.loads(best_match["resolution_steps"])

    return {
        "found": True,
        "confidence": confidence,
        "scenario": best_match["scenario"],
        "steps": steps,
        "source": best_match["source_reference"],
        "issue_type": best_match["issue_type"]
    }


# ── AI CHATBOT ENGINE (NVIDIA LLM + RAG) ──

def _gather_rag_context(db_conn, user_message, current_context=None):
    """Gather relevant context from database for RAG."""
    msg_lower = user_message.lower()
    c = db_conn.cursor()
    context_parts = []

    # Company context
    if current_context and current_context.get("company_id"):
        company = c.execute("SELECT * FROM companies WHERE id = ?", (current_context["company_id"],)).fetchone()
        if company:
            cd = dict(company)
            lp = json.loads(cd["load_pattern"])
            sop = json.loads(cd["sop_rules"])
            context_parts.append(
                f"Current Customer: {cd['name']} (Tier {cd['tier']}, Count Tolerance: ±{cd['count_tolerance']*100:.0f}%)\n"
                f"Load Pattern: max height={lp['max_height']}, weight={lp['weight_placement']}, "
                f"slip_sheets={'required' if lp['slip_sheets'] else 'not required'}, labels={lp['label_direction']}, special={lp['special']}\n"
                f"SOP: Receiving={sop['receiving']}, Shipping={sop['shipping']}, "
                f"Rejection={sop['rejection_criteria']}, Temp Check={sop['temp_check']}"
            )

    if current_context and current_context.get("product_category"):
        context_parts.append(f"Product Category: {current_context['product_category']}")

    # Knowledge base matches
    all_kb = c.execute("SELECT * FROM knowledge_base").fetchall()
    scored_kb = []
    for row in all_kb:
        rd = dict(row)
        keywords = rd["keywords"].lower().split(",")
        score = sum(1 for kw in keywords if kw.strip() in msg_lower)
        if score >= 1:
            scored_kb.append((score, rd))
    scored_kb.sort(key=lambda x: x[0], reverse=True)

    for _, kb in scored_kb[:3]:
        steps = json.loads(kb["resolution_steps"])
        context_parts.append(
            f"Knowledge Base — {kb['issue_type']}: {kb['scenario']}\n"
            f"Steps: {'; '.join(steps)}\n"
            f"Source: {kb['source_reference']} (Confidence: {kb['confidence']})"
        )

    # Facility info
    facility_info = (
        "Facility Info: Slip sheets in Aisle 14 Bay C. Pallet wrap at each dock + extras in Aisle 12 Bay A. "
        "Scanner charging station in Bay 2 near supervisor office. Forklift battery swap in Dock Area C Aisle 20. "
        "Damage/quarantine area in Zone D Rows 1-3. Break room end of Aisle 25. "
        "Temperature thresholds: Frozen ≤0°F, Refrigerated 33-40°F, Produce 32-65°F (varies), Dry N/A. "
        "Always probe center of case, not edge."
    )
    context_parts.append(facility_info)

    return "\n\n".join(context_parts)


def chat_response(db_conn, user_message, current_context=None):
    """
    Process a chat message using NVIDIA LLM with RAG context.
    Falls back to keyword matching if LLM is unavailable.
    """
    # Gather RAG context
    rag_context = _gather_rag_context(db_conn, user_message, current_context)

    # Try LLM-powered response
    try:
        client = get_llm_client()
        system_prompt = (
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
            f"CONTEXT FROM WAREHOUSE DATABASE:\n{rag_context}"
        )

        completion = client.chat.completions.create(
            model="meta/llama-3.1-70b-instruct",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.3,
            max_tokens=512,
        )

        response_text = completion.choices[0].message.content

        # Determine source from context
        source = "DockIQ AI (LLM + Knowledge Base)"
        if current_context and current_context.get("company_id"):
            c = db_conn.cursor()
            company = c.execute("SELECT name FROM companies WHERE id = ?", (current_context["company_id"],)).fetchone()
            if company:
                source = f"DockIQ AI + {dict(company)['name']} SOP"

        return {
            "response": response_text,
            "source": source,
            "confidence": "high"
        }

    except Exception as e:
        print(f"LLM error, falling back to keyword matching: {e}")
        return _keyword_chat_fallback(db_conn, user_message, current_context)


def _keyword_chat_fallback(db_conn, user_message, current_context=None):
    """Fallback keyword-based chat when LLM is unavailable."""
    msg_lower = user_message.lower()
    c = db_conn.cursor()

    # Location queries
    if any(word in msg_lower for word in ["where", "location", "find", "located"]):
        location_responses = {
            "slip sheet": "Slip sheets are in **Aisle 14, Bay C, bottom shelf**. Thin cardboard sheets (48×40 in). Place flat on top of each pallet layer.",
            "pallet": "Empty pallets at the **pallet stack area** at the end of each dock row. GMA (48×40) on left, oversized on right.",
            "wrap": "Pallet wrap at **each dock station**. Extra rolls in **Aisle 12, Bay A**.",
            "scanner": "Backup scanners at **charging station in Bay 2**, near supervisor office. Top shelf.",
            "battery": "Forklift battery swap station in **Dock Area C, Aisle 20**.",
        }
        for key, response in location_responses.items():
            if key in msg_lower:
                return {"response": response, "source": "Facility Layout Guide", "confidence": "high"}

    # Temperature queries
    if any(word in msg_lower for word in ["temp", "temperature", "threshold"]):
        return {
            "response": "**Temperature thresholds:**\n\n• **Frozen:** ≤ 0°F\n• **Refrigerated:** 33–40°F\n• **Produce:** 32–65°F (varies)\n• **Dry:** N/A\n\nAlways probe center of case, not edge.",
            "source": "Cold Chain SOP Section 2", "confidence": "high"
        }

    # Knowledge base search
    all_kb = c.execute("SELECT * FROM knowledge_base").fetchall()
    best_match, best_score = None, 0
    for row in all_kb:
        rd = dict(row)
        keywords = rd["keywords"].lower().split(",")
        score = sum(1 for kw in keywords if kw.strip() in msg_lower)
        if score > best_score:
            best_score = score
            best_match = rd

    if best_match and best_score >= 1:
        steps = json.loads(best_match["resolution_steps"])
        steps_text = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps))
        return {
            "response": f"**{best_match['issue_type']} — {best_match['scenario']}:**\n\n{steps_text}",
            "source": best_match["source_reference"], "confidence": best_match["confidence"]
        }

    return {
        "response": "I can help with **temperature thresholds**, **load patterns**, **issue resolution**, **equipment locations**, and **customer SOPs**. Try asking about one of those topics.",
        "source": "DockIQ Help", "confidence": "low"
    }


# ── COST IMPACT CALCULATOR ──

def estimate_cost_impact(db_conn, product_id, quantity_affected, issue_type):
    """Estimate the dollar impact of an issue."""
    c = db_conn.cursor()
    product = c.execute("SELECT case_value FROM products WHERE id = ?", (product_id,)).fetchone()
    if not product:
        return 0.0

    case_value = dict(product)["case_value"]
    base_cost = case_value * quantity_affected

    # Adjust based on issue type
    multipliers = {
        "Temperature Deviation": 1.0,      # Full loss likely
        "Product Quality Concern": 0.8,     # Most product lost
        "Damaged Pallet": 0.3,              # Partial damage
        "SKU Mismatch": 0.1,                # Re-work cost, not product loss
        "Count Shortage": 1.0,              # Direct loss
        "Lot/Expiry Issue": 1.0,            # Full rejection
        "Seal/Trailer Condition": 0.5,      # Potential full rejection
        "Barcode Issue": 0.0,               # No product loss
        "Equipment Failure": 0.0,           # No product loss
        "Paperwork Mismatch": 0.0,          # No product loss
    }

    multiplier = multipliers.get(issue_type, 0.2)
    return round(base_cost * multiplier, 2)


# ── RECURRING ISSUE DETECTION ──

def check_recurring_issues(db_conn, issue_type, dock_door_id=None, carrier_id=None, days=7):
    """Check if the same issue type has occurred 3+ times recently."""
    c = db_conn.cursor()

    patterns = []

    if dock_door_id:
        count = c.execute(
            """SELECT COUNT(*) FROM issues
               WHERE issue_type = ? AND dock_door_id = ?
               AND created_at >= datetime('now', ?)""",
            (issue_type, dock_door_id, f"-{days} days")
        ).fetchone()[0]
        if count >= 3:
            patterns.append({
                "type": "dock",
                "message": f"This is the {count}th '{issue_type}' at Dock {dock_door_id} in the last {days} days. Possible root cause: environmental (lighting, equipment, dock condition).",
                "count": count
            })

    if carrier_id:
        count = c.execute(
            """SELECT COUNT(*) FROM issues
               WHERE issue_type = ? AND carrier_id = ?
               AND created_at >= datetime('now', ?)""",
            (issue_type, carrier_id, f"-{days} days")
        ).fetchone()[0]
        if count >= 3:
            carrier = c.execute("SELECT name FROM carriers WHERE id = ?", (carrier_id,)).fetchone()
            carrier_name = dict(carrier)["name"] if carrier else f"Carrier #{carrier_id}"
            patterns.append({
                "type": "carrier",
                "message": f"This is the {count}th '{issue_type}' from {carrier_name} in the last {days} days. Recommend carrier quality review.",
                "count": count
            })

    return patterns
