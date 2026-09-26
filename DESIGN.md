---
name: DockIQ
description: Dock-door intelligence for cold-storage warehouses, drawn as an engineering blueprint on cool marble.
colors:
  paper: "#eaeaea"
  surface: "#ffffff"
  paper-sunk: "#f4f4f5"
  paper-deep: "#e0e1e6"
  hairline: "#e0e1e6"
  ink: "#1b1b1b"
  ink-soft: "#60646c"
  ink-mute: "#60646c"
  accent: "#1b1b1b"
  on-accent: "#ffffff"
  accent-ink: "#1b1b1b"
  accent-soft: "#f4f4f5"
  sage: "#7c7c7c"
  sage-ink: "#1b1b1b"
  terracotta: "#7c7c7c"
  strip-forest: "#13784a"
  strip-teal: "#0b6b75"
  hazard: "#b42318"
  hazard-bright: "#d92d20"
  hazard-deep: "#912018"
  hazard-soft: "#fdecea"
  orange: "#8a5a10"
  orange-soft: "#fdf1dc"
  orange-bright: "#d4891f"
  amber: "#515c0b"
  amber-soft: "#f3f5d8"
  amber-bright: "#aebd2a"
  green: "#2f6b1c"
  green-soft: "#eaf6e2"
  teal: "#0a6d78"
  teal-soft: "#e6f8f5"
  indigo: "#00679e"
  indigo-soft: "#e5f5fc"
  mint: "#456d18"
  mint-soft: "#eef7e2"
  purple: "#1d6b52"
  purple-soft: "#e3f4ea"
  brown: "#1b1b1b"
  brown-soft: "#f0f0f1"
  chart-1: "#007096"
  chart-2: "#679725"
  chart-3: "#6a78cd"
  chart-4: "#007d65"
typography:
  display:
    fontFamily: "'Playfair Display Variable', 'Playfair Display', Georgia, serif"
    fontSize: "5.625rem"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Playfair Display Variable', 'Playfair Display', Georgia, serif"
    fontSize: "2.5rem"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  title:
    fontFamily: "'Inter Variable', 'Inter', ui-sans-serif, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.015em"
    fontFeature: "'ss01', 'cv11'"
  body:
    fontFamily: "'Inter Variable', 'Inter', ui-sans-serif, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.018em"
    fontFeature: "'ss01', 'cv11'"
  label:
    fontFamily: "'Hanken Grotesk Variable', 'Hanken Grotesk', 'Inter Variable', ui-sans-serif, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  number:
    fontFamily: "'Inter Variable', 'Inter', ui-sans-serif, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.035em"
    fontFeature: "'lnum', 'tnum'"
  telemetry:
    fontFamily: "'Geist Mono Variable', 'Geist Mono', ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 500
    letterSpacing: "-0.005em"
    fontFeature: "'tnum', 'lnum', 'zero'"
rounded:
  sm: "4px"
  md: "6px"
  lg: "12px"
  xl: "20px"
  full: "40px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  20: "80px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.paper-sunk}"
  button-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 20px"
    height: "48px"
  button-hazard:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "48px"
  button-hazard-hover:
    backgroundColor: "{colors.hazard-deep}"
  button-disabled:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-mute}"
  field:
    backgroundColor: "{colors.surface}"
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
    rounded: "{rounded.xl}"
    padding: "20px"
  notice:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  tag:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "28px"
  severity-critical:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.on-accent}"
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
  nav-item-active:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
---

# Design System: DockIQ

## Overview

**Creative North Star: "The Engineering Blueprint on Cool Marble"**

DockIQ replicates Grafbase's style reference and holds the dock's safety rules above it. The page is a drafting-gray table. White marble sheets sit on it, each edged with a 1px cool hairline and no shadow. Graphite sets all the text and fills the single primary action. The interface has no chromatic accent. Colour appears in two places only: the forest-to-teal announcement strip that says the data is simulated, and the product's own content (diagrams, zones, charts), which uses a cool triad of mint, sky and moss. The world is light only. There is no dark mode.

The type follows the owner's spec in place of Grafbase's single family. Titles are an editorial serif at 400, tight and compressed. Inter, tracked slightly tight, carries everything read at work. Hanken Grotesk sets the small captions. Geist Mono sets the telemetry. Everything is read at arm's length on a forklift tablet, with gloves, glare and dim light. So density is moderate, targets are generous (44px minimum, 48px buttons), the type floor is 14px, and nothing moves on an alert.

The reference gives way to the dock in three documented places. Severity keeps brick red, saffron and olive, always with a word and a shape. The floor is 14px, not Grafbase's 13px. Ash grey never sets small text.

**Key Characteristics:**
- A drafting-gray canvas (`paper`) under white cards with a 1px `hairline`, 20px corners and no shadow.
- Graphite (`ink`) is the text colour and the one filled action. The interface has no accent hue.
- Four typefaces, one per job: Playfair Display 400 for titles, Inter for UI and body, Hanken Grotesk for labels, Geist Mono for telemetry.
- Squared 6px buttons, 12px fields and panels, 20px cards, 40px pills for tags and the sign-in pill.
- Chrome colour is limited to the announcement strip. The cool triad appears only inside product content.
- Light only.

## Colors

A near-monochrome drafting-gray and graphite ground. Colour carries meaning in three separate channels: the simulated-data strip, the cool content triad, and the severity ramp.

### Primary
- **Graphite** (`ink`, `accent`, `accent-ink`, `sage-ink`): all primary text (17.2:1 on marble), the primary button, links (underlined), meter fills, the focus ring, the caret and the ink-toned tag. The alias names are historical; every one of them resolves to graphite.
- **White on Graphite** (`on-accent`): text on the primary action.

### Secondary
- **Severity ramp** (a departure from Grafbase, which has no status colour):
  - Brick (`hazard`): the critical fill, 6.6:1 under white. `hazard-deep` sets critical text on `hazard-soft` (7.6:1). `hazard-bright` is for graphic marks only.
  - Saffron (`orange` on `orange-soft`, 5.3:1): high. `orange-bright` is for marks, issue rings and the cold-room alarm line.
  - Olive (`amber` on `amber-soft`, 6.5:1): medium. `amber-bright` is for marks only.
  - Low: quiet `paper-sunk` with steel.
- **Resolved Green** (`green` on `green-soft`, 5.8:1): resolved issues and the live-connection dot.
- **The Announcement Strip** (`strip-forest` into `strip-teal`, at 89.97deg): the simulated-data bar across the top of the app and the landing page. Both stops sit one step deeper than the reference, so its white 14px text passes AA (5.5:1 at the lightest point).

### Tertiary
- **The cool triad**, for product content only. Each ink is a deepened mark colour and pairs with the pale tint it files under:
  - Mint (`teal` / `teal-soft`)
  - Sky (`indigo` / `indigo-soft`)
  - Moss (`mint` / `mint-soft`)
  - Forest (`purple` / `purple-soft`) and Graphite (`brown` / `brown-soft`) extend the set for load-plan products.
  - The dock wall files zone A under moss, zone B under mint and zone C under sky. The token names are historical; use the names and trust the values.
- **Chart slots:** Sky (`chart-1`), Moss (`chart-2`), Blue (`chart-3`) and Mint (`chart-4`). They always appear in this order and never cycle. They were validated for colour-blind adjacency, and each slot is at least 3:1 on white. The heatmap is one hue (sky), mixed toward white in four steps.

### Neutral
- **Drafting Gray** (`paper`): the canvas, and the alternating bands on the landing page.
- **Marble** (`surface`): cards, the rail, the top bar, the tab bar, fields and sheets.
- **Subtle Gray** (`paper-sunk`, `accent-soft`): hover, quiet fills, the selected nav item, selected choice tiles, the low severity badge, notices and tracks.
- **Cool Rule** (`paper-deep`, `hairline`): every 1px border and structural rule, empty meter cells and trailer floors.
- **Steel** (`ink-soft`, `ink-mute`): secondary text, captions and metadata (5.9:1 on marble, 4.9:1 on the canvas).
- **Ash** (`sage`, `terracotta`): decorative strokes, icons and small marks such as trailer lamps. Never text.

### Named Rules
**The Two Places Rule.** Chromatic colour in the chrome is limited to the announcement strip. Everywhere else, the triad lives inside the product's own content (a zone, a load, a chart series, a cold room). Anything that is neither is graphite, steel or gray.

**The Brick Is Critical Rule.** `hazard` appears only for critical severity, critical door tiles, the critical stat, alert notices and the report or destructive action. It is never a chart hue, and no status colour is ever a chart hue.

**The Graphic-Only Rule.** The `-bright` severity tones and Ash fail as small text. They draw edges, bars, lamps and marks. The base and `-deep` inks carry the words.

## Typography

**Display Font:** Playfair Display Variable (with Playfair Display, Georgia, serif), the free stand-in for Heldane Display
**Body Font:** Inter Variable (with Inter, ui-sans-serif, sans-serif), stylistic sets `ss01` and `cv11`, tracked -0.018em
**Label Font:** Hanken Grotesk Variable (with Hanken Grotesk, Inter), the free stand-in for Aktiv Grotesk
**Mono Font:** Geist Mono Variable (with Geist Mono, ui-monospace, monospace)

**Character:** An editorial serif headline set tight over an engineered, slightly compressed sans. The serif names the place, Inter does the work, and the mono states the facts.

### Hierarchy
- **Display** (Playfair Display 400, 64 to 90px, 0.95, -0.02em): the landing hero. Balanced wrap.
- **Headline** (Playfair Display 400, 40 to 48px, 0.95, -0.02em): every app page title and the landing section headings (at 1.0 line-height). Record screens whose title is data drop to 28 to 40px.
- **Title** (Inter 600, 16 to 24px, 1.3, -0.015em): card, panel, notice and empty-state titles.
- **Body** (Inter 400, 16px, 1.5, -0.018em): running text and values. Landing prose runs at 20px in steel, capped near 32rem.
- **Label** (Hanken Grotesk 500, 14px, 1.4, no tracking, steel): captions, metadata, table headers and "Sample data" marks, in sentence case. 14px is the floor.
- **Number** (Inter 600, -0.035em, lining tabular): stat values, door plates and headline figures, from 20 to 64px.
- **Telemetry** (Geist Mono 500, tabular, lining, slashed zero): every ID, code, time, count, temperature and money value.

### Named Rules
**The Four Jobs Rule.** Each face has one job. Playfair names places (page titles, section headings, the wordmark). Inter carries every sentence, control and headline number. Hanken sets captions. Geist Mono sets data a person copies, compares or reads off. Never set a sentence in mono.

**The Upright IQ Rule.** The wordmark sets "IQ" upright at 600 in steel, so it never reads as "Dock12".

**The No Accent Words Rule.** Emphasis inside a title keeps the title's own voice: no italic and no colour change.

## Layout

On desktop (64rem and up) the shell has two columns. On the left is a 17.5rem marble rail with a hairline right rule. It holds the wordmark, the role and zone, navigation, the live status, the simulated tag and the person card. The content column beside it is capped at 80rem, with 40px side padding. Below 64rem the rail becomes a marble top bar with a hairline underneath, plus a fixed bottom tab bar (56px targets, safe-area padding). The content gains bottom padding so nothing hides under the tabs. The announcement strip sits above everything at every width.

Each page opens with the serif title and a single line of steel metadata, then the task's primary object (load guide, queue, board) before any stats. Spacing runs on a 4px grid: 8 and 12px gaps inside components, 12 to 24px between cards, 20px card padding. Stat tiles run two across on tablets and four on desktop. Working screens use straight rows.

The landing page follows Grafbase's composition. The strip comes first, then a sticky marble nav 64px tall. Next is a 50/50 hero on a 75rem container (`container-page`), followed by full-width bands that alternate marble (ruled top and bottom) and drafting gray, at 80px vertical rhythm.

Diagrams keep a legible minimum width (46rem) and scroll within their frame on narrow screens. Detail sheets rise from the bottom on phones and slide in from the right (34rem) from 48rem up.

## Elevation & Depth

Flat by default: the hairline does all the structural work. Cards, the rail, the nav bars and door tiles cast no shadow, and depth comes from marble sitting on drafting gray. A single soft drop exists. It marks the one primary action, and it marks things that genuinely float above the page. Surfaces are opaque, with no glass or texture, so nothing translucent ever sits over a badge, a reading or an alert.

### Shadow Vocabulary
- **Action drop** (`box-shadow: 0 4px 20px 0 rgb(0 0 0 / 0.15)`): the primary button.
- **Float** (`box-shadow: 0 4px 20px 0 rgb(0 0 0 / 0.15)`): the same value on overlays and previews, meaning the landing product preview panel and load-plan frame, dialogs, detail sheets, alert toasts, chart tooltips and the floating request button.
- **Focus halo** (`box-shadow: 0 0 0 3px` graphite at 18%): fields on focus.

### Named Rules
**The Single Drop Rule.** In the page flow, only the primary action casts a shadow. Everything else sits flat on its hairline.

**The Rule Answers Rule.** Interactive cards answer hover by darkening their hairline toward graphite (30%). They never jump, and never change fill. Critical tiles do not respond.

## Shapes

The corners step up with the size of the thing:
- Buttons and nav items: 6px.
- Fields, choice tiles, panels inside cards and the product preview: 12px.
- Cards, notices, door tiles, sheets and dialogs: 20px.
- Tags, severity badges, meters, avatars and the landing sign-in button: 40px pills.

Every container edge is a 1px cool hairline. Selection is drawn as an inset 2px graphite rule, not as a fill change alone. Data bars are square at the baseline and have a 4px rounded end. Icons are Lucide at a thin 1.6 stroke. Severity has its own shape channel: a triangle for critical, a diamond for high, a square for medium and an open circle for low.

## Components

### Buttons
Squared, sentence case, and answered at once.
- **Shape:** 6px, 48px tall, 20px side padding, Inter 500 at 14px, 8px icon gap.
- **Primary:** graphite fill, white text, the action drop. Hover eases to 88% opacity.
- **Secondary:** marble with a hairline border. Hover sinks to Subtle Gray and darkens the rule.
- **Pill:** the landing "Sign in". Marble, hairline, 40px radius. It is softer than the squared buttons because it asks for less commitment.
- **Hazard:** brick fill with white text. Hover deepens to `hazard-deep`. Used for "Report issue" and critical decisions.
- **Press / Disabled:** press is instant (1px down, 120ms). Disabled drops to Subtle Gray with a hairline, steel text and no shadow.

### Chips
- **Style:** 40px pill, 28px tall, 14px Inter 500. Tones: plain (Subtle Gray with steel), ink (graphite fill) for escalated, hazard, and green with a check icon for resolved.
- **Simulated tag:** a transparent pill with a dashed steel border reading "Simulated data" or "Sim".

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** marble on drafting gray.
- **Shadow Strategy:** none (see Elevation). Hover darkens the rule on interactive cards.
- **Border:** 1px hairline.
- **Internal Padding:** 20px. Titled panels put an Inter 600 title in a 48px row. Landing feature cards use 28px.
- **Stat tile:** a steel label, a large tabular Inter number and a sub-line. The alert variant is a solid brick tile with white text.
- **Notice:** Subtle Gray, 20px, 16px padding. The alert tone is `hazard-soft` with a 1px brick ring and a triangle icon.

### Inputs / Fields
- **Style:** marble, 12px radius, 48px tall. The hairline is darkened 14% toward graphite. Text is 16px, with a steel placeholder.
- **Focus:** the border turns graphite, with a 3px graphite halo at 18%. Keyboard focus elsewhere is a 2px graphite outline offset 3px.
- **Choice tiles:** 52px ruled tiles. Selected is Subtle Gray with a 2px inset graphite rule and weight 600.

### Navigation
- **Rail (desktop):** Inter 500 at 16px with 20px icons, and 6px items in steel. The active item is Subtle Gray with a hairline ring and graphite text. Hover sinks to Subtle Gray.
- **Tab bar (tablet and phone):** marble with a hairline top rule. 24px icons sit over 14px labels. Active is graphite and inactive is steel.
- **Live indicator:** the word comes first ("Live", "Reconnecting", "Offline"). The coloured dot only repeats it.

### Severity Badge
A pill that carries shape, word and colour together. Critical is a solid brick capsule with white text and a triangle. High, medium and low are tinted. Confidence is a separate channel: three graphite signal bars, labelled, never in severity colours.

### Door Tile (the dock wall)
One 20px marble tile per door, grouped on a zone apron washed with the zone's triad tint.
- A zone-tinted door plate carries the number in tabular Inter.
- An SVG bay shows the opening, bumpers, leveler and the trailer. The trailer's load takes the zone tint, and the trailer backs in when it arrives.
- Below that sit the crew avatar, the company, and a thin progress track in the zone ink.
- Idle doors recede into Subtle Gray. Doors with an issue ring in saffron. Critical doors turn solid brick with white marks, and nothing on them moves.

### Loading Guide
The load plan, drawn from the dock door. It shows a perspective trailer interior and outlines the spot to fill in a dashed box that breathes. A dashed arrow flows toward that spot, beside a numbered step pin, with a plan view "from above". Each product takes a triad hue plus a fill pattern, which is the non-colour channel. The primary "Loaded, next pallet" action spans the row.

## Do's and Don'ts

### Do:
- **Do** use graphite (`accent`) for exactly one filled primary action per view. Everything else is secondary, pill or hazard.
- **Do** draw structure with the 1px `hairline` on marble, and leave cards without a shadow.
- **Do** set titles in Playfair Display 400 at -0.02em, UI and body in Inter at -0.018em with `ss01`/`cv11`, captions in Hanken Grotesk, and every ID, code, time and count in Geist Mono.
- **Do** show severity as word, shape and colour together, and confidence as graphite signal bars.
- **Do** keep the cool triad and the chart slots inside product content (zones, loads, rooms, chart series), in their fixed order.
- **Do** keep targets at least 44px (48px buttons and fields) and text at 14px or larger.
- **Do** mark simulated data with the announcement strip and the dashed Simulated tag.
- **Do** keep motion to the 60ms staggered rise on load, rule-darkening on hover and the load guide's explanatory loops. All of it is disabled under reduced motion.

### Don't:
- **Don't** add a chromatic accent to the interface chrome. The strip is the only colour there.
- **Don't** use `hazard` or any status colour as a chart hue or as decoration.
- **Don't** set text in Ash (`sage`, `terracotta`) or any `-bright` tone.
- **Don't** add texture, glass or translucency over badges, readings or alerts.
- **Don't** animate, lift or pulse anything critical.
- **Don't** use italic accent words in titles, or set a sentence in mono.
- **Don't** make action buttons pills. Pills are for tags, badges and the sign-in pill.
- **Don't** add a dark mode, or reach for Tailwind's default palette, radii or shadows. They are wiped, and every value is a token in `frontend/src/styles/app.css`.
- **Don't** recolour the barcode. It stays black on white.
