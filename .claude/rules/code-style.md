# Code Style Rules

These codify what the codebase does and the tooling enforces: ruff for Python; TypeScript strict,
ESLint (typescript-eslint strict, type-checked) and Prettier for the frontend.

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

## TypeScript / React (`frontend/src/`)

`npm run lint`, `npm run typecheck`, `npm run format:check` and `npm test` must be clean.

- TypeScript **strict**, plus `noUncheckedIndexedAccess`. No `any`; no `as` to silence the checker.
- Function components and hooks. Pages are `export default function Name()`; shared components are
  named exports. `.tsx` for components, `.ts` otherwise.
- **API:** only through `src/api/`. Response types are **generated** (`npm run gen:api`) — never
  hand-written. Every read is a hook in `api/hooks.ts`; every data view renders through
  `QueryBoundary`; every mutation shows its error with `MutationError`.
- **No floating promises** (lint-enforced): `void` a fire-and-forget, or handle it.
- **No side effects in state updaters.** Effects go in event handlers or `useEffect`.
- **Vocabulary lives once:** issue status, dock status and lifecycle labels in `lib/vocab.ts`;
  issue types, subtypes, resolutions and request types come from `GET /api/taxonomy`.
- **Styling:** tokens only (`styles/app.css`). No hex in components, no arbitrary Tailwind values
  (`w-[…]`, `[font-stretch:…]`) — add a named class to `app.css` instead. The default Tailwind palette
  does not exist here.
- Icons: `lucide-react` (already the project's icon set). **No emoji as icons.**
- Import order: react → libraries → `api/` → `auth/` → components → `lib/` → relative.

## Shared

- **No secrets in source**, ever. See `security.md`.
- **No absolute paths** in code or config.
- **The `operator` / `worker` vocabulary split is real** — DB says `operator`, frontend routes and
  labels say `worker`. Do not "fix" one side without the other; it is a coordinated change.
- Comment density: match the file. The backend has section-banner comments (`# ── NAME ──`); the
  frontend has almost none. Neither needs more.
- Throwaway artifacts — extraction dumps, probe scripts, one-off outputs — go in `.scratch/`
  (gitignored), never in the project tree.
