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

### 2.2 The committed direction — Botanical / Organic Serif *(chosen 2026-09-25)*

The product owner supplied this design system after judging the Apple-style pass generic. Its
character — rice paper and grain, deep forest ink, sage and terracotta, Playfair Display with italic
emphasis, soft 24px cards, pills, arches, slow graceful motion — answers Part 1 directly: a
distinctive serif pairing, a committed earthy palette with sharp accents, atmosphere from texture,
one orchestrated reveal. Calm is also the right emotion for a stressful dock.

### 2.3 Where DockIQ departs from the design system

| The design system says | DockIQ does instead | Why |
|---|---|---|
| "No artificial brights"; muted palette only | Critical is a **brick red** (`#A8322A`), still earthy but unmistakable; high/medium get ochre and olive | A food-safety alert must never be timid |
| Grain overlay fixed on top, `z-50` | Grain sits **beneath** the opaque cards | No texture may touch a badge, a reading or an alert |
| Sage and terracotta as text/interactive colours | Used for decoration; **deeper `-ink` variants** carry text | They fail AA on rice paper (2.8 and 3.3:1) |
| Slow 500–700ms motion everywhere | Reveals and hovers are slow; **press feedback is instant** | A gloved tap must feel answered at once |
| Small uppercase button labels | 14px floor, 50px pill height | Gloves, distance, glare |
| Staggered cards (`translate-y-12`) | On the landing page only, not in working screens | Scanning a queue needs straight rows |
| One sans for everything read at work | Source Sans 3 for reading, **Spline Sans Mono** for telemetry (IDs, codes, times, counts) | The product owner asked for more type voices; a soft mono keeps codes unambiguous (0/O, 1/l) |
| One orchestrated moment, no scattered micro-interactions | Micro-interactions **where they explain**: the load guide's breathing spot, flowing arrow, settling pallet, gliding view; sheets sliding in | Requested by the product owner; each one carries information. Never on an alert; reduced motion honoured |

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
- 2026-09-25: an Apple design-language pass, then **Botanical / Organic Serif**, the current system
  (`docs/specs/ui-ux-spec.md` §2).

### 2.6 Skills to load for frontend work

- `impeccable` — the project's design-quality pass (hooks wired in `.claude/settings.local.json`).
- `design-taste-frontend` and `redesign-existing-projects` — taste and audit checklists.
- `apple-design` (`.agents/skills/apple-design/`) — motion and interaction feel.
- `dockiq-frontend` — this file's rules as an auto-loading skill.
