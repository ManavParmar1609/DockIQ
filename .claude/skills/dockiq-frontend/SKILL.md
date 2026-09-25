---
name: dockiq-frontend
description: Use for ANY change to frontend/src — components, pages, styles, layout, the landing page. Loads DockIQ's committed aesthetic direction (Botanical / Organic Serif: Playfair Display + Source Sans 3, rice paper with grain, forest/sage/terracotta, 24px cards, pills, slow motion), the anti-AI-slop directive, and the dock-floor legibility non-negotiables that outrank it. Also load before proposing typefaces, palettes, or motion.
---

# DockIQ Frontend

You are working on a tablet interface for a **cold-storage warehouse dock floor**. Gloved hands,
dim light, glare, food-safety decisions. The product owner chose **Apple's design language** for it
(2026-09-25): design as Apple would for this job, and never let the style weaken the safety rules.

## Read first

`.claude/rules/frontend-aesthetics.md` — the directive and DockIQ's resolution of it — and
`docs/specs/ui-ux-spec.md` §2 for every token. Load the `apple-design` skill
(`.agents/skills/apple-design/`) for motion, materials and typography.

## The direction

- **Botanical / Organic Serif** (product owner's design system, 2026-09-25). Tokens and every value:
  `docs/specs/ui-ux-spec.md` §2; rules and the documented departures: `.claude/rules/frontend-aesthetics.md`.
- **Type:** Playfair Display for headings (`.display`, `.heading`, `<em>` for italic sage emphasis)
  and headline numerals (`.num`); Source Sans 3 for everything read at work; Spline Sans Mono via
  `.telemetry` for IDs, codes, times and counts. No kickers above headings. Wordmark: `.wordmark-iq`.
- **Surfaces:** rice-paper ground with grain beneath opaque `.card`s; `.lift` on interactive cards.
- **Colour:** forest for primary pills; sage/terracotta decorate (their `-ink` variants carry text);
  brick red only for critical severity and destructive actions.
- **Motion:** slow reveals and hovers, instant press feedback, purposeful micro-interactions that
  explain (the load guide, sheets), never on an alert. Reduced motion is honoured.

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
