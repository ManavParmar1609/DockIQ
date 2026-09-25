# Deployment — the $0 stack

| Piece | Host | Free-tier facts that matter |
|---|---|---|
| Database | **Neon** Postgres | 0.5 GB, 100 compute-hours/month, scales to zero after 5 min idle, wakes in < 1 s |
| API + WebSocket | **Koyeb** free instance | 512 MB / 0.1 vCPU, Frankfurt or Washington DC, sleeps after **1 h** with no traffic, ~5 s cold start |
| Frontend | **Vercel** Hobby | Static build of `frontend/` |
| CI | **GitHub Actions** | Runs `.github/workflows/ci.yml` on every push and PR |
| Chat LLM | NVIDIA API catalog *(optional)* | Free developer key from build.nvidia.com. Without it chat answers from the knowledge base |

No card is required anywhere. **Before a live demo, open the app once a minute or two ahead** so
Koyeb wakes the API; the first request after an idle hour takes a few seconds.

> This build has **no authentication** until Phase 2A. Deploy it only with the seeded fictional
> data. See `.claude/rules/security.md`.

---

## 1. Neon — the database

1. Create a project at neon.tech. Pick the AWS region closest to your Koyeb region
   (Washington DC → `us-east-1`; Frankfurt → `eu-central-1`).
2. Create a database named `dockiq`.
3. Copy the **direct** connection string (not the `-pooler` host). It looks like
   `postgresql://USER:PASSWORD@ep-….us-east-1.aws.neon.tech/dockiq?sslmode=require`.
   Paste it as-is — the API converts it for `asyncpg` itself.

The schema is created by Alembic migrations when the API boots. There is nothing to run by hand.

## 2. Koyeb — the API

Create a **Web Service** from the GitHub repository:

| Setting | Value |
|---|---|
| Builder | **Dockerfile** |
| Work directory | `backend` |
| Instance | **Free** |
| Region | Washington DC or Frankfurt (match Neon) |
| Port | `8000`, protocol HTTP |
| Health check | HTTP `GET /api/health` on port 8000 |

Environment variables:

| Name | Value | Secret? |
|---|---|---|
| `DATABASE_URL` | the Neon connection string | **yes** |
| `CORS_ORIGINS` | your Vercel URL, e.g. `https://dockiq.vercel.app` (comma-separate several) | no |
| `NVIDIA_API_KEY` | optional | **yes** |

`ENVIRONMENT=production` is baked into the image. On every boot the container runs
`python -m app.seed` — migrate to head, then load the demo data **only if the database is empty** —
and then starts uvicorn. Redeploys never duplicate or wipe data.

Check it: `https://<service>.koyeb.app/api/health` → `{"status":"ok"}`.

## 3. Vercel — the frontend

Import the repository, set **Root Directory** to `frontend` (framework preset: Vite), and set one
environment variable:

| Name | Value |
|---|---|
| `VITE_API_URL` | the Koyeb origin, e.g. `https://dockiq-api-yourorg.koyeb.app` — no trailing `/api` |

The WebSocket URL is derived from it (`https` → `wss`, path `/ws`). A production build **refuses to
run** without `VITE_API_URL`, so a misconfigured deploy fails in the build log instead of shipping
an app that silently receives HTML from every API call.

## 4. Resetting the demo data

The demo ages — seeded timestamps are relative to when it was seeded. To reset, run the seed with
`--reset` against the Neon database **from your machine** (it refuses when `ENVIRONMENT=production`):

```powershell
cd backend
$env:DATABASE_URL = "<the Neon connection string>"
uv run python -m app.seed --reset
Remove-Item Env:DATABASE_URL
```

## 5. Local development

See the root `README.md`. Locally the API uses SQLite (`backend/dev.db`) and needs no accounts.
