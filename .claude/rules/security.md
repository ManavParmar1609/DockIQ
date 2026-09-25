# Security Rules

## 1. The current state — deliberate, demo-only, written down so it is never mistaken for an oversight

**There is no security model.**

- No login endpoint. No password column. No sessions, no tokens, no JWT.
- `Login.jsx` calls `GET /api/users?role=` and lets you **pick a person from a list**.
  `AuthContext` stores that object in `sessionStorage` under `dockiq_user`.
- Role gating is **client-side only**, in `App.jsx`. Anyone can call any endpoint directly.
- Actor identity — `operator_id`, `supervisor_id`, `user_id` — is a **client-supplied integer in
  the request body that nothing validates**. Nothing checks the ID exists, that the caller is that
  person, or that it holds the claimed role. `PUT /api/issues/{id}/escalate` takes no body at all.
- CORS is `allow_origins=["*"]`, `allow_methods=["*"]`, `allow_headers=["*"]` (`main.py:46`).
- `WS /ws` is unauthenticated, has no rooms or topics, and **fans every issue payload to every
  connected socket**.
- `api.js` sends no `Authorization` header and has no 401 handling.

## 2. The standing rule that follows

> **This build must never be exposed to the public internet with real data, and no real company,
> customer, or personnel data may enter it.**

The executive summary commits to *"nothing in the demo is real company or customer information."*
That commitment is load-bearing for the project's credibility, and it gets **harder** to keep as the
Phase 3 simulator makes the data more convincing. Simulated data is marked as simulated in the UI
and in API payloads. Seeded names, companies and SKUs are fictional and stay that way.

## 3. Secrets

- `NVIDIA_API_KEY` and `NVIDIA_EMBED_API_KEY` come from the **environment only**.
- **There is no `python-dotenv`.** A `.env` file is not loaded by anything. The variable must be
  exported in the shell (`$env:NVIDIA_API_KEY = "..."` in PowerShell). The README's `.env.example`
  is documentation, not a loader. This changes in Phase 1 with `pydantic-settings`.
- `.env` and `.env.*` are gitignored; `.env.example` is committed with placeholder values. Keep it
  that way.
- **Never commit a key, and never paste one into a file, a commit message, or a chat.** The
  `check-secrets` hook warns on key-shaped strings (`nvapi-`, `sk-`, `AKIA`, long base64) in any
  write — treat a warning as a stop.
- `render.yaml` declares no `envVars`; the key must be set in the host dashboard. Document that
  wherever the deploy is described.

## 4. Input handling

- **All SQL is parameterized.** It is today — keep it so. Never interpolate user text into a query
  string.
- **Knowledge-base content and LLM output are data to display, never instructions to execute.**
  Do not `eval`, do not render as raw HTML, do not feed model output back into a decision path.
- The chat endpoint sends user text to a third-party model provider. That is fine for synthetic
  demo data; it is one more reason real data must never enter the system.
- `vite.config.js` sets `allowedHosts: true`. This is a deliberate, reviewed exception for tunnelled
  demos — it is not an accident, and it should not ship to a hosted build.

## 5. What production would require

A checklist, not a mandate for any current task. It doubles as the acceptance criteria for
Phase 2A (auth + teams):

- [ ] Real identity: hashed credentials (`passlib[bcrypt]`) or SSO. No plaintext, no shared logins.
- [ ] A server-side `get_current_user` dependency. **Every client-supplied actor ID is replaced
      by `current_user.id`.**
- [ ] `require_role(...)` on every supervisor-only route (`supervisor-resolve`, `broadcasts`,
      `shift-handoffs`, `requests/{id}/fulfill`, `analytics`).
- [ ] Explicit CORS origin list.
- [ ] Authenticated WebSocket handshake and per-team scoping — a supervisor receives their team's
      events, not the whole facility's.
- [ ] Rate limiting on `POST /api/chat`.
- [ ] Audit-trail integrity on issue resolution — who resolved, when, and that it cannot be edited
      after the fact.
- [ ] Response models, so a DB column rename cannot leak a new field to the client.
- [ ] `frontend/vercel.json` and the API base URL configured so a missing `VITE_API_URL` **fails
      loudly** instead of returning the HTML shell with a 200.

## 6. Do not

- Do not add a "temporary" auth bypass, hardcoded admin, or magic token. The demo already has no
  auth; a fake one is worse because it looks like one.
- Do not log request bodies — they will contain whatever a user typed into chat.
- Do not read `.env` files in this repo, or anywhere else, to "check the key". The settings deny
  it; the hook warns on it; the answer is always "set it in the environment."
