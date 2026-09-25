# DockIQ.AI — Functional Specification

**Status:** Describes the system **as built**, verified against `backend/app/` (FastAPI routers in
`app/api/`) and `frontend/src/api.js` on 2026-09-25. The OpenAPI schema at `/docs` is generated from
explicit response models and is authoritative for field names and types.

This is the contract surface. Where the system does *not* yet do something the source documents
promise, it is recorded in §6 rather than omitted — that gap list is the input to
[roadmap.md](../roadmap.md).

---

## 1. Actors

| Actor | `users.role` | Reality |
|---|---|---|
| Operator ("Dock Worker") | `operator` | 8 seeded. Assigned to a dock, runs inspections, loads/unloads, reports issues |
| Supervisor | `supervisor` | 3 seeded. Each has a `zone`. Triages the escalation queue, resolves, broadcasts, hands off shifts |
| Quality Manager | — | **Not implemented.** Appears in the source scenarios as a notification target for critical temperature events. No such role exists |

⚠️ **Vocabulary split.** The database value is `operator`; the frontend routes, directories and
labels say `worker`. Both are live. `App.jsx` branches on `role === 'operator'` and renders the
**supervisor** shell for every other value — there is no `role === 'supervisor'` check anywhere, so
any third role silently lands in the supervisor UI.

⚠️ **There is no authentication.** See §5.

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

### 2.0 Meta

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + database round-trip. Used as the Koyeb health check |

### 2.1 Reference data

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/users` | List users. Optional `?role=` filter. **Used as the login user-picker** |
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

| Method | Path | Purpose | Mutates |
|---|---|---|---|
| GET | `/api/orders` | Optional `?status=` and `?operator_id=` | — |
| GET | `/api/orders/{order_id}` | Order including its `order_items` | — |
| PUT | `/api/orders/{order_id}/items` | Record `actual_quantity` / `verified` per line | `order_items` |
| POST | `/api/orders/{order_id}/complete` | Sign off, capture seal number | `orders.status`, `dock_doors.lifecycle_phase='complete'`, `status='idle'`; emits `order_complete` |

### 2.4 Issues — the core entity

| Method | Path | Purpose | Mutates |
|---|---|---|---|
| GET | `/api/issues` | Filters: `status`, `operator_id`, `severity`, `limit` | — |
| GET | `/api/issues/{issue_id}` | Full issue with joined context | — |
| POST | `/api/issues` | **Create and classify** — see below | `issues`, `dock_doors.status='issue'`; emits `new_issue` |
| PUT | `/api/issues/{id}/self-resolve` | Operator closes it themselves | `issues.status='self_resolved'`, dock → `active`; emits `issue_resolved` |
| PUT | `/api/issues/{id}/escalate` | Hand to a supervisor. **Takes no body** | `issues.status='escalated'`, `escalated_at`; dock → `critical` if severity is critical; emits `issue_escalated` |
| PUT | `/api/issues/{id}/supervisor-resolve` | Supervisor closes it | `issues.status='supervisor_resolved'`, `resolved_at`, notes; emits `issue_resolved` |

**`POST /api/issues`** (`app/api/issues.py` → `create_issue`) is the richest handler. In one inline sequence it:
looks up product and company context → calls `classify_severity()` → runs `find_resolution()` KB
retrieval → calls `estimate_cost_impact()` → counts recent issues for the dock and carrier
(`count_recent_issues()`, decided by `dock_pattern()`/`carrier_pattern()`) → inserts the issue →
flips the dock to `status='issue'` → commits → broadcasts `new_issue` over the WebSocket.

⚠️ The recurrence result is returned to the caller and **never persisted or displayed**.

### 2.5 Inspections

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/inspections` | Trailer pre-check. Sets `dock_doors.lifecycle_phase='inspection'` |

Pass requires **all** of: seal `intact`, cleanliness `clean`, damage `none`, and — if a temperature
was entered — **≤ 45°F** (`app/domain/inspection.py`). See
[business-rules.md §4.6](../architecture/business-rules.md) for why that fixed threshold is a defect.

### 2.6 Chat

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/chat` | Ask the assistant. Retrieves KB context, then calls the NVIDIA LLM |
| GET | `/api/chat/history/{user_id}` | Prior messages for that user |

This is the **only** place an LLM is used. Severity, cost and retrieval are all deterministic.
Model: `meta/llama-3.1-70b-instruct` via NVIDIA's OpenAI-compatible endpoint, temperature 0.3,
max_tokens 512. A deterministic fallback preserves the workflow when the provider is unavailable —
a stated product guarantee, not an accident.

### 2.7 Floor operations

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/requests` | Quick requests. Optional `?status=` |
| POST | `/api/requests` | Operator asks for equipment/supplies/support; emits `new_request` |
| PUT | `/api/requests/{id}/fulfill` | Supervisor marks fulfilled |
| GET · POST | `/api/broadcasts` | Supervisor announcements to the floor; emits `broadcast` |
| GET · POST | `/api/shift-handoffs` | End-of-shift notes |

### 2.8 Analytics

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/analytics/summary` | Twelve aggregate queries in one handler |

Returns: totals, self-resolution rate, cost impact, average resolution minutes, and breakdowns by
type, severity, dock, operator, company and carrier, plus a 30-day time series.

Every foreign-key column is indexed, as are `issues.created_at`, `status`, `severity` and
`issue_type`. The elapsed-minutes average compiles to portable SQL for both SQLite and Postgres
(`app/queries.py` → `minutes_between`).

---

## 3. Realtime — `WS /ws`

A single global fan-out. **No authentication, no rooms, no topics** — every connected client
receives every event.

| Event | Emitted by |
|---|---|
| `new_issue` | `POST /api/issues` |
| `issue_escalated` | `PUT /api/issues/{id}/escalate` |
| `issue_resolved` | self-resolve and supervisor-resolve |
| `order_complete` | `POST /api/orders/{id}/complete` |
| `new_request` | `POST /api/requests` |
| `broadcast` | `POST /api/broadcasts` |

**Adding an event means changing both ends.** The server-side vocabulary is the set of constructor
functions in `backend/app/realtime.py`. The client is *not* in `api.js` — it is constructed
inline and duplicated verbatim in `WorkerLayout.jsx:35-37` and `SupervisorLayout.jsx:13-15`, with no
reconnect, no `onerror`/`onclose` handling, and an unguarded `JSON.parse` that will throw on a
malformed frame and kill the handler.

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

**None.** This is a deliberate demo-scope decision, recorded so it is never mistaken for an
oversight:

- No login endpoint, no password storage, no sessions or tokens.
- `Login.jsx` calls `GET /api/users?role=` and lets you **pick a person from a list**;
  `AuthContext` stores that object in `sessionStorage` under `dockiq_user`.
- Role gating is **client-side only**, in `App.jsx`.
- Actor identity — `operator_id`, `supervisor_id`, `user_id` — is a **client-supplied integer in the
  request body**. The server checks the id exists (404 otherwise) but nothing checks that the caller
  is that person or holds the claimed role.
- CORS is an explicit origin list from `CORS_ORIGINS` (default: the local Vite dev server).
- `api.js` sends **no `Authorization` header** and has no 401 handling.

The standing consequence: **this build must never be exposed publicly with real data.** See
[`.claude/rules/security.md`](../../.claude/rules/security.md).

---

## 6. Gaps against the source documents

Functionality the source material presents as part of the product that the code does not implement.

| Promised | Source | Status |
|---|---|---|
| Barcode scan with automatic SKU-mismatch detection | Scenario 3 — the $4,200 save | **Not implemented.** No scanning anywhere. This is the scenario with the hardest dollar figure attached |
| Photo capture on an issue report | Scenario 1 — "no photos" is the stated pain | **Not implemented** |
| Voice dictation of the description | Scenario 1 | **Not implemented** |
| Quality Manager auto-notification | Scenario 2 | **Not implemented** — no such role |
| Pick list with a reference photo of the correct box | Scenarios 3, 4 | **Partial** — `LoadPatternVisual` exists but hardcodes `"Straight · 22 pallets"` and ignores its `pattern` prop |
| Carrier trend surfacing | Scenario 2 | **Computed and discarded** |
| Safety issue reporting (injury, near miss, spill, pedestrian) | Operator issues DOCX | **Not implemented** — no such issue type |
| WMS issue reporting (offline, pallet not found, task missing) | Operator issues DOCX | **Not implemented** — no such issue type |
| Count **overage**, mixed-SKU pallet, missing pallet | Operator issues DOCX | **Not implemented** — only shortage is modelled |
| Pre-filled dock/trailer/customer/product context | Scenario 1 | ✅ Implemented |
| Severity auto-suggestion with cited SOP source | Scenarios 1, 2 | ✅ Implemented |
| Prioritized supervisor queue | Scenario 5 | ✅ Implemented |
| Digital discrepancy record, searchable | Executive summary | ✅ Implemented |
| Deterministic fallback when the LLM is unavailable | Features 2-pager | ✅ Implemented |
