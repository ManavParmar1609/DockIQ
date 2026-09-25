# DockIQ.AI

Dock-door intelligence for cold-storage warehouses: operators report loading/unloading issues from a
tablet, a deterministic engine scores severity and suggests an SOP-cited resolution, supervisors
triage an escalation queue in real time.

**This is a prototype on synthetic data.** No auth, no real company or personnel data, never exposed
publicly with real data. See `.claude/rules/security.md`.

## Where things are

| Path | What |
|---|---|
| `backend/` | `uv` project. `app/api/` routers · `app/domain/` pure business rules · `app/models.py` + `migrations/` (Alembic) · `app/seed/` demo data · `tests/`. Map in `.claude/rules/architecture.md §1` |
| `frontend/src/` | React 18 + Vite + Tailwind. `App.jsx` → `WorkerLayout`/`SupervisorLayout` → 13 pages → `api.js` |
| `docs/deployment.md` | The $0 production setup: Neon + Koyeb + Vercel |
| `.github/workflows/ci.yml` | Lint, tests on SQLite **and** Postgres, Docker build, frontend build |
| `docs/` | The reviewable record. Start at `docs/README.md`; the plan is `docs/roadmap.md` |
| `.claude/rules/` | Architecture, code style, testing, security, frontend aesthetics — **auto-loaded**, not imported here |
| `.claude/skills/dockiq-frontend/` | Project skill — load it for any `frontend/src` change |
| `.claude/hooks/` | Three advisory PowerShell hooks (session context, secret check, format + lint). None block |
| `DocumentsforProj/` | Source material (PDF/DOCX). Two PDFs are 0 bytes — see roadmap §0 |
| `screenshots/` | UI captures from earlier passes |
| `claude-skills/` | **Vendored third-party skill repo.** Gitignored, edit-denied. Not project code |
| `generate_pdf.py`, `generate_flow_pdf.py` | Standalone reportlab PDF generators. Not part of the app |

## Commands (PowerShell)

```powershell
# Backend (from backend/) — uv manages backend/.venv
uv sync
uv run python -m app.seed            # migrate + seed backend/dev.db (no-op if already seeded)
uv run python -m app.seed --reset    # drop everything, migrate, reseed
uv run uvicorn app.main:app --reload # http://127.0.0.1:8000, OpenAPI at /docs
uv run pytest                        # fresh migrated+seeded DB per test; TEST_DATABASE_URL for Postgres
uv run ruff check . ; uv run ruff format .
uv run alembic revision --autogenerate -m "..."   # then hand-review; see architecture §2.7

# Frontend (from frontend/) — Vite proxies /api and /ws to :8000
npm run dev
```

## Non-obvious facts that cause mistakes

- **Schema changes are Alembic migrations**, hand-reviewed. The initial one is hand-written because
  autogenerate duplicates CHECK constraints and cannot order the `dock_doors` ⇄ `orders` FK cycle.
  `test_migrations_match_the_models` catches drift.
- **Severity is a deterministic weighted formula** (`app/domain/severity.py`), not an LLM call. The
  LLM (NVIDIA, via `AsyncOpenAI`) is used only in `app/services/assistant.py`.
- **Retrieval is keyword substring counting**, not embeddings.
- **Known rule defects are deliberate for now**, marked `KNOWN DEFECT (roadmap 2C)` in code and
  pinned by a strict-xfail test. Fixing one means removing the marker and updating business-rules.
- **All seed data is fictional** (`app/seed/data/*.json`, linked by natural keys). The original
  prototype used real retailer names; they were replaced in Phase 1. Keep it fictional.
- **`operator` in the DB, `worker` in the frontend.** Both are live. `App.jsx:25` checks
  `role === 'operator'` and renders the supervisor shell for *every other value*.
- **Dock state** (`status` + `lifecycle_phase`) changes only via `app/domain/dock.py:transition()`.
- **Layouts are `children` wrappers, not `<Outlet/>` routes**, and each duplicates the WebSocket
  bootstrap. The WS URL comes from `wsUrl()` in `api.js`.
- **The real design tokens are CSS vars in `index.css`.** The `dock.*`/`apple.*` palettes in
  `tailwind.config.js` are unused.
- **`index.css:49` forces `min-height: 44px`** on every button, link and input.
- **A production frontend build fails without `VITE_API_URL`** — by design (`vite.config.js`).
- **Config is `pydantic-settings`** (`app/config.py`): environment, plus `backend/.env` in dev.
  Never read `.env` files to check a key.
- **context7 is configured at user scope** (with its key), so there is deliberately no project
  `.mcp.json` — a keyless project entry would shadow the keyed user one.

## Working agreement

1. **Restate every prompt as a brief before acting:** Objective · Context · Constraints ·
   Acceptance criteria · Out of scope · Open questions. Flag ambiguity, then proceed on the
   unambiguous parts. Prompts here often bundle several asks — surface each one.
2. **Check `docs/roadmap.md` before starting work.** Phases run in order: 0 harness+docs →
   1 stack migration → 2 features + auth/teams → 3 simulated WMS. Features land on the final stack.
3. **A number in `backend/app/domain/` or the seeded knowledge base changes together with
   `docs/architecture/business-rules.md`**, same commit.
4. **New endpoint** → `api.js` + `docs/requirements/functional-specs.md`.
5. **Don't fix structural debt incidentally.** It is listed in `.claude/rules/architecture.md §5` on
   purpose; fix it as its own change.
6. **Typeface and palette for the redesign are proposed, not chosen** — bring 2–3 directions.
7. **Commit only when asked.** `main` is the only branch; branch first.

## Scratch files

Throwaway artifacts — extraction dumps, probe scripts, one-off reports — go to the session
scratchpad or to `.scratch/` (gitignored). Never into the project tree. Extracted source-document
text lives in `.scratch/source-text/`.
