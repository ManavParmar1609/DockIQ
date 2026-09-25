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

### 2.2 The committed direction — Apple's design language *(chosen 2026-09-25)*

The product owner chose an Apple-like aesthetic, replacing "Freight Manifest" (Swiss Industrial
Print, Phase 2). It is resolved against Part 1 as follows:

- **Distinctive, not generic.** "Generic" in Part 1 means undesigned defaults. Apple's language is a
  complete, deliberate system — grouped surfaces, materials, iOS motion, SF Pro Rounded numerals,
  segmented controls — applied with Apple's own restraint. Copying its surface without its rigour
  would be the slop; the rigour is the point.
- **Typography.** Part 1 bans system fonts as a *default*. Here the system font is the *choice*: on
  Apple devices it is SF Pro, which is the aesthetic. Elsewhere the fallback is **Geist**, not Inter
  or Arial. Inter and Space Grotesk stay banned.
- **Colour.** One dominant neutral system (Apple's grays) with one sharp accent, blue, for
  interaction. Red is reserved for critical severity and destructive actions — nothing decorative is
  red.
- **Light and dark.** Both, following the device, from the same tokens. Light is the default, and it
  survives warehouse glare; dark is there for night shifts and dim docks.
- **Motion.** One orchestrated moment (the staggered rise on load) plus press feedback, on iOS
  easing. No scattered micro-animation, never on an alert.
- **The landing page** follows apple.com: black hero, light feature sections, a bento of roles.

### 2.3 Where DockIQ departs from Apple's defaults

| Apple does | DockIQ does instead | Why |
|---|---|---|
| 10–12pt captions and tab labels | **14px floor**; 17px body | Gloves, distance, glare |
| Translucency on alerts and banners | **Critical banners and badges are solid** | A degraded critical alert is a food-safety defect |
| Colour-coded status dots | Severity is **label + shape + colour**, always | Colour alone fails colour-blind users and glare |
| Tinted system red at full saturation behind text | Accessible (increased-contrast) system colours for any text or fill that carries text | WCAG AA on the real surfaces |

### 2.4 Non-negotiables that outrank any aesthetic

1. Severity is legible at a glance and **never conveyed by colour alone** — always paired with a
   label and a shape.
2. Touch targets ≥ 44pt.
3. WCAG AA contrast on the app surfaces, in light and dark mode.
4. The resolution screen keeps showing the **score derivation, the confidence, and the cited SOP
   source** — the product's "explainable, not magic" claim made visible.
5. Confidence has its own visual channel (signal bars), **not** the severity palette.
6. **No emoji as icons.**
7. Simulated data remains **visibly marked as simulated**.

### 2.5 History

- **Phase 0:** an Apple-derived look (`.apple-*`, Inter, `#0071E3`) — generic defaults, replaced.
- **Phase 2:** "Freight Manifest" (Archivo + Martian Mono, paper and ink, one hazard red).
- **2026-09-25:** the Apple design language described above, built as a complete token system with
  dark mode (tokens: `docs/specs/ui-ux-spec.md` §2).

### 2.6 Skills to load for frontend work

- `apple-design` (`.agents/skills/apple-design/`) — motion, materials, typography.
- `redesign-existing-projects` — the audit checklist for any visual pass.
- `impeccable` — the project's own design-quality pass; its hooks are wired in
  `.claude/settings.local.json`.
- `design-taste-frontend` — the landing page.
- `dockiq-frontend` (`.claude/skills/dockiq-frontend/`) — this file's rules as an auto-loading skill.
