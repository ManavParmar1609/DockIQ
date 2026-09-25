# DockIQ.AI — UI / UX Specification

**Status:** Describes the interface **as built** after the Phase 2 redesign (verified against
`frontend/src/` and a screenshot + end-to-end pass on 2026-09-25), and the constraints any change
must respect. Rules: [`.claude/rules/frontend-aesthetics.md`](../../.claude/rules/frontend-aesthetics.md).

---

## 1. Environment constraints — these outrank aesthetics

DockIQ runs on a tablet mounted to a forklift or a dock door in a **cold-storage warehouse**. That
is the whole design brief:

| Constraint | Consequence |
|---|---|
| Operators wear **gloves** | Touch targets ≥ 44px — a base rule on every `button`, `a`, `input`, `select`, `textarea` in `styles/app.css` |
| The floor is **cold and dimly lit**; screens catch glare | A light paper substrate (survives glare), carbon ink, WCAG AA measured on the actual substrate |
| Operators are **standing, often mid-task** | Scan, tap-to-count, subtype tiles and voice dictation before free text |
| Some decisions are **food-safety critical** | Severity is label + shape + fill, never colour alone; only CRITICAL is red |
| The tablet may be at arm's length | Type floor 14px; values an operator acts on (counts, temperatures, severity) at 16px+ |

**Hard rule:** no decorative effect — texture, grain, animation, reduced opacity — is ever applied
to a CRITICAL alert, a temperature, a count or a severity badge.

---

## 2. The design system — "Freight Manifest"

Swiss Industrial Print, chosen for the dock floor (rules §2.2). Tokens live only in
`frontend/src/styles/app.css`; Tailwind's default palette, radii and shadows are **removed**, so an
off-system colour cannot be written.

| Token | Value | Use |
|---|---|---|
| `paper` | `#EFECE4` | Substrate |
| `paper-sunk` / `paper-deep` | `#E5E1D6` / `#D8D2C4` | Recessed fields, scale bars |
| `ink` / `ink-soft` / `ink-mute` | `#111110` / `#3B3A35` / `#5C594F` | Text 17:1 / 11:1 / 5.9:1 on paper |
| `light` | `#FBFAF6` | Panels; text on ink and hazard fills |
| `hazard` | `#D4161A` | The **only** accent — severity and alerts. Light text on it is 5.1:1 |
| `hazard-bright` | `#E61919` | Graphic marks only (hazard tape, chart bars) — never behind text |
| `hazard-deep` | `#B0100D` | Alert text on paper, 6:1 |
| `night*` | `#0E0E0D` … | **Landing page only** — the one dark surface |

- **Type:** Archivo (variable, width axis at 112–125% for uppercase display) + Martian Mono for every
  ID, count, weight, temperature and time. Self-hosted via Fontsource — no third-party font request.
- **Geometry:** square corners, 2px ink rules, compartments on a 0.5-unit ink grid.
- **Motion:** one staggered rise as a screen loads (`.reveal`, 55ms steps). Never on an alert.
  `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast: more` are honoured.

### 2.1 The severity and confidence channels

| Level | Shape | Fill |
|---|---|---|
| Critical | ▲ | Hazard red, light text, hazard-tape edge on alerts and queue rows |
| High | ◆ | Solid ink |
| Medium | ■ | Ink outline |
| Low | ○ | Dashed hairline |

**Match confidence** is a separate three-cell ink meter labelled `MATCH · HIGH|MEDIUM|LOW`. It never
uses the severity palette — the old UI's red "LOW confidence" pill read as more alarming than an
amber MEDIUM severity beside it.

---

## 3. Application structure

```
/               Landing (dark, marketing)          /login   Sign in (employee ID + password)
/app            role home — Shift | Floor | Quality
/app/issues/:id issue detail (all roles; actions by role)
operator        /app/order · /app/inspection · /app/report · /app/issues · /app/chat
supervisor      /app/log · /app/analytics · /app/handoff · /app/chat
quality         /app/log · /app/analytics
```

- **Shell:** desktop rail (numbered nav, live-connection indicator, simulated-data tag, user,
  sign-out); tablet/phone top bar + bottom tab bar with safe-area padding.
- **Routing:** React Router data routes with `<Outlet/>`; every page is lazy-loaded; **every route
  has an error boundary**, so one broken screen never blanks the app.
- **Server state:** TanStack Query; the `/ws` channel invalidates exactly the data an event changes,
  so screens update live without polling.
- **Every data view** renders a loading, an error-with-retry, or the content (`QueryBoundary`).

## 4. Screens

| Screen | What it does |
|---|---|
| **Shift** (operator) | Current dock and order, last handoff, four actions, open/fixed/escalated counts, recent issues |
| **Order** | Loading: *Load plan · Scan & count · Sign-off*. Receiving: *Temperature · Checks · Scan & count · Sign-off* |
| **Inspection** | Seal / interior / damage tiles, reefer temperature; result names the limit used and each failed check, with a pre-filled report per failure |
| **Report** | Type (grouped Product / People / Systems) → subtype, product, type-specific readings, tags, description with dictation, photos → scored result with procedure → resolve or escalate |
| **My issues** | Open / closed / all, with supervisor outcomes |
| **Issue detail** | Everything reported, severity derivation, recurrence, procedure, photos, timeline; the supervisor's decision panel or the operator's close-out, by role and status |
| **Floor** (supervisor) | Team priority queue (critical first, then oldest, live waiting clocks), work in progress, requests, broadcast, dock floor by zone |
| **Quality** | Facility-wide open quality issues and exposure |
| **Issue log** | Search + severity/status/type filters; rows open the detail |
| **Analytics** | Team (supervisor) or facility (quality) totals, 30-day trend, breakdowns |
| **Handoff** | Open issues and zone docks to hand over, the note, previous notes |
| **Assistant** | Suggested prompts, conversation, cited sources; only `**bold**` is interpreted |

### 4.1 The load plan

Drawn from the server's computed plan: a to-scale **top view** (nose and reefer to doors; floor
positions per pattern; pallet footprint turned per orientation; stack counts; load-step numbers),
**side elevations** showing each layer's weight so heavy-on-the-bottom is visible, a **step-through**
that highlights pallet N in both views and reads out row, side, level, SKU, cases and weight,
product patterns (ink hatches — never colour), and the customer's rules and special instruction.

### 4.2 The two moments that sell the product

- **Scan mismatch (Scenario 3):** a known product that is not on the order stops the operator with a
  hazard alert — *SKU mismatch, do not load* — and a one-tap, pre-filled report.
- **Scored result (Scenarios 1, 2):** severity badge, points, every factor of the derivation, cost,
  recurrence, the procedure with its match confidence and cited SOP source.

## 5. What any change must not break

1. Touch targets ≥ 44px.
2. Severity legible at a glance, never by colour alone, never degraded by an effect.
3. The score derivation, confidence and cited source on the result and detail screens.
4. The `prefers-*` media query support.
5. Tablet-first layout — desktop rail, tablet/phone tab bar, safe-area insets.
6. Simulated data **visibly marked as simulated** (shell tag, login, landing sample labels).
7. No arbitrary Tailwind values and no hex in components — tokens only.
