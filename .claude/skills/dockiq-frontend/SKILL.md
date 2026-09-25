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
- **Typography:** heavy neo-grotesque for structure + monospace for data. **Inter is banned. Space
  Grotesk is banned.** Propose a pairing with a reason; do not default.
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

- Tokens are CSS custom properties in `index.css`. No new hardcoded hex in JSX, no new Tailwind
  arbitrary values. The `dock.*`/`apple.*` Tailwind palettes are unused — delete, don't extend.
- All API calls through `src/api.js`. Every new call site handles failure.
- No side effects inside `setState` updaters.
- Keep the existing `prefers-*`, `:focus-visible` and safe-area rules verbatim.
- Skill references: `industrial-brutalist-ui` for the shell (with the overrides in the rules file —
  it lists Inter as optimal and mandates scanlines; both are overridden here),
  `design-taste-frontend` for the landing only, `impeccable` for the quality pass.

## Before building a redesign

Bring the user two or three concrete directions — font pairing, substrate value, one-line argument
for why it fits a dock floor. They choose. Then build it as a **replacement** of the `.apple-*`
system in one pass, not alongside it.
