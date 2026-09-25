# Architecture Rules

How DockIQ is put together, what must stay true, and what is known to be wrong.

---

## 1. Layer map

### Backend — `backend/`, four flat files, no packages

| File | Lines | Owns |
|---|---|---|
| `main.py` | 873 | All 30 routes, all Pydantic request models, the WebSocket manager, CORS |
| `database.py` | 1040 | Connection factory, the entire DDL as one `executescript`, and ~800 lines of seed data |
| `ai_engine.py` | 430 | Severity scoring, KB retrieval, LLM chat, cost estimation, recurrence detection |
| `reset_db.py` | 10 | Demo reset |

There is no `routes/`, `models/`, `services/`, or `repositories/`. Raw SQL lives directly in route
handlers. `get_db()` returns a `sqlite3.Connection` with `row_factory = sqlite3.Row`,
`journal_mode=WAL` and `foreign_keys=ON`, opened and closed inline in every endpoint.

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
   `order_complete`, `new_request`, `broadcast`. Adding one means changing the backend emitter *and*
   both layout handlers.
4. **Domain logic lives in `ai_engine.py` only.** Severity, cost, retrieval and recurrence are
   computed there. Route handlers orchestrate; they do not compute domain values.
5. **Severity is deterministic.** It is a weighted formula, not an LLM call. The LLM is used only
   for the chat assistant. Do not introduce model output into a severity, cost or acceptance
   decision — the auditability of that formula is a product guarantee, not an implementation detail.
6. **Thresholds and weights are documented.** Changing a number in `ai_engine.py` or the seeded
   knowledge base means updating `docs/architecture/business-rules.md` in the same commit.

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

Listed so it is visible rather than rediscovered. None of this is a surprise; do not "fix" it
incidentally in unrelated work.

### Backend

| Issue | Detail |
|---|---|
| **No auth layer** | No login, no sessions, no `current_user`. Actor identity is a client-supplied integer. See `security.md` |
| **Leaking connections** | Every handler does `get_db()` … `db.close()` with no `try/finally`. Any exception mid-handler leaks the connection |
| **Blocking I/O in `async def`** | `sqlite3` calls and the NVIDIA network call run on the event loop thread. `POST /api/chat` is sync (so threadpooled); `POST /api/issues` is `async def` and does blocking DB work |
| **No transaction boundaries** | `create_issue` does multiple writes and commits once at the end; nothing rolls back on partial failure |
| **No response models** | Every endpoint returns bare dicts. No OpenAPI response schema, no field filtering — DB column renames leak straight to the client |
| **No migrations** | `CREATE TABLE IF NOT EXISTS` plus a `COUNT(*) > 0` seed guard means schema and seed changes silently do not apply to an existing DB |
| **No indexes** | None anywhere, despite a 12-query analytics endpoint |
| **No FKs on `issues`** | Seven relational columns, zero `FOREIGN KEY` clauses, despite `PRAGMA foreign_keys=ON`. Same for `trailer_inspections`, `quick_requests`, `broadcasts`, `shift_handoffs`, `chat_messages` |
| **JSON-in-TEXT columns** | `companies.load_pattern`/`sop_rules`, `issues.quick_tags`/`ai_resolution`, several `knowledge_base` columns. Manual `json.loads` at every read site — some wrapped in try/except, some not |
| **Dual dock state** | `status` and `lifecycle_phase` mutated independently by five handlers with no state machine |
| **No logging** | `print()` in the LLM failure path (`ai_engine.py:308`) under a bare `except Exception` |

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

- **A new endpoint** → add it to `api.js`, and to `docs/requirements/functional-specs.md`.
- **A new domain rule, threshold or weight** → it goes in `ai_engine.py` or the seeded knowledge
  base, **and** in `docs/architecture/business-rules.md`. Both, same commit.
- **A new WebSocket event** → backend emitter plus both layout handlers plus the functional spec.
- **A second use of a helper** → that is when it moves to `src/utils/`, not the first.
- **Anything touching the WMS** → it goes through `WmsClient`, never around it.
