# Testing Rules

## The honest state

**There are zero tests.** `backend/tests/test_ai_engine.py` and `backend/tests/test_workflows.py`
are 0-byte files. A stale `conftest.cpython-312-pytest-8.4.2.pyc` in `backend/tests/__pycache__`
shows tests once existed and were deleted. `pytest` is not in `requirements.txt` despite the README
saying `cd backend && pytest`. The frontend has no test runner, no test script, no test files.

Do not describe this project as tested. Do not add to the README's claim until it is true.

---

## Backend — when tests are added

- **`pytest` + FastAPI `TestClient`.** Add `pytest` and `httpx` to a `requirements-dev.txt`.
- **Never against the dev `dockiq.db`.** Each test module gets a temp SQLite file via a fixture
  that calls `init_db()` on a fresh path and removes it after. The current `database.py` derives its
  path from `__file__`, so this needs a small indirection (an env var or a parameter) — that is the
  first thing to add.
- One test module per domain area: `test_severity.py`, `test_cost.py`, `test_retrieval.py`,
  `test_recurrence.py`, `test_inspections.py`, `test_issues_api.py`.

### First targets — pure functions with business consequences

These carry real food-safety and money decisions and are cheap to test because they are already
pure or nearly so:

| Function | What to pin |
|---|---|
| `classify_severity()` | Every band boundary (5.9 → low, 6 → medium, 12 → high, 18 → critical); every modifier fires and stacks; product category multiplies; **`count_actual = 0` triggers the shortage modifier** (it does not today — that test should fail until `ai_engine.py:93` is fixed); the dwell modifier fires when passed |
| `estimate_cost_impact()` | Each multiplier; unknown type → 0.2; missing product → 0.0 |
| `find_resolution()` | High/medium/low confidence thresholds at 4 and 2; category +2; company +1 and the `"all"` wildcard; the no-match fallback |
| `check_recurring_issues()` | Dock pattern at exactly 3; carrier pattern at exactly 3; 2 does not trigger; the 7-day window excludes day 8 |
| Inspection pass rule (`main.py:599-606`) | All four conditions; temperature exactly 45 passes, 45.1 fails; no temperature entered still passes |

### The pinning rule

**The severity weight table, the product risk multipliers, the tier multipliers and the cost
multipliers each get a test that asserts their current values verbatim.** The purpose is not to
prevent change — it is to make a tuning change a *visible, deliberate diff* that also has to touch
`docs/architecture/business-rules.md`. A silent edit to `ISSUE_TYPE_WEIGHTS` should fail CI.

### API tests

`TestClient` against the app with the temp DB. Priority: `POST /api/issues` (the richest handler —
assert the dock flips to `status='issue'` and severity is populated), the escalate → resolve path,
and the inspection pass/fail response.

---

## Frontend

Framework choice is **open** pending the user's stack direction. Until it is decided, do not add a
test runner unilaterally.

### The manual checklist until then

Because there is **no ErrorBoundary anywhere**, a single unimported symbol white-screens a whole
page with nothing to catch it — `IssueDetail.jsx` did exactly this. So after any frontend change:

1. Log in as an **operator** and open every worker screen once: Dashboard, Inspection, Loading,
   Unloading, Resolve (`/app/resolve/new`), Chat, My Issues.
2. Log in as a **supervisor** and open every supervisor screen once: Dashboard, an escalated
   **Issue Detail**, Logs, Analytics, Chat, Handoff.
3. Watch the browser console for any red.

When a runner is chosen, the first component tests should be `SeverityBadge` (all four bands render
the right label and class), the status-label map (once there is one), and `timeAgo` (which today
never rolls up past minutes and renders "27914m ago").

---

## What a good test looks like here

- Names state the rule: `test_total_non_delivery_scores_shortage_modifier`, not `test_count_2`.
- Arrange with the smallest data that exercises the rule. No seeding 27 KB rows to test one.
- Assert on the **business outcome** (`severity == "critical"`), then on the score if it matters.
- A test that pins a number cites where that number is documented:
  `# see docs/architecture/business-rules.md §1.1`.
