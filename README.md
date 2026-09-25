# DockIQ.AI

Dock-door intelligence for cold-storage warehouses. Operators report loading and unloading issues from
a tablet; a **deterministic, explainable** engine scores severity, estimates the cost, and suggests a
resolution with its SOP source; supervisors triage an escalation queue in real time. An optional LLM
answers free-form questions in the chat assistant — and nowhere else.

> **Prototype on fictional data.** Every company, carrier, product and person in the seed is
> invented. There is no authentication yet (Phase 2A), so never deploy it with real data.

## Stack

| | |
|---|---|
| API | Python 3.12 · FastAPI · SQLAlchemy 2 (async) · Alembic · Pydantic v2 · `uv` |
| Database | SQLite locally · Neon Postgres in production |
| Frontend | React 18 · Vite · Tailwind |
| Quality | pytest (SQLite + Postgres in CI) · ruff · GitHub Actions |
| Hosting | Koyeb (API) · Vercel (frontend) · Neon (DB) — all free tiers, see [docs/deployment.md](docs/deployment.md) |

## Run it locally

Prerequisites: [uv](https://docs.astral.sh/uv/) and Node.js 20+. No accounts or keys needed.

```powershell
# API — http://127.0.0.1:8000  (interactive docs at /docs)
cd backend
uv sync
uv run python -m app.seed          # create backend/dev.db: migrate + load demo data
uv run uvicorn app.main:app --reload

# Frontend — http://127.0.0.1:5173  (in a second terminal; proxies /api and /ws to :8000)
cd frontend
npm install
npm run dev
```

Reset the demo data at any time with `uv run python -m app.seed --reset`.

Optional: put `NVIDIA_API_KEY=…` in `backend/.env` (see [backend/.env.example](backend/.env.example))
to have chat answered by the LLM. Without it, chat answers from the knowledge base.

## Test

```powershell
cd backend
uv run pytest                      # every test gets a fresh migrated + seeded database
uv run ruff check . ; uv run ruff format --check .
```

Set `TEST_DATABASE_URL` to a Postgres URL to run the same suite against Postgres (CI does).

## Documentation

Start at [docs/README.md](docs/README.md). The plan is [docs/roadmap.md](docs/roadmap.md); every
scoring rule and threshold is in [docs/architecture/business-rules.md](docs/architecture/business-rules.md).
