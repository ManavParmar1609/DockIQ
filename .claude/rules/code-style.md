# Code Style Rules

These codify what the codebase already does consistently, and name the specific places it does not.
Tooling (ESLint, Prettier config, TypeScript) is **deferred** — the user will direct stack changes
later. Until then these are conventions to follow by hand.

---

## Python (`backend/`)

Enforced by **ruff** (lint + format, config in `backend/pyproject.toml`); the PostToolUse hook runs
it on every edit. `uv run ruff check . && uv run ruff format --check .` must be clean.

- 4-space indent, `snake_case`, double quotes, 110-column lines.
- **Type hints on every function signature**, including tests. Modern syntax: `X | None`,
  `list[str]`, PEP 695 generics (`def f[T: Base](...)`).
- **`logging`, never `print`.** Module-level `logger = logging.getLogger(__name__)`. Never log a
  request body or chat text.
- **`is None`, never truthiness, for numeric fields and ids.** `if count_actual:` treats a total
  non-delivery (0) as "not given" — that exact bug is the pinned `KNOWN DEFECT` in `severity.py`.
- **Timestamps are aware UTC**: `app.db.utcnow()`, columns typed `UTCDateTime`. `datetime.now()`
  without a timezone is a lint error (`DTZ`).
- **Enums, not magic strings**, for closed vocabularies — `app/domain/enums.py` (`StrEnum`).
- **SQLAlchemy 2.0 style only**: `select()`, `session.scalars()`, `Mapped[...]`. No raw SQL strings
  except the dialect-compiled helpers in `queries.py`. Never interpolate user input into SQL.
- **No hardcoded absolute paths.** Derive from `app.config.BACKEND_DIR`.
- Request and response bodies are Pydantic models in `app/schemas.py`.

## JavaScript / React (`frontend/src/`)

- `.jsx` for components, plain `.js` for non-component modules (`api.js`). No TypeScript yet.
- Function components only, hooks only. `PascalCase` file + `export default function SameName()`.
  Shared components are named exports from `components/`.
- **Every API call goes through `src/api.js`.** No `fetch` anywhere else.

### Conventions the codebase already follows — keep them

- **Import order**, uniform across all 13 pages:
  `react` hooks → `react-router-dom` → `AuthContext` → `api` → shared components → `lucide-react`.
- **Variant maps** over chained ternaries. The one genuinely reusable idiom here: a local object
  literal mapping a string prop to a class string, with a fallback —
  `SeverityBadge`'s `config`, `DockStatusDot`'s `colors`. Use it.
- **Domain enums** as `SCREAMING_CASE` module-level const arrays above the component
  (`ISSUE_TYPES`, `RESOLUTION_TYPES`). *But* these must become **one** shared list — today there
  are three divergent copies of the resolution types and four of the status map.

### Rules that fix what is wrong today

- **No side effects inside state updaters.** `Loading.jsx:31-53` and `Unloading.jsx:55-64` call
  `api.updateOrderItem(...)` inside a `setItems(prev => …)` callback. React may invoke updaters
  twice (StrictMode does), so this fires duplicate writes, and failures are swallowed. Effects go
  in `useEffect` or an event handler, never in an updater.
- **Every new `api` call site handles failure.** `api.js` throws a bare `Error` on non-2xx and all
  but one of the 40+ existing call sites are unguarded — a rejection becomes an unhandled promise
  and the page sticks on its loading state forever. New code sets an error state and renders it.
- **Guard `JSON.parse` on anything from the network.** Both WebSocket handlers parse unguarded.
- **Complete `useEffect` dependency arrays.** Several effects read `user` or `refresh` while
  declaring `[]`.
- **Delete dead imports as you go.** `Analytics` (`LineChart`, `Line`), `IssueLogs` (`Filter`,
  `Download`), `ShiftHandoff` (`ArrowLeftRight`), `SupervisorDashboard` (`Coffee`, `Sun`, `Moon`),
  `IssueResolution` (`useParams`), `WorkerDashboard` (`SeverityBadge`).

### Colour and styling

- Design tokens are the CSS custom properties in `index.css` (`--brand`, `--radius-md`,
  `--shadow-sm`, `--spring`). **The `dock.*`/`apple.*` palettes in `tailwind.config.js` are unused
  and not authoritative.** Under the planned redesign the token set changes — see
  `frontend-aesthetics.md` — but the rule holds: tokens live in one place.
- **No new hardcoded hex in JSX.** `Analytics.jsx:5-10` defines `APPLE_BLUE = '#0071e3'` as module
  constants; do not add to that pattern.
- **No new Tailwind arbitrary values** like `focus:ring-[#0071e3]/20` (currently in five files).
  If a value is needed twice, it is a token.
- **One grey family.** `gray`, `stone` and `zinc` are currently mixed across 18 files. New code
  uses whichever the redesign settles on; until then, match the file you are in and do not
  introduce a third.
- Remember `index.css:49` sets a global `min-height: 44px` on `button, a, input, select, textarea`.
  A compact chip that renders too tall is hitting that rule, not a bug in your class list.

## Shared

- **No secrets in source**, ever. See `security.md`.
- **No absolute paths** in code or config.
- **The `operator` / `worker` vocabulary split is real** — DB says `operator`, frontend routes and
  labels say `worker`. Do not "fix" one side without the other; it is a coordinated change.
- Comment density: match the file. The backend has section-banner comments (`# ── NAME ──`); the
  frontend has almost none. Neither needs more.
- Throwaway artifacts — extraction dumps, probe scripts, one-off outputs — go in `.scratch/`
  (gitignored), never in the project tree.
