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

## 2. The design system — Botanical / Organic Serif *(since 2026-09-25)*

Supplied by the product owner (after the Apple pass, which they judged generic). Tokens live only
in `frontend/src/styles/app.css`; Tailwind's default palette, radii and shadows are **removed**.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#F9F8F4` rice paper | `#1B221D` | The page, under a fixed paper-grain layer |
| `surface` | `#FFFFFF` | `#242C26` | Cards (24px, stone hairline, soft forest shadow), sheets |
| `paper-sunk` / `paper-deep` | `#F2F0EB` clay / `#DCCFC2` mushroom | `#2C352E` / `#3A453C` | Quiet fills, fields, tracks |
| `ink` / `ink-soft` / `ink-mute` | `#2D3A31` forest / `#46544A` / `#636E65` | `#EDEAE0` / `#D3D6CB` / `#A3AC9F` | Text (11.2 / 8 / 5.0:1) |
| `hairline` | `#E6E2DA` stone | `#36403A` | Separators |
| `accent` + `on-accent` | forest `#2D3A31` + white | sage `#9FAE97` + forest | Primary pills, selected navigation |
| `sage` / `sage-ink` | `#8C9A84` / `#5E6E57` | `#9FAE97` / `#B7C4AE` | Icons, focus rings, rules / italic emphasis text |
| `terracotta` / `accent-ink` | `#C27B66` / `#9A4F38` | — / `#E0A48F` | Hover blooms / link text |
| `hazard` (+ `-deep`, `-soft`, `-bright`) | brick `#A8322A` | text `#F09A8C` | **Critical only** — white on it is 6.7:1 |
| `orange` / `amber` (+ tints) | ochre `#8F4E16` / olive `#6F5B12` | `#E8A76A` / `#DCC46A` | High / medium severity |
| `green` | moss `#46613C` | `#9CC08C` | Resolved, live |
| `teal`, `indigo`, `mint`, `purple`, `brown` | slate, plum, moss, clay, ochre | lighter | Product identity in the load plan — never severity |
| `night*` | `#1F2A23` | — | The landing page's deep-forest band |

Sage (2.8:1) and terracotta (3.3:1) are too light for text on rice paper, so they decorate; their
deeper `-ink` variants carry text.

- **Type:** Playfair Display (600, italic 500 for emphasis in sage via `<em>`) for headings and headline
  numerals (`.num`); Source Sans 3 for everything read at work, with tabular figures (`.telemetry`).
  Uppercase, widely tracked `.eyebrow` kickers and pill buttons. Scale: 14 floor · 17 body · 24–76
  headlines. Self-hosted via Fontsource.
- **Shape:** 24px cards, pill buttons and tags, arches (`.arch`) on the landing page, thin 1.5 icons.
- **Texture:** a fixed fractal-noise paper grain on the page ground only, **beneath** the opaque cards,
  so it never touches a badge, a reading or an alert. Hidden under `prefers-contrast: more`.
- **Motion:** slow and soft — reveals 800ms (`.reveal`, 80ms stagger), hovers 300–500ms with a gentle
  lift (`.lift`); press feedback stays instant (`scale(.97)`). Never on an alert. Reduced motion,
  reduced transparency and increased contrast are honoured. Dark mode is "the garden at night".

### 2.1 The severity and confidence channels

| Level | Shape | Badge |
|---|---|---|
| Critical | ▲ | Solid brick capsule, white text; brick-tinted rows and a brick edge in queues |
| High | ◆ | Ochre tint, ochre text |
| Medium | ■ | Olive-mustard tint, olive text |
| Low | ○ | Clay tint, muted text |

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
