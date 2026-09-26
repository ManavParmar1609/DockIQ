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

## 2. The design system — Grafbase, exactly *(since 2026-09-25)*

The owner's pinned reference: Grafbase's "engineering blueprint on cool marble", light only, with
the owner's own type spec. Tokens live only in `frontend/src/styles/app.css`; Tailwind's default
palette, radii and shadows are **removed**. Built record: `DESIGN.md`; product truth: `PRODUCT.md`.

| Token | Value | Use |
|---|---|---|
| `paper` | `#EDF7F5` mint frost | The canvas |
| `surface` | `#FFFFFF` | Cards (20px, 1px hairline, **no shadow**), panels, fields |
| `paper-sunk` / `paper-deep` | `#F2F8F6` / `#D0D3D3` fog | Quiet fills, hover, footers of cards / empty cells |
| `ink` / `ink-soft` / `ink-mute` | `#132322` obsidian / `#424F4F` graphite fill / `#56615F` | Text (16.2 / 8.9 / 6.4:1); slate `#828786` decorates only (it fails AA for small text) |
| `hairline` | `#D0D3D3` fog border | The structural rule |
| `accent` + `on-accent` | `#3DDC91` neon pulse + obsidian (8.6:1) | The one filled action, the selected navigation item, the chat's own messages |
| `accent-ink` / `accent-soft` / `accent-line` | `#146C47` / `#DFF5EA` / `#97DDBC` mint whisper | Green text / selection and highlight washes / highlight rules and chips |
| `sage-ink` | `#1B8A57` | Meters, focus rings, the wordmark's IQ (graphic marks) |
| `signal` + `-soft` / `-ink` | `#FFCD48` signal yellow | Lamps and marks in diagrams; the simulated tag; the People filing colour |
| `night` / `night-raised` | `#132322` obsidian / `#0E1A19` deep abyss | The app rail (tokens re-scoped by `.rail`) and the announcement strip |
| `hazard` / `orange` / `amber` | brick `#A4291F` (critical surfaces take its `#FBF1EF` wash and `#EEC6C0` rule; the solid fill is kept for badges, chips and plates) / saffron `#8A5A10` / olive `#515C0B` | **Severity only**, always with a word and a shape |
| `teal`/`indigo`/`mint`/`purple` + `-soft` | deep mint `#0A6D78`, sky `#00679E`, moss `#456D18`, forest — on pale tints | Product content and filing: zones (A moss, B mint, C sky), report groups (Product mint, People yellow, Systems sky), inspection sections |
| `chart-1…4` | `#007096` `#679725` `#6A78CD` `#007D65` | Categorical data, fixed order; dataviz checks pass |

- **Type:** Geist 600 for display and section headings, tight (−0.035em, line-height ~1.05) — a
  product-grade sans, one family with the mono (the owner replaced the editorial serif); Inter for everything read at
  work, tightened (−0.018em) with `ss01`/`cv11`; Hanken Grotesk for captions and labels — the stand-in
  for Aktiv Grotesk; Geist Mono for telemetry (IDs, codes, times, counts). 14px floor (Grafbase's 13px
  captions would fail the dock). Wordmark: *IQ* upright in steel.
- **Shape:** 6px buttons and nav items, 12px panels and fields, 20px cards, 40px pills (tags and the
  sign-in pill). Icons 1.6 stroke.
- **Colour:** the forest-to-deep-teal announcement strip is the only colour in the chrome — it says
  the data is simulated; its stops run one step deeper than the reference so white text passes AA.
- **Surfaces:** no texture, no glass, no dark mode.
- **Motion:** a short staggered rise; hovers darken the rule; press is instant. Purposeful
  micro-interactions that explain (load guide, bays, sheets). Never on an alert.

### 2.1 The severity and confidence channels

| Level | Shape | Badge |
|---|---|---|
| Critical | ▲ | Solid brick capsule, white text; brick-tinted rows and a brick edge in queues |
| High | ◆ | Saffron tint, saffron text |
| Medium | ■ | Olive tint, olive text |
| Low | ○ | Quiet tint, muted text |

**Match confidence** is a separate channel: three ink signal bars labelled `Match: high|medium|low`.

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
| **Floor** (supervisor) | Team priority queue (critical first, then oldest, live waiting clocks), work in progress, requests, broadcast, and the **dock wall**: each zone a row of door bays on a zone-tinted apron (A sage, B slate, C clay — quiet tint families mixed toward the paper). Each bay is drawn: a trailer being worked has its doors open and the load face moves with its progress (toward you as it loads, away as it unloads); a waiting trailer shows closed doors; an empty door shows the open bay. Tiles carry the door plate, status chip (word + icon), operator initials, customer, phase · % with a progress bar, and time at the door; critical is the one solid brick tile and nothing on it moves; a newly arrived trailer backs in. Tapping a dock opens its **dock sheet** (`?dock=N`): who is working it, trailer, time at the door, the order with a cases meter and per-line progress, sign-off blockers, open issues |
| **Simulator** (staff) | Clock, speed, scenarios; shift KPIs (on time, turn time, door use, detention); yard board with door or yard spot, booked vs arrived, reefer set-point, dwell and detention; event feed |
| **Quality** | Facility-wide open quality issues and exposure |
| **Issue log** | Search + severity/status/type filters; rows open the detail |
| **Analytics** | Team (supervisor) or facility (quality). *Needs you now* (open critical, open issues, cost at risk, open cold-chain breaks) · *How the team is doing* (totals + 30-day trend) · *Where the risk is* (issue type × severity heatmap, severity and resolution speed, doors open vs resolved, cost by type, repeat problems) · *People and partners*. Chart hues are the garden hues stepped for data (`app.css` "Charts": clay, slate, moss, plum, validated for colour-blind separation in both modes); every chart has a table |
| **Handoff** | Open issues and zone docks to hand over, the note, previous notes |
| **Assistant** | Suggested prompts, conversation, cited sources; only `**bold**` is interpreted |

### 4.1 The load plan

The picture does the explaining. The hero is **the view into the trailer from the dock door**, in
perspective: walls, floor, the reefer on the nose, row numbers on the wall. Loaded pallets stand in
place as pallets (load in the product's pattern and hue, wooden deck with fork pockets); the next
one is a breathing outline in its exact spot with a numbered pin and, for a floor spot, an arrow
from where the operator stands. The view walks in as the load fills toward the nose, so the spot is
always large. Under it: Row · Side · Height in large type, a slip-sheet note when one is due, and
*Back* / *Loaded, next pallet* (a short haptic tick where supported). Beside it: the whole trailer
**from above** (tap a stack to jump), the products with their swatches, the customer's rules as
chips, the special instruction, and the full rule list folded away. The step is remembered per order.

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
