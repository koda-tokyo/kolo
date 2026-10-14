# Visual Composition — Structure from Nothing

## The Skeleton Principle

All visual design has an invisible skeleton: the spatial relationships between elements. You can't see the skeleton, but you feel it. Bad design feels "off" because the skeleton is wrong. Good design feels "right" because the skeleton is sound.

**The skeleton is:** proportion, alignment, negative space, and hierarchy. Master these and 80% of visual design is solved. Color and typography are paint on the skeleton.

---

## Proportion Systems — Pick One and Commit

### Golden Ratio (φ = 1.618)
**Feels:** Natural, balanced, organic.
**Math:** a/b = (a+b)/a = 1.618
**Applications:** Content-heavy apps, reading interfaces, dashboards with mixed content.
**In practice:** 100px × 162px, 300px × 486px, sidebar 240px → content 388px → total 628px.
**Rule of thirds:** Golden ratio simplified. Divide canvas into 3×3 grid. Key elements on intersections.

### Root-2 (√2 = 1.414)
**Feels:** Geometric, precise, technical.
**Math:** Each step doubles area. A4 paper ratio.
**Applications:** Developer tools, technical products, code interfaces.
**In practice:** Width × 1.414 = height. Good for cards, modals, panels.

### Musical Ratios (4:3, 3:2, 5:4, 2:1)
**Feels:** Classic, stable, harmonious.
**Why "musical":** These are the frequency ratios of consonant intervals (4th, 5th, major 3rd, octave). Our brains find them pleasing.
**Applications:** Enterprise software, finance, medical — anything requiring conservative trust.
**Quick picker:**
| Ratio | Interval | Feel | Use when |
|-------|----------|------|----------|
| 1:1 | Unison | Stable, balanced | Square elements, avatars, icons |
| 5:4 (1.25) | Major 3rd | Slightly dynamic | Cards, panels |
| 4:3 (1.333) | Perfect 4th | Classic, grounded | Content areas, images |
| 3:2 (1.5) | Perfect 5th | Dynamic but stable | Hero sections, key screens |
| 16:9 (1.778) | — | Cinematic | Video, media-heavy |
| 2:1 (2.0) | Octave | Dramatic | Banners, hero images |

### 4px Grid (Atomic)
**Feels:** Minimal, utilitarian, systematic.
**Applications:** Internal tools, developer consoles, CLI tools, anything where content density matters more than "beauty."
**Rule:** All spacing is a multiple of 4. 4, 8, 12, 16, 24, 32, 48, 64, 96.

---

## Negative Space — The Active Void

**Principle:** Negative space is not "empty." It's an active element that shapes perception.

**The 50-50 illusion:** Beginners fill space. Masters compose space. Aim for 40-60% negative space on any screen.

**Space hierarchy:**
- **Micro space (4-8px):** Between related elements (label ↔ input, icon ↔ text)
- **Small space (12-24px):** Between peer elements (list items, card content)
- **Medium space (32-64px):** Between sections (content blocks, page sections)
- **Large space (80-160px):** Between major regions (hero ↔ content, folds)

**The rule of three distances:** If all spacing is the same, nothing is related. Use 3 distinct spacing values (tight, medium, loose) to communicate grouping.

---

## Visual Hierarchy — The Eye's Path

The eye scans in this order, every time:
1. **Largest thing** (size dominates)
2. **Highest contrast thing** (dark on light, or light on dark)
3. **Most saturated thing** (color pops before grayscale)
4. **Isolated thing** (surrounded by space)
5. **Moving thing** (motion overrides everything)

**Hierarchy check:** Squint at the design. What do you still see? That's the hierarchy. If the wrong thing stands out, fix it.

**The 3-level rule:** Every screen needs exactly 3 levels of visual hierarchy:
- **Level 1:** The ONE thing the user must see (heading, CTA, primary data)
- **Level 2:** Supporting information (secondary data, navigation, filters)
- **Level 3:** Everything else (metadata, footnotes, tertiary actions)

More than 3 levels = noise. Less than 3 = flat and disorienting.

---

## Typographic Voice

### Geometric Sans (Futura, Avenir, Poppins)
**Personality:** Modern, clean, slightly clinical.
**When:** Tech products, startups, anything "future-forward."
**Avoid:** Long-form reading — geometric shapes fatigue the eye.

### Grotesk Sans (Inter, Helvetica, SF Pro)
**Personality:** Neutral, invisible, utilitarian.
**When:** "The content matters, not the font." Enterprise, data, tools.
**Superpower:** You forget it exists. That's the point.

### Humanist Sans (Source Sans, Fira Sans, Segoe UI)
**Personality:** Warm, approachable, human.
**When:** Health, education, social — anything person-to-person.
**Difference from Grotesk:** Subtle stroke variation, slightly organic curves.

### Serif (Lora, Source Serif, Georgia)
**Personality:** Traditional, authoritative, readable.
**When:** Long-form reading, editorial, luxury, legal, academic.
**Never:** Use serif for UI labels, buttons, or dense data.

### Monospace (JetBrains Mono, SF Mono, Fira Code)
**Personality:** Technical, raw, functional.
**When:** Code, logs, terminals, data tables, "technical truth" aesthetic.
**Avoid:** Marketing, consumer-facing UI (unless developer tool).

### Font Pairing Rules
1. **Contrast is the point.** Two fonts that look similar = looks like a mistake.
2. **One does the talking.** Heading font has personality. Body font has readability.
3. **Serif headings + sans body = classic editorial.** Sans headings + serif body = modern literary.
4. **Never pair two serifs or two scripts.** Always sans + serif, or sans + sans with strong contrast.

---

## Composition Patterns — Pre-Built Skeletons

### The Dashboard Pattern
```
┌──────────────────────────────────────────┐
│  TOP BAR (nav, search, profile)    64px   │
├──────────┬────────────────────────────────┤
│          │                                │
│ SIDEBAR  │  CONTENT AREA                  │
│  240px   │  ┌──────┐ ┌──────┐ ┌──────┐   │
│          │  │ CARD │ │ CARD │ │ CARD │   │
│          │  └──────┘ └──────┘ └──────┘   │
│          │                                │
│          │  ┌─────────────────────────┐   │
│          │  │  WIDE CONTENT (table,   │   │
│          │  │  chart, feed)           │   │
│          │  └─────────────────────────┘   │
└──────────┴────────────────────────────────┘
```
**Proportion:** Sidebar 1:4 content (or golden: sidebar 240, content 388, total 628 becomes 1:1.618)
**When:** Data-heavy, many features, frequent navigation.

### The Focus Pattern
```
┌──────────────────────────────────────────┐
│                                          │
│                                          │
│           ┌──────────────────┐           │
│           │                  │           │
│           │   CENTERED       │           │
│           │   CONTENT        │           │
│           │   max 640px      │           │
│           │                  │           │
│           └──────────────────┘           │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```
**Proportion:** Content ≤ 640px (optimal reading width). Generous negative space.
**When:** Single task, reading, forms, landing pages, authentication.

### The Split Pattern
```
┌──────────────────┬──────────────────────────┐
│                  │                          │
│   MEDIA /        │   CONTENT                │
│   ILLUSTRATION   │   Heading                │
│   (50%)          │   Description            │
│                  │   CTA                    │
│                  │                          │
└──────────────────┴──────────────────────────┘
```
**Proportion:** 1:1 or golden (~38:62).
**When:** Landing pages, sign-up, product intro, feature showcase.

### The Feed Pattern
```
┌──────────────────────────────────────────┐
│  TOP BAR / HEADER                        │
├──────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐│
│  │  LIST ITEM 1                         ││
│  ├──────────────────────────────────────┤│
│  │  LIST ITEM 2                         ││
│  ├──────────────────────────────────────┤│
│  │  LIST ITEM 3                         ││
│  │  ...infinite...                      ││
│  └──────────────────────────────────────┘│
└──────────────────────────────────────────┘
```
**Proportion:** Full-width or max-width 720px centered.
**When:** Social feeds, notification lists, search results, activity logs.

---

## Quick Proportion Picker

| Product type | Proportion system | Primary comp pattern |
|-------------|-------------------|---------------------|
| B2B SaaS dashboard | 4px grid + musical 4:3 | Dashboard |
| Medical / healthcare | Musical 4:3 + golden ratio | Dashboard or Focus |
| Developer tool | Root-2 + 4px grid | Dashboard |
| Consumer app | Golden ratio | Feed or Focus |
| Landing page | Musical 3:2 + golden ratio | Split or Focus |
| Data-heavy analytics | 4px grid | Dashboard (dense) |
| Reading / content | Golden ratio | Focus |
| Finance / banking | Musical 5:4 or 4:3 | Dashboard |
