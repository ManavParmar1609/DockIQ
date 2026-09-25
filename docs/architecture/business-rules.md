# DockIQ.AI — Business Rules

**Status:** Authoritative record of domain logic currently implemented in code.
**Last verified against source:** 2026-09-25

Every rule below exists as a literal in `backend/app/domain/` or in the seed data in
`backend/app/seed/data/`. This document is the reviewable copy. **When a threshold, weight or
multiplier changes in code, change it here in the same commit** — an unreviewable number that drives
a food-safety decision is the single most dangerous thing in this codebase.

Where a rule is implemented but not actually reachable, it is marked ⚠️. Those are not
documentation errors; they are real defects worth knowing about.

---

## 1. Severity classification

**Source:** `backend/app/domain/severity.py` → `classify_severity()` (lines 60–114)

This is a **deterministic weighted formula, not an LLM call.** The LLM is used only for the chat
assistant. Severity is reproducible and auditable, which is the point — a food-safety decision
should not depend on a sampled token.

```
score = issue_type_weight × product_risk_multiplier × customer_tier_multiplier
        + modifiers
```

### 1.1 Issue type weights

`severity.py:11-23`. Unknown issue type defaults to **2**.

| Issue type | Weight |
|---|---|
| Temperature Deviation | 5 |
| Product Quality Concern | 4 |
| Damaged Pallet | 4 |
| Seal/Trailer Condition | 4 |
| SKU Mismatch | 3 |
| Lot/Expiry Issue | 3 |
| Count Shortage | 2 |
| Paperwork Mismatch | 2 |
| Equipment Failure | 2 |
| Barcode Issue | 1 |

### 1.2 Product risk multiplier

`severity.py:25-30`. Unknown or absent category → **1.0**.

| Product category | Multiplier |
|---|---|
| Frozen | ×3.0 |
| Refrigerated | ×2.5 |
| Produce | ×2.0 |
| Dry | ×1.0 |

### 1.3 Customer tier multiplier

`severity.py:32-36`. Unknown or absent tier → **1.0**.

| Customer tier | Multiplier |
|---|---|
| Tier 1 | ×1.5 |
| Tier 2 | ×1.2 |
| Tier 3 | ×1.0 |

### 1.4 Additive modifiers

Applied after the multiplication, `severity.py:82-110`.

| Condition | Adjustment |
|---|---|
| Temperature more than 10°F above threshold | +5 |
| Temperature 5–10°F above threshold | +3 |
| Temperature 0–5°F above threshold | +1 |
| Count shortage > 5% | +3 |
| Count shortage 2–5% | +1 |
| Allergen-sensitive product | +2 |
| Trailer dwell time > 30 minutes | +2 ⚠️ |

⚠️ **`trailer_dwell_minutes` is never passed by any caller.** The parameter defaults to `0` and
`create_issue` in `app/api/issues.py` does not supply it, so this modifier can never fire. The dock table does
record `trailer_arrived_at`, so the data needed to compute it exists.

### 1.5 Severity bands

`severity.py:39-57` (`SEVERITY_BANDS`, `band_for`).

| Score | Severity |
|---|---|
| ≥ 18 | **critical** |
| 12 – 17.9 | **high** |
| 6 – 11.9 | **medium** |
| < 6 | **low** |

### 1.6 Worked example

From `screenshots/issue_step3.png`, a real output of the running system:

> `Score: 7.5 → MEDIUM. Factors: Issue type 'Temperature Deviation' (weight: 5); Customer Tier 1 (×1.5)`

`5 × 1.0 (no product category) × 1.5 = 7.5` → MEDIUM. Note that a temperature deviation on a Tier-1
customer lands only at *medium* when the product category is unknown. With `Frozen` supplied it
would be `5 × 3.0 × 1.5 = 22.5` → **critical**. **Product category is decisive**, so any code path
that creates an issue without it materially under-reports severity.

### 1.7 Known defect ⚠️

`severity.py:95` reads:

```python
if count_expected and count_actual:
```

This is a truthiness test, so **`count_actual = 0` — nothing received at all, the worst possible
case — skips the shortage modifier entirely.** It must be `is not None`. A total non-delivery
currently scores lower than a 6% shortage.

---

## 2. Cost impact model

**Source:** `backend/app/domain/cost.py` → `estimate_cost_impact()` (lines 3–23)

```
cost = product.case_value × quantity_affected × issue_multiplier
```

Unknown issue type → **0.2**. A product that cannot be found returns `0.0`.

| Issue type | Multiplier | Rationale (from code comments) |
|---|---|---|
| Temperature Deviation | 1.0 | Full loss likely |
| Count Shortage | 1.0 | Direct loss |
| Lot/Expiry Issue | 1.0 | Full rejection |
| Product Quality Concern | 0.8 | Most product lost |
| Seal/Trailer Condition | 0.5 | Potential full rejection |
| Damaged Pallet | 0.3 | Partial damage |
| SKU Mismatch | 0.1 | Re-work cost, not product loss |
| Barcode Issue | 0.0 | No product loss |
| Equipment Failure | 0.0 | No product loss |
| Paperwork Mismatch | 0.0 | No product loss |

---

## 3. Knowledge-base retrieval and confidence

**Source:** `backend/app/domain/retrieval.py` → `find_resolution()` (lines 11–86)

**This is keyword substring matching, not embeddings.** `get_embed_client()` exists at lines 19–26
but is never called anywhere — it is dead code. Do not describe this system as doing semantic search.

Algorithm:
1. Select all `knowledge_base` rows with an exact `issue_type` match. If none, return the **General
   Escalation Procedure** fallback with `confidence: "low"`.
2. For each row, score = count of the row's comma-separated `keywords` that appear as a substring of
   the lowercased issue description.
3. **+2** if the product category is in the row's `applicable_categories`.
4. **+1** if the company name is in `applicable_companies`, or that list contains `"all"`.
5. Take the highest-scoring row.

| Best score | Confidence |
|---|---|
| ≥ 4 | high |
| 2 – 3 | medium |
| < 2 | low |

⚠️ `create_issue` in `app/api/issues.py` **does not pass `company_name`**, so the +1 company bonus can never
fire in the issue-creation path. This depresses confidence and is visible in the UI — see
`screenshots/issue_step3.png`, where a well-matched temperature procedure is labelled
"LOW confidence".

---

## 4. Operational thresholds

Encoded across the 27 seeded entries in `backend/app/seed/data/knowledge_base.json`.
These are the substantive food-safety and acceptance rules.

### 4.1 Damage

| Condition | Required action |
|---|---|
| Damage ≤ 5% of the pallet | Partial accept permitted |
| Damage > 5% | Reject or escalate to supervisor |
| Food packaging punctured | **Immediate stop** and quarantine |
| Pallet cannot be transported safely | Do not move; escalate |

### 4.2 Temperature / cold chain

| Condition | Required action |
|---|---|
| Within 5°F of threshold | Close trailer doors, re-probe in 10 minutes |
| More than 5°F beyond threshold | **Do not unload. Do not sign the BOL.** |
| Probe placement | Probe the **centre** of a case, never the edge — edge cases warm faster |
| Trailer not pre-cooled | Reject or hold pending supervisor decision |

### 4.3 Seals and security

| Condition | Required action |
|---|---|
| Seal broken or missing | Security escalation — not a paperwork issue |
| Seal number ≠ paperwork | Stop; escalate before unloading |

### 4.4 Product integrity

| Condition | Required action |
|---|---|
| Expired product | **Automatic reject. No supervisor override.** |
| Mould or pest evidence < 10% | Segregate affected cases |
| Mould or pest evidence widespread | Reject the whole pallet |
| Wrong lot / batch number | Escalate — lot-tracked products cannot be accepted on assumption |

### 4.5 Barcodes

| Rule |
|---|
| Case-level barcode is **ITF-14**; the consumer **UPC** on the retail unit is not interchangeable with it |
| Scanning the wrong symbology is the most common cause of a false "won't scan" report |

### 4.6 Trailer inspection pass criteria

**Source:** `backend/app/domain/inspection.py`. An inspection passes only if **all** hold:

- Seal condition = `intact`
- Interior cleanliness = `clean`
- Visible damage = `none`
- If an interior temperature was entered: **≤ 45°F**

⚠️ The 45°F gate is a single fixed value applied regardless of product category. A frozen load at
40°F would pass the inspection gate while being catastrophically out of spec for the product. The
per-product thresholds in `products.temp_min` / `temp_max` are not consulted here.

---

## 5. Per-customer SOP variances

Seeded in `companies.sop_rules` and `companies.load_pattern`. These are genuine business rules that
differ by customer, and they are the reason a generic procedure is not sufficient.

| Customer | Variance from the default |
|---|---|
| Fernbrook Provisions | Frozen must be **≤ -5°F** — stricter than the 0°F default |
| Bulkhaven Club | **Zero tolerance** on Bulkhaven-branded product |
| Ridgeview Grocery | Maximum **22 pallets** per 53-ft trailer |
| Tablecraft Distribution | Multi-stop loads must be loaded in **reverse delivery order** |
| Piedmont Foods | May reject a delivery arriving outside its booked window |
| Forkline Foodservice | Rejects any receipt lacking **HACCP** documentation |

Company records also carry `tier` (1–3, feeding §1.3), `count_tolerance` (a fraction, e.g. `0.01` =
1%), and a `load_pattern` JSON blob with `max_height`, `weight_placement`, `slip_sheets`,
`label_direction` and `special`.

---

## 6. Recurring-issue detection

**Source:** `backend/app/domain/recurrence.py` (thresholds) and `app/queries.py` → `count_recent_issues()` (the count). Window: **7 days**.

| Pattern | Trigger | Conclusion offered |
|---|---|---|
| Dock | Same `issue_type` **≥ 3 times** at the same dock | Possible environmental root cause — lighting, equipment, dock condition |
| Carrier | Same `issue_type` **≥ 3 times** from the same carrier | Recommend carrier quality review |

⚠️ **The result is returned to the API caller and then discarded.** Nothing persists it, and no
screen displays it. This is the mechanism behind the executive scenario line *"System notes: 3rd
temp issue from this carrier this month"* — the logic exists, the surfacing does not.

---

## 7. Issue lifecycle

**States** (`issues.status`):

```
resolution_in_progress ──┬──▶ self_resolved
                         └──▶ escalated ──▶ supervisor_resolved
```

**Timestamp trail:** `created_at` → `escalated_at` → `acknowledged_at` → `resolved_at`.

**Dock lifecycle** (`dock_doors.lifecycle_phase`):

```
idle ──▶ inspection ──▶ loading | unloading ──▶ complete
```

⚠️ Dock state is split across **two independently mutated columns** — `status`
(`idle`/`active`/`issue`/`critical`) and `lifecycle_phase` — written by five different handlers with
no state machine. `self_resolve_issue` and `supervisor_resolve_issue` both set the dock back to
`status='active'` unconditionally, even if the dock was idle or another issue is still open on it.

---

## 8. The full operator issue taxonomy (target coverage)

**Source:** `DocumentsforProj/list of issues operators faces.docx`

This is the authoritative list of situations where an operator cannot proceed alone. The system
currently implements **10 issue types**; the mapping below shows what that does and does not cover.
See `docs/roadmap.md` for the plan to close these gaps.

| Category (count) | Currently reportable as | Coverage |
|---|---|---|
| Loading & Pallet Issues (8) | `Damaged Pallet` | Partial — damage only |
| Barcode & Label Issues (7) | `Barcode Issue` | Partial — no sub-reason |
| Scanner & Handheld Issues (6) | `Equipment Failure` | Partial — conflated with forklift |
| Forklift Equipment Issues (7) | `Equipment Failure` | Partial — same bucket |
| Trailer & Dock Issues (7) | `Seal/Trailer Condition` | Partial — no leveler/restraint/plate |
| Documentation & Shipping (6) | `Paperwork Mismatch` | Partial |
| **WMS Issues (7)** | — | **None** |
| **Safety Issues (8)** | — | **None** |

Discrepancy categories from the same document — Inventory & Barcode, Quantity, Product, Temperature,
Trailer & Dock, Documentation, WMS/System, Safety — are covered only insofar as the ten types above
reach them. Notably `Count Shortage` models **shortages only**: there is no overage, no
mixed-SKU-on-one-pallet, and no missing-pallet-from-staging.

### Discrepancies that require supervisor approval

Per the source document, an operator must stop and notify a supervisor for: barcode or label
mismatches; missing or extra pallets; inventory or quantity discrepancies; damaged product or
pallets; temperature deviations; incorrect trailer or shipping documentation; WMS or handheld
scanner issues; and unsafe loading conditions or trailer defects.

---

## Change log

| Date | Change |
|---|---|
| 2026-09-25 | Initial extraction from code and source documents. |
