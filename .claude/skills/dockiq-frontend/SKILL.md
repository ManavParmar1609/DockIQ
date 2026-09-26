---
name: dockiq-frontend
description: Use for ANY change to frontend/src — components, pages, styles, layout, the landing page. Loads DockIQ's committed aesthetic direction (Grafbase structure in the owner's palette, light only: mint-frost canvas, white hairline cards without shadows, obsidian rail, neon pulse action, 6px buttons, 20px cards, 40px pills; Geist + Inter + Hanken Grotesk + Geist Mono), the anti-AI-slop directive, and the dock-floor legibility non-negotiables that outrank it. Also load before proposing typefaces, palettes, or motion.
---

# DockIQ Frontend

You are working on a tablet interface for a **cold-storage warehouse dock floor**. Gloved hands,
dim light, glare, food-safety decisions. The product owner chose **Grafbase, exactly** for it
(2026-09-25, light only): refine within it — and never let the style weaken the safety rules. The
interface is near-monochrome; colour appears only in the announcement strip, in product content and
in severity.

## Read first

`.claude/rules/frontend-aesthetics.md` — the directive and DockIQ's resolution of it — and
`docs/specs/ui-ux-spec.md` §2 for every token. Load the `apple-design` skill
(`.agents/skills/apple-design/`) for motion, materials and typography.

## The direction

- **Grafbase, exactly** (owner-pinned, 2026-09-25), light only. Values: `docs/specs/ui-ux-spec.md` §2,
  `DESIGN.md`; departures: `.claude/rules/frontend-aesthetics.md` §2.3; product truth: `PRODUCT.md`.
- **Type:** Geist 600 for display and section headings (`.display`, `.section-heading`);
  Inter, tightened, for everything read at work (`.heading` 600 for card titles); Hanken Grotesk for
  captions (`.label`); Geist Mono for telemetry (`.telemetry`). No kickers above headings.
- **Surfaces:** drafting-gray canvas, white 20px cards with a 1px hairline and **no shadow**.
- **Colour:** graphite text and the one primary action (6px, the only drop shadow); the cool triad
  only inside product content; brick red only for critical severity and destructive actions; the
  announcement strip is the only colour in the chrome.
- **Motion:** a short staggered rise, hover by rule, instant press, purposeful micro-interactions;
  never on an alert.

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
