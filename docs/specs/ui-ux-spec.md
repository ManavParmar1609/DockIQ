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

## 2. The design system — Apple design language *(since 2026-09-25)*

Chosen by the product owner to replace "Freight Manifest" (rules §2.2). Built from Apple's Human
Interface Guidelines and the `apple-design` skill, held to the dock-floor rules in §1. Tokens live
only in `frontend/src/styles/app.css`; Tailwind's default palette, radii and shadows are **removed**,
so an off-system colour cannot be written.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#F5F5F7` | `#000000` | The page |
| `surface` | `#FFFFFF` | `#1C1C1E` | Cards, sheets, fields |
| `paper-sunk` / `paper-deep` | `#EEEEF3` / `#E1E1E6` | `#2C2C2E` / `#3A3A3C` | Fills: gray buttons, segmented tracks, pressed |
| `ink` / `ink-soft` / `ink-mute` | `#1D1D1F` / `#424245` / `#6E6E73` | `#F5F5F7` / `#D1D1D6` / `#98989D` | Text; `ink-mute` is 4.7:1 on the light page |
| `hairline` | `#D2D2D7` | `#38383A` | Separators only |
| `accent` / `accent-ink` / `accent-soft` | `#0071E3` / `#0066CC` / `#E8F1FD` | fill kept, `#2997FF`, `#0C2A4A` | **Interaction only**: buttons, links, selection, focus |
| `hazard` / `hazard-deep` / `hazard-soft` | `#D70015` / `#B3000F` / `#FDECEE` | fill kept, `#FF6961`, `#3B1216` | Critical severity and destructive actions |
| `orange` / `amber` (+ `-soft`) | `#C93400` / `#8A5A00` | `#FF9F0A` / `#FFD60A` | High / medium severity text on their tints |
| `*-bright` | `#FF3B30`, `#FF9500`, `#FFCC00` | same | Graphic marks only (bars, dots, the critical edge) — never behind text |
| `green` | `#1A7F37` | `#30D158` | Resolved, live |
| `teal`, `indigo`, `mint`, `purple`, `brown` | Apple accessible hues | dark variants | Product identity in the load plan — never severity |
| `night*` | `#000000` … | — | The landing page's black hero and close |

- **Type:** the system stack — SF Pro on Apple devices, **Geist** elsewhere (self-hosted, Fontsource;
  SF cannot be licensed for the web). SF Pro Rounded (`.num`) for headline numbers, tabular figures
  (`.telemetry`) for every ID, count, weight, temperature and time. Size-specific tracking: large
  titles −0.025em, body −0.011em. Scale: 14 floor · 15 · 17 body · 20 · 22 · 28 · 34 large title.
- **Geometry:** continuous-feeling radii (8 · 12 · 16 · 20 · 28pt, capsules for buttons and tags),
  white cards on the gray page with a soft shadow, hairline separators inset in grouped lists.
- **Materials:** the navigation bar, tab bar, chat composer and alert banners are translucent
  (`.material`, backdrop blur + saturate); content scrolls beneath. **Critical banners are solid.**
- **Motion:** iOS easing `cubic-bezier(0.32, 0.72, 0, 1)`; press feedback `scale(0.97)` on
  pointer-down; one staggered rise as a screen loads (`.reveal`, 45ms steps). Never on an alert.
  `prefers-reduced-motion`, `prefers-reduced-transparency` (materials go solid) and
  `prefers-contrast: more` are honoured. Dark mode follows the device.
- **Components:** large-title page headers; grouped cards (`Panel`); Health-style metric tiles
  (`Stat`); capsule tags; segmented controls for tabs and filters; inset grouped lists with chevrons;
  iOS-style grouped form fields on sign-in; sheets for Quick request; iMessage-style chat bubbles.

### 2.1 The severity and confidence channels

| Level | Shape | Badge |
|---|---|---|
| Critical | ▲ | Solid red capsule, white text; red-tinted rows and a red edge in queues |
| High | ◆ | Orange tint, orange text |
| Medium | ■ | Amber tint, amber text |
| Low | ○ | Gray tint, gray text |

Standing alone in a list, the shape takes the severity hue (`tinted`) and carries a screen-reader
label. **Match confidence** is a separate channel: three ink signal bars labelled `Match: high|medium|low`.
It never uses the severity palette.

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
