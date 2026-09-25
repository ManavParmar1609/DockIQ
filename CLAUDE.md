# DockIQ.AI

Dock-door intelligence for cold-storage warehouses: operators report loading/unloading issues from a
tablet, a deterministic engine scores severity and suggests an SOP-cited resolution, supervisors
triage an escalation queue in real time.

**This is a prototype on synthetic data.** No auth, no real company or personnel data, never exposed
publicly with real data. See `.claude/rules/security.md`.

## Where things are

| Path | What |
|---|---|
| `backend/` | FastAPI app — four flat files: `main.py` (routes, models, WS), `database.py` (DDL + seed), `ai_engine.py` (all domain logic), `reset_db.py` |
| `frontend/src/` | React 18 + Vite + Tailwind. `App.jsx` → `WorkerLayout`/`SupervisorLayout` → 13 pages → `api.js` |
| `docs/` | The reviewable record. Start at `docs/README.md`; the plan is `docs/roadmap.md` |
| `.claude/rules/` | Architecture, code style, testing, security, frontend aesthetics — **auto-loaded**, not imported here |
| `.claude/skills/dockiq-frontend/` | Project skill — load it for any `frontend/src` change |
| `.claude/hooks/` | Three advisory PowerShell hooks (session context, secret check, format + lint). None block |
| `DocumentsforProj/` | Source material (PDF/DOCX). Two PDFs are 0 bytes — see roadmap §0 |
| `screenshots/` | UI captures from earlier passes |
| `claude-skills/` | **Vendored third-party skill repo.** Gitignored, edit-denied. Not project code |
| `generate_pdf.py`, `generate_flow_pdf.py` | Standalone reportlab PDF generators. Not part of the app |

## Commands (PowerShell, from repo root)

The venv lives at the **repo root** (`.venv\`), not in `backend\`.

```powershell
# Backend — http://127.0.0.1:8000
$env:NVIDIA_API_KEY = "..."          # optional; without it chat falls back to keyword search
cd backend; ..\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000

# Frontend — http://127.0.0.1:5173 (Vite proxies /api and /ws to :8000)
cd frontend; npm run dev

# Reset the demo database (reseeds from database.py)
cd backend; ..\.venv\Scripts\python.exe reset_db.py
```

There are **no tests** (the two files in `backend/tests/` are empty) and no linter config. `ruff` is
not installed in the venv, so the format hook skips Python silently. See `.claude/rules/testing.md`.

## Non-obvious facts that cause mistakes

- **Schema and seed changes do not apply to an existing `backend/dockiq.db`.** `CREATE TABLE IF NOT
  EXISTS` plus a `COUNT(*) > 0` seed guard. Run `reset_db.py` after editing `database.py`.
- **Severity is a deterministic weighted formula**, not an LLM call. The LLM (NVIDIA endpoint via the
  `openai` client) is used only for chat. Keep it that way — rules §2.5.
- **Retrieval is keyword substring counting**, not embeddings. `get_embed_client()` in
  `ai_engine.py` is dead code.
- **`operator` in the DB, `worker` in the frontend.** Both are live. `App.jsx:25` checks
  `role === 'operator'` and renders the supervisor shell for *every other value* — a new role
  silently lands in the supervisor UI.
- **Dock state is split** across `status` and `lifecycle_phase`, mutated independently by five
  handlers. There is no state machine.
- **Layouts are `children` wrappers, not `<Outlet/>` routes**, and each duplicates the WebSocket
  bootstrap. A new WS event means editing both.
- **The real design tokens are CSS vars in `index.css`.** The `dock.*`/`apple.*` palettes in
  `tailwind.config.js` are unused.
- **`index.css:49` forces `min-height: 44px`** on every button, link and input. A chip that renders
  too tall is hitting that, not your classes.
- **API base URL:** `api.js` uses `VITE_API_URL` when set, else relative `/api`. Dev works via the
  Vite proxy; a production build without `VITE_API_URL` gets the HTML shell back with a 200.
- **No `.env` loader.** There is no `python-dotenv`; keys must be exported in the shell. Never read
  `.env` files to check a key.
- **context7 is configured at user scope** (with its key), so there is deliberately no project
  `.mcp.json` — a keyless project entry would shadow the keyed user one.

## Working agreement

1. **Restate every prompt as a brief before acting:** Objective · Context · Constraints ·
   Acceptance criteria · Out of scope · Open questions. Flag ambiguity, then proceed on the
   unambiguous parts. Prompts here often bundle several asks — surface each one.
2. **Check `docs/roadmap.md` before starting work.** Phases run in order: 0 harness+docs →
   1 stack migration → 2 features + auth/teams → 3 simulated WMS. Features land on the final stack.
3. **A number in `ai_engine.py` or the seeded knowledge base changes together with
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
