# Frontend Aesthetics Rules

This file has two parts. **Part 1 is the standing directive, verbatim, as supplied by the user.**
Part 2 is how DockIQ resolves it, for the direction the product owner chose.

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
glare, and decisions that are sometimes food-safety critical. Whatever the style, the interface has
to be legible at arm's length, unmistakable about severity, and calm under pressure.

### 2.2 The committed direction — Grafbase's structure in the owner's palette *(2026-09-25)*

The owner pinned the Grafbase style reference for structure (hairline cards without shadows, 6px
buttons, 12px panels, 20px cards, 40px pills, one drop shadow, light only), their own type spec
(Geist for titles over tightened Inter, a grotesk for captions, a mono for telemetry), and
then their own palette for colour: an obsidian rail and strip, a mint-frost canvas, neon pulse for
the one filled action and the selected place, mint whisper for highlights, signal yellow as warm
punctuation in diagrams. Colour files things (zones, report groups, inspection sections) or raises
alarms; it never decorates. Values: `docs/specs/ui-ux-spec.md` §2.

### 2.3 Where DockIQ departs from the reference

| Grafbase says | DockIQ does instead | Why |
|---|---|---|
| 99% achromatic; no status colour | Critical **brick red**, high saffron, medium olive — each with a word and a shape | A food-safety alert must never be grey |
| One family, Inter | Geist (display and titles), Inter, Hanken Grotesk (for Aktiv Grotesk), Geist Mono | The owner asked for a product-grade sans over the editorial serif (2026-09-25); Aktiv is paid, the project is free |
| 13px captions | **14px floor** | Gloves, distance, glare |
| Ash `#7C7C7C` for tertiary text | Steel for all small text | Ash fails AA for small text |
| Announcement gradient `#19A05F → #0D7F8C` | Same angle, each stop one step deeper | White text on the light end is 3.3:1; the strip must pass AA |
| Theme toggle | Light only | The owner's instruction |
| Part 1 lists Inter among fonts to avoid | Inter for all UI | The owner's brief names it; the brief outranks the general directive |
| One orchestrated moment, no scattered micro-interactions | Micro-interactions where they explain (load guide, bays, sheets) | Requested by the owner; never on an alert |

### 2.4 Non-negotiables that outrank any aesthetic

1. Severity is legible at a glance and **never conveyed by colour alone** — always label + shape.
2. Touch targets ≥ 44px.
3. WCAG AA contrast on the actual surfaces, in light and dark mode.
4. The resolution screen keeps the **score derivation, the confidence, and the cited SOP source**.
5. Confidence has its own visual channel (signal bars), **not** the severity palette.
6. **No emoji as icons.**
7. Simulated data remains **visibly marked as simulated**.
8. The barcode stays black on white in both modes.

### 2.5 History

- Phase 0: an Apple-derived look with Inter. Phase 2: "Freight Manifest" (industrial print).
- 2026-09-25: an Apple design-language pass, then Botanical / Organic Serif, then the dock ledger
  (Grafbase × Lattice × Altitude), then **Grafbase, exactly** — light only, with the owner's type
  spec — the current system (`docs/specs/ui-ux-spec.md` §2, `DESIGN.md`).

### 2.6 Skills to load for frontend work

- `impeccable` — the project's design-quality pass (hooks wired in `.claude/settings.local.json`).
- `design-taste-frontend` and `redesign-existing-projects` — taste and audit checklists.
- `apple-design` (`.agents/skills/apple-design/`) — motion and interaction feel.
- `dockiq-frontend` — this file's rules as an auto-loading skill.
