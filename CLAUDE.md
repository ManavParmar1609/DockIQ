# DockIQ.AI

Dock-door intelligence for cold-storage warehouses: operators report and resolve loading/unloading
issues from a tablet, a deterministic engine scores severity and finds the SOP-cited procedure,
supervisors triage their team's queue live, and Quality hears about cold-chain breaks as they happen.

**A prototype on fictional data.** Real authentication (Phase 2A) but demo credentials; never deploy
it with real company or personnel data. See `.claude/rules/security.md`.

## Where things are

| Path | What |
|---|---|
| `backend/` | FastAPI · SQLAlchemy 2 async · Alembic · `uv`. `app/api/` routers · `app/domain/` pure rules · `app/services/` · `app/seed/` · `migrations/` · `tests/`. Map: `.claude/rules/architecture.md §1` |
| `frontend/` | React 19 · TypeScript strict · Vite 8 · Tailwind 4 · TanStack Query · React Router 8 · Node 24 |
| `docs/` | The reviewable record. Start at `docs/README.md`; plan: `docs/roadmap.md`; deploy: `docs/deployment.md` |
| `.claude/rules/` | Architecture, code style, testing, security, frontend aesthetics — **auto-loaded** |
| `.claude/skills/dockiq-frontend/` | Load it for any `frontend/src` change |
| `.claude/hooks/` | Advisory PowerShell hooks (session context, secret check, format + lint). None block |
| `.github/workflows/ci.yml` | Backend lint + tests on SQLite **and** Postgres + Docker build; frontend lint, types, tests, build |
| `DocumentsforProj/` | Source material. Two PDFs are 0 bytes — roadmap §0 |
| `claude-skills/` | **Vendored third-party skill repo.** Gitignored, edit-denied. Not project code |

## Commands (PowerShell)

```powershell
# Backend (from backend/)
uv sync
uv run python -m app.seed            # migrate + seed dev.db, or sync reference data if already seeded
uv run python -m app.seed --reset    # drop everything, migrate, reseed
uv run uvicorn app.main:app --reload # :8000, OpenAPI at /docs
uv run pytest ; uv run ruff check . ; uv run ruff format .

# Frontend (from frontend/) — needs Node 24: `fnm use` reads .node-version
npm install
npm run dev                          # :5173, proxies /api and /ws to :8000
npm run lint ; npm run typecheck ; npm test ; npm run build
npm run gen:api                      # regenerate API types from the running backend
```

Demo sign-in locally: any seeded ID (`OP-001`, `SUP-001`, `QA-001` …) with password `dockiq-demo`.

## Non-obvious facts that cause mistakes

- **Severity is a deterministic formula** (`app/domain/severity.py`), never a model. The LLM exists
  only in `app/services/assistant.py` (chat). Every number is pinned by a test and documented in
  `docs/architecture/business-rules.md` — change both together.
- **Identity comes from the token only.** No request body carries an actor id; scoping lives in
  `app/api/access.py`. Out-of-scope records are 404.
- **Frontend API types are generated** (`npm run gen:api`) — never hand-write a response shape. Run it
  after any backend schema change, with the backend running.
- **`issue_type` and subtypes come from `GET /api/taxonomy`** (`app/domain/taxonomy.py`); the frontend
  keeps no copies. Same for resolution and request lists.
- **Schema changes are hand-reviewed Alembic migrations.** On SQLite the migrator pauses FK
  enforcement for batch rebuilds and verifies with `PRAGMA foreign_key_check` afterwards. A failed
  SQLite migration can leave `_alembic_tmp_*` tables — drop them or `--reset`.
- **Reference data syncs on every boot** (`app.seed.sync_reference`): the knowledge base and company
  rules are replaced from `app/seed/data/*.json`; accounts, teams and GTINs are backfilled.
- **Rate limits are real:** 10 logins/min per client. Scripts that log in repeatedly will hit 429.
- **Tailwind's palette is wiped.** `bg-white`, `text-gray-500`, `rounded-lg` do not exist. Use the
  tokens in `frontend/src/styles/app.css`; no hex, no arbitrary values.
- **The uvicorn `--reload` watcher on Windows sometimes misses edits** — restart it if an endpoint
  looks stale.
- **The WMS is Phase 3** and goes behind `WmsClient` — never into route handlers.
- **context7 is configured at user scope** (with its key), so there is deliberately no project
  `.mcp.json` — a keyless project entry would shadow the keyed user one.

## Working agreement

1. **Restate every prompt as a brief before acting:** Objective · Context · Constraints ·
   Acceptance criteria · Out of scope · Open questions. Surface every bundled ask.
2. **Check `docs/roadmap.md` before starting work.**
3. **Everything stays free** — no paid services or card-required tiers (Koyeb, Neon, Vercel).
4. **A number in `app/domain/` or the seeded knowledge base changes with `business-rules.md`.**
5. **Commit only when asked.** Work on a branch.

## Scratch files

Throwaway artifacts go to the session scratchpad or `.scratch/` (gitignored), never the project tree.
