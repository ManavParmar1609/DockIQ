# DockIQ.AI — Roadmap

**Living document.** Updated 2026-09-25.

Four phases, sequenced so nothing gets written twice. The harness makes the rest reviewable; the
migration happens before feature work so features land once, on the final stack.

| Phase | Goal | Status |
|---|---|---|
| **0** | Harness + documentation | **Done** — `CLAUDE.md`, rules, hooks, settings, docs, three bug fixes |
| **1** | Migrate to the free-deployment stack | **Done** — async SQLAlchemy + Alembic, Neon/Koyeb/Vercel, 84 tests, CI |
| **2** | Feature gap + real auth and supervisor→worker teams | **Done** — auth + teams, 12 types / 87 subtypes, scanning, photos, load plans, redesigned TypeScript frontend |
| **3** | Live simulated Warehouse Management Service | Designed |

---

## ⚠️ 0. Blocked input

Two source documents are **0 bytes** on disk and have never existed in git history:

- `DocumentsforProj/Operator_Document_Loading_Issues_for_Stored_Freight.pdf`
- `DocumentsforProj/Warehouse_Unloading_Issue_Data_Collection_Brainstorm_Document.pdf`

The Phase 2 gap analysis below is built from the sources that *do* have content — chiefly
`list of issues operators faces.docx`. **It is almost certainly incomplete without these two.**
When they are re-supplied, re-run the gap analysis in §2 and update
[business-rules.md §8](architecture/business-rules.md).

*(Housekeeping: `DockIQ_Showcase_Overview.pdf` and `DockIQ_Features_Benefits_2Pager.pdf` are
byte-identical duplicates.)*

---

## Phase 1 — Stack migration *(runs before feature work)*

> **Delivered 2026-09-25.** Decisions: **Neon** (Postgres) + **Koyeb** free (API) + **Vercel** —
> everything on free tiers, see [deployment.md](deployment.md).
>
> - Backend restructured into `app/{api,domain,services,seed}` — domain rules are now pure functions.
> - SQLAlchemy 2 async sessions: one transaction per request, no leaked connections, no blocking
>   I/O on the event loop (the LLM call uses `AsyncOpenAI`).
> - Alembic migration `0001`: every FK, every index, CHECK-constrained enums, JSON columns,
>   timezone-aware UTC timestamps. Verified on SQLite **and** Postgres.
> - Explicit response models for every endpoint; `404` instead of `500` for unknown references.
> - `pydantic-settings` config; explicit CORS origins; `/api/health`.
> - Seed moved to reviewable JSON with **fictional** companies, brands, SKUs and carriers (the
>   prototype used real retailer names). Historical issues are now scored by the real formula.
> - 84 tests (pinned rules, API, WebSocket, migrations), ruff, GitHub Actions CI, Dockerfile.
> - Frontend: API/WS origin from one `VITE_API_URL`; production builds fail loudly without it.
>
> Behaviour is otherwise **unchanged** — the known rule defects in 2C are preserved and pinned by
> strict-xfail tests, to be fixed deliberately in Phase 2.

### Why the current production path is broken

| Problem | Detail |
|---|---|
| Ephemeral database | Render's free tier has an ephemeral filesystem — `dockiq.db` is wiped on every deploy and restart |
| Cold starts | The free instance sleeps; a ~50s wake is a bad first impression in front of an audience |
| Broken API base URL | `vercel.json` rewrites `/(.*)` → `/index.html`. With `VITE_API_URL` unset, every `/api/…` call returns the HTML shell **with a 200** — `res.ok` passes and `res.json()` fails with a misleading parse error |
| No WebSockets | Vercel static hosting cannot serve `/ws` at all. Realtime dies silently in production |
| Build crash | `requirements.txt` omits `openai`, which `ai_engine.py` imports *(fixed in Phase 0)* |

### Target

**Keep FastAPI + React.** No domain logic is rewritten — severity, retrieval, cost and recurrence
stay in Python where they are correct and testable.

| Concern | Now | After |
|---|---|---|
| Database | SQLite on ephemeral disk | Neon or Supabase **Postgres** |
| Schema changes | `CREATE TABLE IF NOT EXISTS` — silently no-ops | **Alembic migrations** |
| Backend host | Render free | **Fly.io or Koyeb** — always-on, real WebSockets |
| Frontend host | Vercel | Vercel, with `VITE_API_URL`/`VITE_WS_URL` set at build time |
| Config | `os.environ[...]`, no dotenv loader | `pydantic-settings` |

### Work items

- Settings module via `pydantic-settings`. **Note:** there is currently no `python-dotenv`, so
  `.env` files are not being read at all — the variable must be exported.
- Replace raw `sqlite3` with SQLAlchemy or `asyncpg`. This also fixes **blocking I/O inside
  `async def` handlers** and the connections opened without `try/finally` that leak on any exception.
- Move DDL and the ~800 lines of seed data out of `database.py` into migrations plus a data file.
- Add the missing **indexes** — `issues.created_at`, `status`, `issue_type`, and every FK column.
  There are currently none anywhere in the schema.
- Add the **foreign keys** the `issues` table lacks entirely (7 relational columns, zero constraints,
  despite `PRAGMA foreign_keys=ON`).

~~**Open:** Fly.io vs Koyeb; Neon vs Supabase Postgres.~~ Decided: Koyeb + Neon (Fly.io has no free tier since Oct 2024; Supabase free projects pause after 7 idle days).

*Alternatives considered and set aside:* Next.js + Supabase (attractive because Supabase Auth would
supply Phase 2's auth for free) and Cloudflare Workers + D1 + Durable Objects. Both require porting
~1,500 lines of Python domain logic.

---

## Phase 2 — Features

> **Delivered 2026-09-25.**
>
> - **2A:** Argon2 + JWT sign-in; identity from the token on every route; supervisor→operator teams
>   by zone; a Quality role; row scoping in one module; authenticated, addressed WebSockets; rate
>   limits on login and chat.
> - **2B:** the full DOCX taxonomy (12 types, 87 subtypes) including **Safety** (injury always
>   critical) and **WMS**; count overage, mixed-SKU and missing/extra pallets; barcode scan with
>   SKU-mismatch stop and scan audit; photo evidence; voice dictation; persisted recurrence; Quality
>   notification; per-customer **trailer load plans**; server-side receiving temperature check and
>   automatic count-discrepancy filing.
> - **2C:** every listed defect fixed (the backend ones with tests; the frontend ones by the rebuild).
> - **Frontend:** rebuilt in React 19 + TypeScript strict + TanStack Query + React Router 8 +
>   Tailwind 4 with generated API types, in the "Freight Manifest" design. Verified by lint, types,
>   unit tests, a screenshot pass at tablet/phone/desktop sizes and a cross-role end-to-end run.

### 2A. Real authentication and supervisor→worker teams

Today `users` has **no password column, no login endpoint, and no link between a worker and a
supervisor**. Supervisors have a `zone` string; that is the only grouping that exists.

| Area | Work |
|---|---|
| **Schema** | `users.password_hash`, `users.supervisor_id` (self-FK), `users.is_active`. Seed each of the 3 supervisors with a team, using the existing `zone`/`shift` columns so teams mirror the floor layout |
| **Backend** | `passlib[bcrypt]`; `POST /api/auth/login` issuing a JWT or signed session cookie; `get_current_user` and `require_role(...)` dependencies |
| **Identity** | **Replace every client-supplied actor ID.** `operator_id`, `supervisor_id` and `user_id` currently arrive in request bodies unvalidated. They become `current_user.id`, server-side |
| **Scoping** | A supervisor's queue, analytics and handoff filter to **their own team**. Three supervisors on three screens each seeing their own floor is a far stronger demo than one god-view |
| **Frontend** | Real login form; token storage and an `Authorization` header in `api.js` (currently sends none); 401 handling; authenticated WebSocket handshake |
| **Routing** | Escalation goes to *that operator's* supervisor rather than to everyone |

This also forces a fix to `App.jsx`, which branches on `role === 'operator'` and renders the
supervisor shell for **every** other value — so the `quality` role added in 2B would silently land
in the supervisor UI.

### 2B. Issue coverage gap

The system implements **10 issue types**, consistently across `IssueResolution.jsx:8`,
`app/domain/severity.py:ISSUE_TYPE_WEIGHTS` and the 27 knowledge-base entries. The problem is coverage of the
**8 issue categories (~56 scenarios)** and **8 discrepancy categories (~55 scenarios)** in the source
DOCX.

| DOCX category | Reportable as | Coverage |
|---|---|---|
| Loading & Pallet (8) | `Damaged Pallet` | Partial — no overweight, oversized, unstable, loose wrap, frozen-to-floor, fallen product |
| Barcode & Label (7) | `Barcode Issue` | Partial — one flat bucket, no sub-reason |
| Scanner & Handheld (6) | `Equipment Failure` | Partial — conflated with forklift |
| Forklift Equipment (7) | `Equipment Failure` | Partial — same bucket, no fault-code capture |
| Trailer & Dock (7) | `Seal/Trailer Condition` | Partial — no leveler, restraint, dock plate, trailer shift |
| Documentation & Shipping (6) | `Paperwork Mismatch` | Partial |
| **WMS (7)** | — | **None** |
| **Safety (8)** | — | **None** |

> **The two serious gaps are Safety and WMS.** A warehouse floor tool that cannot report an injury
> or a near miss is a credibility problem in front of an operations audience. And "WMS is offline"
> is the most common reason an operator genuinely cannot proceed.

**Deliverables:**

1. Add **Safety Incident** and **WMS/System Issue** as first-class types — weights, KB entries,
   icons. An injury must score **critical unconditionally**, which the current multiplicative
   formula cannot express; this needs an override path.
2. Add an `issue_subtype` field so the ~110 documented scenarios are selectable under the types,
   instead of being lost in free-text `quick_tags`.
3. Count discrepancies in **both directions** — overage as well as shortage — plus mixed-SKU pallets
   and missing-from-staging.
4. **Photo capture** on issue creation (Scenario 1 names "no photos" as a pain point).
5. **Barcode entry with SKU-mismatch checking** — manual first, camera scan if the target supports
   it. This is Scenario 3, the one with the $4,200 figure, and it is currently entirely unsupported.
6. **Persist and surface recurrence** so Scenario 2's carrier-trend line appears.
7. A **`quality` role**, so Scenario 2's three-way notification is real.

### 2C. Known defects to fix during feature work

| Defect | Location |
|---|---|
| `count_actual = 0` skips the shortage modifier — total non-delivery scores *lower* than a 6% short | `app/domain/severity.py:95` truthiness test |
| `trailer_dwell_minutes` modifier can never fire — no caller passes it | `app/domain/severity.py:60` |
| `company_name` never passed to `find_resolution`, so the +1 company bonus never applies | `app/api/issues.py` `create_issue` |
| Inspection temperature gate is a fixed 45°F regardless of product category — a frozen load at 40°F passes | `app/domain/inspection.py` |
| `timeAgo` never rolls up past minutes — renders "27914m ago" | both dashboards |
| `NaN%` progress on an order with no items | `Loading.jsx:98` |
| Side effects inside `setState` updaters — double-fire under StrictMode, failures swallowed | `Loading.jsx:31-53`, `Unloading.jsx:55-64` |
| Unguarded `JSON.parse` in both WebSocket handlers | both layouts |
| `useParams` imported but never called; every caller navigates to the literal `/app/resolve/new` | `IssueResolution.jsx` |
| ~8 dead lucide imports across five files | `Analytics`, `IssueLogs`, `ShiftHandoff`, `SupervisorDashboard`, `WorkerDashboard` |

---

## Phase 3 — Live simulated Warehouse Management Service

Today the backend is static: `app/seed` loads a fixed set of orders and nothing moves unless a
human clicks. The goal is a warehouse that runs.

### Build it as an adapter, not as more seed data

The executive summary commits to asking for real WMS access once there is interest. So the simulator
should sit behind the interface a real WMS would:

```
routes  →  WmsClient (protocol)  →  SimulatedWms   ← Phase 3 builds this
                                 →  RealWms        ← the pilot swaps this in, config-only
```

Everything the app needs from a WMS goes through that one boundary: trailer appointments, yard and
door assignment, inventory by location, pick lists / ASN lines, order status write-back. This makes
the demo *be* the integration spike rather than throwaway work.

### A deterministic virtual clock, not a background loop

State is a pure function of `(seed, simulated_elapsed_time)`, computed on read and materialised as
events. This matters for three reasons:

- **Reproducible demos.** The same seed replays the same shift — you can rehearse a presentation and
  get the identical trailer at the identical dock every time.
- **Testable at all.** You can assert on a full shift without waiting for one.
- **Host-agnostic.** A perpetual `asyncio` tick pins you to one always-on process; a virtual clock
  survives restarts, redeploys and a sleeping free tier.

### What it simulates

Layered on the existing 12 docks / 11 users / 20 companies seed:

- Trailer appointments arriving on a schedule with carrier, customer, BOL, seal and temperature
- Yard → door assignment, door occupancy, turn time
- Operators progressing `inspection → loading|unloading → complete` at rates varying by
  `experience_level` — already a seeded column, currently unused
- Inventory with locations, so "pallet not found in WMS" becomes a real simulated condition
- **Injected exceptions** drawn from the Phase 2 taxonomy, flowing through the real severity formula
  rather than being hardcoded demo records

### Control surface

`/api/sim/*`: status · play/pause · speed · reset · set-seed · **inject-event**. The last one is
what makes a live demo safe to give — trigger the Scenario 2 temperature emergency on cue instead of
waiting for the RNG.

### Realtime

Simulated events publish through the existing `/ws` fan-out and its six event types, so the frontend
needs no new transport — but it does need the reconnect and parse guards the current inline
WebSocket code lacks. A live simulation will expose that fragility immediately.

### Guardrail

**Simulated data must be visibly marked as simulated**, in the UI and in API payloads. The project's
credibility rests on "nothing in the demo is real company information", and a *convincing* simulator
makes that promise easier to accidentally break.

---

## Cross-cutting: frontend redesign

**Done in Phase 2** — "Freight Manifest": Archivo + Martian Mono on unbleached paper, carbon ink, one
hazard red for severity and alerts. See [`docs/specs/ui-ux-spec.md`](specs/ui-ux-spec.md).
