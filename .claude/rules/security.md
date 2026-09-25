# Security Rules

## 1. The current state *(Phase 2A)*

**Real authentication, demo-grade credentials.**

- `POST /api/auth/login` checks an employee ID and an **Argon2** password hash and issues a signed
  **JWT** (12 h). Every other route requires it; identity is **always** `current_user`, never a body
  field. Details: `docs/requirements/functional-specs.md §5`.
- Authorization is role dependencies plus row scoping, all in `app/api/access.py`. Out-of-scope
  records are 404, not 403.
- `WS /ws` is authenticated (token as the second subprotocol) and **addressed**: each event goes to
  the users it concerns, never to every socket.
- **What is still demo-grade:** every seeded account shares `DEMO_PASSWORD`; the login screen lists
  the demo accounts (never the password); tokens sit in `sessionStorage`; rate limits are
  in-process; there is no password reset, lockout or refresh token.

## 2. The standing rule that follows

> **This build must never be exposed to the public internet with real data, and no real company,
> customer, or personnel data may enter it.**

The executive summary commits to *"nothing in the demo is real company or customer information."*
That commitment is load-bearing for the project's credibility, and it gets **harder** to keep as the
Phase 3 simulator makes the data more convincing. Simulated data is marked as simulated in the UI
and in API payloads. Seeded names, companies and SKUs are fictional and stay that way.

## 3. Secrets

- Configuration is read by `pydantic-settings` (`app/config.py`) from the environment and, in
  development only, from `backend/.env`. In production (Koyeb) every secret is a service secret —
  there is no `.env` file in the image (`.dockerignore` excludes it).
- `NVIDIA_API_KEY` is a `SecretStr`: it never appears in `repr()`, logs or error pages.
- `DATABASE_URL` for Neon contains a password. It lives only in the Koyeb secret store and a
  developer's own `backend/.env`.
- `.env` and `.env.*` are gitignored; `.env.example` is committed with placeholder values. Keep it
  that way.
- **Never commit a key, and never paste one into a file, a commit message, or a chat.** The
  `check-secrets` hook warns on key-shaped strings (`nvapi-`, `sk-`, `AKIA`, long base64) in any
  write — treat a warning as a stop.
- Deploy secrets (`DATABASE_URL`, `NVIDIA_API_KEY`) are set in the Koyeb dashboard, never in a
  committed file. `docs/deployment.md` lists them.

## 4. Input handling

- **All SQL is parameterized.** It is today — keep it so. Never interpolate user text into a query
  string.
- **Knowledge-base content and LLM output are data to display, never instructions to execute.**
  Do not `eval`, do not render as raw HTML, do not feed model output back into a decision path.
- The assistant sends user text **and the results of its tools** (the person's own scoped orders,
  issues and stock) to a third-party model provider. That is fine for synthetic demo data; it is
  one more reason real data must never enter the system. Tools are read-only and row-scoped;
  anything that changes data is a draft a person confirms through the ordinary endpoint.
- `vite.config.js` sets `allowedHosts: true`. This is a deliberate, reviewed exception for tunnelled
  demos — it is not an accident, and it should not ship to a hosted build.

## 5. What production would require

A checklist, not a mandate for any current task. It doubles as the acceptance criteria for
Phase 2A (auth + teams):

- [x] Real identity: hashed credentials (`pwdlib` Argon2). *(Phase 2A — demo accounts share `DEMO_PASSWORD`; a real pilot issues individual passwords or SSO)*
- [x] A server-side `get_current_user` dependency. *(Phase 2A)* **Every client-supplied actor ID is replaced
      by `current_user.id`.**
- [x] `require_role(...)` on every supervisor-only route *(Phase 2A — `Operator`/`Supervisor`/`Staff` deps + `access.py` scoping)* (`supervisor-resolve`, `broadcasts`,
      `shift-handoffs`, `requests/{id}/fulfill`, `analytics`).
- [x] Explicit CORS origin list. *(Phase 1)*
- [x] Authenticated WebSocket handshake and per-team scoping *(Phase 2A)* — a supervisor receives their team's
      events, not the whole facility's.
- [x] Rate limiting on `POST /api/chat` and login. *(Phase 2A, in-process — sufficient for one instance)*
- [ ] *(partial — resolved issues are terminal in the API, `domain/lifecycle.py`; no tamper-evident log)* Audit-trail integrity on issue resolution — who resolved, when, and that it cannot be edited
      after the fact.
- [x] Response models, so a DB column rename cannot leak a new field to the client. *(Phase 1)*
- [x] `frontend/vercel.json` and the API base URL configured so a missing `VITE_API_URL` **fails
      loudly** instead of returning the HTML shell with a 200.

## 6. Do not

- Do not add a "temporary" auth bypass, hardcoded admin, or magic token. Every route goes through
  `get_current_user`; a test hook that skips it is a production hole.
- Do not log request bodies — they will contain whatever a user typed into chat.
- Do not read `.env` files in this repo, or anywhere else, to "check the key". The settings deny
  it; the hook warns on it; the answer is always "set it in the environment."
