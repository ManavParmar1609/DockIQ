# DockIQ.AI — Documentation

Start here. These documents are the reviewable record of what DockIQ is, what it does, and what
rules it enforces. They are written to be **correct rather than flattering** — where the product
does not yet do something the source material promises, that is recorded, not omitted.

## Reading order

| # | Document | Read it when |
|---|---|---|
| 1 | [requirements/business-requirements.md](requirements/business-requirements.md) | You need the *why* — the problem, the cost of it, and what is being asked for |
| 2 | [specs/product-spec.md](specs/product-spec.md) | You need the product story — the five scenarios and the capability groups |
| 3 | [requirements/functional-specs.md](requirements/functional-specs.md) | You need the *what* — actors, the 30 endpoints, the WebSocket contract, the state machines |
| 4 | [architecture/business-rules.md](architecture/business-rules.md) | **Before changing any threshold, weight or multiplier.** The severity formula, cost model, cold-chain rules and per-customer SOPs |
| 5 | [specs/ui-ux-spec.md](specs/ui-ux-spec.md) | You are touching the frontend — screens, environment constraints, and what a redesign must not break |
| 6 | [roadmap.md](roadmap.md) | You want to know what is planned and why, including the gap between the docs and the code |

## The four documents that carry the most weight

- **business-rules.md** — every domain rule currently living as a literal in code. If a number in
  here and a number in `ai_engine.py` disagree, that is a bug in one of them; find out which.
- **functional-specs.md §6** — the honest gap list between what the source documents promise and
  what the code does.
- **ui-ux-spec.md §1** — the environment constraints. Gloves, cold, glare, food safety. These
  outrank aesthetics.
- **roadmap.md** — the plan, and the two source documents currently blocking part of it.

## Conventions

- ⚠️ marks a **known defect or a rule that is implemented but unreachable**. These are deliberate,
  not documentation errors.
- Every rule cites its source location (`file.py:line`) so it can be verified.
- Source material lives in `DocumentsforProj/`. Extracted plain text is in `.scratch/source-text/`
  (gitignored — regenerate rather than commit it).

## Keeping these current

**When a threshold, weight or multiplier changes in code, change it in
[business-rules.md](architecture/business-rules.md) in the same commit.** An unreviewable number
that drives a food-safety decision is the most dangerous thing in this repository.

Engineering rules — architecture, code style, testing, security, frontend aesthetics — live in
[`.claude/rules/`](../.claude/rules/) and are loaded automatically via `CLAUDE.md`.
