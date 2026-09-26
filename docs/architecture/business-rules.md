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

**Source:** `backend/app/domain/severity.py` → `classify_severity()`; its inputs are built in one
place, `app/services/issue_filing.py` → `score_issue()`, for a filing and for the assistant's preview.

This is a **deterministic weighted formula, not an LLM call.** The LLM is used only for the chat
assistant. Severity is reproducible and auditable, which is the point — a food-safety decision
should not depend on a sampled token.

```
score = issue_type_weight × product_risk_multiplier × customer_tier_multiplier × quantity_share_factor
        + modifiers
severity = the band of the score, raised (never lowered) to the highest floor that applies
```

`quantity_share_factor` is 1.0 unless §1.9 applies.

### 1.1 Issue type weights

`severity.py` → `ISSUE_TYPE_WEIGHTS`. Unknown issue type defaults to **2**.

| Issue type | Weight |
|---|---|
| Temperature Deviation | 5 |
| Safety Incident *(Phase 2 — see §1.7, §1.8)* | 5 |
| Product Quality Concern | 4 |
| Damaged Pallet | 4 |
| Seal/Trailer Condition | 4 |
| SKU Mismatch | 3 |
| Lot/Expiry Issue | 3 |
| WMS/System Issue *(Phase 2)* | 3 |
| Count Discrepancy *(was Count Shortage)* | 2 |
| Paperwork Mismatch | 2 |
| Equipment Failure | 2 |
| Barcode Issue | 1 |

### 1.2 Product risk multiplier

`severity.py` → `PRODUCT_RISK`. Unknown or absent category → **1.0**.

| Product category | Multiplier |
|---|---|
| Frozen | ×3.0 |
| Refrigerated | ×2.5 |
| Produce | ×2.0 |
| Dry | ×1.0 |

### 1.3 Customer tier multiplier

`severity.py` → `CUSTOMER_TIER_MULTIPLIER`. Unknown or absent tier → **1.0**.

| Customer tier | Multiplier |
|---|---|
| Tier 1 | ×1.5 |
| Tier 2 | ×1.2 |
| Tier 3 | ×1.0 |

### 1.4 Additive modifiers

Applied after the multiplication, in `classify_severity()`.

| Condition | Adjustment |
|---|---|
| Temperature more than 10°F above threshold | +5 |
| Temperature 5–10°F above threshold | +3 |
| Temperature 0–5°F above threshold | +1 |
| Count shortage > 5% | +3 |
| Count shortage 2–5% | +1 |
| Allergen-sensitive product | +2 |
| Trailer dwell time > 30 minutes | +2 |

**Dwell** is the minutes since the dock's `trailer_arrived_at`, computed when the issue is reported.
A dock with no trailer contributes nothing. *(Phase 2: previously never passed, so it never fired.)*

**Count shortage** applies only when both counts are given and `expected > 0`. **A count of 0 is a
total non-delivery and scores the full +3.** An **overage** (actual > expected) is recorded but adds
nothing — per Receiving SOP 5.6, overages are less critical than shortages.

### 1.5 Severity bands

`severity.py` → `SEVERITY_BANDS`, `band_for()`.

| Score | Severity |
|---|---|
| ≥ 18 | **critical** |
| 12 – 17.9 | **high** |
| 6 – 11.9 | **medium** |
| < 6 | **low** |

### 1.6 Worked example

A real output of the running system (captured before the Phase 2 redesign):

> `Score: 7.5 → MEDIUM. Factors: Issue type 'Temperature Deviation' (weight: 5); Customer Tier 1 (×1.5)`

`5 × 1.0 (no product category) × 1.5 = 7.5` → MEDIUM. Note that a temperature deviation on a Tier-1
customer lands only at *medium* when the product category is unknown. With `Frozen` supplied it
would be `5 × 3.0 × 1.5 = 22.5` → **critical**. **Product category is decisive**, so any code path
that creates an issue without it materially under-reports severity.

### 1.7 People risk *(Phase 2)*

For **Safety Incident** the product-risk and customer-tier multipliers are **not applied**: the risk is
to a person, and a frozen tier-1 load does not make a slip hazard more dangerous. The reason text
says so explicitly.

### 1.8 Severity floors *(Phase 2)*

Some situations are serious regardless of score. After banding, the severity is raised to the floor
if it is below it — never lowered. `taxonomy.py` → `SEVERITY_FLOORS`.

| Type | Subtype | Never below |
|---|---|---|
| Safety Incident | Employee injury | **critical** |
| Safety Incident | Near miss · Pedestrian in loading area · Unsafe trailer condition | **high** |
| Safety Incident | any other | **medium** |

The reason text records it: `Floor: 'Employee injury' is never below CRITICAL`.

### 1.9 Proportional damage: the share of cases affected

Two torn cases off a pallet are not a damaged pallet. For the damage below, the base score
(weight × product × tier) is multiplied by a factor for the **share of cases affected**.
`severity.py` → `QUANTITY_SHARE_FACTORS`; `taxonomy.py` → `QUANTITY_SCALED_SUBTYPES`.

| Cases affected ÷ reference | Factor | Why |
|---|---|---|
| ≤ 5% | ×0.4 | Within the SOP's partial-accept allowance (§4.1) |
| > 5% and ≤ 25% | ×0.7 | Past the allowance: the SOP escalates, but a fraction of the pallet |
| > 25% (a quarter, a whole pallet or more) | ×1.0 | Treated as the whole pallet |

- **Reference** = the product's `cases_per_pallet`, or the order line's expected cases when that is
  smaller. With neither known, nothing is scaled.
- **Scaled:** Damaged Pallet with no subtype, *Damaged cartons or packaging*, *Torn or loose shrink
  wrap*, *Product fallen off pallet*; Product Quality Concern *Water damage from condensation*.
- **Never scaled:** structural and handling damage (*Crushed or collapsed pallet*, *Leaning or unstable
  load*, *Damaged or broken pallet*, *Frozen pallet stuck to floor*, *Cannot safely remove or place
  pallet*) — the question is whether the pallet can move safely, not how many cases are hurt — and
  every other type, **Temperature Deviation included**: product over its limit is a food-safety
  judgement on the product and the reading, not on the case count.
- **Only a stated quantity scales.** `IssueCreate.quantity_affected` defaults to 1; a report that
  leaves it out is scored in full (`issue_filing.given_quantity()`). The Report screen's *Cases
  affected* starts blank, and the assistant's draft carries only a number the person gave.
- The reason text records it: `2 of 48 cases on the pallet (4.2%) (×0.4)`.

### 1.10 Scope floors: a whole room, and product far over its limit

Added to the floors of §1.8; the highest floor that applies is the one recorded.

| Situation | Never below | Source |
|---|---|---|
| A **cold-room excursion** (the whole room, filed by the warehouse, §12.12) | **high** | `classify_severity(room_minutes_over_limit=…)` |
| …and the room has read over its limit for **≥ 15 min** (`ROOM_ALARM_MINUTES`, the same as the warehouse alarm, §12.12) | **critical** | |
| A Temperature Deviation with product **more than 5°F** over its limit | **high** | `TEMPERATURE_FLOORS`, the probe check's *warning* band (§11.1) |
| A Temperature Deviation with product **more than 10°F** over its limit | **critical** | the probe check's *critical* band: *Do not unload* (receiving) / *Do not load* (loading) |

A room excursion alarms only after 15 minutes over the limit, so every alarm the warehouse files is
**critical** and escalated at once (§7.1). A person's report is never room-scoped: only the warehouse
sets `room_minutes_over_limit` (`SystemFiling`).

### 1.11 Worked examples (§1.9 and §1.10)

**A. Two torn cases of frozen chicken.** OP-001 loading Crestline Markets (tier 1), CRM-FZ-1001
(Frozen, 48 cases a pallet, a 200-case line), *Damaged cartons or packaging*, 2 cases, trailer at the
door for 111 min.

| | Derivation | Result |
|---|---|---|
| Before | 4 × 3.0 × 1.5 = 18.0, + 2 dwell | **20.0 → CRITICAL** — escalated, the dock goes red |
| After | 4 × 3.0 × 1.5 = 18.0 × 0.4 (2 of 48 = 4.2%) = 7.2, + 2 dwell | **9.2 → MEDIUM** — the worker can segregate the cases and resolve it |

**B. A tripped compressor in the produce room.** The room (limit 45°F) reads 48°F for 15 min; the
most temperature-sensitive product stored there is a tier-1 customer's produce.

| | Derivation | Result |
|---|---|---|
| Before | 5 × 2.0 × 1.5 = 15.0, + 1 (3°F over) | **16.0 → HIGH** — *below* two torn cases |
| After | the same 16.0, then the §1.10 room floor (over its limit ≥ 15 min) | **16.0 → CRITICAL** — escalated; Supervisor and Quality alerted |

Both are pinned: `test_worked_example_two_torn_cases_of_frozen_chicken`,
`test_worked_example_produce_room_compressor_trip`, and end to end through the API and the assistant's
draft (`test_damage_severity_follows_the_cases_the_person_states`,
`test_two_torn_cases_draft_scores_by_share_and_files_the_same`).

**Seeded history** is scored without a quantity (the seed does not state one), so its severities are
unchanged. The simulator's receiving damage (1–6 cases, §12.13) now scores by share; its injected
*Crushed or collapsed pallet* (§12.4) is structural and unchanged.

### 1.12 Change history

The Phase 1 code carried a truthiness test (`if count_expected and count_actual:`) that made a
**total non-delivery score lower than a 6% shortage**. Fixed in Phase 2; pinned by
`test_total_non_delivery_scores_shortage_modifier`.

2026-09-25: proportional damage (§1.9) and scope floors (§1.10), approved by the product owner after
two torn cases of chicken outranked a cold room in alarm.

---

## 2. Cost impact model

**Source:** `backend/app/domain/cost.py` → `estimate_cost_impact()`

```
cost = product.case_value × quantity_affected × issue_multiplier
```

Unknown issue type → **0.2**. A product that cannot be found returns `0.0`.

| Issue type | Multiplier | Rationale (from code comments) |
|---|---|---|
| Temperature Deviation | 1.0 | Full loss likely |
| Count Discrepancy | 1.0 | Direct loss — except the **Overage** and **Extra pallet not on load** subtypes, which are 0.0 |
| Lot/Expiry Issue | 1.0 | Full rejection |
| Product Quality Concern | 0.8 | Most product lost |
| Seal/Trailer Condition | 0.5 | Potential full rejection |
| Damaged Pallet | 0.3 | Partial damage |
| SKU Mismatch | 0.1 | Re-work cost, not product loss |
| Barcode Issue | 0.0 | No product loss |
| Equipment Failure | 0.0 | No product loss |
| Paperwork Mismatch | 0.0 | No product loss |
| Safety Incident | 0.0 | The cost is human; not modelled in dollars |
| WMS/System Issue | 0.0 | No product loss |

---

## 3. Knowledge-base retrieval and confidence

**Source:** `backend/app/domain/retrieval.py` → `find_resolution()`

**This is keyword substring matching, not embeddings.** Do not describe this system as doing
semantic search. The text searched is the chosen **subtype plus the description**.

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

The company bonus now fires in the issue-creation path *(Phase 2 — previously `company_name` was
never passed, which depressed confidence on well-matched procedures)*.

Before step 2, rows for the other direction or the other temperature band are dropped (§3.1, §3.2).
If nothing is left, the fallback is returned — never a procedure for the wrong job.

### 3.1 Direction: loading is not receiving

`retrieval.py` → `SCENARIO_DIRECTION`. The order's `type` is passed in (`outbound` = loading,
`inbound` = receiving). The knowledge base has no direction column, so the table names scenarios; a
test fails if a name drifts from `knowledge_base.json`. Scenarios not listed apply to both.

| Inbound only (receiving) | Outbound only (loading) |
|---|---|
| Less than 5% of cases damaged · More than 5% of cases damaged · Packaging is punctured on food items | **Damaged cases found while loading** (Loading SOP 3.2) · **Punctured or open food packaging found while loading** (Loading SOP 3.3) |
| Temperature within 5°F of threshold (marginal) · Temperature more than 5°F above threshold | **Product within 5°F of its limit while loading (marginal)** (Cold Chain SOP 2.2) · **Product more than 5°F above its limit while loading** (Cold Chain SOP 2.4) |
| Count is within / exceeds customer tolerance · Overage — received more than expected | **Staged count does not match the order** (Loading SOP 3.5) · Missing or extra pallet |
| BOL doesn't match physical product | — |

A loading job is never told to *continue unloading*, *partial accept* or *sign the BOL with the
count received*. With no order (a warehouse filing, a staff question) every row competes.

### 3.2 Temperature band

`retrieval.py` → `temperature_band()`, `SCENARIO_TEMPERATURE_BAND`. With a reading and a limit, the
band is **marginal** when the product is 0–5°F over (`MARGINAL_BAND_MAX = 5.0`) and **critical**
beyond; at or under the limit there is no band. The other band's procedures are dropped, and a row in
the reading's band scores **+2** (`BAND_BONUS`), so it beats a generic temperature row (the reefer
check) on the same words. The assistant's `find_procedure` without a reading returns **both** band
procedures, each labelled with when it applies.

### 3.3 Torn or loose wrap

A new row, **Torn or loose shrink wrap** (Company SOP 4.5 — Pallet Wrap Integrity), for the subtype of
the same name and the words *shrink wrap, stretch wrap, torn wrap, loose wrap, wrap came off, re-wrap,
wrap*: check the cases under the wrap, **re-wrap and continue** — torn wrap alone is not a reason to
reject. Before, "torn" matched *Packaging is punctured on food items* (stop, quarantine, full
rejection). Punctured or open cases under the wrap are still reported as damaged cartons.

### 3.4 The procedure's suggested decision *(advice, never a decision)*

`knowledge_base.suggested_decision` (seeded from `knowledge_base.json`, migration `0008`), carried in
the issue's procedure (`ai_resolution.suggested_decision`, `null` when the procedure implies none).
Where an SOP's own words name the outcome, the procedure names the supervisor decision they point to;
the decision panel shows it as *"Procedure suggests: ‹decision›"*. It is **never auto-selected** and
never enters a severity, cost or acceptance rule (architecture invariant 5): the supervisor decides,
and the notes rules of §7.2 apply to whatever they choose. Pinned by `test_suggested_decisions_are_pinned`;
every value must be one of the taxonomy's supervisor decisions.

| Procedure (scenario) | SOP | Suggests | Because the SOP says |
|---|---|---|---|
| Less than 5% of cases damaged | Company SOP 4.1 | **Partial Accept** | *"If damaged cases are ≤5% of total: partial accept the pallet"* |
| More than 5% of cases damaged | Company SOP 4.2 | **Full Reject** | *"Mark the pallet with a REJECT tag"* |
| Packaging is punctured on food items | FDA / Company SOP 4.3 | **Full Reject** | *"requires supervisor authorization for full rejection"* |
| Temperature more than 5°F above threshold | Cold Chain SOP 2.3 | **Full Reject** | Critical Temperature Rejection: *"DO NOT UNLOAD … do NOT sign the BOL"* |
| Reefer unit not running on trailer | Equipment SOP 7.2 | **Contact Carrier** | *"The carrier is responsible for functioning reefer equipment"* |
| Count is within customer tolerance | Receiving SOP 5.4 | **Accept** | *"If within tolerance: accept the shipment and note the shortage"* |
| Count exceeds customer tolerance | Receiving SOP 5.5 | **Contact Carrier** | *"escalated to supervisor for carrier contact"* |
| Trailer seal is broken or missing | Security SOP 8.1 | **Contact Carrier** | *"Supervisor will need to contact the carrier"* |
| Product expiry date has already passed | Quality SOP 9.1 | **Full Reject** | *"automatic rejection — no supervisor override allowed"* |
| Overage — received more than expected | Receiving SOP 5.6 | **Accept** | *"If confirmed overage: accept and note the actual count"* |
| Pallet wood is broken but product is fine | Company SOP 4.4 | **Accept** | *"the product can still be accepted"* |
| Torn or loose shrink wrap | Company SOP 4.5 | **Accept** | *"torn or loose wrap alone is not a reason to reject"* |

Every other procedure suggests nothing: its outcome depends on a re-probe, the customer's policy, the
vendor, or Quality — or, when loading, there is no load to accept or reject.

---

## 4. Operational thresholds

Encoded across the 47 seeded entries in `backend/app/seed/data/knowledge_base.json` (27 original,
14 added in Phase 2 for Safety, WMS, count and trailer-restraint scenarios, 6 on 2026-09-25 for
loading-side procedures and pallet wrap, §3.1–§3.3). The knowledge base is
reference data: every boot replaces it with the repository's copy.
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
- If an interior temperature was entered: **≤ the strictest `temp_max` of any product on the load**

The limit comes from the order being loaded (or the dock's current order): a load with a Frozen line
must be at or below that line's maximum (0°F, or −5°F for Fernbrook's frozen range). **45°F applies
only when the load has no temperature-controlled product, or there is no order.** The response names
the limit used and each failed check. *(Phase 2 — previously a fixed 45°F let a frozen load at 40°F
pass.)*

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
`label_direction`, `special`, and — since Phase 2 — `floor_pattern`, `sequence`,
`segregate_categories` and `max_pallets`, which drive the load plan in §10.

---

## 6. Recurring-issue detection

**Source:** `backend/app/domain/recurrence.py` (thresholds) and `app/queries.py` → `count_recent_issues()` (the count). Window: **7 days**.

| Pattern | Trigger | Conclusion offered |
|---|---|---|
| Dock | Same `issue_type` **≥ 3 times** at the same dock, counting the report being filed | Possible environmental root cause — lighting, equipment, dock condition |
| Carrier | Same `issue_type` **≥ 3 times** from the same carrier, counting the report being filed | Recommend carrier quality review |

The patterns are **stored on the issue** (`issues.recurring_patterns`) and shown on the report
confirmation, the supervisor queue and the issue detail — the *"3rd temp issue from this carrier"*
line from Scenario 2. *(Phase 2 — previously computed and discarded, and the count excluded the
report being filed, so the message read "the 3th" on what was really the 4th.)* Counts read as
English ordinals — 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st (`recurrence.ordinal`). Messages
stored before the fix are rewritten to that form by migration `0007` (data only; the downgrade keeps
the corrected text).

---

## 7. Issue lifecycle

**States** (`issues.status`):

```
resolution_in_progress ──┬──▶ self_resolved
                         ├──▶ escalated ──┬──▶ supervisor_resolved
                         │                ├──▶ self_resolved   (not critical, with the worker's note: §7.5)
                         │                └──▶ on_hold ──▶ supervisor_resolved
                         ├──▶ on_hold      (a decision that waits on the carrier or a re-inspection)
                         └──▶ supervisor_resolved   (a supervisor may close it directly)
```

Resolved states are terminal; `on_hold` is **open** (it counts as active, blocks sign-off if the
issue is critical, and may move to another pending decision or to a final one). Any other move is
refused with **409 Conflict** (`domain/lifecycle.py`). Only the reporting operator may self-resolve
(§7.5); only **that operator's supervisor** decides.

**Timestamp trail:** `created_at` → `escalated_at` → `acknowledged_at` (+ `acknowledged_by`, who said
"on my way") → `on_hold_at` (a pending decision) → `resolved_at` (+ `supervisor_id`, who decided). A
decision no longer back-fills `acknowledged_at`: acknowledging and deciding are separate facts, and
may be separate people.

**The record as reported** (Phase 3 audit): every issue stores `temp_reading`, `temp_limit`,
`quantity_affected` (as stated; not the form's default), `lot`, `room` (a cold-room alarm), and the
order's `order_number`, `trailer_number` and `bol_number` **as they were when it was filed** — so a
report stays traceable even if its order is later removed (a simulator reset, §12.5). A simulated
issue also stores `sim_minute`, returned as `sim_time` ("07:42") and `sim_shift` so it lines up with
the WMS clock. Timestamps are ISO-8601 UTC with an offset.

### 7.1 Guardrails: critical work is a supervisor's decision

From the source documents: *"Critical issues require supervisor action"* and *"open critical issues,
failed inspections … stop workflow completion."* Rules in `domain/lifecycle.py`:

| Rule | Behaviour |
|---|---|
| Critical is escalated on filing | An issue scored **critical** is created `escalated` (with `escalated_at`), the dock goes `critical`, and the supervisor and Quality are alerted with `new_issue`. There is no window in which it waits on the operator. Every path files through `file_issue` — a person's report, receiving discrepancies, a critical probe, the simulator's exceptions, alarms and scenarios — and a test asserts that no critical issue is ever left `resolution_in_progress`. Migration `0006` moved any such row filed before the rule to `escalated`, with `escalated_at` = when it was filed |
| Critical cannot be self-resolved | `PUT /self-resolve` on a critical issue answers **409**; only the team supervisor resolves it |
| Sign-off waits on critical issues | `POST /orders/{id}/complete` answers **409** while any critical issue on the order is open |
| Sign-off waits on a failed inspection | If the order's most recent inspection failed, sign-off answers **409** until a supervisor resolves an issue on the order after that inspection, or a later inspection passes |
| A rejected load is never signed off | A **Full Reject** on any issue of the order blocks sign-off for good: *"Rejected by ‹supervisor› — ‹reason›"* (§7.2) |
| Sign-off waits on a requested re-inspection | While an issue on the order is `on_hold` with **Request Re-inspection**, sign-off waits for a trailer inspection that passes *after* the request |
| Inbound sign-off needs its evidence | Every receiving check answered, a probe reading on a temperature-controlled load, and no critical probe whose Temperature Deviation is still open (§11.3) |

`GET /orders/{id}` returns `completion_blockers`, the plain-language reasons above, so the sign-off
screen explains itself instead of failing on tap. Count discrepancies filed *by* sign-off never block
it: they are recorded with the completion.

### 7.2 Supervisor decisions take effect

`PUT /api/issues/{id}/supervisor-resolve`, `domain/lifecycle.py`. `GET /api/taxonomy` lists
`accept_decisions`, `pending_decisions` and `noted_decisions` (`ALWAYS_NOTED_DECISIONS`: Full Reject
and Override — Accept Anyway, which always need the reason) so the screen can say which is which and
hold its submit until the reason is written. The procedure's suggested decision (§3.4) is shown beside
the choices as advice.

| Decision | Status | Effect |
|---|---|---|
| Accept · Partial Accept | `supervisor_resolved` | The dock goes back to `active`. On a **critical** or **temperature** (cold-chain) issue the decision needs the supervisor's reason in `supervisor_notes` — **422** without it |
| Override — Accept Anyway | `supervisor_resolved` | As Accept, but the reason is required on **every** issue (**422** without): overriding the procedure is always explained |
| Full Reject | `supervisor_resolved` | The reason is required on **every** issue (**422** without). The order is blocked from sign-off (*"Rejected by ‹supervisor› — ‹notes›"*), and the dock is flagged `issue` (`DockEvent.LOAD_REJECTED` through `transition()`), not reopened |
| Contact Carrier | `on_hold` | Still open, `pending_action` *"Awaiting the carrier"*; the dock stays as it is |
| Request Re-inspection | `on_hold` | Still open, *"Awaiting a re-inspection"*; the order is blocked until a trailer inspection passes after the request |
| Other | `supervisor_resolved` | As Accept, without the notes rule |

The smallest model that keeps a pending call honest: one extra status, `on_hold`, open like
`escalated`, with the decision in `resolution_type` and its time in `on_hold_at`. A later final
decision replaces it; a second pending one may too. `issue_resolved` is sent for every decision, with
`method` = the new status (`on_hold` or `supervisor_resolved`) and `resolution` = the decision.

### 7.3 Quality hold and disposition

`domain/quality_hold.py` (which issues, which dispositions), `wms/warehouse.py` → `select_for_hold`
(which licence plates), through `WmsClient.hold_stock` / `dispose_stock` and the stock ledger —
never around it.

**Which issues hold stock:** a **Temperature Deviation** or **Product Quality Concern** filed against
an order the WMS holds stock for (an order with a WMS reference; a person's own non-simulated order
has none, so nothing moves but the disposition is still recorded).

| Scope | Plates moved to `{room}-HOLD` |
|---|---|
| Temperature Deviation on an order | The plates received from (inbound) or picked for (outbound) that order, still in storage, on a dock lane or staged — only the issue's product when one is named |
| Product Quality Concern on an order | The same, **and every other plate in storage of the same SKU and lot** (a quality concern is about the lot) |
| Cold-room alarm (§12.12) | Every plate stored in that room whose product's `temp_max` is **below the alarm reading** — the product the excursion actually took over its own limit. Dry-room stock (no limit) is never held |
| A planned damage or temperature exception at receiving (§12.8) | Its cases already come off the trailer onto their own plate bound for hold; that plate is recorded on the issue. So is a receiving-damage plate (§12.13) |

Plates on hold, on a trailer or gone are never moved. A hold is a `hold` movement in the ledger, with
the issue (`ISSUE-‹id›`) as its reference and the person (or `system`) as its actor. Any pick or
replenishment counting on a held plate is cancelled and its line allocated again from pickable stock
(first-expiring first; held stock is never pickable), and a staged pick that is held is taken off the
load. The plates held are recorded on the issue (`held_pallets`). A person's report is on record
before the hold is asked for; if the WMS is offline at that moment nothing is held and Quality can
apply the hold later.

**Disposition** — `PUT /api/issues/{id}/disposition`, **Quality only** (supervisors read it):
`hold` (apply the hold again, e.g. after an outage), `release` (each held plate to the nearest free
reserve slot for its SKU: a `release` movement), `destroy` or `return_to_vendor` (out of the building:
an `adjust`). Notes are required. Release, destroy and return are **final** (409 afterwards). Who and
when are stored (`disposition_by`, `disposition_at`) and shown on the issue. The disposition does not
change the issue's status: the supervisor still decides the issue.

**Dock lifecycle** (`dock_doors.lifecycle_phase`):

```
idle ──▶ inspection ──▶ loading | unloading ──▶ complete
```

Dock `status` and `lifecycle_phase` change only through `domain/dock.py` → `transition()`; the
status follows everything open on the door (§7.7).

### 7.4 Decision targets: when an open issue is overdue

`domain/lifecycle.py` → `DECISION_TARGET_MINUTES`, `is_overdue`; served by `GET /api/taxonomy` as
`decision_targets` so the queue flags lateness without keeping its own copy.

| Severity | Target (minutes) | Why this number |
|---|---|---|
| critical | **15** | Product or people at risk now. The cold-chain procedure re-probes in 10 minutes (§4.2); a supervisor has that window plus the walk to the door. A room alarm is itself 15 minutes over its limit (§1.10) |
| high | **60** | Within the hour: a trailer at the door past 30 minutes already scores higher (§1.4), and a second half-hour is the most a reefer should wait with its doors worked |
| medium | **240** | Half of the 8-hour shift (§12.1) |
| low | **480** | The same shift: nothing low is handed to the next supervisor undecided |

The clock runs from the moment the issue reached the queue — `escalated_at`, else `created_at` —
to a supervisor's decision. An acknowledgement ("on my way") does **not** stop it: being on the way is
not a decision. A pending decision (`on_hold`, §7.2) does: the wait is then on the carrier or the
re-inspection, shown as its `pending_action`. Resolved issues are never overdue. The queue shows
*Overdue* as a word with an icon, never by colour alone.

**Dock open-issue count.** `GET /api/docks` carries `open_issues` per door — a count across every
team — so a supervisor looking at another zone's door learns that it has open issues and that that
zone's supervisor handles them, without the records leaving their team's scope.

### 7.5 Self-resolve: the worker closes their own issue

`PUT /api/issues/{id}/self-resolve`; `domain/lifecycle.py` → `can_self_resolve`,
`self_resolve_needs_note`, `why_not_self_resolve`. Escalating is asking for help, not giving the issue
away: a worker who then fixes it closes it, as long as it is not a decision that is the supervisor's.

| The worker's own issue | May they close it? | Answer otherwise |
|---|---|---|
| `resolution_in_progress`, not critical | **Yes**; the note is optional | — |
| `escalated`, not critical — whether or not a supervisor said "on my way" | **Yes, with a note** saying what they did | **422** without a non-blank `resolution_notes` |
| **critical** (any status) | No — always the supervisor's decision (§7.1) | **409** |
| `on_hold` | No — a supervisor's decision is pending on it (§7.2) | **409** |
| already resolved | No — resolved is terminal | **409** |
| someone else's issue | No — out of scope | **404** — its existence is not disclosed (`api/access.py`) |

The resolution must be one of the taxonomy's `operator_resolutions` **that fits the issue type**
(§7.6; **422** otherwise, naming the ones that fit). The note is
stored trimmed. The issue becomes `self_resolved` and the dock goes back to `active` through
`transition()`. After the commit, `issue_resolved` (`method` = `self_resolved`) goes to the reporter,
their supervisor, the supervisor who acknowledged it (if any) and — for a quality-relevant issue —
Quality: a supervisor on the way learns the trip is off.

Every issue response carries `can_self_resolve` and `self_resolve_needs_note` (and so does the
filing response), so the screens offer *Resolve it yourself* — inline on *My issues*, on the issue,
and on the report's result — from the rule itself, never a copy of it. The assistant follows the same
rule: `my_open_issues` marks an escalated issue `note_required`, and `draft_self_resolve` drafts it
with the note left for the worker to write on the card.

### 7.6 Resolutions that fit the issue type

`domain/taxonomy.py` → `RESOLUTIONS_BY_TYPE`, `allowed_resolutions()`; served per type as
`issue_types[].resolutions` by `GET /api/taxonomy`, enforced by `PUT /self-resolve` (**422** for one
that does not fit). A worker closing a forklift fault is never offered *Temp Re-check OK*, and a
temperature deviation is never closed as *Equipment Swapped*. Listed in `operator_resolutions` order;
**Other** is always offered (with the note for the record). Pinned by
`test_resolutions_by_issue_type_are_pinned`.

| Issue type | Resolutions offered |
|---|---|
| Temperature Deviation | Full Reject · Temp Re-check OK · Product Segregated · Other |
| Product Quality Concern | Partial Accept · Full Reject · Product Segregated · Other |
| Damaged Pallet | Partial Accept · Full Reject · Product Segregated · Corrected and Continued · Other |
| SKU Mismatch | Full Reject · Product Segregated · Corrected and Continued · Other |
| Count Discrepancy | Partial Accept · Full Reject · Corrected and Continued · Other |
| Lot/Expiry Issue | Partial Accept · Full Reject · Product Segregated · Corrected and Continued · Other |
| Seal/Trailer Condition | Full Reject · Corrected and Continued · Other |
| Safety Incident | Corrected and Continued · Other |
| Equipment Failure | Equipment Swapped · Corrected and Continued · Other |
| WMS/System Issue | Manual Entry · Corrected and Continued · Other |
| Barcode Issue | Manual Entry · Corrected and Continued · Other |
| Paperwork Mismatch | Manual Entry · Corrected and Continued · Other |

The simulated crew's resolutions (§12.3, `wms/engine.py` → `SELF_RESOLUTION`, and the outage's
*Manual Entry*) and the seeded history use the same map; a test holds the simulator to it. The
assistant's `draft_self_resolve` drops a resolution that does not fit, and the worker picks on the card.

### 7.7 The door shows everything still open on it

`domain/dock.py` → `door_status()`, `worst_severity()`, `transition(…, open_severity=, rejected=)`;
the facts come from `queries.door_issues` through `services/dock_status.apply_issue_event`. Every
issue event — reported, escalated, resolved (either path), Full Reject, and the simulator's reset —
recomputes the door's `status` from the door's open issues **after** the event:

| What is open on the door | `status` |
|---|---|
| any open issue is **critical** | `critical` |
| any open issue (low · medium · high), or the door's current load was **fully rejected** | `issue` |
| nothing open, a trailer being worked (`inspection`, `loading`, `unloading`) | `active` |
| nothing open, no trailer being worked (`idle`, `complete`) | `idle` |

Severity order for "worst": low < medium < high < critical (`SEVERITY_RANK`). A reported or escalated
issue is itself open, so its door is at least `issue`. The simulator's reset (§12.5) deletes the
simulated issues and then recomputes every door: a person's report outlives the reset and keeps its
door flagged. Before 2026-09-26 the status followed the last event alone — a later, lesser report
downgraded a critical door, and resolving one issue set the door `active` while another was open.
Pinned by `test_the_door_status_is_the_worst_open_severity` and the tests around it.

---

## 8. The full operator issue taxonomy (target coverage)

**Source:** `DocumentsforProj/list of issues operators faces.docx`

This is the authoritative list of situations where an operator cannot proceed alone. Since Phase 2
it is implemented in full as **12 issue types with 87 subtypes** (`domain/taxonomy.py`, served by
`GET /api/taxonomy`). The ~111 scenarios in the document overlap between its "issues" and
"discrepancies" halves; merged, they are 87.

| Category | Reported as | Subtypes |
|---|---|---|
| Loading & Pallet | Damaged Pallet | 8 |
| Barcode & Label | Barcode Issue | 7 |
| Scanner & Handheld · Forklift · Dock equipment | Equipment Failure | 14 |
| Trailer & Dock | Seal/Trailer Condition | 8 |
| Documentation & Shipping | Paperwork Mismatch | 6 |
| **WMS / System** | **WMS/System Issue** *(new)* | 9 |
| **Safety** | **Safety Incident** *(new)* | 11 |
| Quantity | Count Discrepancy *(was Count Shortage)* — shortage, overage, partial, missing, extra, mixed-SKU | 7 |
| Product | Product Quality Concern · SKU Mismatch · Lot/Expiry Issue | 5 · 3 · 3 |
| Temperature | Temperature Deviation | 6 |

The **Quality** team is notified (and can see) every Temperature Deviation, Product Quality Concern
and Lot/Expiry Issue, plus any issue that scores critical.

**Reporting without an assignment.** A *people* or *systems* issue (Safety Incident, Equipment
Failure, WMS/System Issue, Barcode Issue, Paperwork Mismatch) may be reported with no order, and with
or without a dock. A *product* issue is about a load: a person's report names its order (**422**
otherwise); when it names no dock, the order's dock is used. Issues DockIQ files itself (receiving
discrepancies, the warehouse's alarms) are not bound by this.

### Discrepancies that require supervisor approval

Per the source document, an operator must stop and notify a supervisor for: barcode or label
mismatches; missing or extra pallets; inventory or quantity discrepancies; damaged product or
pallets; temperature deviations; incorrect trailer or shipping documentation; WMS or handheld
scanner issues; and unsafe loading conditions or trailer defects.

---

## 9. Photo evidence

`domain/evidence.py`. Photos are stored in the database (the free tiers have no object storage):

| Rule | Value |
|---|---|
| Maximum size | **600 kB** per photo — the client downscales to a ~1280 px JPEG first |
| Maximum count | **4** per issue |
| Accepted | JPEG, PNG, WebP — identified from the file's **bytes**; the declared type is ignored |
| Who may add | the reporting operator or their supervisor |

---

## 10. Trailer load plan

`domain/load_plan.py`, served by `GET /api/orders/{id}/load-plan`. A 53-ft trailer holds two
48×40 pallets across; the customer's `load_pattern` decides the rest.

| Floor pattern | Rows × 2 | Floor positions |
|---|---|---|
| straight — 48" side along the trailer | 13 | 26 |
| pinwheel — alternating, interlocked | 14 | 28 |
| turned — 40" side along the trailer | 15 | 30 |

1. **Pallets** = expected cases ÷ cases per pallet, the last one partial. Weight = cases × case weight
   + **50 lb** pallet tare.
2. **Sequence** (what goes in first, at the nose by the reefer unit):
   `heaviest_to_nose` · `by_category` (Frozen → Refrigerated → Produce → Dry) · `reverse_stop_order`
   (last delivery loaded first).
3. **Stacks** hold at most `max_height` pallets. With `heavy_bottom`, the heaviest pallets form the
   **floor layer across every stack** — not one heavy stack at the nose.
4. With `segregate_categories`, no stack mixes categories.
5. Exceeding the trailer's floor positions or the customer's `max_pallets` produces a **warning** on
   the plan; it is never silently truncated.

---

## 11. Receiving

`domain/receiving.py`.

### 11.1 Probe temperature check — `POST /api/orders/{id}/temperature-check`

The reading is judged against the **strictest `temp_max` of any product on the load**, in the same
bands as the severity temperature modifier (§1.4), so the guidance and the score always agree:

| Over the limit by | Status | Guidance — receiving (inbound) | Guidance — loading (outbound) |
|---|---|---|---|
| ≤ 0°F | ok | Proceed | Proceed |
| > 0°F | marginal | Monitor, re-probe before continuing | Monitor, re-probe before loading more |
| > 5°F | warning | Close the doors; re-probe the centre of a case in 10 minutes | Stop loading it; move it back into the cold; re-probe in 10 minutes |
| > 10°F | critical | **Do not unload. Close the doors. Do not sign the BOL.** Report it | **Do not load. Hold it at the dock, off the trailer, kept cold. Do not release the trailer.** Report it |

The bands are the same in both directions; only the words change (`GUIDANCE` in `domain/receiving.py`),
because the order's direction decides what "stop" means — an inbound load is not unloaded, an outbound
one is not loaded. The assistant's temperature tool uses the same guidance for the order it checks.

No temperature-controlled product on the load → `not_applicable`. *(Phase 2 — previously computed in
the browser from the first line only.)*

**Every reading is logged** (`temperature_checks`, the HACCP record: reading, limit, delta, status,
who, when), served oldest first by `GET /api/orders/{id}/temperature-checks`. A **critical** reading
files a *Temperature Deviation · Product temperature out of range* against the order, the strictest
product on the load, the reading and the limit — through `file_issue`, so the formula scores it — or,
if a critical probe on this order already filed one that is still open, joins it (the log entry
carries its `issue_id`). The deviation holds stock like any other (§7.3) and holds sign-off until it
is resolved (§11.3).

### 11.2 Count reconciliation on completion

When an **inbound** order is completed, each line whose received count deviates from expected by more
than the customer's `count_tolerance` is filed automatically as a **Count Discrepancy** issue —
subtype *Short count* or *Overage* — scored by the normal formula, in the same transaction as the
completion. Lines with `expected = 0` are skipped. *(Phase 2 — previously done in the browser, which
filed overages as "Count Shortage" with a negative quantity.)*

### 11.3 Receiving evidence before sign-off

`domain/receiving.py` → `receiving_gaps`, the checks in `domain/taxonomy.py` → `RECEIVING_CHECKS`
(served by `GET /api/taxonomy`). Answers are stored per order and check, with who and when
(`PUT` / `GET /api/orders/{id}/receiving-checks`, inbound orders only).

| Check | A "No" is reported as |
|---|---|
| Pallets intact? | Damaged Pallet · Damaged or broken pallet |
| Packaging sealed, not punctured? | Damaged Pallet · Damaged cartons or packaging |
| Labels readable and matching? | Barcode Issue · Barcode damaged or unreadable |
| Product matches the BOL? | SKU Mismatch · Paperwork does not match product |
| Lot and expiry verified? | Lot/Expiry Issue · Wrong lot or batch number |

An **inbound** order signs off only when every check is answered (yes or no — a "no" is evidence,
reported as its issue), at least **one probe reading** is logged if any product on the load has a
temperature limit, and no critical probe's Temperature Deviation is still open. Each gap is a
`completion_blockers` line (§7.1).

## 12. The shift simulation (Phase 3)

Everything below lives in `backend/app/wms/`: `clock.py`, `plan.py` (both pure) and `engine.py` (the
materialiser). The simulator stands behind the `WmsClient` boundary (architecture §4); nothing here
changes how an issue is scored. **Every simulated exception is filed through the same
`file_issue` → `classify_severity` path as a person's report.**

### 12.1 The clock

| Rule | Value |
|---|---|
| Shift length | 480 simulated minutes, shown as 06:00–14:00 |
| Speeds | 1×, 5×, 15× (default), 60× |
| Start state | paused at 06:00 of shift 1, seed 42 |
| End of shift | the clock stops at 13:59; *Next shift* is an explicit action |
| Definition | `minutes = anchor_minutes + (now − anchor_real) × speed` while running. Play, pause, speed, step and next-shift re-anchor; nothing increments a counter |

### 12.2 The plan: a pure function of (seed, shift)

| Rule | Value |
|---|---|
| Lanes | one per simulated crew member, from the top door of each zone (4 crew → doors 4, 8, 11, 12) |
| First arrival per lane | 4–45 min into the shift |
| Last arrival | at least 70 min before the shift ends |
| Load | 1–3 of the customer's products; 2–5 pallets each, less 0–8 cases on some lines |
| Inspection | 4–9 min |
| Work per pallet | senior 2.0 min · experienced 2.6 · new 3.4 (the crew member's `experience_level`) |
| Turn pacing | inspection + work at the *slowest* rate + a 12–30 min gap |
| Exception chance | 0.3 per trailer |
| Exception mix (weights) | damage 25 · temperature 15 (inbound cold loads only) · count 15 · SKU 10 · barcode 10 · equipment 10 · safety 8 · paperwork 7 |
| Temperature exceptions | +2.5, +7 or +14 °F over the product's limit |
| When it surfaces | 15–85% of the way through the work |
| Operator follow-up | 3–12 min later |
| WMS outage | one per shift, starting 90–390 min in, lasting 5–10 min |

### 12.3 Materialising the plan

- **Exactly once.** Each event has a key (`s0-d4-12:arrive`, `:work`, `:exc`, `:fu`, `:done`,
  `s0-outage0`, `s0-outage0-end`) recorded in `sim_events`; re-running the engine never repeats one.
- **Timed by simulated minutes, not by when the engine runs.** A trailer arrives at
  `max(planned arrival, minute its door came free, minute a crew member came free)`; departure is
  stamped at the computed finish. Stepping a shift in 5-minute or 30-minute steps produces the same
  floor.
- **Door choice.** The planned door if free, otherwise whichever door frees first. A person working a
  trailer holds their door.
- **Follow-up.** The crew member escalates if the issue scored **high or critical**, or its type has
  no dock-level resolution (Safety, Seal/Trailer Condition, …). Otherwise it is self-resolved with:
  Damaged Pallet → Product Segregated · Count Discrepancy → Partial Accept · Barcode Issue → Manual
  Entry · Equipment Failure → Equipment Swapped · Temperature Deviation → Temp Re-check OK · SKU
  Mismatch and Paperwork Mismatch → Corrected and Continued.
- **An escalated trailer waits at its door** until the supervisor decides. No trailer leaves before
  its follow-up.
- **WMS outage.** A crew member files *WMS/System Issue: WMS offline or not responding*; lookups
  answer 503; completions are stored with `wms_synced = false` and written back when the WMS returns,
  when the outage issue is self-resolved as *Manual Entry*.
- **Human takeover.** Anyone who counts, scans, inspects, reports on or completes a simulated trailer
  clears `sim_managed`, and the simulator stops driving it.
- **Crew only.** The simulator assigns trailers only to users with `simulated = true` (OP-009 to
  OP-012) and files reports only in their names. The demo accounts' own orders are never touched.

### 12.4 Scenarios on cue: `POST /api/sim/inject`

Only a simulated crew member's trailer is ever used; with none at a door the call answers 409.

| Scenario | Filed as | Target |
|---|---|---|
| `temperature_emergency` | Temperature Deviation, product 28 °F over its limit, 24 cases | the coldest inbound load at a door |
| `wrong_product` | SKU Mismatch: Wrong product staged, 12 cases | an outbound load |
| `damaged_pallet` | Damaged Pallet: Crushed or collapsed pallet, 8 cases | any |
| `injury` | Safety Incident: Employee injury (always critical, §1.8) | any |
| `wms_outage` | WMS offline for 8 simulated minutes | none |

A high or critical injected issue is escalated at once.

### 12.5 Marking

`simulated: true` on every order, issue and crew member the simulator creates; `SIM-` order numbers;
a *Sim* tag in the UI; the demo login list leaves out simulated crew. `POST /api/sim/reset` removes
all of it and rewinds to 06:00. **Reset is a supervisor's call** (Quality: 403), and it **never
deletes an issue a person filed**: a report on a simulated trailer is detached from the order
(`order_id` cleared) and keeps the order's number, trailer and BOL as they were when filed. The
trailer's probe log and receiving checks go with it.

*Known limitation:* the dwell modifier (§1.3) reads wall-clock time since the trailer arrived, so at
15× a simulated trailer's dwell counts slower than its simulated time.

### 12.6 Realism: punctuality, yard, reefers, stock and dock KPIs

All in `app/wms/plan.py`, pinned in `tests/test_simulation.py`.

| Rule | Value |
|---|---|
| Carrier punctuality profile, fixed per carrier for a seed's run | *reliable* 4 : *average* 4 : *late* 2 (weights) |
| Arrival against the appointment, triangular (earliest, most likely, latest) minutes | reliable (−15, −3, +15) · average (−10, +5, +40) · late (−5, +18, +75); never before the shift starts |
| On time | arrives no more than **15 min** after the appointment |
| Detention | on site (gate to departure, or to now) longer than **120 min** |
| Reefer set-point | **5 °F** under the strictest product limit on the load; none for a load with no limit |
| Yard spots | `Y-01` … `Y-40`, where a trailer waits while its door is busy |
| Storage rooms | Frozen `F`, Refrigerated `C`, Produce `P`, Dry `D`; location `{room}-{aisle}-B{bay}-{level}` (layout: §12.7) |
| Shelf life at receipt (days, uniform) | Frozen 120–365 · Refrigerated 6–21 · Produce 3–12 · Dry 90–540, from the shift's date (shift 1 = 2026-09-25, one day per shift) |
| Pick order | first-expiring first (FEFO): the pallet with the earliest best-before is listed first — and allocated first (§12.9) |

**Shift KPIs** (`shift_kpis`, on `GET /api/sim/status`): trailers arrived; on-time % of those;
average turn (gate to departure, trailers that have left); trailers on detention now; pallets per
hour (pallets on departed trailers ÷ elapsed shift hours, at least a quarter hour); door utilisation
(door-minutes occupied ÷ doors × elapsed minutes, capped at 100 %).

### 12.7 The warehouse: layout, licence plates and the stock ledger

`app/wms/layout.py` and `app/wms/warehouse.py` (pure); `app/wms/ledger.py` persists. Pinned in
`tests/test_warehouse.py`.

| Rule | Value |
|---|---|
| Racking per room | aisles **10–17**, bays **1–12**, levels **1–4**: 384 positions, of which level 1 (96) are pick positions and levels 2–4 (**288**) reserve slots |
| Pick face | one level-1 position per SKU: the room's SKUs in SKU order, across the aisles, then along them |
| Other locations | quality hold `{room}-HOLD` (on hand, not pickable) · overflow floor `{room}-OVF` (when the racking is full; pickable) · dock lane `DOCK-{door}` · staging lane `STAGE-{door}` · a loaded trailer (its trailer number) |
| Licence plate (LPN) | `00286` + seed (3 digits) + serial (7 digits); opening stock uses serials below **1,000,000**, receipts count up from it |
| Opening stock | **6–10** full pallets per SKU; the earliest-expiring on the pick face, the rest in the nearest free reserve slots. Recorded at the start of the first shift as a *receive* to `DOCK-00` and a *put-away* per pallet, by `system` |
| Movements | *receive* (nowhere → dock lane) · *put-away* · *replenish* (reserve → pick face) · *pick* (→ staging lane) · *load* (→ trailer) · *ship* (trailer → nowhere) · *adjust* · *hold* (→ `{room}-HOLD`) · *release* (hold → reserve slot), the last two for quality holds (§7.3); each with licence plate, SKU, lot, best-before, from, to, cases, simulated minute and actor (crew code, dock crew employee ID, a person, or `system`) |
| Invariant | on hand per licence plate per location **equals** the sum of its movements in minus out; a test asserts it |
| Exactly once | every movement, task, shipment and gate event has a unique key; the ledger keeps a watermark minute and applies events in (watermark, now] **in time order**, so one jump and many small steps write the same ledger (tested) |
| Warehouse → trailers | one way: the warehouse reads the trailers' timelines; nothing in it moves a trailer |

### 12.8 Inbound: ASN → gate → unload → receipt → put-away

| Rule | Value |
|---|---|
| Advance ship notice | **120 min** before the appointment (never before the shift starts), one line per SKU |
| Gate check-in | at the gate arrival: the shipper's seal number, a reefer reading of set-point **± 1.5 °F**, a yard spot, a *late* flag (> 15 min, §12.6) |
| Receipt | pallet *k* of *N* comes off at (*k*+1)/*N* of the unloading (the §12.2 work window, after inspection) onto the door's dock lane as a new licence plate; full pallets first, the last partial |
| Planned exceptions | a *short count* arrives short; a *damage* or *temperature* exception's cases are received at the moment it surfaces onto a separate licence plate bound for `{room}-HOLD` |
| Lot and best-before | one lot per SKU per trailer; best-before = the shift's date + the §12.6 shelf life |
| Put-away | a task to the free reserve slot nearest the SKU's pick face — same aisle first, then the nearest bay, lowest level — or the room's overflow; the slot is reserved while the task is queued |
| Receipt confirmation | when the trailer leaves: `RC-` + the order's number |

### 12.9 Outbound: wave → pick (FEFO) → stage → load → ship

| Rule | Value |
|---|---|
| Waves | released every **30 min** from the start of the shift; each carries the loads booked **60–90 min** after it (never before the shift starts); loads in a wave are allocated in appointment order |
| Allocation | first-expiring first over pickable stock not already promised to a task (the pick face before reserve on the same date); a whole licence plate is a *pallet pick*, part of one a *case pick*. Out of stock → the line is short-allocated, and shipped short |
| Pick | a task from the location to the booked door's staging lane |
| Replenishment | when a pick face's free cases fall below **25 %** of a full pallet, a task brings the first-expiring untouched reserve pallet of that SKU to it (one at a time per SKU) |
| Load | the dock crew loads staged pallets in the order they were staged: pallet *j* at (*j*+1)/*P* of the work window (*P* = the planned pallets), never before it is staged |
| Ship | when the trailer leaves: everything on it ships; the seal is recorded at gate check-out; ship confirmation `SC-` + the order's number, with cases shipped per line. Picks still queued are cancelled |
| No-show | at the next shift's start, a load whose trailer never reached a door is cancelled and its staged pallets are put away again |

### 12.10 The task queue and crew productivity

| Rule | Value |
|---|---|
| Crew (fictional) | WH-01 Ines Albescu (senior, reach truck) · WH-02 Kofi Mensah (experienced, reach truck) · WH-03 Rosa Delgado (experienced, pallet jack) · WH-04 Stellan Berg (new, pallet jack) |
| Assignment | a task goes to whoever can start it first (ties: the lower code); each crew member works their queue in order |
| Standard minutes | put-away **3.0** · pallet pick **2.5** · case pick **1.5 + 0.05 per case** · replenish **3.0** · cycle count **4.0** |
| Room factor | Freezer ×**1.3** · Cooler ×**1.1** · Produce ×**1.1** · Dry ×**1.0** |
| Crew factor | senior ×**0.85** · experienced ×**1.0** · new ×**1.2** |
| Statuses | *open* (queued) → *assigned* (started) → *done*, or *cancelled*; each with its simulated minute |
| Cycle count | every **30 min** of the shift, one occupied storage location chosen by the seed; the count is recorded on the task |
| Productivity (this shift) | tasks done ÷ elapsed hours, cases moved (not counted) ÷ elapsed hours, and % of the elapsed shift busy; for the dock crew, pallets received or loaded. At least a quarter hour |

### 12.11 The yard and the gate

Every trailer leaves three gate-log entries (`GET /api/wms/gate`), timed by the same simulated minutes
as the yard board:

| Entry | When | Records |
|---|---|---|
| Check-in | the gate arrival (§12.6 punctuality) | trailer, carrier, the yard spot it is given, the seal (inbound; an outbound trailer arrives empty), a reefer reading (§12.8), *late* if more than **15 min** after the appointment |
| Yard move | when it reaches a door (§12.3: the door and a crew member both free) | the spot it left, the door, minutes waited in the yard (0 when the door was free) |

The yard board (`GET /api/wms/appointments`) shows the door a trailer **actually** reached (or left
from) as `door` once it is at one — a trailer rerouted to whichever door freed first (§12.3) shows
that door — and the appointment's door as `booked_door`; until it reaches a door the two are the
same.
| Check-out | when it leaves | the seal (outbound), dwell from gate to gate, and *detention* when the dwell exceeds **120 min** (§12.6) |

### 12.12 Cold rooms

`app/wms/rooms.py` (pure). Each room is sampled every **5 min**; a reading is the set-point plus
uniform noise of **± 0.8 °F**, plus any excursion in progress.

| Room | Set-point | Alarm limit | Excursion chance per shift |
|---|---|---|---|
| Freezer `F` | −10 °F | 0 °F | 0.25 |
| Cooler `C` | 34 °F | 40 °F | 0.25 |
| Produce `P` | 38 °F | 45 °F | 0.20 |
| Dry `D` | 65 °F | 80 °F | 0 (monitored, never alarms) |

An excursion starts **60–400 min** into the shift, climbs over **10 min** to **3–9 °F above the
limit**, holds **10–40 min**, and recovers over 10 min; its cause is a door left open, an overrunning
defrost cycle, or a tripped compressor. When readings stay over the limit for **15 min** the alarm is
raised — **once per excursion** — and filed as a *Temperature Deviation* (*Freezer door left open too
long* for a door, otherwise *Cold chain compromised*) against the most temperature-sensitive product
stored in the room, with the reading and the room's limit, through the ordinary scoring path. At
the same simulated minute the room's exposed stock goes on quality hold (§7.3: every plate stored
there whose product's limit is below the reading); the issue records the room and the plates. It is
filed as **room-scoped** with 15 minutes over the limit, so it is always **critical** (§1.10) and
escalated when filed.

### 12.13 Organic exceptions

Drawn from the seed and the event's own key, so the same run always has the same problems.

| Exception | Chance | What happens | Filed as |
|---|---|---|---|
| Short pick | **0.02** per pick | 1–**6** cases fewer than the ledger (never the whole pick) are written off (*adjust*); the pick takes what is there; the line is allocated again | Count Discrepancy · Short count (expected, found) |
| Pallet not at location | **0.01** per pick or replenishment | the pallet is written off as missing, every task relying on it is cancelled and its line allocated again, and the location is queued for a recount | WMS/System Issue · WMS shows a different location |
| Receiving damage | **0.02** per pallet received | 1–**6** damaged cases (never the whole pallet) go onto a separate licence plate bound for quality hold | Damaged Pallet · Damaged cartons or packaging |
| Cycle-count variance | **0.05** per count | 1–**4** cases short on the first pallet at the location, adjusted and noted on the count | — |
| Late carrier | §12.6 punctuality | the *late* flag at check-in; the yard board shows minutes late | — |
| Room excursion | §12.12 | the alarm | Temperature Deviation |

A warehouse problem is filed by the simulated crew member of the zone it concerns (the booked door's
team; the first crew member for a room), names **no dock** (the warehouse never changes a door's
state), and is linked to the order when the trailer is already at a door. **8 min** later the crew
settles it by the §12.3 rule — escalated if it scored high or critical or its type has no dock-level
resolution, otherwise self-resolved with the suggested procedure. The on-cue scenarios (§12.4) are
unchanged.

---

## Change log

| Date | Change |
|---|---|
| 2026-09-26 | §7.7 the door's status follows everything open on it (worst open severity, a rejected load), on every issue event and after a simulator reset — the known "resolve sets the dock active" defect is fixed. |
| 2026-09-26 | §3.4 a procedure's suggested decision (12 procedures; advice only, never selected); §7.2 Full Reject and Override — Accept Anyway always need the supervisor's reason (422); §7.6 resolutions by issue type (422 on one that does not fit). Migration 0008 (also a cancelled quick request and a report's idempotency key). |
| 2026-09-25 | §7.5 self-resolve: the reporter may close an escalated issue that is not critical, with a note (422 without); never critical, on hold or resolved (409). Migration 0007 rewrites stored "3th"-style recurrence ordinals (§6). |
| 2026-09-25 | §11.1 probe guidance follows the order's direction: loading gets *do not load / hold at the dock*, never *do not unload*. |
| 2026-09-25 | §7.4 decision targets (critical 15 · high 60 · medium 240 · low 480 minutes), overdue flag in the queue; per-door `open_issues` count. |
| 2026-09-25 | Audit: §7 `on_hold`, who acknowledged vs who decided, the record as reported; §7.1 every filing path escalates a critical, migration 0006; §7.2 decisions take effect (reasons for accepting critical/temperature product, Full Reject blocks sign-off and flags the dock, pending decisions); §7.3 quality hold and disposition; §8 people and systems issues without an order; §11.1 the probe log and critical auto-filing; §11.3 receiving evidence before sign-off; §12.5 reset guard; §12.7 hold/release movements; §12.11 the yard's actual door; §12.12 the alarm holds exposed stock; §6 ordinals. |
| 2026-09-25 | §1.9–§1.11 proportional damage (share of cases) and scope floors (cold room, product far over its limit), with worked examples; §3.1–§3.3 direction-aware procedures, temperature bands (+2 band bonus), the pallet-wrap procedure; 6 knowledge-base rows (41 → 47); §12.12 room alarms are critical. |
| 2026-09-25 | Initial extraction from code and source documents. |
| 2026-09-25 | §12.11–§12.13: the gate log, cold-room temperatures and excursion alarms, organic warehouse exceptions (short pick, pallet not at location, receiving damage, count variance). |
| 2026-09-25 | §12.7–§12.10 the warehouse behind the WMS: layout, licence plates, the stock ledger, inbound, outbound waves and FEFO, the task queue, crew productivity. Opening stock 2–5 → 6–10 pallets per SKU, placed on pick faces and reserve slots. |
| 2026-09-25 | §12.6 simulator realism: carrier punctuality, on-time window, detention, reefer set-points, yard spots, storage rooms, shelf life, FEFO, shift KPIs. |
| 2026-09-25 | §7.1 guardrails: critical issues escalate on filing and cannot be self-resolved; sign-off waits on open critical issues and on a failed inspection a supervisor has not cleared. |
| 2026-09-25 | Phase 3: §12, the shift simulation: clock, plan, materialisation, scenarios, marking. |
| 2026-09-25 | Phase 2: Safety and WMS types, 87 subtypes, severity floors and people risk, zero-count and dwell fixes, company bonus reaches retrieval, load-aware inspection gate, persisted recurrence, lifecycle guard, photo evidence, load plans. |
