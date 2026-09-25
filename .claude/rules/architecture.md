# Architecture Rules

How DockIQ is put together, what must stay true, and what is known to be wrong.

---

## 1. Layer map

### Backend — `backend/`, a `uv` project (Python 3.12, FastAPI, SQLAlchemy 2 async, Alembic)

```
app/main.py        create_app(): lifespan (Database, ConnectionManager, Assistant), CORS, /api/health, /ws
app/config.py      Settings (pydantic-settings) — DATABASE_URL, CORS_ORIGINS, NVIDIA_API_KEY …
app/db.py          engine + async session per request, UTCDateTime, enum_column, naming convention
app/models.py      ORM models (the schema itself is owned by migrations/)
app/schemas.py     every request AND response model
app/queries.py     shared read selects (flat rows shaped like their schema), portable SQL helpers
app/realtime.py    ConnectionManager + the complete /ws event vocabulary
app/api/           routers: reference, orders, issues, floor, chat, analytics — orchestration only
app/domain/        PURE business rules: severity, cost, retrieval, recurrence, inspection, dock, enums
app/services/      assistant.py — the only LLM call
app/seed/          demo data (data/*.json, natural keys) + `python -m app.seed [--reset]`
app/migrate.py     programmatic Alembic (seed CLI, tests)
migrations/        Alembic; hand-reviewed, portable across SQLite and Postgres
tests/             pytest; every test gets a freshly migrated + seeded database
```

Local development uses SQLite (`backend/dev.db`); production uses Neon Postgres. The same migrations
and the same test suite run on both (`TEST_DATABASE_URL` switches the suite to Postgres).

### Frontend — `frontend/src/` (React 19, TypeScript strict, Vite 8, Tailwind 4, Node 24)

```
main.tsx        QueryClientProvider → AuthProvider → RouterProvider
router.tsx      data routes; lazy pages; ErrorBoundary per branch; RoleGate
api/            client.ts (openapi-fetch, the only gateway) · schema.gen.ts (generated) ·
                types.ts · hooks.ts (TanStack Query) · realtime.ts (/ws → cache invalidation)
auth/           AuthProvider (token in sessionStorage, /auth/me, 401 → signed out)
shell/          AppShell (rail + tab bar), nav, Alerts, QuickRequest
components/     ui kit, Severity, LoadPlanView, Barcode, ScanField, Evidence, Resolution, …
lib/            format, vocab (the one status map), ean13, useNow
pages/          Landing, Login, Home, IssueDetail, Chat, operator/*, staff/*
styles/app.css  every token; Tailwind palette wiped
```

---

## 2. Invariants — do not break these

1. **All HTTP routes are namespaced under `/api`.**
2. **`frontend/src/api/` is the only client-side gateway.** No `fetch` anywhere else — ESLint
   enforces it. Types come from `npm run gen:api`; never hand-write a response shape.
3. **`/ws` carries exactly eight event types** — `new_issue`, `issue_escalated`, `issue_resolved`,
   `issue_acknowledged`, `order_complete`, `new_request`, `broadcast`, `floor_update` — each built by
   a constructor in `app/realtime.py`. Only the data-free `floor_update` goes to every socket.
   Adding one means a new constructor *and* both layout handlers *and* the functional spec.
4. **Domain logic lives in `app/domain/` only, and it is pure.** No database session, no I/O, no
   framework imports. Routers fetch, call the domain, persist. `queries.py` may *count*; the domain
   *decides* (see `recurrence.py`).
5. **Severity is deterministic.** It is a weighted formula, not an LLM call. The LLM is used only
   in `app/services/assistant.py`. Do not introduce model output into a severity, cost or acceptance
   decision — the auditability of that formula is a product guarantee, not an implementation detail.
6. **Thresholds and weights are documented and pinned.** Changing a number in `app/domain/` or the
   seeded knowledge base means updating `docs/architecture/business-rules.md` in the same commit —
   the pinning tests fail otherwise.
7. **Schema changes are migrations.** Never `create_all`. A model change without a migration fails
   `test_migrations_match_the_models`.
8. **One transaction per request.** Handlers commit once; the session rolls back on any exception.
   WebSocket events are sent after the commit, never before.
9. **Every response has an explicit schema** in `app/schemas.py`.
10. **Dock `status`/`lifecycle_phase` change only through `app/domain/dock.py:transition()`.**

---

## 3. Server state on the frontend

TanStack Query owns server state: one query per read, one mutation per write, each mutation
invalidating exactly what it changes. The realtime channel invalidates what *other people* change.
There is no polling. Components never call the API directly — they use the hooks in `api/hooks.ts`.

---

## 4. The WMS adapter boundary *(built — Phase 3)*

`app/wms/client.py` defines the protocol; `app/wms/simulated.py` implements it; `NoWms` is the
`WMS_MODE=none` stand-in. Routes receive it as `WmsDep` and never import the simulator.

```
routes  →  WmsClient (protocol)  →  SimulatedWms   ← the live warehouse simulator
                                 →  RealWms        ← the pilot swaps this in, config-only
```

Everything the app needs from a warehouse management system — trailer appointments, yard and door
assignment, inventory by location, pick lists / ASN lines, order status write-back — goes through
that single interface. **Do not let simulator concepts leak into route handlers.** The point of the
boundary is that a real WMS becomes a config change rather than a rewrite.

The simulator is a **deterministic virtual clock**: state is a function of
`(seed, simulated_elapsed_time)`. A background tick (`SIM_TICK_SECONDS`, default 2) only makes it
*timely*; correctness never depends on it, because every call catches up from the clock, exactly
once. The simulator controls (`/api/sim/*`) are a demo surface, not part of the WMS boundary.
Business rules: `docs/architecture/business-rules.md` §12.

---

## 5. Known structural debt

Listed so it is visible rather than rediscovered. Do not "fix" it incidentally in unrelated work.

### Backend

| Issue | Status |
|---|---|
| **No auth layer** — actor identity is a client-supplied integer | Open → Phase 2A. See `security.md` |
| Leaking connections, no transactions, blocking I/O in `async def` | ✅ Fixed in Phase 1 (async session per request, AsyncOpenAI) |
| No response models | ✅ Fixed in Phase 1 |
| No migrations, no indexes, no FKs, JSON in TEXT | ✅ Fixed in Phase 1 |
| Dual dock state mutated by five handlers | ✅ Centralised in `domain/dock.py` (the two columns remain) |
| `print()` logging | ✅ Fixed in Phase 1 |
| Resolution sets the dock `active` even when another issue is still open on it | Open — preserved behaviour, see functional-specs §4 |
| Known rule defects (zero-count shortage, unreachable dwell modifier, missing company bonus, fixed 45°F gate) | Open → Phase 2C; marked `KNOWN DEFECT` in code |

### Frontend

The Phase 1 frontend debt — duplicated layouts, no error boundaries, copy-pasted helpers, four
status maps, three resolution lists, unhandled API failures, side effects in state updaters,
unguarded `JSON.parse` — was removed by the Phase 2 rebuild. Open items:

| Issue | Detail |
|---|---|
| Token in `sessionStorage` | Readable by any script on the origin; an HttpOnly cookie needs same-site hosting. See `security.md` |
| No offline mode | A tablet that loses Wi-Fi shows errors with retry, but cannot queue a report |

---

## 6. When you add something

- **A new endpoint** → router in `app/api/`, request + response schema in `app/schemas.py`, a test,
  `npm run gen:api`, a hook in `api/hooks.ts`, and a row in `docs/requirements/functional-specs.md`.
- **A new table or column** → model in `app/models.py` **and** a migration in `migrations/versions/`.
- **A new domain rule, threshold or weight** → `app/domain/` or the seeded knowledge base, a pinning
  test, **and** `docs/architecture/business-rules.md`. Same commit.
- **A new WebSocket event** → constructor in `app/realtime.py`, `RealtimeEvent` + invalidation in
  `frontend/src/api/realtime.ts`, the spec.
- **A second use of a helper** → it moves to `src/lib/`.
- **Anything touching the WMS** → it goes through `WmsClient`, never around it.
