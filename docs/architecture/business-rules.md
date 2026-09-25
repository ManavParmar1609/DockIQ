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
| Movements | *receive* (nowhere → dock lane) · *put-away* · *replenish* (reserve → pick face) · *pick* (→ staging lane) · *load* (→ trailer) · *ship* (trailer → nowhere) · *adjust*; each with licence plate, SKU, lot, best-before, from, to, cases, simulated minute and actor (crew code, dock crew employee ID, or `system`) |
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
stored in the room, with the reading and the room's limit, through the ordinary scoring path.

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
| 2026-09-25 | Initial extraction from code and source documents. |
| 2026-09-25 | §12.11–§12.13: the gate log, cold-room temperatures and excursion alarms, organic warehouse exceptions (short pick, pallet not at location, receiving damage, count variance). |
| 2026-09-25 | §12.7–§12.10 the warehouse behind the WMS: layout, licence plates, the stock ledger, inbound, outbound waves and FEFO, the task queue, crew productivity. Opening stock 2–5 → 6–10 pallets per SKU, placed on pick faces and reserve slots. |
| 2026-09-25 | §12.6 simulator realism: carrier punctuality, on-time window, detention, reefer set-points, yard spots, storage rooms, shelf life, FEFO, shift KPIs. |
| 2026-09-25 | §7.1 guardrails: critical issues escalate on filing and cannot be self-resolved; sign-off waits on open critical issues and on a failed inspection a supervisor has not cleared. |
| 2026-09-25 | Phase 3: §12, the shift simulation: clock, plan, materialisation, scenarios, marking. |
| 2026-09-25 | Phase 2: Safety and WMS types, 87 subtypes, severity floors and people risk, zero-count and dwell fixes, company bonus reaches retrieval, load-aware inspection gate, persisted recurrence, lifecycle guard, photo evidence, load plans. |
