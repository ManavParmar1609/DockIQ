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

## 2. The design system — the GSAP reference, dark *(since 2026-09-26)*

The owner's pinned reference: GSAP's "animated chalkboard in a design studio" (video in
`DocumentsforProj/`), dark only, with the owner's serif request. Tokens live only in
`frontend/src/styles/app.css`; Tailwind's default palette, radii and shadows are **removed**. Built
record: `DESIGN.md`; product truth: `PRODUCT.md`.

| Token | Value | Use |
|---|---|---|
| `paper` | `#0E100F` just black | The stage |
| `surface` | `#171917` | Cards (10px, 1px hairline, **no shadow**), panels, bars |
| `paper-sunk` / `paper-deep` | `#1F211E` / `#2C2E2A` | Quiet fills, hover / tracks and empty cells |
| `ink` / `ink-soft` / `ink-mute` | `#FFFCE1` cream / `#D3D0B9` / `#A3A292` | Text (17 / 11.4 / 6.9:1 on a card); the reference's `#7C7C6F` decorates only (4.2:1) |
| `hairline` / `rule` / `rule-strong` | `#34352F` / `#42433D` / `#6D6E63` | Card edges / dividers that must read / control edges (3.2:1) |
| `accent` + `on-accent` | `#0AE448` green + `#0E100F` (11:1) | The gradient stroke of the primary pill, your place (active nav, selected tab, your chat words), focus, meters |
| `accent-ink` / `accent-soft` / `accent-line` | `#3DF06F` / `#12281A` / `#1F5A32` | Green text / green washes / green rules |
| `pink` / `blue` + `-ink` / `lilac` + `-ink` (+ `-soft`) | `#FEC5FB` / `#00BAE2` `#4FD3EF` / `#9D95FF` `#B4AEFF` on dark washes | Filing: zones (A pink, B blue, C lilac), report groups (Product blue, People pink, Systems lilac), inspection sections, cold rooms |
| `orangey` / `signal` | `#FF8709` | The simulated mark (an orange highlighter block), trailer lamps |
| `hazard` / `orange` / `amber` | red `#C9372C` (white 5.2:1; marks `#FF5A4F`, text `#FF9B90` on `#2B1311`) / amber `#FFC062` / citron `#E3E37D` | **Severity only**, always with a word and a shape |
| `chart-1…4` | `#00B320` `#7A71CF` `#B28500` `#0096B9` | Categorical data, fixed order; the highlighters stepped into the dark chart band, slot 3 a deep gold because orange marks simulated data; dataviz checks pass |

- **Type:** Host Grotesk (the free stand-in for Mori and Messina Sans) for everything: page titles
  at 44–66px, 600, −0.035em (`.display`), body 16px, labels, controls. Source Serif 4 at its display
  optical size (for Untitled Serif) sets panel, section and editorial titles, 400, never below 20px
  (`.serif-title`, `.section-heading`). Geist Mono for telemetry. 14px floor. Wordmark: *IQ* upright
  in green.
- **Shape:** 100px pills for every button and tag; 8px fields and tiles; 10px cards and sheets. Icons
  1.6 stroke.
- **Signatures:** `{ bracket }` notes beside titles (never stacked above one); highlighter blocks
  (`.hl-*`) for your place and the simulated mark; the green announcement bar; soft 3D gradient
  shapes on the landing page only.
- **Motion** (gsap.com's own ease tokens: `--ease-out` `(.23,1,.32,1)`, `--ease-in`, `--ease-colour`
  `(.645,.045,.355,1)`): titles wipe up; screens rise out of a blur, staggered; every pill fills from
  the exact point it was pressed (`lib/flair.ts`, ≤150ms on press) and its label inverts; nav bars
  slide in; cards lift and light their filing rule. Work screens: a scan rings the matched line
  (with a match / mismatch / unknown tone, mutable per device), a count tap pops a tick on the
  button (the number never moves) and offers a 5-second undo, a step slides in from the side it lies
  on, the procedure is a checklist (the step to do now bright, done steps dim), evidence photos are a
  snapping carousel. The landing hero is built letter by letter with GSAP SplitText, once; words
  light as they scroll; shapes drift. Entrance animations hold only their first frame
  (`backwards`), so nothing they wrap loses fixed positioning. Never on an alert, a severity mark, a
  temperature or a count; reduced motion shows the final state.
- **Staff patterns:** issue rows file their type with a group dot or the type as a category word in
  its hue (`IssueGroupDot`, `IssueTypeLabel`); the priority queue reorders with GSAP Flip (critical
  rows jump, never glide) and says how far past its target an issue is; alert cards carry a thin
  timer bar for their 12s life and sit clear of page-header buttons; the dock sheet opens on its open
  issues with an inline "On my way"; Issue-log filters are outlined pills, filled cream when set, and
  a table that must scroll shows its scroll edge; the simulator's scenarios and reset sit behind
  "Demo controls" with a confirm; past handoffs are accordion rows; Analytics cells drill into the
  Issue log.
- **Work-screen patterns:** `TempInput` (a ± key, since frozen readings are negative); the load
  guide's actions pinned above the tab bar on phones; the quick request as a rail pill (lg) or a
  56px disc above the tab bar; the Order step and a report draft survive navigation (URL, session).

### 2.1 The severity and confidence channels

| Level | Shape | Badge |
|---|---|---|
| Critical | ▲ | Solid red capsule, white text; red-washed rows and a red edge in queues |
| High | ◆ | Amber text on its dark wash |
| Medium | ■ | Citron text on its dark wash |
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
| **Floor** (supervisor) | Team priority queue (critical first, then oldest, live waiting clocks), work in progress, requests, broadcast, and the **dock wall**: each zone a row of door bays on a zone-washed apron (A pink, B blue, C lilac — the filing highlighters on dark washes). Each bay is drawn: a trailer being worked has its doors open and the load face moves with its progress (toward you as it loads, away as it unloads); a waiting trailer shows closed doors; an empty door shows the open bay. Tiles carry the door plate, status chip (word + icon), operator initials, customer, phase · % with a progress bar, and time at the door; critical is the one red-ruled tile and nothing on it moves; a newly arrived trailer backs in. Tapping a dock opens its **dock sheet** (`?dock=N`): who is working it, trailer, time at the door, the order with a cases meter and per-line progress, sign-off blockers, open issues |
| **Simulator** (staff) | Clock, speed, scenarios; shift KPIs (on time, turn time, door use, detention); yard board with door or yard spot, booked vs arrived, reefer set-point, dwell and detention; event feed |
| **Quality** | Facility-wide open quality issues and exposure |
| **Issue log** | Search + severity/status/type filters; rows open the detail |
| **Analytics** | Team (supervisor) or facility (quality). *Needs you now* (open critical, open issues, cost at risk, open cold-chain breaks) · *How the team is doing* (totals + 30-day trend) · *Where the risk is* (issue type × severity heatmap, severity and resolution speed, doors open vs resolved, cost by type, repeat problems) · *People and partners*. Chart hues are the garden hues stepped for data (`app.css` "Charts": clay, slate, moss, plum, validated for colour-blind separation in both modes); every chart has a table |
| **Handoff** | Open issues and zone docks to hand over, the note, previous notes |
| **Assistant** | Starter tiles, then turns: the person's neon bubble; DockIQ's mark in a gutter, a ruled caption-face trace of what it checked, tool cards, the answer, the cited source. Answers are formatted by `components/RichAnswer` — headings, bullet and numbered lists, bold, italic, notes, and codes (orders, SKUs, bins, issue numbers, temperatures) in Geist Mono — as React text, never HTML |

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
