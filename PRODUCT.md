# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Dock workers (operators):** on a tablet mounted on a forklift or carried on the dock of a cold-storage
  warehouse; gloved hands, dim light, glare, time pressure, sometimes their first week. Job: load and
  receive trailers, inspect them, count cases, report problems and resolve the ones they can.
- **Supervisors:** run a zone of doors and a crew; triage problems live, make the calls a worker may not
  (critical food-safety issues), keep trailers moving, hand over to the next shift. Tablet on the floor,
  desk screen in the office, constantly interrupted.
- **Quality / food-safety leads:** watch the cold chain across the facility; place, release or destroy
  product on hold; need a traceable record for auditors and customers.

## Product Purpose

Dock-door intelligence for cold-storage warehouses. Workers report and resolve loading and unloading
problems at the door; a deterministic engine scores severity and finds the cited procedure; supervisors
triage their team's queue live; Quality hears about cold-chain breaks as they happen. Success: problems
are caught at the door, decided by the right person, and leave a record that can be traced.

## Positioning

Explainable, not magic: every severity is a fixed, documented formula with its derivation shown, every
procedure cites its SOP source and match confidence, and the assistant drafts but never decides.

## Operating Context

Outbound loading against customer load rules; inbound receiving with probe temperatures and checks;
trailer inspections; a simulated WMS (yard, gate, stock ledger with licence-plated pallets, crew tasks,
cold rooms) behind a boundary a real WMS can replace. Shift handoffs between supervisors. Everything
runs in the browser on free hosting (Render, Neon, Vercel).

## Capabilities and Constraints

- Roles: operator (UI says "worker"), supervisor, quality. Identity from the sign-in token only.
- Critical issues are always a supervisor's decision; workers self-resolve their own non-critical issues.
- Severity never comes from a model; the LLM only drafts and explains.
- Real-time updates over one WebSocket; no polling.
- Everything must stay free.

## Brand Commitments

- Name: **DockIQ** — "IQ" must never read as "12".
- Visual direction chosen by the owner (2026-09-26): the GSAP style reference, dark only — a near-black
  stage, cream type, outlined pills, bracket notes and colour-coded highlighters — with a display serif
  for editorial titles. Paid faces (Mori, Messina Sans, Untitled Serif) are replaced by free stand-ins.

## Evidence on Hand

All data is fictional demo data (companies, people, SKUs, trailers), visibly marked as simulated. No real
customers, testimonials, metrics or logos exist and none may be invented.

## Product Principles

1. Safety outranks style: severity is legible at a glance and never shown by colour alone.
2. Explain every number: derivation, source and confidence stay visible.
3. The right person decides: the interface routes decisions, it does not make them.
4. Nothing is lost quietly: offline taps, readings and decisions are kept and shown.
5. Honest about simulation: simulated data is always marked.

## Accessibility & Inclusion

WCAG AA contrast on the actual surfaces in light and dark; touch targets at least 44px; 14px type floor
(16px+ for values acted on); reduced motion, reduced transparency and increased contrast honoured; no
motion on critical alerts.
