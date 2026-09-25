# DockIQ.AI — UI / UX Specification

**Status:** Describes the interface **as built** (verified against `frontend/src/` and the 42 images
in `screenshots/`, 2026-09-25), plus the constraints any redesign must respect.

⚠️ **A redesign is planned.** The current look is Apple-derived and uses Inter — both of which the
project's frontend aesthetic brief rules out. See
[`.claude/rules/frontend-aesthetics.md`](../../.claude/rules/frontend-aesthetics.md) for the target
direction. This document records what exists and, more importantly, **what must survive the
redesign**.

---

## 1. Environment constraints — these outrank aesthetics

DockIQ runs on a tablet mounted to a forklift or a dock door in a **cold-storage warehouse**. That
is the whole design brief:

| Constraint | Consequence |
|---|---|
| Operators wear **gloves** | Touch targets ≥ 44px. Enforced globally today by `index.css:49` |
| The floor is **cold and dimly lit**; screens catch glare | High contrast is functional, not stylistic. WCAG AA minimum |
| Operators are **standing, often mid-task, sometimes in a hurry** | Minimise typing. Prefer tap-to-count, chips, and presets over free text |
| Some decisions are **food-safety critical** | Severity must be unambiguous at a glance. Never rely on colour alone |
| Hands may be full; the tablet may be at arm's length | Large type for primary values; the critical number should be readable across a pallet |

**Hard rule:** no decorative effect — texture, grain, scanline, animation, reduced opacity — is ever
applied to a CRITICAL alert, a temperature reading, or a severity badge. Those must render at full
contrast, always.

---

## 2. Application structure

Two role shells wrapping a shared content area.

```
/                    Landing (marketing)
/login               Role picker → person picker
/app/*               ProtectedRoutes → WorkerLayout | SupervisorLayout
```

⚠️ Layouts are **wrapper components taking `children`**, not `<Outlet/>` route elements, and each
carries its own duplicated WebSocket bootstrap. There is no 404 inside `/app` — an unknown
sub-path renders the chrome with an empty content area.

| Shell | Navigation |
|---|---|
| **Worker** (`role === 'operator'`) | Dashboard · Inspection · Loading · Unloading · Resolve · Chat · My Issues. Plus a broadcast banner, a FAB, and a quick-request sheet |
| **Supervisor** (everything else) | Dashboard · Issue detail · Logs · Analytics · Chat · Handoff. Plus an alerts badge |

Both render: a sidebar with brand, nav and a user footer on desktop; a top bar and bottom tab bar on
mobile. They are ~80% identical code.

---

## 3. Screens

| Screen | Purpose |
|---|---|
| **Landing** | Marketing site — sticky nav, hero with a dashboard mockup, stats ribbon, feature sections, dark CTA, scroll-reveal via IntersectionObserver |
| **Login** | Passwordless demo entry: pick *Dock Worker* or *Supervisor*, then pick a person |
| **Worker · Dashboard** | Time-of-day greeting, last shift's handoff note, current dock assignment card, 4 quick-action tiles, 4 stat cards, recent-issues timeline |
| **Worker · Trailer Inspection** | Seal condition, cleanliness, interior temp, visible damage, notes → pass/fail verdict screen |
| **Worker · Loading** | Outbound. Load-pattern diagram, SOP panel, per-SKU tap counters, progress bars, sign-off with seal number |
| **Worker · Unloading** | Inbound. Temperature probe check with threshold verdict, 5-point receiving checklist, per-SKU counters with tolerance flags, auto-files Count Shortage issues on complete |
| **Worker · Issue Resolution** | 4-step wizard: issue type → quick tags + notes → AI severity + resolution steps → self-resolve or escalate |
| **Worker · My Issues** | Own issue list with status badges, quick tags, supervisor notes, inline resolve |
| **Worker/Supervisor · Chat** | AI assistant — message thread, typing indicator, suggested questions |
| **Supervisor · Dashboard** | Broadcast composer, 4 stat cards, severity-sorted escalated queue, pending requests with Fulfill, live dock grid. Polls every 10s |
| **Supervisor · Issue Detail** | Full context (customer, product, carrier, cost), AI severity reasoning, the guidance the worker saw, resolve form |
| **Supervisor · Issue Logs** | Searchable/filterable table of the last 200 issues |
| **Supervisor · Analytics** | Recharts: 5 metric cards, 30-day trend, severity donut, breakdowns by type/dock/customer/carrier, operator leaderboard |
| **Supervisor · Shift Handoff** | Dock counts, active docks, unresolved issues, day/night toggle, notes, history |

⚠️ **Chat is one component serving both roles**, with worker-centric copy and worker-centric
suggested questions ("What's the load pattern for…") shown to supervisors.

---

## 4. The two screens that carry the product

### 4.1 Supervisor priority queue

The single most important screen — it *is* Scenario 5. The source document mocks it up as:

```
CRITICAL  Dock 5  — Temp deviation 28°F
          Frozen Seafood — Lisa — 8:03 AM          [GO TO DOCK 5]
HIGH      Dock 12 — Damaged pallet
          Frozen Chicken — Mike — 8:00 AM          [VIEW DETAILS]
MEDIUM    Dock 18 — Load sequence question
          Dairy — Jay — 8:02 AM                    [VIEW DETAILS]
```

Every row must carry **severity · dock · issue type · product · operator · age**, and the highest
severity must be unmistakably first. The current build adds estimated cost impact, which is a good
addition — it makes the triage decision defensible.

### 4.2 Issue Resolution step 3 — AI severity + guidance

Where the product's "explainable, not magic" claim is made good. It shows:

- The **severity band** as a badge, and
- **The arithmetic**, in plain language:
  `Score: 7.5 → MEDIUM. Factors: Issue type 'Temperature Deviation' (weight: 5); Customer Tier 1 (×1.5)`
- The **numbered resolution steps**, and
- A **confidence badge** and a **cited source** (e.g. "Cold Chain SOP 2.3").

**Preserve all four in any redesign.** Showing the score derivation is what separates this from a
black box, and the citation is what makes an operator willing to act on it.

---

## 5. Current design system — and its problems

### 5.1 What is actually in use

**Three colour vocabularies compete**, which is the main thing a redesign must collapse to one:

1. CSS custom properties in `index.css` — `--brand: #0071e3`, `--radius-md`, `--shadow-sm`,
   `--spring`. **These are the tokens actually in use.**
2. Tailwind semantic utilities — `bg-blue-600` and friends.
3. Hardcoded hex in JS — `Analytics.jsx:5-10` defines `APPLE_BLUE = '#0071e3'` etc.; the arbitrary
   value `focus:ring-[#0071e3]/20` appears in five files.

⚠️ The `dock.*` and `apple.*` palettes defined in `tailwind.config.js` are **completely unused** —
verified, zero matches in `src/`. Either adopt them or delete them.

⚠️ **Grey-family chaos:** `gray`, `stone` and `zinc` are mixed across 18 files with no rule (390
occurrences). The dashboards use `stone-*`; everything else uses `gray-*`.

Class systems in `index.css`: `.glass` / `.glass-sm` cards · `.severity-*` (consumed by
`SeverityBadge`) · `.glow-*` · `.animate-in` · ~130 lines of landing-only classes · ~80 lines of
`.apple-*` app chrome.

Type: **Inter** body, JetBrains Mono for monospace.

### 5.2 Severity colour language

| Severity | Current treatment |
|---|---|
| CRITICAL | Red, with an alarm emoji |
| HIGH | Orange/red |
| MEDIUM | Amber |
| LOW | Neutral |

Confidence badges use the same red/amber/green family, which is a genuine problem: in
`screenshots/issue_step3.png` a MEDIUM amber severity badge sits beside a red "LOW confidence" badge,
and the red reads as *more* alarming than the severity. **A redesign should give confidence its own
visual channel** — weight, outline, or a meter — rather than reusing the severity palette.

### 5.3 Accessibility: good CSS, weak JSX

**Already handled well in `index.css`:** `prefers-reduced-motion`, `prefers-reduced-transparency`,
`prefers-contrast: more`, `:focus-visible`, and `env(safe-area-inset-bottom)`. Keep all of these.

**Gaps in the JSX:**
- Clickable `<div onClick>` cards that are not focusable or keyboard-operable
  (`SupervisorDashboard.jsx:213`)
- A `✕` close button with no `aria-label` (`WorkerLayout.jsx:122`)
- No `aria-live` on the broadcast banner or the chat stream — new critical information arrives
  silently for a screen reader
- **Emoji used as meaningful content** with no text alternative — the supervisor dashboard uses 🚨 ⚡
  🚪 📋 📍 👤 🏢 📦 💰 as functional icons

The emoji-as-icon pattern should go in the redesign regardless of accessibility: it is also a
generic-AI-aesthetic tell, and it renders inconsistently across platforms.

### 5.4 Known visual defects

| Defect | Evidence |
|---|---|
| **`timeAgo` never rolls up past minutes** | `screenshots/sup_dashboard.png` renders **"27914m ago"** (≈19 days). Needs hours/days/weeks |
| `timeAgo`/`getGreeting` are copy-pasted between the two dashboards | `WorkerDashboard.jsx:8-22`, `SupervisorDashboard.jsx:8-22` |
| Progress renders `NaN%` on an order with no items | `Loading.jsx:98` |
| Four competing status→label maps for the same five statuses | `MyIssues`, `IssueLogs`, `WorkerDashboard`, `ShiftHandoff` — labels differ ("Supervisor" vs "Supervisor Resolved") |
| Three competing resolution-type lists | `IssueResolution` (8), `MyIssues` (7), `IssueDetail` (7, different set) |
| Three different loading treatments, five hand-rolled empty states | Needs `<LoadingState>` / `<EmptyState>` primitives |
| The tap-counter is duplicated and **divergent** | `Loading.jsx` clamps to expected quantity, `Unloading.jsx` does not; one renders `−1` (U+2212), the other `-1` |
| The global 44px `min-height` silently overrides compact chips | `index.css:49` vs `py-0.5`/`text-xs` chip buttons |

---

## 6. What a redesign must not break

1. Touch targets ≥ 44px.
2. Severity legible at a glance, never by colour alone, never degraded by an effect.
3. The score derivation, confidence and cited source on the resolution screen.
4. The existing `prefers-*` media query support.
5. Tablet-first layout — desktop sidebar, mobile/tablet tab bar, safe-area insets.
6. Simulated data must remain **visibly marked as simulated**, per the project's binding constraint
   that nothing in the demo is real company information.
