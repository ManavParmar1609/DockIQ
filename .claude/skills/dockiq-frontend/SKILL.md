---
name: dockiq-frontend
description: Use for ANY change to frontend/src — components, pages, styles, layout, the landing page. Loads DockIQ's committed aesthetic direction (Swiss Industrial Print for the app shell, dark permitted on the landing), the anti-AI-slop directive, and the dock-floor legibility non-negotiables that outrank it. Also load before proposing typefaces, palettes, or motion.
---

# DockIQ Frontend

You are working on a tablet interface for a **cold-storage warehouse dock floor**. Gloved hands,
dim light, glare, food-safety decisions. Design for that — not for a consumer app, not for a demo
reel.

## Read first

`.claude/rules/frontend-aesthetics.md` — the full directive and DockIQ's resolution of it. What
follows is the operational summary.

## The direction

- **App shell: Swiss Industrial Print.** Off-white paper substrate (`#F4F4F0` / `#EAE8E3`), carbon
  ink (`#050505`–`#111111`), **one** hazard-red accent (`#E61919`) reserved for severity and alerts.
  Rigid visible CSS grid, uppercase monolithic headers at extreme scale, monospaced telemetry for
  every ID, count, temperature and timestamp. Reads as an operations manual.
- **Landing page: dark archetype permitted.** It is a desk-viewed marketing surface. Do not mix
  substrates inside one interface.
- **Typography:** Archivo (heavy, width axis) for structure + Martian Mono for data. Inter and
  Space Grotesk are banned.
- **Motion:** one orchestrated staggered reveal on dashboard load. Not scattered. Never on an alert.
  Respect `prefers-reduced-motion`.

## Non-negotiables — these outrank the aesthetic

1. Severity never by colour alone: label + shape/weight, always.
2. Touch targets ≥ 44px. `index.css:49` enforces this today; do not lose it.
3. WCAG AA on the actual off-white substrate.
4. **No grain, scanline, dither, blend-mode, opacity or animation on** a severity badge, a
   temperature, a count, a CRITICAL alert, or a primary action. Ever.
5. Type floor: 14px for anything read at arm's length; 16px+ for values an operator acts on.
6. The resolution screen keeps the score derivation, the confidence badge, and the cited SOP source.
7. Confidence gets its own visual channel — never the severity palette.
8. No emoji as icons.
9. Simulated data stays visibly marked as simulated.

## Mechanics

- Tokens are in `styles/app.css` `@theme`; Tailwind's palette is wiped. No hex in components, no
  Tailwind arbitrary values — add a named class instead.
- All API calls through `src/api/` hooks; render data with `QueryBoundary`, errors with `MutationError`.
- No side effects inside `setState` updaters.
- Keep the existing `prefers-*`, `:focus-visible` and safe-area rules verbatim.
- Skill references: `industrial-brutalist-ui` for the shell (with the overrides in the rules file —
  it lists Inter as optimal and mandates scanlines; both are overridden here),
  `design-taste-frontend` for the landing only, `impeccable` for the quality pass.

## The system is built — extend it

The direction was chosen ("Freight Manifest") and shipped. Do not propose a new typeface or palette;
build with what exists: tokens in `frontend/src/styles/app.css`, the kit in `components/ui.tsx`,
severity in `components/Severity.tsx`. Record any genuinely new pattern in `docs/specs/ui-ux-spec.md`.
