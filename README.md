# DockIQ.AI

Dock-door intelligence for cold-storage warehouses. Operators scan, count and report issues from a
tablet at the dock; a **deterministic, explainable** engine scores severity, estimates the cost and
finds the procedure with its SOP source; supervisors triage their own team's queue in real time;
Quality is told about cold-chain and product-integrity issues the moment they are raised. Each
customer's trailer load plan is drawn pallet by pallet.

> **Prototype on fictional data.** Every company, carrier, product and person in the seed is
> invented. Sign-in is real but the credentials are demo credentials — never deploy it with real data.

## Stack

| | |
|---|---|
| API | Python 3.12 · FastAPI · SQLAlchemy 2 (async) · Alembic · Pydantic v2 · Argon2 + JWT · `uv` |
| Database | SQLite locally · Neon Postgres in production |
| Frontend | React 19 · TypeScript (strict) · Vite 8 · Tailwind 4 · TanStack Query · React Router 8 |
| Quality | pytest (SQLite + Postgres) · Vitest + Testing Library · ruff · ESLint · Prettier · GitHub Actions |
| Hosting | Render (API) · Vercel (frontend) · Neon (DB) — all free tiers, see [docs/deployment.md](docs/deployment.md) |

## Run it locally

Prerequisites: [uv](https://docs.astral.sh/uv/) and **Node 24** (`fnm use` / `nvm use` reads
`frontend/.node-version`). No accounts or keys needed.

```powershell
# API — http://127.0.0.1:8000  (interactive docs at /docs)
cd backend
uv sync
uv run python -m app.seed          # create backend/dev.db: migrate + load demo data
uv run uvicorn app.main:app --reload

# Frontend — http://127.0.0.1:5173  (second terminal; proxies /api and /ws to :8000)
cd frontend
npm install
npm run dev
```

Sign in as `OP-001` (operator), `SUP-001` (supervisor) or `QA-001` (quality) with the local demo
password `dockiq-demo`. Reset the demo data with `uv run python -m app.seed --reset`.

Optional: `NVIDIA_API_KEY=…` in `backend/.env` (see [backend/.env.example](backend/.env.example)) has
the chat assistant answer with an LLM. Without it, chat answers from the knowledge base.

## Test

```powershell
cd backend;  uv run pytest; uv run ruff check .; uv run ruff format --check .
cd frontend; npm run lint; npm run typecheck; npm test; npm run build
```

Set `TEST_DATABASE_URL` to a Postgres URL to run the backend suite against Postgres (CI does).

## Documentation

Start at [docs/README.md](docs/README.md). The plan is [docs/roadmap.md](docs/roadmap.md); every
scoring rule and threshold is in [docs/architecture/business-rules.md](docs/architecture/business-rules.md);
the interface is specified in [docs/specs/ui-ux-spec.md](docs/specs/ui-ux-spec.md).
