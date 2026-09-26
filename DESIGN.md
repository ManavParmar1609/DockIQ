---
name: DockIQ
description: Dock-door intelligence for cold-storage warehouses, drawn on a near-black chalkboard stage in carved cream type, with highlighters that file the work and severity that never whispers.
colors:
  paper: "#0e100f"
  surface: "#171917"
  paper-sunk: "#1f211e"
  paper-deep: "#2c2e2a"
  night: "#0b0c0b"
  night-raised: "#191919"
  ink: "#fffce1"
  ink-soft: "#d3d0b9"
  ink-mute: "#a3a292"
  hairline: "#34352f"
  rule: "#42433d"
  rule-strong: "#6d6e63"
  sage: "#7c7c6f"
  white: "#ffffff"
  black: "#000000"
  accent: "#0ae448"
  accent-light: "#abff84"
  on-accent: "#0e100f"
  accent-ink: "#3df06f"
  accent-soft: "#12281a"
  accent-line: "#1f5a32"
  pink: "#fec5fb"
  pink-soft: "#2c1b2b"
  blue: "#00bae2"
  blue-ink: "#4fd3ef"
  blue-soft: "#0b2329"
  lilac: "#9d95ff"
  lilac-ink: "#b4aeff"
  lilac-soft: "#1c1a33"
  orangey: "#ff8709"
  signal-ink: "#ffa24a"
  signal-soft: "#2d1a07"
  hazard: "#c9372c"
  hazard-bright: "#ff5a4f"
  hazard-deep: "#ff9b90"
  hazard-soft: "#2b1311"
  hazard-line: "#6e2a23"
  orange: "#ffc062"
  orange-bright: "#ffab2e"
  orange-soft: "#2c1f0b"
  amber: "#e3e37d"
  amber-bright: "#d4d64a"
  amber-soft: "#23240f"
  green: "#6ff09a"
  green-soft: "#10261a"
  chart-1: "#00b320"
  chart-2: "#7a71cf"
  chart-3: "#dc7100"
  chart-4: "#0096b9"
typography:
  hero:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "clamp(3.5rem, 12.5vw, 11.5rem)"
    fontWeight: 600
    lineHeight: 0.9
    letterSpacing: "-0.045em"
  display:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "4.125rem"
    fontWeight: 600
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  statement:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "clamp(1.75rem, 3.6vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "-0.02em"
  serif-title:
    fontFamily: "'Source Serif 4 Variable', 'Source Serif 4', Georgia, serif"
    fontSize: "1.4375rem"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.025em"
    fontVariation: "font-optical-sizing: auto"
  heading:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  body-reading:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "-0.005em"
  telemetry:
    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace"
    fontSize: "1rem"
    fontWeight: 500
    letterSpacing: "-0.01em"
    fontFeature: "'tnum', 'lnum', 'zero'"
  num:
    fontFamily: "'Host Grotesk Variable', 'Host Grotesk', ui-sans-serif, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.04em"
    fontFeature: "'lnum', 'tnum'"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "10px"
  2xl: "12px"
  3xl: "16px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "10": "40px"
  "14": "56px"
  "24": "96px"
components:
  button-primary:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 22.4px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 22.4px"
    height: "48px"
  button-hazard:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.white}"
    rounded: "{rounded.full}"
    padding: "0 22.4px"
    height: "48px"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-mute}"
    rounded: "{rounded.full}"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 14px"
    height: "48px"
  choice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
    height: "52px"
  choice-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  pill-tag:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "0 11.2px"
    height: "28px"
  sim-tag:
    backgroundColor: "{colors.orangey}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.sm}"
    padding: "0 11.2px"
    height: "28px"
  severity-critical:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.white}"
    rounded: "{rounded.full}"
  severity-high:
    backgroundColor: "{colors.orange-soft}"
    textColor: "{colors.orange}"
    rounded: "{rounded.full}"
  severity-medium:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.full}"
  severity-low:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-mute}"
    rounded: "{rounded.full}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.lg}"
    padding: "10px 16px"
  nav-item-current:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  rail:
    backgroundColor: "{colors.night}"
    width: "280px"
  bubble-user:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    padding: "10px 16px"
  medallion:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.lg}"
    size: "44px"
---

# Design System: DockIQ

## Overview

**Creative North Star: "The Chalkboard on the Dock"**

DockIQ is the owner's GSAP reference, an animated chalkboard in a design studio, brought onto a cold-storage loading dock. One near-black stage carries everything. On it: cream type carved tight at display sizes, hairline rules instead of boxes, outlined pills to press, and a small set of highlighters that file the work. Green is DockIQ itself and the thing to do next. Pink, blue and lilac file zones, report groups, inspection sections and cold rooms. Orange marks data as simulated. Nothing is coloured to decorate an operating screen: a colour either files something or raises an alarm.

The dock outranks the reference wherever the two disagree. Severity keeps its own red, amber and citron, always as a word plus a shape. The type floor is 14px, control edges pass 3:1, every target is at least 44px, nothing moves on an alert, and the barcode stays black on white. The interface is dark only. It is read at arm's length through gloves and glare, so the carving stays at page-title scale and the working surfaces stay calm, legible and dense enough for a tablet on a forklift.

Motion is the reference's signature and is spent where it explains. Titles wipe up out of their own baseline. Screens rise out of a blur on a stagger. Green rises up through the primary pill when it is hovered or pressed. A quiet bar slides in behind a hovered nav item, and cards rise while their rule lights in their filing colour. The landing page adds words that light as they scroll, a highlighter montage, and soft 3D shapes that drift slowly. None of it touches a critical surface, and reduced motion turns it all off.

**Key Characteristics:**
- One near-black stage with surfaces one step lifted; cream ink, never pure white text.
- Hairline rules and surface steps for depth; no drop shadows on cards.
- 100px pills for everything pressed; a single gradient-stroked green primary per view.
- Five highlighters that file; severity has a separate red/amber/citron channel with shapes.
- Three type voices: Host Grotesk for everything, Source Serif 4 for editorial titles, Geist Mono for telemetry.
- `{ bracket }` notes beside or under titles as the reference's annotation.

## Colors

A near-black stage with cream ink, one electric green that means DockIQ and "do this", four filing highlighters, and a severity palette that sits outside the reference entirely.

### Primary
- **Shockingly Green** (accent): The brand and the next action. It strokes the primary pill (as the 114° gradient into **Lime Light**, accent-light), fills the current nav item, carries the person's own chat words, and draws focus rings, the caret, meters and selection. **Green Ink** (accent-ink) is its text step, **Green Wash** (accent-soft) its surface, **Green Rule** (accent-line) its line. **On-Green** (on-accent), the stage colour, is the only ink allowed on a green fill.

### Secondary
- **Highlighter Pink** (pink, wash pink-soft): Files Zone A, the People report group and the Operators column.
- **Highlighter Blue** (blue, text blue-ink, wash blue-soft): Files Zone B, the Product report group, the frozen cold room and the heatmap ramp.
- **Highlighter Lilac** (lilac, text lilac-ink, wash lilac-soft): Files Zone C, the Systems report group and Quality.

### Tertiary
- **Orangey** (orangey, text signal-ink, wash signal-soft): The simulated mark, a square-cornered orange highlighter block reading "Simulated data" or "Sample data". Also trailer lamps in the door bays.

### Severity (a departure from the reference)
- **Critical Red** (hazard): The one solid capsule, with white text. **Hazard Bright** is used for graphic marks and the critical edge, **Hazard Deep** for critical text on its wash, **Hazard Soft** for the critical wash and **Hazard Line** for the rule around it.
- **High Amber** (orange, orange-bright, orange-soft): Tinted capsule and amber ring on a door tile. Also the dashed alarm limit on cold-room traces.
- **Medium Citron** (amber, amber-bright, amber-soft): Tinted capsule.
- **Resolved Green** (green, green-soft): Resolved status and the live dot. This is a status green, distinct from the brand green.

### Neutral
- **Just Black** (paper): The stage behind everything, and also the fill of a text field.
- **Lifted Black** (surface): Cards, panels, bars, the composer and sheets.
- **Quiet Step** (paper-sunk): Hover fills, quiet tags, notices and low severity.
- **Deep Step** (paper-deep): Meter tracks, empty cells, trailer floors and answer tokens.
- **Night** (night) and **Off Black** (night-raised): The rail, and the landing footer band.
- **Surface Cream** (ink): All primary text. It also fills the cream footer terminator.
- **Soft Cream** (ink-soft): Secondary text and bracket glyphs.
- **Mute Cream** (ink-mute): Captions and metadata, the lowest step allowed for small text.
- **Hairline** (hairline): Card edges and the rail divider. **Rule** (rule) is for dividers that must read. **Rule Strong** (rule-strong) is for control edges at 3:1.
- **Sage** (sage): The reference's grey, kept for decorative strokes and icons only.

### Charts
Four categorical slots in fixed order: chart-1 green, chart-2 lilac, chart-3 orange, chart-4 blue. They are the highlighters stepped down into a dark chart band so marks sit on a card without glowing. Never cycle them. The heatmap is one hue (chart-4) in four steps mixed up from the surface.

### Named Rules
**The Filing Rule.** Colour files things or raises an alarm; it never decorates an operating screen. Pink, blue and lilac always name a zone, group, section or room. A filing colour never signals urgency.

**The One Green Rule.** Green means DockIQ and the thing to do: the primary stroke, your place in the nav, your own words, focus. Inside the app the only green fills are the current nav item, the primary pill's rise, the person's chat bubble, meters and the brand disc; everywhere else green is a wash or a rule.

**The Simulated Orange Rule.** Inside the product, the orange highlighter block means simulated data and nothing else. Keep it on every surface that shows fictional data.

**The Severity Channel Rule.** Red, amber and citron are reserved for severity. Every level pairs its colour with a word and a shape (▲ critical, ◆ high, ■ medium, ○ low). Red is never a chart hue and never a filing colour.

## Typography

**Display Font:** Host Grotesk Variable (with ui-sans-serif)
**Body Font:** Host Grotesk Variable (with ui-sans-serif)
**Editorial Font:** Source Serif 4 Variable, optical size axis (with Georgia)
**Label/Mono Font:** Geist Mono Variable (with ui-monospace)

**Character:** Host Grotesk stands in for the reference's Mori and Messina. It is carved tight at 600 for titles and plain at 16px for work. Source Serif 4 at its display optical size stands in for Untitled Serif and gives panel titles a quiet editorial voice. Geist Mono sets every ID, count, time and temperature, with tabular figures and a slashed zero.

### Hierarchy
- **Hero** (600, clamp 56px to 184px, 0.9): Landing headline only, two lines with the second indented 18%.
- **Display** (600, 44px to 66px, 0.98, -0.035em): Page titles, wiping up on load. Record screens whose title is data use 34px to 44px. Section titles on the landing page use the same voice, and the wordmark uses it at 20px to 23px.
- **Statement** (400, clamp 28px to 44px, 1.18): The landing paragraph whose words light as they scroll.
- **Serif Title** (400, 23px in panels, 28px to 34px on landing, 1.08, -0.025em): Panel titles, empty states, editorial lines and the footer note. Assistant answer headings use 22px.
- **Heading** (600, 16px to 19px, 1.25, -0.015em): Card and notice titles, row titles in queues.
- **Body** (400, 16px, 1.5, -0.01em): All working text. Assistant answers use 17px at 1.6 with a 68ch measure.
- **Label** (500, 14px, 1.4): Captions, metadata, definition terms and table headers, in mute cream.
- **Telemetry** (Geist Mono 500, tabular + lining + slashed zero): IDs, order numbers, SKUs, times, money, temperatures.
- **Num** (600, 44px, -0.04em, tabular): Headline metrics and scores.

### Named Rules
**The Three Voices Rule.** Host Grotesk for everything read and every control, Source Serif 4 only for editorial titles, Geist Mono only for telemetry. There is no fourth face.

**The Serif Floor Rule.** The serif sets titles at 400 and never below 20px. It is never used for body text, labels or controls.

**The 14px Floor Rule.** No text is smaller than 14px (text-xs and text-sm are both 14px). Captions step down in colour, never below 14px.

**The Telemetry Rule.** Anything a person reads off and matches (an ID, a count, a time, a temperature) is set in Geist Mono with tabular, slashed figures.

## Layout

The app is a two-column shell from 1024px up: a 280px night rail (wordmark, bracketed role, nav, live indicator, simulated tag, user card) beside a content column capped at 1280px. Content padding is 16px on phones, 24px from 640px and 40px from 1024px. Below 1024px the rail becomes a blurred top bar and a fixed bottom tab bar with safe-area padding, and content gets 128px of bottom padding to clear it.

Panels sit directly on the stage under a single rule, with no box around them. Cards and tiles use 16px to 20px internal padding. Grids use gaps of 8px to 12px, stat grids run 2 columns and then 4, and fact strips run 2, 3 and then 6 columns with 1px hairline gaps. Sheets are `min(36rem, 100% - 2rem)`. The dock-detail sheet rises from the bottom on phones and slides in from the right, 544px wide, from 768px up. Wide diagrams keep a 736px minimum and scroll inside their frame on narrow screens.

The landing page is a 1280px column with 24px gutters and generous vertical rhythm (80px to 112px section padding). Tool rows are separated by rules and use a 256px shape column beside the content from 1024px up.

## Elevation & Depth

Depth is tonal. The stage is the lowest layer, cards and panels are one surface step lifted and edged with a hairline, and quiet fills sit one step higher. Cards carry no shadow at all. The only shadow is the float: a faint cream ring plus a long dark fall. It is reserved for layers that actually float over content: dialogs, alert toasts, the assistant composer and the landing product preview. Top and bottom bars are the stage itself at 92% opacity with a 14px blur. When transparency is reduced they fall back to an opaque surface. Dialog backdrops are near-black at 72% with a 4px blur.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 0 0 1px rgb(255 252 225 / 0.06), 0 18px 48px -12px rgb(0 0 0 / 0.7)`): Dialogs, toasts, the composer, the product preview. Never on a card.
- **Focus halo** (`box-shadow: 0 0 0 4px color-mix(in srgb, #0ae448 18%, transparent)`): Around a focused field, and at 14% around the focused composer.
- **Inset rule** (`box-shadow: inset 0 0 0 1px` rule, or `2px` accent when selected): The edge of a choice tile. On door tiles it is `2px` orange-bright for issues and `1px` hazard-bright for critical.

### Named Rules
**The Surface Step Rule.** A card is lifted by one surface step and a hairline, never by a shadow. If something needs to feel higher, it must actually float.

## Shapes

Anything you press is a pill: buttons, tags, severity capsules, suggestion chips and the live dot (9999px). Fields, choice tiles, nav items and medallions use 8px. Cards, panels, fact strips, starters and the dock sheet use 10px. Floating layers (dialogs, toasts, the composer) and door tiles use 12px. The zone apron that holds a row of doors uses 16px. Two things break the pill: the simulated mark is a square-cornered highlighter block (4px), and the highlighter spans (`.hl`) round only 0.12em, like a marker stroke. The user's chat bubble is 12px with a 4px tail corner toward them. Data bars are square at the baseline with a 4px rounded data end.

Edges are 1px hairlines. The primary pill has a 1.5px gradient stroke. Icons are lucide, drawn at a 1.6 stroke. Landing shapes are soft 3D forms lit from within by radial gradients (clover, dome, squiggle, ring, spark, pallet stack, probe, drop). They appear on the landing page only and are always hidden from assistive technology.

## Components

### Buttons
Pressed things are pills, set in Host Grotesk 600 at 16px.
- **Shape:** Full pill (9999px), 48px minimum height, 22.4px side padding, 8px icon gap.
- **Primary:** A green-wash fill inside a 1.5px green gradient stroke, with cream text. On hover (pointer devices) and on press, the gradient rises up through the pill over 480ms and the text turns stage-black. A trailing arrow nudges 3px right.
- **Secondary:** Transparent, with a cream hairline at 55% and cream text. Hover brings the border to full cream and adds a 7% cream wash; press deepens the wash to 12%.
- **Hazard:** A solid critical-red fill with white text, for destructive and critical decisions only.
- **Press / Disabled:** Every press scales to 0.97. Disabled buttons drop to a transparent fill with a hairline and mute text, and the primary loses its gradient.

### Chips
- **Tag pill:** 28px tall, 14px semibold, full pill. Plain tags are quiet step on soft cream, ink tags are cream on stage, accent tags are green wash on green ink, and resolved tags are green-soft on green with a check.
- **Suggestion chip:** A transparent pill with a rule border in soft cream. On hover it warms to a green border, green wash and cream text, and it scales to 0.97 on press. Chips scroll in a rail that fades out at the right edge.
- **Simulated mark:** An orange highlighter block (4px corners) with dark ink, reading "Simulated data", "Sim" or "Sample data".

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Lifted black (surface) with a 1px hairline.
- **Shadow Strategy:** None (see The Surface Step Rule).
- **Interactive cards:** On hover they rise 2px, the border lights in the card's filing colour (green by default), and the fill takes a 12% tint of that colour. Their medallion tilts -8° and scales to 1.06. Critical door tiles never move.
- **Panel:** Not a card. It is a rule on the stage with a serif title row, and it reveals on a 70ms stagger.
- **Alert notice:** A 12px hazard wash with a hazard-line border, a warning icon and a title in hazard-deep text.

### Inputs / Fields
- **Style:** Stage-black fill, 1px rule-strong edge (3:1), 8px corners, 48px tall, 16px text, mute placeholder, green caret.
- **Hover:** The edge warms toward cream.
- **Focus:** The edge turns green and a 4px green halo appears at 18%. The global focus ring for everything else is a 2px green outline with a 3px offset.
- **Choice tiles:** A surface-filled tile with an inset rule, 52px tall and 8px corners. Selected tiles take the green wash and a 2px green inset, and their weight steps from 500 to 600.

### Navigation
- **Rail (1024px and up):** A night column with the gradient-disc wordmark (*IQ* upright in green) and a bracketed role label. Nav items are 16px medium soft cream on 8px corners. On hover a quiet-step bar scales in from the left and the icon nudges and tilts -6°. The current item is a solid green highlighter block with stage-black 600 text.
- **Tab bar (below 1024px):** Blurred stage with a top hairline. Tabs are at least 56px tall with a 24px icon and a 14px label. The current tab's icon and label turn green, and the icon pops once.
- **Top bar (below 1024px):** Blurred stage with a bottom hairline, the compact wordmark, the live indicator, alerts and sign-out.
- **Announcement strip:** The full-width green gradient bar with stage-black text and a dot, stating that the data is simulated. It sits above every app screen and the landing page.

### Severity Badge (signature)
A pill capsule that always holds a shape glyph and a word. Critical is solid red with white text and ▲. High is an amber wash with amber text and ◆. Medium is a citron wash with citron text and ■. Low is the quiet step with mute text and ○. It comes in three sizes: sm (28px), md (32px) and lg (44px). Critical queue rows take the hazard wash, and their dock plate turns solid red. Match confidence is a separate channel of three cream signal bars with a "Match:" label, and it never borrows severity colour.

### Bracket Note (signature)
The reference's annotation: a short note held between tall `{ }` glyphs in light Host Grotesk at 2.1em. It sits under or beside a page title (greeting, scope, context), beside the rail wordmark (role and zone), or at the left of a landing statement. In assistant answers the same braces hold an aside instead of a box.

### Door Tile and Dock Wall (signature)
Door tiles are 12px surface tiles grouped on a zone apron tinted with the zone's highlighter. Each has a dock plate in the zone colour with stage-black type, a trailer drawn backing into its bay, and a progress bar in the zone colour. Idle doors recede to half a surface step. Doors with an issue get a 2px amber inset ring. A critical door takes the hazard wash with a bright-red rule and a solid red plate, and nothing on it animates.

### Fact Strip
A ruled grid of cells with 1px hairline gutters inside a 10px frame. It runs 2, 3 and then 6 columns. Each cell has a label over a value set in the body voice or telemetry, and its fill steps to the quiet step on hover.

### Assistant Turn
A 36px gradient disc sits in a gutter beside the answer. The answer is prose at 17px with 68ch lines, green list markers and mono-numbered ordered lists. Codes in the answer sit on the deep step in mono. What the assistant checked is shown as a trace with a green left rule. The person's own words sit in a solid green bubble with stage-black text that rises in from the bottom right. The composer is the one floating surface on the page, and its rule turns green on focus.

## Do's and Don'ts

### Do:
- **Do** keep every screen on the near-black stage (#0e100f) with cream ink (#fffce1). The system is dark only.
- **Do** build depth from the surface step (#171917) and a 1px hairline, and save the float shadow for layers that actually float.
- **Do** make every button and tag a full pill, and keep one gradient-stroked green primary per view.
- **Do** file zones, groups, sections and rooms with pink, blue and lilac on their dark washes, using the `-ink` step for small text.
- **Do** mark every surface that shows fictional data with the orange simulated block.
- **Do** pair every severity colour with its word and its shape.
- **Do** set every ID, count, time and temperature in Geist Mono with tabular, slashed figures.
- **Do** keep text at 14px or larger, targets at 44px or larger (48px for buttons and fields), and control edges at 3:1.
- **Do** put `{ bracket }` notes under or beside the title they annotate.
- **Do** honour reduced motion, reduced transparency and more-contrast, which the stylesheet already handles.

### Don't:
- **Don't** build a light SaaS dashboard: no white cards, no filled grey buttons, no theme toggle.
- **Don't** put a drop shadow on a card.
- **Don't** colour anything in an operating screen for decoration. If a colour doesn't file or alarm, it goes.
- **Don't** fill anything in the app green except the current nav item, the primary pill's rise, the person's chat bubble, meters and the brand disc.
- **Don't** use red, amber or citron for anything but severity, and never use red as a chart hue.
- **Don't** stack a bracket note above a title as an eyebrow.
- **Don't** set the serif below 20px or use it for body text, labels or controls.
- **Don't** use sage (#7c7c6f) for text. It fails for small type on a card.
- **Don't** animate a critical door, an alert, or a severity mark.
- **Don't** put soft 3D shapes inside the app. They belong to the landing page.
- **Don't** write hex or arbitrary Tailwind values in components. Add a named class or token to `frontend/src/styles/app.css`.
