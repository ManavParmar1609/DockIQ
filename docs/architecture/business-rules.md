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

### 1.9 Change history

The Phase 1 code carried a truthiness test (`if count_expected and count_actual:`) that made a
**total non-delivery score lower than a 6% shortage**. Fixed in Phase 2; pinned by
`test_total_non_delivery_scores_shortage_modifier`.

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

---

## 4. Operational thresholds

Encoded across the 41 seeded entries in `backend/app/seed/data/knowledge_base.json` (27 original,
14 added in Phase 2 for Safety, WMS, count and trailer-restraint scenarios). The knowledge base is
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
report being filed, so the message read "the 3th" on what was really the 4th.)*

---

## 7. Issue lifecycle

**States** (`issues.status`):

```
resolution_in_progress ──┬──▶ self_resolved
                         ├──▶ escalated ──▶ supervisor_resolved
                         └──▶ supervisor_resolved   (a supervisor may close it directly)
```

Resolved states are terminal. Any other move is refused with **409 Conflict**
(`domain/lifecycle.py`). Only the reporting operator may self-resolve; only **that operator's
supervisor** may supervisor-resolve.

**Timestamp trail:** `created_at` → `escalated_at` → `acknowledged_at` → `resolved_at`.

### 7.1 Guardrails: critical work is a supervisor's decision

From the source documents: *"Critical issues require supervisor action"* and *"open critical issues,
failed inspections … stop workflow completion."* Rules in `domain/lifecycle.py`:

| Rule | Behaviour |
|---|---|
| Critical is escalated on filing | An issue scored **critical** is created `escalated` (with `escalated_at`), the dock goes `critical`, and the supervisor and Quality are alerted with `new_issue`. There is no window in which it waits on the operator |
| Critical cannot be self-resolved | `PUT /self-resolve` on a critical issue answers **409**; only the team supervisor resolves it |
| Sign-off waits on critical issues | `POST /orders/{id}/complete` answers **409** while any critical issue on the order is open |
| Sign-off waits on a failed inspection | If the order's most recent inspection failed, sign-off answers **409** until a supervisor resolves an issue on the order after that inspection, or a later inspection passes |

`GET /orders/{id}` returns `completion_blockers`, the plain-language reasons above, so the sign-off
screen explains itself instead of failing on tap. Count discrepancies filed *by* sign-off never block
it: they are recorded with the completion.

**Dock lifecycle** (`dock_doors.lifecycle_phase`):

```
idle ──▶ inspection ──▶ loading | unloading ──▶ complete
```

Dock `status` and `lifecycle_phase` change only through `domain/dock.py` → `transition()`.
⚠️ Resolving an issue still sets the dock back to `active` even if another issue is open on it.

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

| Over the limit by | Status | Guidance |
|---|---|---|
| ≤ 0°F | ok | Proceed |
| > 0°F | marginal | Monitor, re-probe before continuing |
| > 5°F | warning | Close the doors; re-probe the centre of a case in 10 minutes |
| > 10°F | critical | **Do not unload. Close the doors. Do not sign the BOL.** Report it |

No temperature-controlled product on the load → `not_applicable`. *(Phase 2 — previously computed in
the browser from the first line only.)*

### 11.2 Count reconciliation on completion

When an **inbound** order is completed, each line whose received count deviates from expected by more
than the customer's `count_tolerance` is filed automatically as a **Count Discrepancy** issue —
subtype *Short count* or *Overage* — scored by the normal formula, in the same transaction as the
completion. Lines with `expected = 0` are skipped. *(Phase 2 — previously done in the browser, which
filed overages as "Count Shortage" with a negative quantity.)*

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
all of it and rewinds to 06:00.

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
| Storage rooms | Frozen `F`, Refrigerated `C`, Produce `P`, Dry `D`; location `{room}-{aisle}-B{bay}-{level}` |
| Shelf life at receipt (days, uniform) | Frozen 120–365 · Refrigerated 6–21 · Produce 3–12 · Dry 90–540, from 2026-09-25 |
| Pick order | first-expiring first (FEFO): the pallet with the earliest best-before is listed first |

**Shift KPIs** (`shift_kpis`, on `GET /api/sim/status`): trailers arrived; on-time % of those;
average turn (gate to departure, trailers that have left); trailers on detention now; pallets per
hour (pallets on departed trailers ÷ elapsed shift hours, at least a quarter hour); door utilisation
(door-minutes occupied ÷ doors × elapsed minutes, capped at 100 %).

---

## Change log

| Date | Change |
|---|---|
| 2026-09-25 | Initial extraction from code and source documents. |
| 2026-09-25 | §12.6 simulator realism: carrier punctuality, on-time window, detention, reefer set-points, yard spots, storage rooms, shelf life, FEFO, shift KPIs. |
| 2026-09-25 | §7.1 guardrails: critical issues escalate on filing and cannot be self-resolved; sign-off waits on open critical issues and on a failed inspection a supervisor has not cleared. |
| 2026-09-25 | Phase 3: §12, the shift simulation: clock, plan, materialisation, scenarios, marking. |
| 2026-09-25 | Phase 2: Safety and WMS types, 87 subtypes, severity floors and people risk, zero-count and dwell fixes, company bonus reaches retrieval, load-aware inspection gate, persisted recurrence, lifecycle guard, photo evidence, load plans. |
