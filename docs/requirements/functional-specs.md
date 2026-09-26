# DockIQ.AI — Functional Specification

**Status:** Describes the system **as built**, verified against `backend/app/` (FastAPI routers in
`app/api/`) and `frontend/src/api.js` on 2026-09-25. The OpenAPI schema at `/docs` is generated from
explicit response models and is authoritative for field names and types.

This is the contract surface. Where the system does *not* yet do something the source documents
promise, it is recorded in §6 rather than omitted — that gap list is the input to
[roadmap.md](../roadmap.md).

---

## 1. Actors

| Actor | `users.role` | Scope |
|---|---|---|
| Operator ("Dock Worker") | `operator` | 8 seeded, each in one supervisor's team (`users.supervisor_id`). Sees and acts on **their own** orders, issues, requests and chat |
| Supervisor | `supervisor` | 3 seeded, one per zone (A/B/C = docks 1–4, 5–8, 9–12). Sees **their team's** issues, orders, requests and analytics; broadcasts to their team; writes handoffs for their zone |
| Quality Manager | `quality` | 1 seeded (`QA-001`). Facility-wide view of quality issues (temperature, product quality, lot/expiry, and anything critical); notified in real time. Decides the **disposition** of product held for an issue (hold, release, destroy, return to vendor); otherwise read-only |

The database says `operator`; the frontend's routes and labels say `worker`. That split is
deliberate and coordinated — see `.claude/rules/code-style.md`.

A record outside your scope is a **404**, not a 403, so its existence is not disclosed.

---

## 2. HTTP API

All routes are namespaced under `/api`. `frontend/src/api.js` is the single client-side gateway and
mirrors this list 1:1; no `fetch` call exists elsewhere in the frontend.

**Conventions (all routes):**

- Every response is an explicit Pydantic model — a column rename cannot leak a new field.
- Timestamps are ISO-8601 **UTC with an offset** (`2026-09-25T14:03:11.52+00:00`).
- A referenced id that does not exist (dock, operator, product, order, issue …) returns **404**, not
  a 500. Invalid enum values in query strings return **422**, and so does an id outside 1…2³¹−1 in
  a path, query or body (the range of a Postgres `INTEGER`).
- Free text a person types (`description`, notes, `details`) is at most **2000** characters;
  `quick_tags` is at most 10 tags of at most 32 characters. Longer is **422**.
- A validation error is **422** `{"detail": [{"loc", "msg", "type"}]}` — where and what, never the
  input echoed back. Numbers a person enters (temperatures, readings, counts, quantities) must be
  finite: `NaN` or `±Infinity` is **422**, never a 500 and never a stored value.
- Each request runs in one database transaction, committed once. WebSocket events are emitted only
  after the commit succeeds.

### 2.0 Meta and authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | Liveness + database round-trip. Used as the Render health check |
| POST | `/api/auth/login` | public, rate-limited | OAuth2 password form: `username` = employee ID, `password`. Returns a bearer token (12 h — one shift) and the user |
| GET | `/api/auth/me` | token | The signed-in user, with their supervisor's name |
| GET | `/api/auth/demo-accounts` | public | Names, IDs and roles of the seeded accounts for the demo login screen. **Never passwords.** Disabled by `DEMO_ACCOUNTS_LISTED=false` |
| GET | `/api/taxonomy` | token | Every closed list: 12 issue types with subtypes, weights, icons and severity floors; operator resolutions; supervisor decisions, with `accept_decisions` (need notes on a critical or temperature issue) and `pending_decisions` (put the issue `on_hold`); `decision_targets` (minutes an open issue may wait for its decision, by severity — business-rules §7.4); `pending_actions` (what each pending decision waits on) and `cold_chain_issue_types` (accepting product on these needs notes, as on a critical); request types; `receiving_checks` (`id`, `question`, and the `issue_type` / `issue_subtype` a "No" is reported as). **The frontend keeps no copies** |

Every other route requires `Authorization: Bearer <token>`. **Actor identity always comes from the
token** — no request body carries `operator_id`, `supervisor_id` or `user_id`.

### 2.1 Reference data

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users` | Your team (supervisor), yourself and your supervisor (operator), or everyone (quality). Optional `?role=` |
| GET | `/api/users/{user_id}` | Single user |
| GET | `/api/companies` | List customers with `tier`, `count_tolerance`, `load_pattern`, `sop_rules` |
| GET | `/api/companies/{company_id}` | Single customer |
| GET | `/api/products` | Products. Optional `?company_id=` |
| GET | `/api/carriers` | List carriers |

### 2.2 Docks

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/docks` | All 12 doors, joined with current operator, order and customer, and the order's `cases_done` / `cases_expected` (null with no order), and `open_issues` — a count of the door's open issues across every team (records stay team-scoped; business-rules §7.4) |
| GET | `/api/docks/{dock_id}` | Single door with the same joins |

### 2.3 Orders

| Method | Path | Who | Purpose | Mutates |
|---|---|---|---|---|
| GET | `/api/orders` | scoped | Optional `?status=` and `?operator_id=` | — |
| GET | `/api/orders/{id}` | scoped | Order including its `order_items` (with GTINs), `completion_blockers`, `load_step` (the load guide's current pallet, or null) and `inspection` (the latest trailer inspection — `overall_pass`, `failed_checks`, `temperature_limit`, `interior_temperature`, `created_at` — or null before one) | — |
| GET | `/api/orders/{id}/load-plan` | scoped | Where every pallet goes, by the customer's rules — see business-rules §10 | — |
| PUT | `/api/orders/{id}/load-step` | assigned operator | `{step, count?}` — where the operator is in the load guide (1 … pallets + 1), kept on the server. With `count: true`, a step on by one adds the pallet just loaded to its order line (capped at expected), a step back by one takes it off (not below 0); any other jump with `count` is **422**. Outbound only (**422** inbound). Returns `{order_id, load_step, counted}` (`counted`: the order line, when counted) | `orders.load_step`, `order_items` |
| POST | `/api/orders/{id}/temperature-check` | assigned operator | `{reading}` → status, limit, delta, guidance, and `id` (the log entry), `issue_id`, `created_at`. **Logged** (HACCP). A critical reading files a Temperature Deviation through the scoring path — or joins the open one a critical probe already filed — and blocks sign-off until it is resolved (business-rules §11.1) | `temperature_checks`, `issues`; emits `new_issue` when it files one |
| GET | `/api/orders/{id}/temperature-checks` | scoped | The order's probe log, oldest first: reading, limit, delta, status, `issue_id`, `operator_name`, `created_at` | — |
| GET | `/api/orders/{id}/receiving-checks` | scoped | Each receiving check with its `answer` (true, false, or null), who and when; `all_answered`, `probes`, `needs_probe` | — |
| PUT | `/api/orders/{id}/receiving-checks` | assigned operator | `{answers: {check_id: bool}}` — records answers (others keep theirs). Unknown id or empty **422**; outbound order **422**. Returns the same as `GET` (business-rules §11.3) | `receiving_checks` |
| POST | `/api/orders/{id}/scan` | assigned operator | `{code}` — GTIN-14/13, UPC-A, or SKU. Returns `match` (case counted), `mismatch` (a real product **not on this order — do not load**), or `unknown`. Every scan is logged in `scan_events` | `order_items`, `scan_events` |
| PUT | `/api/orders/{id}/items` | assigned operator | Record `actual_quantity` for a line | `order_items` |
| POST | `/api/orders/{id}/complete` | assigned operator | Sign off, capture seal number. **409** while a critical issue is open, a failed inspection is uncleared, the load was rejected, a requested re-inspection has not passed, or — inbound — a receiving check is unanswered, no probe is logged on a temperature-controlled load, or a critical probe's deviation is open (business-rules §7.1, §11.3; `GET` returns `completion_blockers`). Inbound: lines outside tolerance are filed as Count Discrepancy issues (returned as `discrepancy_issue_ids`) — without a dock if the order was never given one. A complete order is closed to further counting (403) | `orders`, `issues`, dock → `idle`/`complete`; emits `new_issue` per discrepancy and `order_complete` |

### 2.4 Issues — the core entity

| Method | Path | Who | Purpose | Mutates |
|---|---|---|---|---|
| GET | `/api/issues` | scoped | Filters: `status` (or `active`; `on_hold` is open), `operator_id`, `severity`, `dock` (a door number), `carrier_id`, `from` / `to` (UTC days, inclusive; `from` after `to` **422**), `limit` | — |
| GET | `/api/issues/export.csv` | scoped | The same list, the same filters and scope, as CSV (`text/csv`, an attachment), newest first; `limit` 1–5000 (default 1000). Text a spreadsheet would run as a formula is prefixed with `'` | — |
| GET | `/api/issues/{id}` | scoped | Full issue with joined context, `issue_subtype`, `recurring_patterns`, `photo_count` — and the record as reported: `order_number`, `trailer_number`, `bol_number` (as when filed), `temp_reading`, `temp_limit`, `quantity_affected`, `lot`, `room`; `acknowledged_by(_name)`; `on_hold_at`, `pending_action`; `sim_minute`, `sim_time`, `sim_shift` (simulated issues); `held_pallets`, `disposition`, `disposition_notes`, `disposition_by(_name)`, `disposition_at`; `can_self_resolve` and `self_resolve_needs_note` (business-rules §7.5; also on the filing response). Printable as is | — |
| POST | `/api/issues` | operator | **Create and classify** — see below. `issue_type` and `issue_subtype` must come from the taxonomy (422). A **product** issue names an order (**422** without); a people or systems issue may name neither order nor dock. An `order_id` must be one of the caller's orders (**404** otherwise) and at `dock_door_id` (**422** otherwise; omitted → the order's dock); naming a simulated order takes it over from the simulator. A Temperature Deviation or Product Quality Concern on an order with WMS stock puts that stock on quality hold (business-rules §7.3), recorded in `held_pallets` | `issues`, dock → `issue`, WMS hold; emits `new_issue` |
| PUT | `/api/issues/{id}/self-resolve` | the reporter | Business-rules §7.5. `resolution_type` must be an operator resolution (422). Allowed on the reporter's own open issue that is not critical, `resolution_in_progress` or `escalated` (acknowledged or not); on an **escalated** one `resolution_notes` is required (**422** when blank). Critical, `on_hold` and resolved answer **409**; another worker's issue **404** | `status='self_resolved'`, `resolution_notes` (trimmed), dock → `active`; emits `issue_resolved` to the reporter, their supervisor, whoever acknowledged it, and Quality if quality-relevant |
| PUT | `/api/issues/{id}/acknowledge` | the team supervisor | "On my way": stamps `acknowledged_at` and `acknowledged_by` (the first to acknowledge; `supervisor_id` is left for whoever decides). 409 once resolved | emits `issue_acknowledged` (who is coming, to which door) |
| PUT | `/api/issues/{id}/escalate` | the reporter or their supervisor | Hand to the supervisor. No body. Critical issues arrive already escalated (business-rules §7.1) | `status='escalated'`; dock → `critical` if severity is critical; emits `issue_escalated` |
| PUT | `/api/issues/{id}/supervisor-resolve` | the reporter's supervisor | `resolution_type` must be a supervisor decision (422). Accept, Partial Accept and Override on a critical or temperature issue need `supervisor_notes` (**422** without). Contact Carrier and Request Re-inspection → `on_hold` (open). Full Reject blocks the order's sign-off and flags the dock (business-rules §7.2). Returns the new status | `status='supervisor_resolved'` or `'on_hold'`; dock → `active` (or `issue` on Full Reject; unchanged on hold); emits `issue_resolved` (`method` = the new status) |
| PUT | `/api/issues/{id}/disposition` | **Quality** (supervisors 403: they read it) | `{disposition: hold \| release \| destroy \| return_to_vendor, notes}` (notes required, **422**). Hold applies the hold again; release returns held plates to storage; destroy / return take them out through ledger adjustments. Release, destroy and return are final (**409** after). **503** if the WMS is offline and stock would move. Returns the issue | `issues.disposition*`, `held_pallets`; the WMS ledger |
| POST | `/api/issues/{id}/photos` | reporter or their supervisor | Multipart `file`. ≤ 600 kB, ≤ 4 per issue, JPEG/PNG/WebP by content | `issue_photos` |
| GET | `/api/issues/{id}/photos` | scoped | Photo metadata (the image bytes are never read; `GET /api/photos/{id}` serves one) | — |
| GET | `/api/photos/{id}` | scoped | The image bytes (`Cache-Control: private`) | — |

An illegal status move (e.g. escalating a resolved issue) is **409 Conflict**.

**`POST /api/issues`** (`app/api/issues.py` → `create_issue`) is the richest handler. In one inline sequence it:
looks up product, company and the dock's trailer dwell → calls `classify_severity()` → runs `find_resolution()` KB
retrieval → calls `estimate_cost_impact()` → counts recent issues for the dock and carrier
(`count_recent_issues()`, decided by `dock_pattern()`/`carrier_pattern()`) → inserts the issue →
flips the dock to `status='issue'` → commits → broadcasts `new_issue` over the WebSocket.

The recurrence patterns are returned **and stored on the issue**.

### 2.5 Inspections

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/inspections` | Trailer pre-check (operator). Sets `dock_doors.lifecycle_phase='inspection'`. Returns `overall_pass`, the `temperature_limit` used and each `failed_checks` entry |

Pass requires **all** of: seal `intact`, cleanliness `clean`, damage `none`, and — if a temperature
was entered — at or below **the strictest product limit on the load** (45°F only when the load has no
temperature-controlled product). See [business-rules.md §4.6](../architecture/business-rules.md).

### 2.6 The assistant

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat/stream` | Ask the assistant; the agent's work streams back as server-sent events (below). 12 messages/minute per user |
| POST | `/api/chat` | The same agent, collected into one `ChatReply` (`response`, `source`, `steps`, `cards`, `actions`) |
| GET | `/api/chat/history` | Your most recent 100 messages, oldest first (text only) |

**An agent over your own data** (`app/services/agent.py`, tools in `agent_tools.py`). The model picks
tools; tools read only what the person's own screens could show (the same row scope as the API) and
take every number from a deterministic rule. At most 5 tool rounds per question; a tool error goes
back to the model so it can correct itself. An unexpected failure inside a tool is logged (never its
arguments), rolled back, and reported as a failed step; the conversation continues.

| Tool | Who | Does |
|---|---|---|
| `my_work` | all | Operator: active order with line counts and customer rules, own open issues. Staff: escalated and in-progress issues |
| `find_procedure` | all | Knowledge-base procedure with steps, source and confidence, for the order's direction (loading or receiving). A temperature problem with a reading gets its band's procedure; without one, the marginal and the critical procedure, each labelled with when it applies. A weak match carries a note (business-rules §3–§3.3) |
| `check_temperature` | all | The probe rule against the strictest limit on the order (§11.1) |
| `locate_stock` | all | Pallet locations through `WmsClient`; says so when the WMS is offline |
| `look_up` | all | One order, issue or product, row-scoped |
| `draft_issue_report` | operator | A report for the active order with the formula's severity preview, built by the same `score_issue()` as filing; cases affected only when the person said so. **Not filed** |
| `my_open_issues` | operator | The operator's own open issues, each with `can_self_resolve` and why not (critical or on hold: the supervisor decides), `note_required` on an escalated one, and the resolution options (`operator_resolutions`) |
| `draft_self_resolve` | operator | Closing one of the operator's own issues: `self_resolve` action with the resolution (or none: the worker picks it on the card). An escalated issue is drafted with `note_required`: the worker writes the note on the card (the rules router never fills it in). For a critical or on-hold issue: why not, and **nothing to confirm**. **Not resolved** until the worker presses *Resolve issue #N*, which calls `PUT /api/issues/{id}/self-resolve` |
| `shift_summary` | staff | Last 12 hours of issues: severity, status, types, carriers, still escalated |
| `draft_broadcast` | supervisor | A team message. **Not sent** |
| `draft_handoff` | supervisor | A handoff note, opened pre-filled on the Handoff screen. **Not saved** |
| `room_status` | staff | Cold rooms through `WmsClient`: temperature, set-point, limit, over limit, alarm, cases on quality hold; one room or all |
| `trace_lot` | staff | A SKU (and optionally a lot) through `WmsClient`: pallets on hand and where, latest receipts, shipments and adjustments with their orders — at most 8 of each |

**Stream events** (one JSON object per `data:` line): `step` (`running` / `done` / `failed`, with a
one-line summary), `card` (`order`, `temperature`, `stock`, `procedure`, `issues`, `rooms`, `trace`:
the tool's own figures, rendered as data), `action` (`file_issue`, `send_broadcast`, `handoff_note`,
`self_resolve`: drafts with a confirm button that calls the ordinary endpoint), `delta` (answer
text), `source`, `done` (`message_id`), or `error`.

**The system prompt** tells the model to give `find_procedure`'s steps **word for word**, never adding,
merging, rewording or generalising a step, and to say so when a match is weak. It changes with the
person: an operator is sent to their supervisor for anything beyond the procedure; a supervisor is
never told to confirm with or wait for a supervisor (the decision is theirs); Quality is spoken to
about holds, disposition, traceability and the record — never told to stand by.

**Guarantees.** The assistant cannot file, send or change anything. Severity, cost and acceptance
stay deterministic: a draft's severity is a preview from `classify_severity`, recomputed when the
person files it. Model: `NVIDIA_MODEL` (default `nvidia/nemotron-3-ultra-550b-a55b`) through
NVIDIA's OpenAI-compatible endpoint, temperature 0.3; `NVIDIA_THINKING=true` turns on the model's
reasoning mode, which is never shown. **Without a key, or if the model fails before answering, a
rules-based router drives the same tools** (temperatures, SKUs, issue and order numbers, "what's
next", shift summaries; for an operator "resolve my issue", "close issue 12", "I fixed it" →
`my_open_issues`, then a `draft_self_resolve` for the named issue or the only one they may close; for
staff "freezer", "cooler", "room temp" → `room_status`, "trace … <SKU> lot …" → `trace_lot`, "open
quality issues" → `my_work`) and falls back to the knowledge-base keyword answer.

### 2.7 Floor operations

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/requests` | scoped | Quick requests. Optional `?status=` |
| GET | `/api/requests/mine` | any | The requests you made, newest first, with status. Optional `?status=` |
| POST | `/api/requests` | operator | `request_type` from the taxonomy; emits `new_request` (`status: pending`) to the operator and supervisor |
| PUT | `/api/requests/{id}/fulfill` | the requester's supervisor | Mark fulfilled. **409** if already fulfilled (the first `fulfilled_at` stands). Emits `new_request` with `status: fulfilled` to the operator who asked and the supervisor |
| GET | `/api/broadcasts` | any | Operators see their supervisor's; supervisors their own; quality all |
| POST | `/api/broadcasts` | supervisor | Announcement to **their team**; emits `broadcast` |
| GET | `/api/shift-handoffs` | any | Handoffs for your zone (quality: all), with the read receipt (`read_by`, `read_by_name`, `read_at`) |
| GET | `/api/shift-handoffs/draft` | supervisor | A pre-filled handoff for their team and zone: `open_criticals`, `decisions` made in the last 12 h (final, or `on_hold`), `trailers` in the yard, at a door or due (zone doors, through `WmsClient`), `room_alarms` (rooms in alarm or over their limit), `pending_requests`, `wms_online`, and the same as `notes` text. Saves nothing |
| POST | `/api/shift-handoffs` | supervisor | End-of-shift notes for their zone |
| PUT | `/api/shift-handoffs/{id}/read` | supervisor of the zone | The incoming supervisor opened it: records `read_by` / `read_at` (the first reader stands). Another zone's **404**; your own **409**. Returns the handoff |

### 2.8 Analytics

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/analytics/summary` | The issues you can open — supervisor: their team; Quality: quality issues and every critical issue — named in `scope` (`team` \| `quality`). Operators: 403. Optional `from` / `to` (UTC days) bound everything, trend and repeats included. Totals, open-now counts (open, open critical, cost at risk, cold-chain breaks), breakdowns by type (with cost), severity (open + average resolution), type × severity, door (open), operator, customer, carrier, the 30-day trend, and repeats (same type at one door / from one carrier, more than once in 30 days) |

Returns: totals, self-resolution rate, cost impact, average resolution minutes, and breakdowns by
type, severity, dock, operator, company and carrier, plus a 30-day time series.

Every foreign-key column is indexed, as are `issues.created_at`, `status`, `severity` and
`issue_type`. The elapsed-minutes average compiles to portable SQL for both SQLite and Postgres
(`app/queries.py` → `minutes_between`).

### 2.9 Simulation and WMS *(Phase 3)*

The WMS as the app sees it, through `WmsClient` only. `WMS_MODE=simulated` (default) serves the live
simulator; `WMS_MODE=none` answers every lookup 503 and hides the simulator (404).

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/wms/status` | everyone | `{mode, online, message}`; drives the shell's *WMS offline* banner |
| GET | `/api/wms/appointments` | staff | Yard board: scheduled (next 90 min), in yard, at door, recently left — each with booked and gate-arrival times, minutes late, reefer set-point, yard spot, dwell and a detention flag; `door` is the door it actually reached (or left from) and `booked_door` the appointment's. 503 when offline |
| GET | `/api/wms/inventory?sku=` | everyone | Pickable pallets of a SKU (racking and overflow, from the stock ledger) with lot and best-before, first-expiring first (*Where is it stored* on an outbound line; the first is marked *Pick first*). 503 when offline |
| GET | `/api/wms/pallets/{id}` | everyone | One pallet by licence plate — its storage location if it has one, else wherever it is (dock lane, staging lane, trailer). 404 unknown, 503 offline |
| GET | `/api/wms/stock?room=&sku=&limit=` | everyone | On hand by licence plate and location in every area (storage, hold, dock, stage, trailer), first-expiring first. `room` ∈ F, C, P, D; `limit` 1–500 (default 200). 422 out of range, 503 offline |
| GET | `/api/wms/tasks?status=&kind=&limit=` | staff | The task queue (put-away, pick, replenish, cycle count), newest first: crew member, queued/started/finished times, standard minutes, the order it serves, count results. `limit` 1–200 (default 60). 422 unknown status/kind, 503 offline |
| GET | `/api/wms/productivity` | staff | This shift so far per crew member: tasks (or dock pallet moves) done, cases, tasks/hour, cases/hour, % busy (warehouse crew). 503 offline |
| GET | `/api/wms/transactions?limit=&before_id=&sku=&pallet_id=` | staff | The movement ledger, newest first — kind, licence plate, SKU, lot, best-before, from → to, cases, who, the order. Page back with `before_id`. `limit` 1–200 (default 50). 422 out of range, 503 offline |
| GET | `/api/wms/shipments?direction=&limit=` | staff | Inbound ASNs and receipts; outbound loads from wave release to ship confirmation — status, wave, seal, confirmation, cases expected/allocated/received-or-shipped per line. `limit` 1–100 (default 40). 503 offline |
| GET | `/api/wms/shipments/{ref}` | staff | One shipment by appointment reference or order number. 404 unknown, 503 offline |
| GET | `/api/wms/gate?limit=` | staff | The gate log, newest first: check-in (seal, reefer reading, late flag, yard spot), the move from the yard to a door (wait), check-out (seal, dwell, detention). `limit` 1–200 (default 60). 422 out of range, 503 offline |
| GET | `/api/wms/rooms?readings=` | staff | The four temperature rooms: set-point, alarm limit, the latest `readings` samples (1–96, default 12), over-limit and alarm flags, racking positions, positions occupied, pallets, cases, cases on quality hold. 422 out of range, 503 offline |
| GET | `/api/sim/status` | staff | Clock, seed, speed, WMS state, trailer counts, the last 15 events |
| POST | `/api/sim/play`, `/pause`, `/next-shift` | staff | Clock control; each returns the new status |
| POST | `/api/sim/speed` `{speed}` | staff | 1, 5, 15 or 60 |
| POST | `/api/sim/step` `{minutes}` | staff | Jump the clock forward, up to 480 (stops at shift end) |
| POST | `/api/sim/reset` `{seed?}` | **supervisor** | Remove everything simulated; 06:00, paused. A person's report on a simulated trailer is kept, detached (business-rules §12.5) |
| POST | `/api/sim/inject` `{scenario}` | staff | A scenario on cue (business-rules §12.4). 409 with no simulated trailer to use |

`OrderOut` gains `simulated` and `wms_synced`; `IssueOut` and `UserOut` gain `simulated`. Completing
an order calls `WmsClient.confirm_order`; while the WMS is down the completion is kept with
`wms_synced = false` and written back later.

---

## 3. Realtime — `WS /ws`

**Authenticated and addressed.** The client opens `new WebSocket(url, ["dockiq", <token>])`; a
missing or invalid token is refused with close code **1008**. A socket lives no longer than its
token: once the token's `exp` passes it is closed with **1008** — on the next event addressed to it,
or by a sweep every 30 seconds, whichever is first. The client's retry with the same token is refused
too, and its next API call answers 401, which signs the person out.
Each event goes only to the users it concerns:

| Event | Emitted by |
|---|---|
| `new_issue` | `POST /api/issues` → reporter, their supervisor, and Quality if quality-relevant |
| `issue_escalated` | `PUT /api/issues/{id}/escalate` → same audience |
| `issue_resolved` | self-resolve and supervisor-resolve → same audience; carries `resolution` so the operator sees the decision, and `method` = the new status: `self_resolved`, `supervisor_resolved`, or **`on_hold`** (a pending decision — the issue is still open) |
| `issue_acknowledged` | `PUT /api/issues/{id}/acknowledge` → same audience; the operator is told who is coming |
| `order_complete` | `POST /api/orders/{id}/complete` → operator and supervisor |
| `new_request` | `POST /api/requests` (`status: pending`) and `PUT /api/requests/{id}/fulfill` (`status: fulfilled`) → the operator who asked and the supervisor |
| `broadcast` | `POST /api/broadcasts` → the supervisor's team |
| `floor_update` | the simulator, whenever trailers move → **every** connected user. It carries no data; each client refetches docks, orders and the WMS through its own row scope |

**Adding an event means changing both ends:** a constructor in `backend/app/realtime.py` and the
client in `frontend/src/api/realtime.ts`, which authenticates, reconnects with backoff (1 s → 30 s),
drops malformed frames, and invalidates exactly the cached data each event changes.

---

## 4. State machines

### Issue status

```
resolution_in_progress ──┬──▶ self_resolved
                         ├──▶ escalated ──┬──▶ supervisor_resolved
                         │                └──▶ on_hold ──▶ supervisor_resolved
                         ├──▶ on_hold
                         └──▶ supervisor_resolved
```

`on_hold` (Contact Carrier, Request Re-inspection) is open. See business-rules §7.

Timestamps: `created_at` → `escalated_at` → `acknowledged_at` → `on_hold_at` → `resolved_at`.

### Dock lifecycle

```
idle ──▶ inspection ──▶ loading | unloading ──▶ complete
```

Tracked in two columns — `lifecycle_phase` above, and `status` (`idle`/`active`/`issue`/`critical`)
alongside it. Every change to either goes through one function, `app/domain/dock.py` → `transition()`:

| Event | `status` | `lifecycle_phase` |
|---|---|---|
| issue reported | `issue` | unchanged |
| issue escalated | `critical` if severity is critical, else `issue` | unchanged |
| issue resolved (either path) | `active` | unchanged |
| load rejected (Full Reject) | `issue` | unchanged |
| inspection submitted | unchanged | `inspection` |
| order completed | `idle` | `complete` |

⚠️ Resolution sets the dock to `active` unconditionally, even if another issue remains open on it.
That is preserved behaviour, now visible in one table instead of five handlers.

---

## 5. Authentication and authorization

*(Phase 2A.)*

- **Credentials:** employee ID + password, hashed with **Argon2** (`pwdlib`). Login always verifies
  against a hash — a dummy one for unknown IDs — so a missing account and a wrong password take the
  same time and return the same 401.
- **Tokens:** HS256 JWT signed with `JWT_SECRET` (the API refuses to start in production with the
  development secret), carrying the user id and role, valid for one 12-hour shift. The user is
  re-loaded on every request, so deactivating an account (`is_active=false`) takes effect at once.
- **Authorization:** role dependencies (`Operator`, `Supervisor`, `Staff`) on every mutating route,
  plus row scoping in `app/api/access.py` — the single place those rules live.
- **Rate limits:** 10 login attempts per minute per client address **and** 10 per employee ID (the
  address can be forged through `X-Forwarded-For`; the ID cannot); 12 chat messages per minute per
  user. The limiter forgets keys that have been quiet for a full window.
- **Demo accounts** share one password, `DEMO_PASSWORD`. In development it defaults to `dockiq-demo`;
  in production nothing is seeded with a password unless it is set.
- **Still true:** CORS is an explicit origin list; tokens live in the browser's `sessionStorage`
  (cleared when the tab closes); there is no refresh token — a shift-long token re-prompts after 12 h.

---

## 6. Gaps against the source documents

Functionality the source material presents as part of the product that the code does not implement.

| Promised | Source | Status |
|---|---|---|
| Barcode scan with automatic SKU-mismatch detection | Scenario 3 — the $4,200 save | ✅ **Phase 2** — scanner-wedge or typed entry, camera where the browser supports `BarcodeDetector` |
| Photo capture on an issue report | Scenario 1 — "no photos" is the stated pain | ✅ **Phase 2** |
| Voice dictation of the description | Scenario 1 | ✅ **Phase 2** where the browser supports speech recognition |
| Quality Manager auto-notification | Scenario 2 | ✅ **Phase 2** — `quality` role, addressed realtime |
| Pick list with a reference of the correct case | Scenarios 3, 4 | ✅ **Phase 2** — load plan per customer rules, with the expected barcode |
| Carrier trend surfacing | Scenario 2 | ✅ **Phase 2** — persisted and shown |
| Safety issue reporting (injury, near miss, spill, pedestrian) | Operator issues DOCX | ✅ **Phase 2** — injury is always critical |
| WMS issue reporting (offline, pallet not found, task missing) | Operator issues DOCX | ✅ **Phase 2** |
| Count **overage**, mixed-SKU pallet, missing pallet | Operator issues DOCX | ✅ **Phase 2** — Count Discrepancy subtypes |
| Pre-filled dock/trailer/customer/product context | Scenario 1 | ✅ Implemented |
| Severity auto-suggestion with cited SOP source | Scenarios 1, 2 | ✅ Implemented |
| Prioritized supervisor queue | Scenario 5 | ✅ Implemented |
| Digital discrepancy record, searchable | Executive summary | ✅ Implemented |
| Deterministic fallback when the LLM is unavailable | Features 2-pager | ✅ Implemented |
