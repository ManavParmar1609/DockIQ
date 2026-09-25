# DockIQ.AI — Business Requirements

**Source:** `DocumentsforProj/DockIQ_AI_Executive_Summary.pdf` — *Dock-Door Operator Support
Initiative*, Executive Summary for Company Presentation, 1 July 2026, prepared by Rishabh Gupta.

This document restates the business case. It is the "why" that every technical decision in this
repository should be traceable to. For what the system does, see
[functional-specs.md](../requirements/functional-specs.md); for the rules it enforces, see
[business-rules.md](../architecture/business-rules.md).

---

## 1. The problem

Forklift operators loading and unloading trailers regularly hit issues they cannot resolve alone — a
damaged pallet, a barcode that won't scan, a temperature reading out of range, a mismatch between
paperwork and product. When that happens the operator must stop working and either drive across the
facility to find a supervisor or reach them by radio. The supervisor then has to travel to the dock
before the issue can even be assessed.

Two further gaps compound it:

- **Discrepancy records are paper.** When an operator identifies a wrong SKU, short count,
  temperature deviation or mismatched lot, it is recorded by hand, disconnected from the warehouse
  management system.
- **Handling rules are not usable at the point of work.** The customer- and product-specific rules
  operators need — load patterns, lot rules, temperature thresholds — exist as dense reference
  sheets, not as something consultable while loading.

The source document is explicit that this is **not any individual's fault** — it is a gap in process
and tooling.

## 2. Why it matters

| Cost | Detail |
|---|---|
| **Idle time** | Every minute an operator spends finding a supervisor is a minute the dock isn't moving — directly affecting trailer turn time and throughput |
| **No triage by urgency** | Supervisors respond to whoever reaches them first. A safety concern and a minor scanning glitch currently compete for attention identically |
| **No searchable history** | Paper records mean no visibility across dock doors, shifts or customers — and no way to spot patterns or repeat problems |
| **Food-safety risk** | In cold storage specifically, some delays carry direct product-quality and food-safety exposure, not merely an efficiency cost |

## 3. What is proposed

A tablet-based tool at each dock door giving an operator, in one place:

1. Their assigned load, customer and paperwork details — pulled from the WMS with no re-keying.
   *(Simulated with hypothetical data in the prototype.)*
2. A one-tap way to flag an issue **by severity**, instantly notifying the right supervisor with full
   context — replacing the walk-or-radio process.
3. A digital discrepancy report, pre-filled with load data, replacing the paper form.
4. The applicable customer/product SOPs and a visual load-pattern guide, so fewer errors occur in
   the first place.
5. A built-in knowledge base and AI-assisted chat, so an operator facing a familiar issue can get
   step-by-step guidance immediately and attempt to resolve it themselves — reducing unnecessary
   escalations and freeing supervisors for issues that genuinely need them.

## 4. Approach — build first, then present

Rather than seeking approval on a concept, a fully working end-to-end prototype is being built
first, without company resources, budget or system access.

> **Binding constraint.** All data in the prototype — loads, customers, SOPs, discrepancies — is
> manually created, hypothetical sample data. **Nothing in the demo is real company or customer
> information.**

This constraint is load-bearing for the project's credibility and is enforced as a standing
engineering rule in [`.claude/rules/security.md`](../../.claude/rules/security.md). It becomes
*more* important, not less, as the simulation fidelity improves.

The goal is to walk into the company presentation with something leadership can see and use. Only
once there is real interest does the ask for WMS access, IT support and a pilot facility follow.

## 5. What will be asked for, once the prototype is ready

- Time to **demo the working prototype live** to the wider team, not merely describe it.
- If there is real interest: access to real WMS data/APIs, and confirmation of which systems (WMS,
  scanners, identity/login) integration would be permitted with.
- A decision on scope: **one cold-storage facility or dock cluster as a pilot**, before any wider
  rollout.
- Alignment with quality/compliance on what temperature and cold-chain records must look like for
  audit purposes — since that shapes the design before it goes further.

## 6. Investment and timeline

Directional only, per the source; to be firmed up once there is company involvement.

| Phase | Timeline | Investment |
|---|---|---|
| Prototype (self-built) | In progress | Personal time only — no company cost |
| Pilot (1 facility) | TBD — to be scoped | TBD — depends on build-vs-buy decision |
| Full rollout | TBD — phased by facility | TBD — informed by pilot results |

## 7. Proposed next step

Finish the working prototype using hypothetical sample data, then schedule a live demo with the
wider team — after which scope for a real pilot can be agreed.

---

## 8. Success measures

The source document does not state numeric targets, so these are the measures it *implies*. They
are recorded here as the criteria the prototype should be able to evidence, and are the reason the
analytics endpoint exists.

| Measure | Where it is evidenced today |
|---|---|
| Reduction in operator idle time per issue | Scenario deltas — 20 min → 5 min, 25 min → 5 min |
| Critical issues handled before minor ones | Supervisor priority queue, sorted by severity |
| Self-resolution rate (issues closed without a supervisor) | `GET /api/analytics/summary` |
| Searchable discrepancy history | `GET /api/issues`, the Issue Logs screen |
| Repeat-problem detection | `check_recurring_issues()` — ⚠️ computed but not yet surfaced |
| Errors prevented before they cost money | Scenario 3 ($4,200 chargeback), Scenario 4 ($6,000 re-delivery) |

⚠️ Two of these are not yet demonstrable in the running product. See
[roadmap.md](../roadmap.md).
