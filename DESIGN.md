---
version: alpha
name: Apple
description: |
  Apple's design system embodies a philosophy of refined minimalism and
  deliberate clarity. The visual identity prioritizes restrained elegance,
  favoring generous whitespace, surgical typography, and a restrained colour
  palette anchored by a premium electric blue. The system conveys innovation and
  precision through careful restraint—every element serves a purpose, and visual
  noise is eliminated in favour of focused content and clear hierarchy. The mood
  is aspirational yet approachable, technical yet human-centred. Depth emerges
  not from ornament but from carefully calibrated surface colour shifts,
  strategic opacity layers, and surgical focus on interactive states.
source:
  url: "https://apple.com"
  pagesAnalyzed: 6
  extractedAt: 2026-11-03
  tokensMeasured: true
colors:
  primary: "#0071E3"
  accent: "#2997FF"
  canvas: "#FFFFFF"
  surface: "#F5F5F7"
  on-primary: "#FFFFFF"
  ink: "#000000"
  body: "#1D1D1F"
  muted: "#6E6E73"
  faint: "#86868B"
  hairline: "#D2D2D7"
  accent-1: "#0066CC"
  accent-2: "#B64400"
  neutral-1: "#333336"
typography:
  display-xl:
    fontFamily: "SF Pro Display"
    fontSize: 80px
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: -1.2px
  display-lg:
    fontFamily: "SF Pro Display"
    fontSize: 64px
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: -0.58px
  display-md:
    fontFamily: "SF Pro Display"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.07
    letterSpacing: -0.28px
  display-sm:
    fontFamily: "SF Pro Display"
    fontSize: 48px
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: -0.14px
  display-xs:
    fontFamily: "SF Pro Display"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: 0px
  heading-xl:
    fontFamily: "SF Pro Display"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.13
    letterSpacing: 0.13px
  heading-lg:
    fontFamily: "SF Pro Display"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.14
    letterSpacing: 0.2px
  heading-lg-strong:
    fontFamily: "SF Pro Display"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.14
    letterSpacing: 0.2px
  heading-md:
    fontFamily: "SF Pro Display"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.17
    letterSpacing: 0.22px
  heading-sm:
    fontFamily: "SF Pro Display"
    fontSize: 19px
    fontWeight: 600
    lineHeight: 1.21
    letterSpacing: 0.23px
  heading-xs:
    fontFamily: "SF Pro Text"
    fontSize: 14.04px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: -0.12px
  body-md:
    fontFamily: "SF Pro Text"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: -0.37px
  body-md-strong:
    fontFamily: "SF Pro Text"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.47
    letterSpacing: -0.37px
  body-sm:
    fontFamily: "SF Pro Text"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.29
    letterSpacing: -0.22px
  body-sm-strong:
    fontFamily: "SF Pro Text"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.29
    letterSpacing: -0.22px
  body-xs:
    fontFamily: "SF Pro Text"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.12px
  body-xs-loose:
    fontFamily: "SF Pro Text"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
    letterSpacing: -0.12px
  button:
    fontFamily: "SF Pro Text"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 2.41
    letterSpacing: 0px
  caption-sm:
    fontFamily: "SF Pro Text"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: -0.12px
  caption-xs:
    fontFamily: "SF Pro Text"
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.08px
rounded:
  none: 0px
  xs: 8px
  sm: 11px
  md: 28px
  full: 9999px
spacing:
  xxs: 8px
  xs: 12px
  sm: 16px
  md: 20px
  lg: 24px
  xl: 28px
  xxl: 32px
  xxxl: 36px
  section: 40px
  band: 44px
elevationStrategy: color-blocking
themes:
  derived: dark   # the other theme is the site's measured palette
  light:
    bg: "#FFFFFF"
    surface: "#F5F5F7"
    surfaceRaised: "#EBEBED"
    text: "#000000"
    textMuted: "#1D1D1F"
    border: "#D2D2D7"
    accent: "#0071E3"
    accentFg: "#FFFFFF"
    focusRing: "#0071E3"
    elevation: shadow
  dark:
    bg: "#090F16"
    surface: "#181D24"
    surfaceRaised: "#242930"
    text: "#F5F9FE"
    textMuted: "#9BA0A6"
    border: "#30353B"
    accent: "#007BF7"
    accentFg: "#0B0B0C"
    focusRing: "#0071E3"
    elevation: "border+surface"
components:
  button-filled:
    typography: "{typography.button}"
    backgroundColor: "rgb(22, 22, 23)"
    textColor: "rgba(255, 255, 255, 0.92)"
    padding: "0px 14px 0px 14px"
    rounded: "{rounded.sm}"
    border: "3px solid rgba(255, 255, 255, 0.08)"
    height: 42px
  button-primary:
    typography: "{typography.body-md}"
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    padding: "11px 21px 11px 21px"
    rounded: 980px
    height: 20px
  button-filled-sm:
    typography: "{typography.body-sm}"
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "8px 15px 8px 15px"
    rounded: "{rounded.xs}"
    height: 36px
  button-primary-sm:
    typography: "{typography.body-sm}"
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    padding: "8px 15px 8px 15px"
    rounded: 980px
    height: 18px
  button-icon:
    backgroundColor: "rgba(210, 210, 215, 0.64)"
    textColor: "rgba(0, 0, 0, 0.48)"
    fontSize: 17px
    fontWeight: 400
    fontFamily: "SF Pro Text"
    rounded: "50%"
    height: 24px
    lineHeight: 1.47
  button-outline:
    typography: "{typography.body-md}"
    textColor: "{colors.accent}"
    padding: "11px 21px 11px 21px"
    rounded: 980px
    border: "1px solid {colors.accent}"
    height: 20px
  card:
    typography: "{typography.body-xs-loose}"
    textColor: "rgba(0, 0, 0, 0.56)"
  card-2:
    backgroundColor: "{colors.surface}"
    textColor: "rgba(0, 0, 0, 0.88)"
    fontSize: 17px
    fontWeight: 400
    fontFamily: "SF Pro Text"
    rounded: "{rounded.md}"
    lineHeight: 1.47
  navigation:
    backgroundColor: "rgba(29, 29, 31, 0.8)"
    textColor: "{colors.body}"
    fontSize: 17px
    fontWeight: 400
    fontFamily: "SF Pro Text"
    height: 44px
    lineHeight: 1.47
  navigation-2:
    textColor: "{colors.body}"
    fontSize: 17px
    fontWeight: 400
    fontFamily: "SF Pro Text"
    height: 44px
    lineHeight: 1.47
  footer:
    typography: "{typography.body-xs-loose}"
    backgroundColor: "{colors.surface}"
    textColor: "rgba(0, 0, 0, 0.56)"
  link:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.accent}"
    fontSize: 17px
    fontWeight: 400
    fontFamily: "SF Pro Text"
    lineHeight: 1.47
  link-lg:
    textColor: "{colors.accent}"
    fontSize: 17px
    fontWeight: 400
    fontFamily: "SF Pro Text"
    lineHeight: 1.47
  badge-text:
    typography: "{typography.caption-sm}"
    textColor: "{colors.accent-2}"
    height: 16px
states:
  link-hover:
    target: link
    state: hover
    textColor: "{colors.accent-1}"
    textDecoration: none
  other-hover:
    target: other
    state: hover
    borderColor: "rgba(0, 0, 0, 0)"
    textDecoration: none
  other-active:
    target: other
    state: active
    outline: none
  button-focus-visible:
    target: button
    state: focus-visible
    opacity: 1
  link-focus:
    target: link
    state: focus
    outline: none
  nav-hover:
    target: nav
    state: hover
    opacity: 1
  button-hover:
    target: button
    state: hover
    opacity: 1
  button-active:
    target: button
    state: active
    outline: none
  link-focus-visible:
    target: link
    state: focus-visible
    outline: none
  other-focus:
    target: other
    state: focus
    outline: none
  link-disabled:
    target: link
    state: disabled
    textDecoration: none
  card-hover:
    target: card
    state: hover
    textDecoration: none
  other-focus-visible:
    target: other
    state: focus-visible
    outline: none
  input-focus:
    target: input
    state: focus
    outline: none
  link-active:
    target: link
    state: active
    textDecoration: none
  other-disabled:
    target: other
    state: disabled
    textDecoration: none
  card-focus-visible:
    target: card
    state: focus-visible
    outline: none
  button-disabled:
    target: button
    state: disabled
    opacity: 0.32
breakpoints:
  - width: 375
    containerWidth: 343
    gridColumns: 3
    navLinksVisible: 14
    menuToggleVisible: true
    headingPx: 32
    bodyPx: 17
    sectionPaddingX: 0
  - width: 768
    containerWidth: 736
    gridColumns: 3
    navLinksVisible: 5
    menuToggleVisible: true
    headingPx: 48
    bodyPx: 17
    sectionPaddingX: 12
  - width: 1024
    containerWidth: 980
    gridColumns: 3
    navLinksVisible: 78
    menuToggleVisible: true
    headingPx: 48
    bodyPx: 17
    sectionPaddingX: 12
  - width: 1280
    containerWidth: 980
    gridColumns: 3
    navLinksVisible: 78
    menuToggleVisible: true
    headingPx: 56
    bodyPx: 17
    sectionPaddingX: 12
  - width: 1440
    containerWidth: 980
    gridColumns: 3
    navLinksVisible: 78
    menuToggleVisible: true
    headingPx: 56
    bodyPx: 17
    sectionPaddingX: 12
coverage:
  stylesheetsBlocked: true
  responsiveMeasured: true
  archetypesDetected: 0
  archetypesUnnamed: 0
  statesFound: 114
  gradientsFound: 0
  semanticRampDeclared: false
  rolesUnassigned: 3
---

# Design System Inspired by Apple

## 1. Visual Theme & Atmosphere

Apple's design system embodies a philosophy of refined minimalism and deliberate clarity. The visual identity prioritizes restrained elegance, favoring generous whitespace, surgical typography, and a restrained colour palette anchored by a premium electric blue. The system conveys innovation and precision through careful restraint—every element serves a purpose, and visual noise is eliminated in favour of focused content and clear hierarchy. The mood is aspirational yet approachable, technical yet human-centred. Depth emerges not from ornament but from carefully calibrated surface colour shifts, strategic opacity layers, and surgical focus on interactive states.

**Key Characteristics**

- Ultra-refined colour palette: two shades of blue plus a neutral spectrum
- Pill-shaped buttons and badges as primary affordances
- Sharp-edged cards and containers as a counterpoint to rounded interactions
- Negative letter-spacing on display type creates visual tension and modernity
- Opacity-driven depth and state communication
- High-contrast monochromatic foundation with electric-blue accent for navigation
- Touch-first interactive targets with generous padding
- Whitespace is architectural, not accidental

## 2. Color Palette & Roles

### Primary

- **Primary / Brand** (`{colors.primary}` — `#0071E3`): Primary call-to-action fills, active states, brand accent in hero contexts and interactive affordances
- **Accent** (`{colors.accent}` — `#2997FF`): Secondary accent for hero bands and supporting accent contexts

### Interactive

- **Outline Accent** (`{colors.accent-1}` — `#0066CC`): Decorative; measured in link and interactive border contexts but no primary role assigned

### Neutral Scale

- **Canvas** (`{colors.canvas}` — `#FFFFFF`): Default page background; label and text colour on primary brand surfaces
- **Surface** (`{colors.surface}` — `#F5F5F7`): Card, panel, and container backgrounds; footer background
- **Ink** (`{colors.ink}` — `#000000`): Headings and primary text emphasis
- **Body** (`{colors.body}` — `#1D1D1F`): Standard body copy and primary body text
- **Muted** (`{colors.muted}` — `#6E6E73`): Captions, secondary text, and tertiary labels
- **Faint** (`{colors.faint}` — `#86868B`): Placeholder text and tertiary content
- **Neutral** (`{colors.neutral-1}` — `#333336`): Decorative neutral; no primary role assigned

### Surface & Borders

- **Hairline** (`{colors.hairline}` — `#D2D2D7`): 1px borders, dividers, and subtle separators

### Decorative

- **Accent Decorative** (`{colors.accent-2}` — `#B64400`): Measured in badge and accent contexts; no primary semantic role—treat as decorative brand colour

## 3. Typography Rules

### Font Family

**Primary (Display):** SF Pro Display, with fallback to system serif or Apple system font stack
**Secondary (Text):** SF Pro Text, with fallback to system sans-serif or Apple system font stack

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|---|---|---|---|---|---|---|
| **Display XL** | SF Pro Display | 80px | 600 | 1.05 | –1.2px | Hero headlines; maximum display impact |
| **Display LG** | SF Pro Display | 64px | 600 | 1.06 | –0.58px | Large feature headings |
| **Display MD** | SF Pro Display | 56px | 600 | 1.07 | –0.28px | Medium feature headings |
| **Display SM** | SF Pro Display | 48px | 600 | 1.08 | –0.14px | Small feature headings and section headers |
| **Display XS** | SF Pro Display | 40px | 600 | 1.1 | 0px | Compact display; section dividers |
| **Heading XL** | SF Pro Display | 32px | 600 | 1.13 | 0.13px | Large section headings |
| **Heading LG** | SF Pro Display | 28px | 400 | 1.14 | 0.2px | Standard heading; lighter weight variant |
| **Heading LG Strong** | SF Pro Display | 28px | 600 | 1.14 | 0.2px | Emphasis heading |
| **Heading MD** | SF Pro Display | 24px | 600 | 1.17 | 0.22px | Subsection headings |
| **Heading SM** | SF Pro Display | 19px | 600 | 1.21 | 0.23px | Tertiary headings and card titles |
| **Heading XS** | SF Pro Display | 14.04px | 600 | 1.33 | –0.12px | Minimal heading role |
| **Body MD** | SF Pro Text | 17px | 400 | 1.18 | –0.37px | Standard body copy and button text |
| **Body MD Strong** | SF Pro Text | 17px | 600 | 1.47 | –0.37px | Emphasis body text |
| **Body SM** | SF Pro Text | 14px | 400 | 1.29 | –0.22px | Secondary body and smaller copy |
| **Body SM Strong** | SF Pro Text | 14px | 600 | 1.29 | –0.22px | Emphasis secondary body |
| **Body XS** | SF Pro Text | 12px | 400 | 1 | –0.12px | Minimal body; links and tight copy |
| **Body XS Loose** | SF Pro Text | 12px | 400 | 1.33 | –0.12px | Loose-fitted 12px body for list items |
| **Caption SM** | SF Pro Text | 12px | 600 | 1.33 | –0.12px | Strong captions and labels |
| **Caption XS** | SF Pro Text | 10px | 600 | 1.2 | –0.08px | Minimal caption; fine print |
| **Button** | SF Pro Text | 17px | 400 | 2.41 | 0px | Button text (note: excessive line-height creates visual centering) |

### Principles

- Display type employs aggressive negative letter-spacing (–1.2px on the largest sizes) to create visual density and modernity
- Body text uses subtle negative tracking (–0.37px on 17px) to tighten word spacing and improve readability
- Line-height scales inversely with size: larger type has tighter line-height (1.05–1.08), smaller type has looser line-height (1.2–1.33)
- Weight contrast between 400 and 600 drives hierarchy without size alone
- Positive letter-spacing appears only on mid-size display headings (0.2–0.23px), creating a visual inflection point
- Button text uses an unusually high line-height (2.41) to vertically centre content within constrained container heights

## 4. Component Stylings

### Buttons

#### Primary Button
- Background: `{colors.primary}` (`#0071E3`)
- Text color: `{colors.canvas}` (`#FFFFFF`)
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 11px 21px
- Border radius: `{rounded.full}` (9999px, pill-shaped)
- Border: 1px solid transparent
- Height: 20px
- Hover state: colour lightens or opacity increases; focus ring appears at `#0071E3` 2px solid

#### Primary Button Small
- Background: `{colors.primary}` (`#0071E3`)
- Text color: `{colors.canvas}` (`#FFFFFF`)
- Font: `{typography.body-sm}` (14px, weight 400, SF Pro Text)
- Padding: 8px 15px
- Border radius: `{rounded.full}` (9999px, pill-shaped)
- Border: 1px solid transparent
- Height: 18px

#### Outline Button
- Background: transparent
- Text color: `{colors.accent}` (`#2997FF`)
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 11px 21px
- Border radius: `{rounded.full}` (9999px, pill-shaped)
- Border: 1px solid `{colors.accent}` (`#2997FF`)
- Height: 20px

#### Filled Button (Dark)
- Background: `#161617`
- Text color: `rgba(255, 255, 255, 0.92)`
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 0px 14px
- Border radius: `{rounded.sm}` (11px)
- Border: 3px solid `rgba(255, 255, 255, 0.08)`
- Height: 42px

#### Filled Button Small (Light)
- Background: `{colors.surface}` (`#F5F5F7`)
- Text color: `{colors.ink}` (`#000000`)
- Font: `{typography.body-sm}` (14px, weight 400, SF Pro Text)
- Padding: 8px 15px
- Border radius: `{rounded.xs}` (8px)
- Border: 1px solid transparent
- Height: 36px

#### Icon Button
- Background: `rgba(210, 210, 215, 0.64)`
- Text color: `rgba(0, 0, 0, 0.48)`
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 0px
- Border radius: 50% (circular)
- Border: none
- Height: 24px
- Width: 24px

### Cards & Containers

#### Default Card (Transparent)
- Background: transparent
- Text color: `rgba(0, 0, 0, 0.56)`
- Font: `{typography.body-xs}` (12px, weight 400, SF Pro Text)
- Padding: 0px
- Border radius: `{rounded.none}` (0px, sharp)
- Border: none
- Line height: 1.6

#### Card with Surface Background
- Background: `{colors.surface}` (`#F5F5F7`)
- Text color: `rgba(0, 0, 0, 0.88)`
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 0px
- Border radius: `{rounded.md}` (28px)
- Border: none
- Height: 480px (measured example)
- Hover: subtle scale transform or opacity shift as measured

### Navigation

#### Primary Navigation Bar (Semi-transparent Dark)
- Background: `rgba(29, 29, 31, 0.8)` (semi-transparent `{colors.body}`)
- Text color: `{colors.body}` (`#1D1D1F`)
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 0px
- Border radius: `{rounded.none}` (0px)
- Border: none
- Height: 44px
- Width: full width

#### Secondary Navigation (Transparent)
- Background: transparent
- Text color: `{colors.body}` (`#1D1D1F`)
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: 0px
- Border radius: `{rounded.none}` (0px)
- Border: none
- Height: 44px
- Width: full width
- Hover: text colour may brighten or link underline appears

### Inputs & Forms

#### Text Input (Focus State)
- Outline: 2px solid `{colors.primary}` (`#0071E3`)
- Border radius: typically `{rounded.xs}` (8px) or `{rounded.sm}` (11px)
- Font: `{typography.body-md}` (17px, weight 400, SF Pro Text)
- Padding: standard form padding
- Disabled state: opacity 0.42 or 0.36 as indicated

### Links

#### Default Link
- Text color: `{colors.accent}` (`#2997FF`)
- Font: `{typography.body-md}` or `{typography.body-xs}` (17px or 12px, weight 400, SF Pro Text)
- Text decoration: none by default
- Hover: underline appears; colour may shift to `#0066CC`
- Focus-visible: 2px solid outline in `#0071E3`
- Disabled: opacity 0.42

### Badges

#### Badge Text (Accent Decorative)
- Background: transparent
- Text color: `{colors.accent-2}` (`#B64400`)
- Font: `{typography.caption-sm}` (12px, weight 600, SF Pro Text)
- Padding: 0px
- Border radius: `{rounded.none}` (0px)
- Border: none
- Use: labels, tags, and accent text

### Footer

#### Footer Container
- Background: `{colors.surface}` (`#F5F5F7`)
- Text color: `rgba(0, 0, 0, 0.56)`
- Font: `{typography.body-xs}` (12px, weight 400, SF Pro Text)
- Padding: 0px
- Border radius: `{rounded.none}` (0px)
- Border: none
- Line height: 1.6

## 5. Layout Principles

### Spacing System

Apple's spacing system is built on an 4px base unit, with a named scale for semantic use:

- `{spacing.xxs}` = 8px (tight micro-spacing)
- `{spacing.xs}` = 12px (compact spacing)
- `{spacing.sm}` = 16px (standard small spacing)
- `{spacing.md}` = 20px (standard medium spacing)
- `{spacing.lg}` = 24px (generous spacing)
- `{spacing.xl}` = 28px (extra-large spacing)
- `{spacing.xxl}` = 32px (large section spacing)
- `{spacing.xxxl}` = 36px (extra large section spacing)
- `{spacing.section}` = 40px (major section gap)
- `{spacing.band}` = 44px (full-bleed band spacing)

Use cases: micro-spacing (8–12px) between tightly grouped elements; standard spacing (16–24px) for component padding and local gaps; section spacing (40–44px) between major content blocks.

### Grid & Container

- **Max width:** 980px (content container width remains constant from 1024px onwards)
- **Grid columns:** 3-column layout measured across all breakpoints
- **Horizontal padding:** 0px at 375px mobile; 12px at 768px and above
- **Container strategy:** Content centre-aligned with symmetrical padding; footer and navigation full-width; cards and sections respect the content container

### Whitespace Philosophy

Whitespace is foundational to the system. Empty space is not wasted real estate but a primary design material. Sections are separated by generous `{spacing.section}` (40px) and `{spacing.band}` (44px) gaps. Padding within containers increases proportionally with breakpoint, amplifying the breathing room on larger screens. This spaciousness conveys premium quality and aids visual scanning.

### Border Radius Scale

- `{rounded.none}` = 0px — cards, containers, and structural elements; sharp corners create architectural clarity
- `{rounded.xs}` = 8px — small buttons, compact controls, and tight UI elements
- `{rounded.sm}` = 11px — filled buttons and medium-sized interactive elements
- `{rounded.md}` = 28px — featured cards, image backgrounds, and larger surface elements
- `{rounded.full}` = 9999px — primary buttons, secondary buttons, and pill-shaped affordances; creates visual softness on interactive elements while structural elements remain sharp

### Border Widths

The system uses minimal borders, prioritizing colour blocking and opacity shifts over strokes:

- **Thin:** 1px — subtle dividers, link borders (outline buttons)
- **Medium:** 3px — accent borders on filled buttons (e.g. dark button with 3px white border)

## 6. Depth & Elevation

| Level | Treatment | Use |
|---|---|---|
| **Flat** | No shadow; colour blocking only | Default cards, surfaces, text layers |
| **Modal** | `rgba(0, 0, 0, 0) 0px 0px 0px 1px inset` | Modal backgrounds and constrained surfaces |

The system prioritizes **colour-blocking and opacity shifts** over drop shadows. Depth emerges from surface colour changes (white to `{colors.surface}` to darker neutrals), opacity layers (0.36–0.97), and z-index stacking rather than blur and offset. This creates visual clarity without visual clutter—a hallmark of Apple's minimalist aesthetic.

### Opacity Levels

The system employs a discrete opacity scale for state communication and layering:

- **36%** (0.36) — very faint; disabled elements, placeholder text
- **42%** (0.42) — faint; secondary text, muted states
- **80%** (0.80) — semi-opaque; navigation bar (semi-transparent dark)
- **82%** (0.82) — near-opaque; slightly muted but still readable
- **97%** (0.97) — near-full opacity; minimal visual impact

### Z-index / Layering

A flat, minimal z-index scale reflects the spare elevation strategy:

- **z-index 1–7:** Base layers (cards, surfaces, text)
- **z-index 30:** Dropdown menus and overlays

## 7. Do's and Don'ts

### Do

- Use the pill-shaped button radius (`{rounded.full}`, 9999px) for all primary and secondary interactive affordances to signal interactivity
- Apply negative letter-spacing on display sizes (copy the measured values exactly: –1.2px on 80px, –0.58px on 64px) to create visual tension and modernity
- Combine surface colour shifts with opacity changes to create depth; avoid relying on shadows
- Maintain sharp borders on cards and containers (`{rounded.none}`, 0px) to contrast with rounded buttons
- Use generous whitespace (`{spacing.section}` or `{spacing.band}`) between major content blocks
- Set link text to `{colors.accent}` (`#2997FF`) by default; underline on hover
- Centre-align content within a 980px max-width container on large screens
- Stack navigation and UI at 44px height with 17px body text
- Apply focus rings as 2px solid outlines in `{colors.primary}` (`#0071E3`) for keyboard navigation
- Use the SF Pro family (Display for headers, Text for body) without deviation
- Layer opacity and colour blocking for disabled states (e.g. opacity 0.42) rather than grey-out

### Don't

- Avoid drop shadows or blur-based depth; the system communicates depth through colour and opacity alone
- Do not round button corners to less than `{rounded.full}` (9999px) on primary CTAs—sharp or minor radius signals secondary action
- Don't use positive letter-spacing on display type; the system reserves this only for mid-size headings (0.2–0.23px)
- Avoid serif or decorative fonts; maintain SF Pro Display and SF Pro Text exclusively
- Don't apply padding inside a button that exceeds `{spacing.md}` (20px) horizontally; the system keeps buttons compact
- Never invent a shadow value; elevation is colour and opacity only
- Don't use more than three distinct text colours in a single view; the system limits to ink, body, muted, and faint roles
- Avoid mixing semantic badge colours (no red for error, no green for success)—badges are decorative only unless explicitly a link
- Don't reduce opacity below 0.36 for disabled text; it becomes illegible
- Never scale type down below 10px (`{typography.caption-xs}`); smaller text violates accessibility touch targets
- Avoid horizontal padding less than `{spacing.md}` (20px) on buttons; touch targets must meet minimum 44px height and proportional width

## 8. Responsive Behavior

### Breakpoints

| Breakpoint | Viewport Width | Content Column | Grid Columns | Heading (H1) | Body Text | Section Padding X | Notes |
|---|---|---|---|---|---|---|---|
| **Mobile** | 375px | 343px | 3 | `{typography.display-xs}` (40px) | `{typography.body-md}` (17px) | 0px | Menu toggle visible; minimal horizontal padding |
| **Tablet** | 768px | 736px | 3 | `{typography.display-sm}` (48px) | `{typography.body-md}` (17px) | 12px | Horizontal padding introduced; navigation mostly visible |
| **Desktop** | 1024px–1440px | 980px | 3 | `{typography.display-md}` or `{typography.display-sm}` (56px or 48px) | `{typography.body-md}` (17px) | 12px | Content container max-width locked; full navigation visible; no further layout changes |

### Touch Targets

- Minimum button height: 44px (measured: small buttons 18–20px height are secondary or icon-only)
- Minimum button width: proportional to content (primary buttons ~86px minimum)
- Icon buttons: 24px × 24px minimum (measured)
- Link touch area: implicit; recommend 44px vertical spacing in lists
- Navigation links: 44px height (measured)

### Collapsing Strategy

- **375px → 768px:** Heading sizes step down (80px → 48px); no layout column change (3-column grid maintained); section padding shifts from 0px to 12px; navigation collapses to hamburger (menu toggle becomes visible around 14 nav links threshold)
- **768px → 1024px:** Content column widens from 736px to 980px; heading may step up slightly (48px → 56px on largest displays); no menu toggle; full horizontal navigation visible
- **1024px → 1440px:** Content remains locked at 980px; heading remains stable; no layout shift; padding holds at 12px

Navigation link visibility: ~14 links fit at 375px (with collapse), ~5 links fit around the collapse point (768px threshold), ~78 links visible on full desktop—indicating a data-driven nav that expands as viewport permits.

## 9. Agent Prompt Guide

### Quick Color Reference

- **Primary CTA:** Primary (`{colors.primary}` — `#0071E3`)
- **Secondary CTA:** Outline / Accent (`{colors.accent}` — `#2997FF`)
- **Page Background:** Canvas (`{colors.canvas}` — `#FFFFFF`)
- **Card / Panel Background:** Surface (`{colors.surface}` — `#F5F5F7`)
- **Heading Text:** Ink (`{colors.ink}` — `#000000`)
- **Body Text:** Body (`{colors.body}` — `#1D1D1F`)
- **Secondary Text:** Muted (`{colors.muted}` — `#6E6E73`)
- **Placeholder / Tertiary:** Faint (`{colors.faint}` — `#86868B`)
- **Borders / Dividers:** Hairline (`{colors.hairline}` — `#D2D2D7`)

### Iteration Guide

1. **Buttons are pill-shaped by default.** Primary, secondary, and outline buttons use `{rounded.full}` (9999px). Only filled dark buttons and small light buttons use `{rounded.sm}` (11px) or `{rounded.xs}` (8px).

2. **Display type requires negative letter-spacing.** Set –1.2px on 80px (`{typography.display-xl}`), –0.58px on 64px (`{typography.display-lg}`), –0.28px on 56px (`{typography.display-md}`), –0.14px on 48px (`{typography.display-sm}`). Body type uses –0.37px on 17px (`{typography.body-md}`).

3. **Depth is colour and opacity, never shadow.** Use `{colors.surface}` (#F5F5F7) for card backgrounds, opacity shifts (0.36–0.97) for disabled and hover states, and z-index (1–30) for layering. No drop shadows.

4. **Navigation and buttons are 44px tall.** Primary buttons may compress to 20px height in dense layouts, but standard nav and secondary buttons hold 44px.

5. **Content maxes out at 980px.** On screens larger than 1024px, lock the content container width; do not expand beyond 980px. Maintain 12px horizontal padding for breathing room.

6. **Links are `{colors.accent}` (#2997FF) by default, underline on hover.** Use focus-visible outline in `{colors.primary}` (#0071E3) for keyboard users.

7. **Headings use SF Pro Display; body uses SF Pro Text.** No serif, no script. Weight contrast (400 vs 600) drives hierarchy as much as size.

8. **Spacing is semantic, not arbitrary.** Use `{spacing.section}` (40px) or `{spacing.band}` (44px) between major sections; `{spacing.md}` (20px) for component padding; `{spacing.xxs}` (8px) for micro-spacing between siblings.

9. **Disabled elements use opacity, not greying.** Apply opacity 0.42 or 0.36 rather than a separate grey colour.

10. **Breakpoint collapse at 768px is content-driven, not arbitrary.** When nav links exceed screen capacity, introduce a menu toggle. Heading sizes step (40px → 48px → 56px) as viewport grows.

## 10. Known Gaps

- **No semantic status ramp.** The site does not declare error, success, warning, or info colours in markup. Do not invent status badges; use the decorative accent colours (`{colors.accent-2}`) only if explicitly called out.

- **Interaction states are partial.** The extraction captured hover, focus-visible, active, and disabled states for buttons, links, and inputs, but not all surfaces (e.g. card expansion, drag feedback, or animation timing). Assume defaults unless explicitly measured.

- **No gradients or decorative meshes.** The system is colour-block only; no gradients, skews, or mesh backgrounds were observed.

- **3 colours have no assigned role.** `{colors.accent-1}` (#0066CC), `{colors.accent-2}` (#B64400), and `{colors.neutral-1}` (#333336) were measured but lack primary semantic roles. Treat as decorative.

- **Dark mode not evaluated.** Only the light theme was extracted; dark-mode behaviour is not documented here.

- **Authentication-gated surfaces not visited.** Account pages, checkout, and admin interfaces were not analysed; their design may diverge from the public-facing system.

- **Animation and timing not measured.** The extraction captured static styles only; transition durations, easing functions, and keyframe sequences are not included.

- **No component compound patterns.** Tooltips, popovers, modals, and complex composite components were not fully extracted. Use the single-tier elevation and colour rules as a foundation.

- **Breakpoint thresholds are measured, not declared.** The system was derived by resizing and observing layout changes; no explicit CSS media queries were parsed. Intermediate breakpoints (e.g. 900px, 1100px) may exist but were not detected.

- **Font fallback stacks incomplete.** Only the primary fonts (SF Pro Display, SF Pro Text) are confirmed; web font loading strategy and fallback cascade specifics are not included.