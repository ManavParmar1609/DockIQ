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

### Frontend — `frontend/src/`

```
App.jsx  →  WorkerLayout | SupervisorLayout  →  13 page components  →  api.js  →  backend
              (children wrappers, not <Outlet/>)
```

One context (`context/AuthContext.jsx`), one shared-component file (`components/Shared.jsx`).
**No `hooks/`, `utils/`, `constants/`, or `lib/` directories exist yet** — create them when the
first genuine second use appears, not before.

---

## 2. Invariants — do not break these

1. **All HTTP routes are namespaced under `/api`.**
2. **`frontend/src/api.js` is the only client-side gateway.** No `fetch` anywhere else in `src/`.
   If you need a new endpoint, add a method there.
3. **`/ws` carries exactly six event types** — `new_issue`, `issue_escalated`, `issue_resolved`,
   `order_complete`, `new_request`, `broadcast` — each built by a constructor in `app/realtime.py`.
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

Every page owns its own data with `useState` + `useEffect`. **There is no cache and no query
library.** Two pages showing the same order are two independent fetches.

WebSocket events do **not** invalidate page data — the supervisor's WS handler only increments a
badge counter in the layout; the dashboard has no idea an event arrived and relies on a 10-second
`setInterval` poll instead.

Assume nothing is shared. If you need cross-page freshness, that is a deliberate change, not
something to bolt on ad hoc.

---

## 4. The WMS adapter boundary *(planned — Phase 3)*

Written down before it is built, so nothing is built that contradicts it.

```
routes  →  WmsClient (protocol)  →  SimulatedWms   ← the live warehouse simulator
                                 →  RealWms        ← the pilot swaps this in, config-only
```

Everything the app needs from a warehouse management system — trailer appointments, yard and door
assignment, inventory by location, pick lists / ASN lines, order status write-back — goes through
that single interface. **Do not let simulator concepts leak into route handlers.** The point of the
boundary is that a real WMS becomes a config change rather than a rewrite.

The simulator is a **deterministic virtual clock**: state is a function of
`(seed, simulated_elapsed_time)`, not a background tick loop. See `docs/roadmap.md` Phase 3.

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

| Issue | Detail |
|---|---|
| **Two ~80%-identical layouts** | `WorkerLayout` (202 ln) and `SupervisorLayout` (111 ln) duplicate the WS bootstrap, shell, sidebar, mobile bars and logout handler. Extract `<AppShell>` + `useRealtime()` |
| **Layouts are not route elements** | They take `children` and wrap a nested `<Routes>`. Converting to `<Outlet/>` enables per-route error boundaries and a real `/app/*` 404 |
| **No ErrorBoundary anywhere** | One unimported symbol white-screens an entire page with nothing to catch it |
| **Copy-pasted helpers** | `timeAgo` and `getGreeting` duplicated across both dashboards, and divergent |
| **Divergent duplicate widget** | The tap counter in `Loading.jsx` clamps to expected quantity; the one in `Unloading.jsx` does not |
| **Four competing status maps** | Same five issue statuses, four different label/colour tables, with different labels |
| **Three competing resolution-type lists** | `IssueResolution` (8), `MyIssues` (7), `IssueDetail` (7, different set) |
| **`Shared.jsx` is a grab-bag** | Seven unrelated components, from a 3-line dot to a 107-line diagram. Its exported `StatCard` is dead code — both dashboards hand-roll their own |
| **No error handling on 40+ API call sites** | A rejection leaves the page stuck on its loading state forever |

---

## 6. When you add something

- **A new endpoint** → router in `app/api/`, request + response schema in `app/schemas.py`, a test,
  a method in `api.js`, and a row in `docs/requirements/functional-specs.md`.
- **A new table or column** → model in `app/models.py` **and** a migration in `migrations/versions/`.
- **A new domain rule, threshold or weight** → `app/domain/` or the seeded knowledge base, a pinning
  test, **and** `docs/architecture/business-rules.md`. Same commit.
- **A new WebSocket event** → constructor in `app/realtime.py`, both layout handlers, the spec.
- **A second use of a helper** → that is when it moves to `src/utils/`, not the first.
- **Anything touching the WMS** → it goes through `WmsClient`, never around it.
