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
| Quality Manager | `quality` | 1 seeded (`QA-001`). Read-only, facility-wide view of quality issues (temperature, product quality, lot/expiry, and anything critical); notified in real time |

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
  a 500. Invalid enum values in query strings return **422**.
- Each request runs in one database transaction, committed once. WebSocket events are emitted only
  after the commit succeeds.

### 2.0 Meta and authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | Liveness + database round-trip. Used as the Koyeb health check |
| POST | `/api/auth/login` | public, rate-limited | OAuth2 password form: `username` = employee ID, `password`. Returns a bearer token (12 h — one shift) and the user |
| GET | `/api/auth/me` | token | The signed-in user, with their supervisor's name |
| GET | `/api/auth/demo-accounts` | public | Names, IDs and roles of the seeded accounts for the demo login screen. **Never passwords.** Disabled by `DEMO_ACCOUNTS_LISTED=false` |
| GET | `/api/taxonomy` | token | Every closed list: 12 issue types with subtypes, weights, icons and severity floors; operator resolutions; supervisor decisions; request types. **The frontend keeps no copies** |

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
| GET | `/api/docks` | All 12 doors, joined with current operator, order and customer |
| GET | `/api/docks/{dock_id}` | Single door with the same joins |

### 2.3 Orders

| Method | Path | Who | Purpose | Mutates |
|---|---|---|---|---|
| GET | `/api/orders` | scoped | Optional `?status=` and `?operator_id=` | — |
| GET | `/api/orders/{id}` | scoped | Order including its `order_items` (with GTINs) | — |
| GET | `/api/orders/{id}/load-plan` | scoped | Where every pallet goes, by the customer's rules — see business-rules §10 | — |
| POST | `/api/orders/{id}/temperature-check` | assigned operator | `{reading}` → status, limit, delta and guidance (business-rules §11.1) | — |
| POST | `/api/orders/{id}/scan` | assigned operator | `{code}` — GTIN-14/13, UPC-A, or SKU. Returns `match` (case counted), `mismatch` (a real product **not on this order — do not load**), or `unknown`. Every scan is logged in `scan_events` | `order_items`, `scan_events` |
| PUT | `/api/orders/{id}/items` | assigned operator | Record `actual_quantity` for a line | `order_items` |
| POST | `/api/orders/{id}/complete` | assigned operator | Sign off, capture seal number. Inbound: lines outside tolerance are filed as Count Discrepancy issues (returned as `discrepancy_issue_ids`). A complete order is closed to further counting (403) | `orders`, `issues`, dock → `idle`/`complete`; emits `new_issue` per discrepancy and `order_complete` |

### 2.4 Issues — the core entity

| Method | Path | Who | Purpose | Mutates |
|---|---|---|---|---|
| GET | `/api/issues` | scoped | Filters: `status` (or `active`), `operator_id`, `severity`, `limit` | — |
| GET | `/api/issues/{id}` | scoped | Full issue with joined context, `issue_subtype`, `recurring_patterns`, `photo_count` | — |
| POST | `/api/issues` | operator | **Create and classify** — see below. `issue_type` and `issue_subtype` must come from the taxonomy (422) | `issues`, dock → `issue`; emits `new_issue` |
| PUT | `/api/issues/{id}/self-resolve` | the reporter | `resolution_type` must be an operator resolution (422) | `status='self_resolved'`, dock → `active`; emits `issue_resolved` |
| PUT | `/api/issues/{id}/escalate` | the reporter or their supervisor | Hand to the supervisor. No body | `status='escalated'`; dock → `critical` if severity is critical; emits `issue_escalated` |
| PUT | `/api/issues/{id}/supervisor-resolve` | the reporter's supervisor | `resolution_type` must be a supervisor decision (422) | `status='supervisor_resolved'`; emits `issue_resolved` |
| POST | `/api/issues/{id}/photos` | reporter or their supervisor | Multipart `file`. ≤ 600 kB, ≤ 4 per issue, JPEG/PNG/WebP by content | `issue_photos` |
| GET | `/api/issues/{id}/photos` | scoped | Photo metadata | — |
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

### 2.6 Chat

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | Ask the assistant (12 messages/minute per user). Retrieves KB context, then calls the NVIDIA LLM |
| GET | `/api/chat/history` | Your most recent 100 messages, oldest first |

This is the **only** place an LLM is used. Severity, cost and retrieval are all deterministic.
Model: `meta/llama-3.1-70b-instruct` via NVIDIA's OpenAI-compatible endpoint, temperature 0.3,
max_tokens 512. A deterministic fallback preserves the workflow when the provider is unavailable —
a stated product guarantee, not an accident.

### 2.7 Floor operations

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/requests` | scoped | Quick requests. Optional `?status=` |
| POST | `/api/requests` | operator | `request_type` from the taxonomy; emits `new_request` to the supervisor |
| PUT | `/api/requests/{id}/fulfill` | the requester's supervisor | Mark fulfilled |
| GET | `/api/broadcasts` | any | Operators see their supervisor's; supervisors their own; quality all |
| POST | `/api/broadcasts` | supervisor | Announcement to **their team**; emits `broadcast` |
| GET | `/api/shift-handoffs` | any | Handoffs for your zone (quality: all) |
| POST | `/api/shift-handoffs` | supervisor | End-of-shift notes for their zone |

### 2.8 Analytics

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/analytics/summary` | Supervisor: their team. Quality: the whole facility. Operators: 403 |

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
| GET | `/api/wms/appointments` | staff | Yard board: scheduled (next 90 min), in yard, at door, recently left. 503 when offline |
| GET | `/api/wms/inventory?sku=` | everyone | Pallet locations for a SKU (*Where is it stored* on an outbound line). 503 when offline |
| GET | `/api/wms/pallets/{id}` | everyone | One pallet by ID. 404 unknown, 503 offline |
| GET | `/api/sim/status` | staff | Clock, seed, speed, WMS state, trailer counts, the last 15 events |
| POST | `/api/sim/play`, `/pause`, `/next-shift` | staff | Clock control; each returns the new status |
| POST | `/api/sim/speed` `{speed}` | staff | 1, 5, 15 or 60 |
| POST | `/api/sim/step` `{minutes}` | staff | Jump the clock forward, up to 480 (stops at shift end) |
| POST | `/api/sim/reset` `{seed?}` | staff | Remove everything simulated; 06:00, paused |
| POST | `/api/sim/inject` `{scenario}` | staff | A scenario on cue (business-rules §12.4). 409 with no simulated trailer to use |

`OrderOut` gains `simulated` and `wms_synced`; `IssueOut` and `UserOut` gain `simulated`. Completing
an order calls `WmsClient.confirm_order`; while the WMS is down the completion is kept with
`wms_synced = false` and written back later.

---

## 3. Realtime — `WS /ws`

**Authenticated and addressed.** The client opens `new WebSocket(url, ["dockiq", <token>])`; a
missing or invalid token is refused with close code **1008**. Each event goes only to the users it
concerns:

| Event | Emitted by |
|---|---|
| `new_issue` | `POST /api/issues` → reporter, their supervisor, and Quality if quality-relevant |
| `issue_escalated` | `PUT /api/issues/{id}/escalate` → same audience |
| `issue_resolved` | self-resolve and supervisor-resolve → same audience |
| `order_complete` | `POST /api/orders/{id}/complete` → operator and supervisor |
| `new_request` | `POST /api/requests` → operator and supervisor |
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
                         └──▶ escalated ──▶ supervisor_resolved
```

Timestamps: `created_at` → `escalated_at` → `acknowledged_at` → `resolved_at`.

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
- **Rate limits:** 10 login attempts per minute per client; 12 chat messages per minute per user.
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
