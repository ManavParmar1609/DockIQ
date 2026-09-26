---
name: DockIQ
description: Dock-door intelligence for cold-storage warehouses, drawn as an engineering blueprint on mint frost with an obsidian rail and one neon pulse.
colors:
  paper: "#edf7f5"
  surface: "#ffffff"
  paper-sunk: "#f2f8f6"
  paper-deep: "#d0d3d3"
  hairline: "#d0d3d3"
  ink: "#132322"
  ink-soft: "#424f4f"
  ink-mute: "#56615f"
  accent: "#3ddc91"
  on-accent: "#132322"
  accent-ink: "#146c47"
  accent-soft: "#dff5ea"
  accent-line: "#97ddbc"
  sage: "#828786"
  sage-ink: "#1b8a57"
  signal: "#ffcd48"
  terracotta: "#ffcd48"
  signal-soft: "#fff4d1"
  signal-ink: "#6b5000"
  night: "#132322"
  night-raised: "#0e1a19"
  rail-sunk: "#1b3230"
  rail-rule: "#24403d"
  rail-ink-soft: "#d0d3d3"
  rail-ink-mute: "#b2b6b4"
  hazard: "#a4291f"
  hazard-bright: "#c23a2c"
  hazard-deep: "#912018"
  hazard-soft: "#fbf1ef"
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
    fontFamily: "'Geist Variable', 'Geist', 'Inter Variable', ui-sans-serif, sans-serif"
    fontSize: "5.625rem"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "'Geist Variable', 'Geist', 'Inter Variable', ui-sans-serif, sans-serif"
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
    textColor: "{colors.surface}"
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
  fact-strip-cell:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "12px 16px"
  notice:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "16px"
  medallion:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.lg}"
    size: "44px"
  medallion-product:
    backgroundColor: "{colors.teal-soft}"
    textColor: "{colors.teal}"
  medallion-people:
    backgroundColor: "{colors.signal-soft}"
    textColor: "{colors.signal-ink}"
  medallion-systems:
    backgroundColor: "{colors.indigo-soft}"
    textColor: "{colors.indigo}"
  tag:
    backgroundColor: "{colors.paper-sunk}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "28px"
  tag-accent:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
  tag-simulated:
    backgroundColor: "{colors.signal-soft}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.full}"
    height: "28px"
  chip-suggest:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "44px"
  chat-bubble-own:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
  severity-critical:
    backgroundColor: "{colors.hazard}"
    textColor: "{colors.surface}"
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
  rail:
    backgroundColor: "{colors.night}"
    textColor: "{colors.surface}"
    width: "280px"
  nav-item-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  nav-item-hover:
    backgroundColor: "{colors.rail-sunk}"
    textColor: "{colors.surface}"
---

# Design System: DockIQ

## Overview

**Creative North Star: "The Engineering Blueprint on Mint Frost"**

DockIQ keeps Grafbase's structure and holds the dock's safety rules above it, now in the owner's own palette. The page is a pale mint-frost table. White sheets sit on it, each edged with a 1px fog hairline and no shadow. Obsidian, a green-black, sets all the text. The desktop rail is a solid obsidian column, and the announcement strip above everything runs from obsidian into deep abyss. One neon green pulse lights the thing to do and the place you are: the single filled action, the selected rail item, your own messages to the assistant. Mint whisper washes mark selection and highlights, signal yellow punctuates the diagrams and the simulated mark, and filing medallions colour-code what kind of thing an item is. The world is light only. There is no dark mode.

The type follows the owner's spec in place of Grafbase's single family. Titles are an editorial serif at 400, tight and compressed. Inter, tracked slightly tight, carries everything read at work. Hanken Grotesk sets the small captions. Geist Mono sets the telemetry. Everything is read at arm's length on a forklift tablet, with gloves, glare and dim light. So density is moderate, targets are generous (44px minimum, 48px buttons), the type floor is 14px, and nothing moves on an alert.

The palette gives way to the dock in four places. Severity keeps brick red, saffron and olive, always with a word and a shape. Neon never carries white text: obsidian sits on it. The pale greens and yellow are washes and marks, and deeper `-ink` variants carry any words. Slate grey never sets small text.

**Key Characteristics:**
- A mint-frost canvas (`paper`) under white cards with a 1px fog `hairline`, 20px corners and no shadow.
- Obsidian (`ink`) for every word; an obsidian rail and an obsidian-to-abyss strip frame the app.
- One neon pulse (`accent`) with obsidian text: the filled action, the selected place, your own chat bubbles.
- Mint whisper washes for selection, signal yellow for marks and the simulated tag, filing medallions for kind.
- Four typefaces, one per job: Geist 600 for titles, Inter for UI and body, Hanken Grotesk for labels, Geist Mono for telemetry.
- Squared 6px buttons, 12px fields, panels and medallions, 20px cards, 40px pills.
- Light only.

## Colors

A cool mint-and-obsidian ground with one neon pulse. Colour carries meaning in four separate channels: the action and place (neon), filing (medallion families), content (the cool triad and chart slots) and severity.

### Primary
- **Obsidian Shell** (`ink`): all primary text (16.2:1 on white), the escalated tag's fill, and the rail and strip as `night`.
- **Neon Pulse** (`accent`): the one filled primary action, the selected rail item, the report step bar's completed segments, the user's own chat bubbles, the wordmark's disc, the floating request button and the load guide's step pin. Always under obsidian text (`on-accent`, 8.6:1). Never text itself.
- **Deep Green** (`accent-ink`): links, green text, the tab bar's active item, "waiting on" lines and the default medallion ink (6.4:1 on white).
- **Signal Green** (`sage-ink`): meter fills, the focus ring and outline, the caret, the selected choice's inset rule. 4.4:1 on white, so it is a graphic mark, never small text.

### Secondary
- **Mint Whisper** (`accent-soft` wash, `accent-line` rule): text selection, selected choice tiles, supervisor notes and highlight panels in the load guide, accent tags, the suggestion chips (`accent-line` is their border).
- **Signal Yellow** (`signal`, also the `terracotta` alias used by trailer lamps): warm punctuation in diagrams. Its wash and ink (`signal-soft`, `signal-ink`, 7.1:1) make the dashed simulated tag and the People filing colour.
- **Deep Abyss** (`night-raised`): the strip's far stop and the rail's person card. Inside the rail the tokens are re-scoped: surface becomes `night-raised`, hover fills become `rail-sunk`, rules become `rail-rule`, secondary text becomes `rail-ink-soft` and captions `rail-ink-mute` (8.1:1 on obsidian), and ink turns white.
- **Severity ramp** (a departure from the reference, which has no status colour):
  - Brick (`hazard`): the critical fill, 6.5:1 under white. `hazard-deep` sets critical text on `hazard-soft` (7.5:1). `hazard-bright` is for graphic marks only.
  - Saffron (`orange` on `orange-soft`, 5.6:1): high. `orange-bright` is for marks, issue rings and the cold-room alarm line.
  - Olive (`amber` on `amber-soft`, 6.6:1): medium. `amber-bright` is for marks only.
  - Low: quiet `paper-sunk` with the caption grey.
- **Resolved Green** (`green` on `green-soft`, 6.5:1): resolved issues and the live-connection dot.

### Tertiary
- **Filing families**, each an ink on its pale wash, drawn as a 44px medallion or a small dot beside a heading:
  - Product: deep mint (`teal` / `teal-soft`).
  - People: signal yellow (`signal-ink` / `signal-soft`).
  - Systems: sky (`indigo` / `indigo-soft`).
  - Green: the job itself and the core check (`accent-ink` / `accent-soft`).
  - Report groups, inspection sections and the order's job cell file under these.
- **The cool triad**, for product content: mint (`teal`), sky (`indigo`), moss (`mint`), with forest (`purple`) and graphite (`brown`) extending the set for load-plan products and cold rooms. The dock wall files zone A under moss, zone B under mint and zone C under sky. The token names are historical; use the names and trust the values.
- **Chart slots:** Sky (`chart-1`), Moss (`chart-2`), Blue (`chart-3`) and Mint (`chart-4`). Always in this order, never cycled, validated for colour-blind adjacency, each at least 3:1 on white. The heatmap is one hue (sky), mixed toward white in four steps.

### Neutral
- **Mint Frost** (`paper`): the canvas.
- **White** (`surface`): cards, the mobile top bar and tab bar, fields, sheets, fact cells.
- **Frost Hover** (`paper-sunk`): hover, quiet fills, card footers, notices, the low severity badge, tracks.
- **Fog** (`paper-deep`, `hairline`): every 1px border and structural rule, empty meter cells, trailer floors, the avatar disc.
- **Graphite Fill** (`ink-soft`): secondary text (8.9:1 on white).
- **Caption Grey** (`ink-mute`): captions, metadata and placeholders (6.4:1 on white, about 5.9:1 on the canvas).
- **Slate** (`sage`): decorative strokes and icons. Never text.

### Named Rules
**The Neon Means Now Rule.** Neon marks the action to take, where you are, and what you said. It is never a status, a chart hue, a filing colour or text, and it always carries obsidian, never white.

**The Filing Rule.** A medallion or a file dot says what kind of thing an item is (product, people, systems, the job). Filing colours never signal severity, and severity colours never file.

**The Brick Is Critical Rule.** `hazard` appears only for critical severity, critical door tiles, the critical stat, alert notices and the report or destructive action. It is never a chart hue, and no status colour is ever a chart hue.

**The Graphic-Only Rule.** Neon, signal yellow, slate, `sage-ink` and the `-bright` severity tones fail as small text. They draw fills, edges, bars, lamps and marks. The base, `-ink` and `-deep` tones carry the words.

## Typography

**Display Font:** Geist Variable (with Geist, Inter Variable, ui-sans-serif, sans-serif), a product-grade sans in one family with the mono
**Body Font:** Inter Variable (with Inter, ui-sans-serif, sans-serif), stylistic sets `ss01` and `cv11`, tracked -0.018em
**Label Font:** Hanken Grotesk Variable (with Hanken Grotesk, Inter), the free stand-in for Aktiv Grotesk
**Mono Font:** Geist Mono Variable (with Geist Mono, ui-monospace, monospace)

**Character:** An editorial serif headline set tight over an engineered, slightly compressed sans. The serif names the place, Inter does the work, and the mono states the facts.

### Hierarchy
- **Display** (Geist 600, 64 to 90px, 1.05, -0.035em): the landing hero. Balanced wrap.
- **Headline** (Geist 600, 40 to 48px, 1.05, -0.035em): every app page title and the landing section headings (at 1.0 line-height). Record screens whose title is data drop to 28 to 40px.
- **Title** (Inter 600, 16 to 24px, 1.3, -0.015em): card, panel, notice, empty-state and filed group titles (24px beside a file dot).
- **Body** (Inter 400, 16px, 1.5, -0.018em): running text and values. Chat messages run at 20px. Landing prose runs at 20px, capped near 32rem.
- **Label** (Hanken Grotesk 500, 14px, 1.4, no tracking, caption grey): captions, metadata, table headers and fact-cell terms, in sentence case. 14px is the floor.
- **Number** (Inter 600, -0.035em, lining tabular): stat values, door plates and headline figures, from 20 to 64px.
- **Telemetry** (Geist Mono 500, tabular, lining, slashed zero): every ID, code, time, count, temperature and money value.

### Named Rules
**The Four Jobs Rule.** Each face has one job. Geist names places (page titles, section headings, the wordmark). Inter carries every sentence, control and headline number. Hanken sets captions. Geist Mono sets data a person copies, compares or reads off. Never set a sentence in mono.

**The Upright IQ Rule.** The wordmark sets "IQ" upright at 600 in `ink-soft`, so it never reads as "Dock12". Beside it sits a 40px neon disc carrying the warehouse icon.

**The No Accent Words Rule.** Emphasis inside a title keeps the title's own voice: no italic and no colour change.

## Layout

On desktop (64rem and up) the shell has two columns. On the left is a 17.5rem obsidian rail, full height and sticky. It holds the wordmark, the role and zone, navigation, the live status and alerts bell, the simulated tag and the person card on deep abyss. The content column beside it is capped at 80rem, with 40px side padding. Below 64rem the rail becomes a white top bar with a fog hairline underneath, plus a fixed white bottom tab bar (56px targets, safe-area padding). The content gains bottom padding so nothing hides under the tabs. The announcement strip sits above everything at every width.

Each page opens with the serif title and a single line of secondary metadata, then the task's primary object (load guide, queue, board) before any stats. An order opens with the fact strip: a ruled grid of cells, two across on phones, three from 40rem and six from 80rem. Spacing runs on a 4px grid: 8 and 12px gaps inside components, 12 to 24px between cards, 20px card padding. Stat tiles run two across on tablets and four on desktop. Working screens use straight rows. Filed groups (report types) sit under a title row ruled underneath, their tiles in one, two or three columns.

The landing page follows Grafbase's composition: the strip, a sticky white nav 64px tall, a 50/50 hero on a 75rem container (`container-page`), then full-width bands at 80px vertical rhythm.

Diagrams keep a legible minimum width (46rem) and scroll within their frame on narrow screens. Detail sheets rise from the bottom on phones and slide in from the right (34rem) from 48rem up.

## Elevation & Depth

Flat by default: the hairline does all the structural work. Cards, the rail, the nav bars and door tiles cast no shadow, and depth comes from white sitting on mint frost, and from the obsidian rail beside both. A single soft, obsidian-tinted drop marks the one primary action, and a slightly lighter one marks things that genuinely float. Surfaces are opaque, with no glass or texture, so nothing translucent ever sits over a badge, a reading or an alert.

### Shadow Vocabulary
- **Action drop** (`box-shadow: 0 4px 20px 0 rgb(19 35 34 / 0.18)`): the primary button.
- **Float** (`box-shadow: 0 4px 20px 0 rgb(19 35 34 / 0.15)`): overlays and previews: the landing product preview panel and load-plan frame, dialogs, detail sheets, alert toasts, chart tooltips and the floating request button.
- **Focus halo** (`box-shadow: 0 0 0 3px` signal green at 18%): fields on focus.

### Named Rules
**The Single Drop Rule.** In the page flow, only the primary action casts a shadow. Everything else sits flat on its hairline.

**The Rule Answers Rule.** Interactive cards answer hover by darkening their hairline toward obsidian (30%). They never jump. Critical tiles do not respond.

## Shapes

The corners step up with the size of the thing:
- Buttons, nav items and door plates: 6px.
- Fields, choice tiles, panels inside cards, highlight notes and filing medallions: 12px.
- Cards, notices, the fact strip, door tiles, sheets and dialogs: 20px.
- Tags, severity badges, suggestion chips, meters, avatars and the landing sign-in button: 40px pills. Chat bubbles are 20px with the speaker's corner tucked to 6px.

Every container edge is a 1px fog hairline. Selection is drawn as an inset 2px signal-green rule over a mint whisper wash, not as a fill change alone. Data bars are square at the baseline and have a 4px rounded end. Icons are Lucide at a thin 1.6 stroke. Severity has its own shape channel: a triangle for critical, a diamond for high, a square for medium and an open circle for low.

## Components

### Buttons
Squared, sentence case, and answered at once.
- **Shape:** 6px, 48px tall, 20px side padding, Inter 500 at 14px, 8px icon gap.
- **Primary:** neon fill, obsidian text, the action drop. Hover mixes 12% obsidian into the neon.
- **Secondary:** white with a fog hairline. Hover sinks to frost and darkens the rule.
- **Pill:** the landing "Sign in". White, hairline, 40px radius. Softer than the squared buttons because it asks for less commitment.
- **Hazard:** brick fill with white text. Hover deepens to `hazard-deep`. Used for "Report issue" and critical decisions.
- **Press / Disabled:** press is instant (1px down, 120ms). Disabled drops to frost with a hairline, caption-grey text and no shadow.

### Chips
- **Tags:** 40px pill, 28px tall, 14px Inter 500. Tones: plain (frost with graphite fill text), ink (obsidian fill with mint-frost text) for escalated, accent (mint whisper with deep green) for flags such as "Short" or "Late", hazard, and green with a check icon for resolved.
- **Simulated tag:** a signal-yellow wash with signal ink and a dashed rule, reading "Simulated data" or "Sim".
- **Suggestion chips:** the assistant's suggested questions. Mint whisper pills with an `accent-line` border, obsidian text at 16px, 44px tall; hover deepens the wash toward the rule.

### Cards / Containers
- **Corner Style:** 20px.
- **Background:** white on mint frost.
- **Shadow Strategy:** none (see Elevation). Hover darkens the rule on interactive cards; linked card bodies sink to frost.
- **Border:** 1px fog hairline.
- **Internal Padding:** 20px. Titled panels put an Inter 600 title in a 48px row. Card actions sit in a frost footer ruled above.
- **Stat tile:** a caption label, a large tabular Inter number and a sub-line. The alert variant is a solid brick tile with white text.
- **Notice:** frost, 20px, 16px padding. The alert tone is `hazard-soft` with a 1px brick ring and a triangle icon.
- **Fact strip:** one 20px ruled frame split into cells by 1px fog gaps; each cell is white, 12px by 16px, a caption term over an Inter 600 or mono value. The job cell leads with its green file dot.

### Filing Medallion
A 44px, 12px-cornered square that holds a Lucide icon in its family's ink on the family's wash. It opens every report-type tile and every inspection section title; the default (no family) is deep green on mint whisper. A 10px file dot in the family ink stands in beside group headings and in the fact strip.

### Inputs / Fields
- **Style:** white, 12px radius, 48px tall. The hairline is darkened 14% toward obsidian. Text is 16px, with a caption-grey placeholder and a signal-green caret.
- **Focus:** the border turns signal green, with a 3px halo at 18%. Keyboard focus elsewhere is a 2px signal-green outline offset 3px.
- **Choice tiles:** 52px ruled tiles; hover fills with mint frost. Selected is mint whisper with a 2px inset signal-green rule and weight 600.

### Navigation
- **Rail (desktop):** obsidian, Inter 500 at 16px with 20px icons, 6px items in `rail-ink-soft`. The active item is a neon fill with obsidian text at 600. Hover fills with `rail-sunk` and turns the text white. The person card sits on deep abyss.
- **Tab bar (tablet and phone):** white with a fog top rule. 24px icons over 14px labels. Active is deep green (`accent-ink`), inactive is caption grey.
- **Live indicator:** the word comes first ("Live", "Reconnecting", "Offline"). The coloured dot only repeats it.
- **Announcement strip:** a full-width band, obsidian into deep abyss at 89.97deg, white 14px text, led by an 8px neon dot. It says the data is simulated.

### Assistant Conversation
The user's own questions are neon bubbles with obsidian 20px text, right-aligned, the bottom-right corner tucked. The assistant answers in white ruled cards, citing its source under a hairline. Suggested questions sit as mint whisper chips along the input.

### Severity Badge
A pill that carries shape, word and colour together. Critical is a solid brick capsule with white text and a triangle. High, medium and low are tinted. Confidence is a separate channel: three signal bars, labelled, never in severity colours.

### Door Tile (the dock wall)
One 20px white tile per door, grouped on a zone apron washed with the zone's triad tint.
- A zone-tinted door plate carries the number in tabular Inter.
- An SVG bay shows the opening, bumpers, leveler, signal-yellow lamps and the trailer. The trailer's load takes the zone tint, and the trailer backs in when it arrives.
- Below that sit the crew avatar, the company, and a thin progress track in the zone ink.
- Idle doors recede into frost. Doors with an issue ring in saffron. Critical doors turn solid brick with white marks, and nothing on them moves.

### Loading Guide
The load plan, drawn from the dock door. It shows a perspective trailer interior and outlines the spot to fill in a dashed box that breathes. A dashed arrow flows toward that spot, beside a neon numbered step pin, with a plan view "from above". Each product takes a triad hue plus a fill pattern, which is the non-colour channel. Highlight notes sit on mint whisper. The primary "Loaded, next pallet" action spans the row.

## Do's and Don'ts

### Do:
- **Do** use neon (`accent`) with obsidian text for exactly one filled primary action per view, plus the selected place and the user's own chat bubbles. Everything else is secondary, pill or hazard.
- **Do** draw structure with the 1px fog `hairline` on white, and leave cards without a shadow.
- **Do** set titles in Geist 600 at -0.035em, UI and body in Inter at -0.018em with `ss01`/`cv11`, captions in Hanken Grotesk, and every ID, code, time and count in Geist Mono.
- **Do** show severity as word, shape and colour together, and confidence as labelled signal bars.
- **Do** file items by kind with a medallion or file dot in the product, people, systems or green family.
- **Do** keep the cool triad and the chart slots inside product content (zones, loads, rooms, chart series), in their fixed order.
- **Do** keep targets at least 44px (48px buttons and fields) and text at 14px or larger.
- **Do** mark simulated data with the announcement strip and the signal-yellow Simulated tag.
- **Do** re-scope tokens through the rail rather than hard-coding dark values inside it.
- **Do** keep motion to the 60ms staggered rise on load, rule-darkening on hover and the load guide's explanatory loops. All of it is disabled under reduced motion.

### Don't:
- **Don't** put white text on neon, or set any text in neon, signal yellow, slate, `sage-ink` or a `-bright` tone.
- **Don't** use neon for status, filing, charts or decoration.
- **Don't** use `hazard` or any status colour as a chart hue, a filing colour or decoration.
- **Don't** add texture, glass or translucency over badges, readings or alerts.
- **Don't** animate, lift or pulse anything critical.
- **Don't** use italic accent words in titles, or set a sentence in mono.
- **Don't** make action buttons pills. Pills are for tags, badges, suggestion chips and the sign-in pill.
- **Don't** add a dark mode, or reach for Tailwind's default palette, radii or shadows. They are wiped, and every value is a token in `frontend/src/styles/app.css`.
- **Don't** recolour the barcode. It stays black on white.
