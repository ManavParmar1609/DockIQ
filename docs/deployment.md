# Putting DockIQ online — step by step

This takes about **20 minutes** and costs **nothing**. No credit card is needed anywhere.

You will do three things, **in this order**, and you never have to go back to an earlier step:

| Step | Service | What it runs | You end up with |
|---|---|---|---|
| 1 | **Neon** | The database | a *connection string* (a long line of text) |
| 2 | **Render** | The server (the "API") | a web address like `https://dockiq-api.onrender.com` |
| 3 | **Vercel** | The website people open | a web address like `https://dockiq.vercel.app` ← **this is the link you share** |

Each step uses **only** what the step before it gave you. Neon's string goes into Render. Render's
address goes into Vercel. That's it.

---

## Before you start: three things to have ready

1. **Your accounts.** GitHub (your code is already there), Neon, Render and Vercel. Sign up to
   Render and Vercel **with your GitHub account** — it saves a step later.
2. **Your NVIDIA API key** — the *new* one (build.nvidia.com → your profile → API Keys). This is
   what makes the assistant smart. If you don't have one, the app still works; the assistant just
   answers from its built-in rules.
3. **A demo password you make up**, for example `Dock-Demo-2026`. Everyone who tries the app signs in
   with this password (with IDs like `OP-001`). Write it down.

> ### About the `.env` file
> **You do not need the `.env` file to put DockIQ online.** It is only for running DockIQ on your
> own computer (see "Optional" at the end). Everything for the online version is typed into the
> Render and Vercel websites, in the steps below. **Never put a password or key in any other file,
> in a commit, or in a chat** — if you ever do, treat it as leaked and replace it.

---

## Step 1 — Neon: get your database connection string

You already created the Neon project. Because its connection string was shared in a chat, first
give the database user a new password, so the leaked one stops working.

1. Go to **console.neon.tech** and open your project.
2. In the left menu, open **Branches → production** (or your main branch) → **Roles**.
3. Next to **neondb_owner**, click the **⋯** menu → **Reset password** → confirm.
4. Go back to the project **Dashboard** and click the **Connect** button (top right).
5. A box appears with a line starting `postgresql://`. Click **Copy**.
   *(Pooled or not doesn't matter — DockIQ handles both.)*
6. Paste it into a **temporary note** (Notepad). You will need it in Step 2, and then you can delete
   the note.

✅ **You now have:** the connection string. It looks like
`postgresql://neondb_owner:••••@ep-…-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`

---

## Step 2 — Render: put the server online

DockIQ contains a file called `render.yaml` that tells Render exactly what to build, so you only
answer three questions.

1. Go to **dashboard.render.com** and sign in (with GitHub).
2. Click **New +** (top right) → **Blueprint**.
3. Under *Connect a repository*, pick **ManavParmar1609/DockIQ**.
   - Don't see it? Click **Configure account** (GitHub opens) → under *Repository access* choose
     **DockIQ** → **Save**. Back on Render, it now appears.
4. **Blueprint Name:** type `dockiq`. **Branch:** `main`. Render shows one service:
   **dockiq-api** — *Web Service · Free*.
5. Render now asks for three values. Fill them in:

   | Box | What to paste |
   |---|---|
   | `DATABASE_URL` | the Neon connection string from Step 1 |
   | `DEMO_PASSWORD` | the demo password you made up |
   | `NVIDIA_API_KEY` | your NVIDIA key (starts with `nvapi-`). No key? Leave it empty |

   Everything else (a secret for signing people in, the model name, the simulator) is already set
   by the file — you don't type anything else.
6. Click **Deploy Blueprint** (or **Apply**).
7. Wait. The first build takes **5–10 minutes**. Click **dockiq-api** → **Logs** to watch. It is
   finished when you see a line containing **`Application startup complete`**.
8. At the top of the **dockiq-api** page there is a web address, like
   **`https://dockiq-api.onrender.com`** (yours might have extra letters). **Copy it** into your
   note.
9. **Check it works:** open that address with **`/api/health`** added on the end, e.g.
   `https://dockiq-api.onrender.com/api/health`. You should see:
   ```
   {"status":"ok"}
   ```

✅ **You now have:** the Render address. You can delete the Neon string from your note now.

> Render's free server **goes to sleep after 15 minutes** without visitors. The next visit wakes it,
> which takes **about a minute**. Before showing DockIQ to someone, open it a minute early.

---

## Step 3 — Vercel: put the website online

1. Go to **vercel.com** and sign in (with GitHub).
2. Click **Add New…** → **Project**.
3. Find **DockIQ** in the list and click **Import**.
4. On the *Configure Project* screen, set exactly this:

   | Setting | Value |
   |---|---|
   | **Project Name** | `dockiq` — **type it exactly like this.** The server only trusts a Vercel site with this name, which is why you never have to give Render the website's address |
   | **Framework Preset** | `Vite` |
   | **Root Directory** | click **Edit** → select the **`frontend`** folder → **Continue** |

5. Open **Environment Variables** and add one:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | your Render address from Step 2, e.g. `https://dockiq-api.onrender.com` — **nothing after `.com`** (no `/` and no `/api`) |

6. Click **Deploy**. It takes 1–2 minutes. When the confetti appears, click **Continue to
   Dashboard**.
7. Under **Domains** you'll see your website address, e.g. **`https://dockiq.vercel.app`**.

✅ **You're online.** That Vercel address is the link to share.

---

## Step 4 — Try it

1. Open your Vercel address. If the sign-in screen says it is waking the server, wait up to a minute.
2. Sign in with an ID and your demo password:

   | ID | Who |
   |---|---|
   | `OP-001` | a dock operator |
   | `SUP-001` | a supervisor (try **Simulator → Play** to watch trucks arrive) |
   | `QA-001` | Quality |

From now on, **every time code is pushed to `main`, Render and Vercel update themselves.** You don't
repeat any of these steps.

---

## If something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| Vercel build fails with **"VITE_API_URL is not set"** | Step 3.5 was skipped | Vercel → project → **Settings → Environment Variables** → add it → **Deployments** → ⋯ on the latest → **Redeploy** |
| The website says **the server could not be reached** | Render is waking up, or `VITE_API_URL` is wrong | Wait one minute and retry. Still failing? Open `…onrender.com/api/health` yourself. If that works, re-check `VITE_API_URL` in Vercel (exact address, nothing after `.com`), then **Redeploy** — Vercel only reads it when it builds |
| Browser console mentions **CORS** | The Vercel project isn't named `dockiq` | Either rename it (Vercel → Settings → General → Project Name), **or** in Render → dockiq-api → **Environment** add `CORS_ORIGINS` = your exact Vercel address |
| Render logs say **password authentication failed** | The Neon string is wrong or old | Copy it again from Neon (**Connect**), then Render → dockiq-api → **Environment** → edit `DATABASE_URL` → **Save** (Render restarts by itself) |
| Sign-in says **wrong password** | The demo password differs | Render → dockiq-api → **Environment** → check `DEMO_PASSWORD` |
| The assistant gives short, rule-based answers | No NVIDIA key, or it's wrong | Render → dockiq-api → **Environment** → set `NVIDIA_API_KEY` → **Save** |

**Changing any value later:** Render → **dockiq-api** → **Environment**, or Vercel → project →
**Settings → Environment Variables**. Render restarts on its own; on Vercel, click **Redeploy**.

---

## Where every value lives

| Value | Where it goes | Who makes it |
|---|---|---|
| Neon connection string | Render → `DATABASE_URL` | Neon (Step 1) |
| Demo password | Render → `DEMO_PASSWORD` | you |
| NVIDIA API key | Render → `NVIDIA_API_KEY` (and optionally your computer's `.env`) | NVIDIA |
| Sign-in secret (`JWT_SECRET`) | Render, filled in automatically | Render |
| Render address | Vercel → `VITE_API_URL` | Render (Step 2) |

---

## Optional — running DockIQ on your own computer

Only needed if you want to run it locally (you don't need this to be online). Locally, DockIQ uses
its own small database file, so **don't** put the Neon string here — your computer would then write
into the live database.

The only thing worth putting in `backend/.env` is your NVIDIA key, so the assistant is smart locally
too. The file should contain just this line:

```
NVIDIA_API_KEY=nvapi-your-key-here
```

(`backend/.env` is ignored by Git, so it is never uploaded.) Then follow the "Commands" section of
the root `README.md`. Sign in locally with password `dockiq-demo`.

---

## For maintainers

- **Why Render:** Koyeb was the original host. Mistral AI acquired Koyeb in February 2026 and its
  free tier is closed to new sign-ups. The `backend/Dockerfile` is host-neutral; `render.yaml` is the
  Render Blueprint (Docker, Ohio region next to Neon `us-east-2`, health check `/api/health`).
- **Database:** migrations run and demo data is seeded on the first boot (`python -m app.seed`, then
  uvicorn on Render's `$PORT`); later boots never duplicate or wipe data. A `-pooler` Neon host is
  PgBouncer, so the engine switches to NullPool with unique prepared-statement names.
- **CORS:** `CORS_ORIGINS` (explicit list) plus `CORS_ORIGIN_REGEX`, which defaults to the project's
  own Vercel sites, `https://dockiq(-…)?.vercel.app`. Set it to an empty value to allow only the
  list.
- **Login rate limit:** uvicorn trusts `X-Forwarded-For` from any peer (`--forwarded-allow-ips='*'`,
  because Render's proxy addresses are not fixed), so the per-address limit can be dodged with a
  forged header; the second limit, 10 attempts a minute per employee ID, still holds.
- **Reset the demo data** (it ages: timestamps are relative to when it was seeded), from a machine
  with the repo — it refuses when `ENVIRONMENT=production`:
  ```powershell
  cd backend
  $env:DATABASE_URL = "<the Neon connection string>"
  uv run python -m app.seed --reset
  Remove-Item Env:DATABASE_URL
  ```
  The simulation alone resets from the app: **Simulator → Reset**.
