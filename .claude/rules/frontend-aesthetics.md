# Frontend Aesthetics Rules

This file has two parts. **Part 1 is the standing directive, verbatim, as supplied by the user.**
Part 2 is how DockIQ resolves it — including where it deliberately overrides the design skills it
draws on.

---

## Part 1 — The directive (verbatim)

```
<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:
Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.
Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.
Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.
Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.
Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character
Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>
```

---

## Part 2 — How DockIQ resolves it

### 2.1 The context, which decides everything

DockIQ runs on a tablet on a forklift in a **cold-storage warehouse**. Gloved hands, dim light,
glare, and decisions that are sometimes food-safety critical. "Genuinely designed for the context"
therefore means: the interface should feel like an **operations document or a control panel**, not
a consumer app. The original Apple-derived look (`.apple-*` classes, `--brand: #0071e3`, Inter) was
exactly the safe, on-distribution choice the directive rules out — and it is also the wrong genre
for the setting.

### 2.2 The committed direction

**Application shell — Swiss Industrial Print.** Drawn from the `industrial-brutalist-ui` skill's
first archetype: unbleached-paper substrate, carbon-ink foreground, a single hazard-red accent,
rigid visible grid, monolithic uppercase headers at extreme scale, monospaced telemetry for every ID,
count, temperature and timestamp. It reads as a declassified operations manual, which is what a
dock-door control surface *is*. Chosen over the dark "Tactical Telemetry" archetype for one concrete
reason: **a light substrate survives glare on a warehouse tablet; a dark one does not.**

**Landing page — the dark archetype is permitted.** The landing page is a marketing surface viewed
on a desk, not a dock. The `design-taste-frontend` skill applies there (its own scope note excludes
dashboards and product UI). Going dark on the landing and light in the app satisfies "vary between
light and dark" **without mixing substrates inside one interface**, which the industrial skill
correctly forbids.

**One accent.** Hazard red (`#E61919` family) is the only accent, and it is reserved for severity
and alerts. Nothing decorative may be red. This is what makes CRITICAL unmistakable.

### 2.3 Where DockIQ overrides the skills it draws on

The `industrial-brutalist-ui` skill is the right structural reference, and it is **wrong for this
context in four specific places.** These overrides are not negotiable:

| Skill says | DockIQ does instead | Why |
|---|---|---|
| Inter (Extra Bold/Black) is an "optimal" macro font | **Inter is banned.** Part 1 names it explicitly. Use another heavy neo-grotesque — Archivo Black or Monument Extended are the skill's own alternatives | The directive outranks the skill |
| Micro-type at 10–14px | **Floor of 14px for anything read at arm's length; 16px+ for values an operator acts on** (temperatures, counts, severity) | Gloves, distance, glare |
| Global grain, CRT scanlines, halftone dithering | **No texture, grain, scanline, dither, blend-mode or opacity effect on any severity badge, temperature reading, count, CRITICAL alert, or primary action.** Sparing use on chrome and landing only, if at all | A degraded critical alert is a food-safety defect, not a style |
| Rejects all `border-radius`; 1px dividing lines | Keep the rigid grid, **but touch targets stay ≥ 44px** with clear hit areas. Razor-thin dividers are fine; razor-thin *targets* are not | `styles/app.css` enforces 44px on every control |

And two the directive itself requires:

- **Do not default to Space Grotesk.** Part 1 calls it out by name. The typeface is proposed with a
  reason, not picked from habit.
- **Motion is for one orchestrated moment** — a staggered reveal on dashboard load — not scattered
  micro-interactions, and never on a critical alert. Respect `prefers-reduced-motion` (already in
  `styles/app.css`; keep it).

### 2.4 Non-negotiables that outrank any aesthetic

1. Severity is legible at a glance and **never conveyed by colour alone** — always paired with a
   label and a shape/weight.
2. Touch targets ≥ 44px.
3. WCAG AA contrast minimum on the app substrate. Test on the actual off-white, not on pure white.
4. The resolution screen keeps showing the **score derivation, the confidence, and the cited SOP
   source** — that is the product's "explainable, not magic" claim made visible.
5. Confidence gets its own visual channel (weight, outline, a meter) — **not** the severity palette.
   Today a red "LOW confidence" badge reads as more alarming than an amber MEDIUM severity beside it.
6. **No emoji as icons.** The supervisor dashboard currently uses 🚨 ⚡ 🚪 📋 📍 👤 🏢 📦 💰 as
   functional icons. They are inaccessible, render inconsistently, and are a generic-AI tell.
7. Simulated data remains **visibly marked as simulated**.

### 2.5 The shipped direction — "Freight Manifest" *(chosen 2026-09-25, built in Phase 2)*

Archivo (width axis 112–125% for uppercase display) + Martian Mono for telemetry, on unbleached paper
`#EFECE4` with carbon ink `#111110` and one hazard red. Text-bearing red is `#D4161A` (5.1:1 with
light text; the brighter `#E61919` is kept for graphic marks only). The Apple-derived system was
replaced in one pass: the `.apple-*` classes, Inter and the unused Tailwind palettes are gone, and the
`prefers-*`, `:focus-visible` and safe-area rules carried over. Details: `docs/specs/ui-ux-spec.md` §2.

### 2.6 Skills to load for frontend work

- `industrial-brutalist-ui` — structural reference for the app shell (with the overrides above).
- `design-taste-frontend` — landing page only.
- `impeccable` — the project's own design-quality pass; its hooks are already wired in
  `.claude/settings.local.json`.
- `dockiq-frontend` (`.claude/skills/dockiq-frontend/`) — this file's rules as an auto-loading
  skill, so they apply without being pasted.
