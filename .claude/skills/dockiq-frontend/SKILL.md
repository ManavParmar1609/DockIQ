---
name: dockiq-frontend
description: Use for ANY change to frontend/src — components, pages, styles, layout, the landing page. Loads DockIQ's committed aesthetic direction (the owner's GSAP reference, dark only: near-black stage, cream type, hairline rules, 100px pills with one green-gradient-stroked primary, { bracket } notes, highlighter blocks, pink/blue/lilac filing; Host Grotesk + Source Serif 4 display + Geist Mono), the anti-AI-slop directive, and the dock-floor legibility non-negotiables that outrank it. Also load before proposing typefaces, palettes, or motion.
---

# DockIQ Frontend

You are working on a tablet interface for a **cold-storage warehouse dock floor**. Gloved hands,
dim light, glare, food-safety decisions. The product owner chose **the GSAP reference, dark**
(2026-09-26): refine within it — and never let the style weaken the safety rules. Colour files
things or raises alarms; it never decorates.

## Read first

`.claude/rules/frontend-aesthetics.md` — the directive and DockIQ's resolution of it — and
`docs/specs/ui-ux-spec.md` §2 for every token.

## The direction

- **The GSAP reference** (owner-pinned, 2026-09-26), dark only. Values: `docs/specs/ui-ux-spec.md` §2,
  `DESIGN.md`; departures: `.claude/rules/frontend-aesthetics.md` §2.3; product truth: `PRODUCT.md`.
- **Type:** Host Grotesk for everything (`.display` page titles, `.heading` card titles, `.label`);
  Source Serif 4 display for panel and section titles ≥20px (`.serif-title`, `.section-heading`);
  Geist Mono for telemetry (`.telemetry`). No eyebrows above headings: context goes in a `.bracket`
  note beside or under the title.
- **Surfaces:** the `#0E100F` stage, `#171917` cards with a hairline and **no shadow**.
- **Colour:** green is DockIQ and the thing to do (the primary pill's gradient stroke, your place as
  a highlighter block); pink, blue and lilac file zones, groups and sections; orange marks simulated
  data; red only for critical severity and destructive actions.
- **Motion:** titles wipe up, screens rise out of a blur, the green rises through the primary pill,
  nav bars slide in, cards light their rule; never on an alert; reduced motion honoured.

## Non-negotiables — these outrank the aesthetic

1. Severity never by colour alone: label + shape, always.
2. Touch targets ≥ 44pt (`styles/app.css` enforces it on every control).
3. WCAG AA on the actual surfaces, in light **and** dark.
4. **No translucency, grain, opacity or animation on** a severity badge, a temperature, a count, a
   CRITICAL alert, or a primary action. Critical banners are solid.
5. Type floor: 14px for anything read at arm's length; 17px body.
6. The resolution screen keeps the score derivation, the confidence meter, and the cited SOP source.
7. Confidence gets its own visual channel (signal bars) — never the severity palette.
8. No emoji as icons (`lucide-react` is the icon set).
9. Simulated data stays visibly marked as simulated.
10. The barcode is always black on white, in both modes, so it scans.

## Mechanics

- Tokens are in `styles/app.css` `@theme`; Tailwind's palette is wiped. No hex in components, no
  Tailwind arbitrary values — add a named class instead.
- All API calls through `src/api/` hooks; render data with `QueryBoundary`, errors with `MutationError`.
- No side effects inside `setState` updaters.
- Keep the `prefers-*`, `:focus-visible` and safe-area rules.
- Skills: `apple-design` for motion/materials/type, `redesign-existing-projects` for audits,
  `impeccable` for the quality pass, `design-taste-frontend` for the landing page.

## The system is built — extend it

Build with what exists: tokens in `frontend/src/styles/app.css`, the kit in `components/ui.tsx`,
severity in `components/Severity.tsx`. Record any genuinely new pattern in `docs/specs/ui-ux-spec.md`.
