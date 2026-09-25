# DockIQ.AI — Product Specification

**Sources:** `DocumentsforProj/DockIQ_AI_Scenarios_Explained.pdf`,
`DockIQ_Features_Benefits_2Pager.pdf`, `DockIQ_Showcase_Overview.pptx`.

This is the product story — what DockIQ is for, told the way it is told to a business audience. For
the API surface see [functional-specs.md](../requirements/functional-specs.md); for the rules it
enforces see [business-rules.md](../architecture/business-rules.md).

---

## 1. The one-sentence version

> Three things combined into one tablet at the dock door: **a smart assistant** that tells an
> operator what to do, **a panic button with brains** that sends the right person the right
> information in one tap, and **a memory** that makes every issue and resolution searchable forever.

The source is explicit about the framing: *"The AI isn't replacing anyone. It's giving operators
confidence to handle routine issues themselves and giving supervisors the information to prioritize
what actually matters."*

## 2. The setting

A large cold-storage warehouse, **20 dock doors, 3 supervisors, 20 operators**. Each operator has a
tablet mounted on their forklift or at the dock door. *(The prototype seeds a smaller floor — 12
doors, 3 supervisors, 8 operators.)*

---

## 3. The five scenarios

These are the product's argument. Each is a before/after with a stated cost.

### Scenario 1 — "The Damaged Pallet"

Operator finds a crushed pallet of frozen chicken at Dock 12. **Without DockIQ:** he parks the
forklift, walks 400 feet, waits 8 minutes for a supervisor busy at another dock, walks back
together, and records the discrepancy on a paper form with no photos. The trailer sits open for 15
minutes — a cold-chain risk.

**With DockIQ:** he taps *Report Issue* on a pre-filled screen (dock, trailer, customer, product),
picks type and severity, and submits. The supervisor gets an instant notification with full context.
While waiting, he asks the assistant what to do and gets the Marlow Grocers receiving procedure with its
source citation, and starts separating cases.

> **20 minutes → 5 minutes.** Knowledge captured: a searchable digital record instead of a paper
> form in a filing cabinet.

### Scenario 2 — "The Temperature Emergency"

A 28°F reading on frozen seafood that must be ≤ 0°F. **Without:** a two-month-tenure operator isn't
sure of the cutoff, can't raise the supervisor by radio (he's in the freezer), and waits 12 minutes
while the product warms. Quality isn't told until end of shift.

**With:** entering the reading immediately flags CRITICAL. Three things happen at once — the
supervisor is alerted, **the Quality Manager is auto-notified**, and the operator sees *do not
unload, close the doors, do not sign the BOL*, cited to Cold Chain SOP 2.3. The system also notes
this is the third temperature issue from this carrier this month.

> **25 minutes → 5 minutes.** Food-safety risk minimised; Quality notified instantly.

⚠️ Two elements of this scenario are **not implemented**: there is no Quality Manager role, and the
carrier-trend detection is computed but never surfaced.

### Scenario 3 — "The Wrong Product"

Two near-identical milk SKUs. **Without:** 200 cases of the wrong product ship, and Crestline Markets files a
**$4,200 chargeback** two days later — the warehouse learns about it from the complaint.

**With:** the operator scans a case barcode, the system flags `SKU MISMATCH — DO NOT LOAD`, and the
right product is re-staged.

> **$4,200 saved on a single incident.**

⚠️ **Not implemented.** There is no barcode scanning anywhere in the system. This is the scenario
carrying the hardest dollar figure, and it is currently unsupported.

### Scenario 4 — "The New Employee"

A day-three operator loads for an unfamiliar customer with specific requirements — max 2 pallets
high, slip sheets between layers, labels facing out, heavy on the bottom. **Without:** the rules are
in a binder in the supervisor's office; he loads it the standard way, the customer rejects the load,
and re-delivery plus damage costs **$6,000+**.

**With:** the load plan appears on screen as a visual guide, and when he isn't sure where slip
sheets are kept, the assistant tells him.

> **$6,000 mistake prevented by real-time guidance.**

⚠️ **Partially implemented.** `LoadPatternVisual` exists but hardcodes `"Straight · 22 pallets"` and
ignores the customer's actual pattern.

### Scenario 5 — "The Supervisor's Perspective"

Three issues arrive within three minutes: a damaged pallet, a load-sequence question, and a critical
temperature deviation. **Without:** the supervisor handles them first-come-first-served based on who
physically reaches her — so **the critical food-safety issue is handled last, 32 minutes late**.

**With:** her tablet shows a queue sorted by severity. CRITICAL first, always. She goes to the
temperature issue at 8:03. By the time she reaches the other two, the operators have self-resolved
both using the assistant.

> **Critical handled first; two issues self-resolved without her.**

This scenario is the clearest statement of the product's core claim, and it **is** implemented.

---

## 4. Capability groups

From the features 2-pager.

### 4.1 Worker operations — *context at the point of work*

Assigned dock and order context (trailer, customer, carrier, BOL, products, expected quantities
stay visible) · trailer inspection workflow where seal, cleanliness, damage and temperature checks
gate completion · guided loading and unloading with counts, load patterns, SOP rules and discrepancy
handling · mobile-first quick requests for equipment, supplies or floor support.

> **Benefit:** less context switching, fewer incomplete handoffs.

### 4.2 Exception intelligence — *consistent response under pressure*

Transparent severity scoring, where issue type, product risk, customer tier, temperature delta and
count variance **explain** the priority · grounded SOP retrieval returning confidence and source
references · live-or-fallback AI, where optional live assistance enhances chat but deterministic
guidance preserves the core workflow · controlled resolution paths, where critical issues require
supervisor action and invalid transitions are rejected.

> **Benefit:** faster, safer decisions with explainable guidance.

### 4.3 Supervisor control — *priority and visibility*

Priority issue queue organised by severity, age, dock and estimated impact · realtime floor updates
over WebSocket · resolution and audit trail keeping supervisor actions, notes, source guidance and
timestamps searchable · analytics and shift handoff preserving context across shifts.

> **Benefit:** attention moves to the highest-risk work first.

---

## 5. The demonstrated control loop

The showcase deck reduces the product to one four-step loop, using the temperature case:

| Step | What happens |
|---|---|
| **1 · Detect** | A worker selects the measured product; 28°F is compared against a 0°F maximum and flagged critical |
| **2 · Guide** | Do not unload; close trailer doors; preserve context |
| **3 · Ground** | Cold Chain SOP 2.3 is returned with confidence, source and action steps |
| **4 · Escalate** | The unresolved issue enters the supervisor priority queue carrying dock, operator, product, carrier, cost context and notes |

Closing with **Resolution recorded** — validated state transitions update the issue, dock status,
searchable logs and analytics.

## 6. Operational benefits claimed

| | Claim |
|---|---|
| **Clarity** | Each role sees the next required action. Assignment context, completion gates and status feedback reduce ambiguity at the dock |
| **Risk control** | Unsafe completion paths are blocked — open critical issues, failed inspections, missing counts and invalid roles stop workflow completion |
| **Response** | Relevant guidance arrives *with* the issue. Severity reasoning and cited procedures travel from worker report to supervisor decision |
| **Continuity** | The operating record survives provider failure — deterministic fallback, persistent events, analytics and handoffs keep the demo usable |

## 7. Scope boundary

Stated explicitly by the source material, and binding:

> Controlled demo access · **synthetic operational data** · local persistence.
> **Production identity and hardware integrations are out of scope.**
> No production metrics or sensor integration is claimed.

This is not a limitation to be quietly engineered around — it is the honesty that makes the pitch
credible. See [business-requirements.md §4](../requirements/business-requirements.md).
