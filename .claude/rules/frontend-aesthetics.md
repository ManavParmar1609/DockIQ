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

### 2.2 The committed direction — the GSAP reference, dark *(2026-09-26)*

The owner pinned GSAP's site (a video and a style spec in `DocumentsforProj/`): an animated
chalkboard — a near-black stage, warm cream type, hairline rules, outlined pills with one
green-gradient-stroked primary, `{ bracket }` notes, highlighter blocks, and five colour-coded
highlighters that file things. They also asked for a high-contrast display serif (Untitled Serif) and
a functional sans (Messina Sans). Values: `docs/specs/ui-ux-spec.md` §2.

### 2.3 Where DockIQ departs from the reference

| The reference says | DockIQ does instead | Why |
|---|---|---|
| No status colour | Critical **red**, high amber, medium citron — each with a word and a shape | A food-safety alert must never be cream |
| Mori, one family | Host Grotesk (for Mori and Messina), Source Serif 4 display (for Untitled Serif) on titles ≥20px, Geist Mono | Mori, Messina and Untitled are paid; the owner asked for the serif |
| Muted text `#7C7C6F` | `#A3A292` for all small text | `#7C7C6F` is 4.2:1 on a card |
| Hairline `#42433D` on everything | `#34352F` card edges, `#42433D` dividers, `#6D6E63` control edges | Field boundaries must pass 3:1 |
| Outlined-only, no fills | Your place is a green highlighter block; the primary pill fills green on hover and press | A gloved tap must be answered and the current screen unmistakable |
| No cards, just the stage | 10px surface cards with a hairline | Operate screens need grouping at arm's length |
| 224px display | 44–66px page titles in the app; the landing hero caps at 184px | Titles are data on a tablet |
| Curly-bracket eyebrows above sections | Bracket notes sit beside or under titles | No eyebrows stacked above headings |
| Soft 3D shapes everywhere | Landing page only | Nothing decorative near a reading or a badge |

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
  (Grafbase × Lattice × Altitude), then Grafbase, exactly — light only, with the owner's type spec.
- 2026-09-26: **the GSAP reference, dark** — the current system (`docs/specs/ui-ux-spec.md` §2,
  `DESIGN.md`).

### 2.6 Skills to load for frontend work

- `impeccable` — the project's design-quality pass (hooks wired in `.claude/settings.local.json`).
- `design-taste-frontend` and `redesign-existing-projects` — taste and audit checklists.
- `dockiq-frontend` — this file's rules as an auto-loading skill.
