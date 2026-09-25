# Testing Rules

## The state

**Backend:** pytest, in `backend/tests/`. Run with `cd backend; uv run pytest`. The same suite runs
against SQLite locally and against Postgres in CI (`TEST_DATABASE_URL`). Every test that touches the
API gets a **freshly migrated, freshly seeded** database — never `dev.db`.

| Module | Covers |
|---|---|
| `test_severity.py` | Pinned weight/risk/tier tables, every band boundary, every modifier step, stacking, the reason text |
| `test_domain_rules.py` | Pinned cost multipliers, retrieval thresholds and bonuses, recurrence threshold, inspection gate, dock transitions |
| `test_api_issues.py` | Create → score → escalate → resolve, dock status side effects, filters, 404s, WebSocket events |
| `test_api_operations.py` | Reference data, orders, inspections, requests, broadcasts, handoffs, chat fallback, analytics |
| `test_platform.py` | Settings normalisation, migrations match the models, downgrade/upgrade round-trip |

**Frontend:** Vitest + Testing Library (`npm test`), jsdom. `lib/lib.test.ts` pins the pure helpers
(`timeAgo`, EAN-13, the status vocabulary, severity-reason parsing); `components/components.test.tsx`
covers `SeverityBadge` (all four levels, red only for critical), `ConfidenceMeter` and `LoadPlanView`.

---

## Rules

### The pinning rule

**The severity weight table, the product risk multipliers, the tier multipliers and the cost
multipliers each have a test that asserts their current values verbatim.** The purpose is not to
prevent change — it is to make a tuning change a *visible, deliberate diff* that also has to touch
`docs/architecture/business-rules.md`. A silent edit to `ISSUE_TYPE_WEIGHTS` fails CI.

### Known defects are tests too

A known defect gets a test that asserts the **correct** behaviour, marked
`@pytest.mark.xfail(strict=True, reason="KNOWN DEFECT …")`. When the fix lands the test starts
passing, `strict=True` turns that into a failure, and the marker must be removed in the same change.
`test_total_non_delivery_scores_shortage_modifier` is the model.

### What a good test looks like here

- Names state the rule: `test_total_non_delivery_scores_shortage_modifier`, not `test_count_2`.
- Domain tests call pure functions directly — no database, no client.
- API tests use the `client` fixture and assert the **business outcome** (`severity == "critical"`,
  the dock flipped to `issue`), then the score if it matters.
- Arrange with the smallest data that exercises the rule; lean on the seed's documented facts
  (listed at the top of `test_api_issues.py`) rather than inserting rows by hand.
- A test that pins a number cites where that number is documented:
  `# see docs/architecture/business-rules.md §1.1`.

### When you add something

- New endpoint → at least one API test for the happy path and one for the 404/422 path.
- New migration → `test_migrations_match_the_models` must still pass (it compares models to the
  migrated schema).
- New domain rule → a pure-function test, plus a pinning test if it introduces a number.

---

## Frontend: before calling a UI change done

1. `npm run lint && npm run typecheck && npm test && npm run build`.
2. Run both servers and open, once each, as **OP-001**: Shift, Order (all tabs), Inspection, Report,
   My issues, Assistant; as **SUP-001**: Floor, an issue detail, Issue log, Analytics, Handoff; as
   **QA-001**: Quality. Watch the console for any red.
3. For layout work, check a tablet (1180×820), a phone (390×844) and a desktop (1440×900).
