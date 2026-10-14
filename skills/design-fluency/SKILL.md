---
name: design-fluency
description: "Deep visual design expertise for generating original, beautiful UI from first principles — no reference required. Covers composition, proportion systems, color theory, typography as voice, motion design, and creative methodology. Use when designing visual interfaces from scratch without screenshots or Figma references to copy, when an agent needs to create original aesthetic direction, or when the task requires pure creative generation rather than implementation of existing designs. Triggers: design from scratch, original design, visual direction, create a look, design without reference, aesthetic direction, composition, color palette from nothing, motion design, animation curves, easing, micro-interactions, visual identity, brand design generation, pure-aesthetic design."
---

# Design Fluency — Visual Creation from First Principles

Creates original visual designs without copying references. This is the creative engine for when no screenshot, Figma file, or design system exists — when you must generate beauty from nothing.

**Who this is for:** Builders who can implement anything but struggle with the creative leap of inventing the visual shape. Engineers who think in systems but need a system for aesthetics.

**Boundary with other skills:**
- `enterprise-ui-design` = design SYSTEM (tokens, consistency, patterns). **Consumes** the output of this skill.
- `design-fluency` (this) = design CREATION (original aesthetics, composition, voice). **Generates** what `enterprise-ui-design` systematizes.
- `frontend-design-engineering` = project lead that delegates to both.

## Core Philosophy

**Design is decision-making under constraints.** Creativity isn't magic — it's method. When you have no reference, you need decision frameworks, not inspiration.

**Three pillars of original design:**
1. **Structure** — The invisible skeleton. Proportions, grids, negative space, hierarchy.
2. **Surface** — The visible layer. Color, typography, imagery, texture.
3. **Motion** — The living layer. Timing, easing, transformation, choreography.

**The golden rule of original design:** Start with constraints. Blank canvas is paralysis. Add constraints deliberately and design becomes a series of choices, not a leap of faith.

## Quick Start — The 5-Minute Design Generation

When you have nothing and need a visual direction NOW:

```
1. PICK A METAPHOR → What does this feel like?
   (clinical, playful, luxurious, technical, warm, minimal)

2. PICK A PROPORTION SYSTEM → Load references/visual-composition.md § Quick Proportion Picker
   (golden ratio Φ=1.618, root-2, musical 4ths/5ths, or 4px grid)

3. PICK A COLOR STRATEGY → Load references/color-science.md § Quick Palette Generator
   (monochromatic, analogous, complementary, or neutral+accent)

4. PICK A TYPE VOICE → Load references/visual-composition.md § Typographic Voice
   (geometric/scientific, humanist/warm, grotesk/neutral, mono/technical)

5. COMPOSE THE HERO → Pick one screen. Compose it. The rest flows from this.
```

**Don't iterate on all 5 at once.** Lock each decision before moving to the next. Constraints reduce chaos.

## The Design Generation Workflow

### Step 1: Define the Emotional Brief
Before any visual decision, answer these:

| Question | Example answers |
|----------|-----------------|
| What emotion should the user feel? | Confident, calm, focused, delighted, safe |
| What's the opposite feeling? | (know what to avoid) |
| What existing thing has this feeling? | Swiss train station, Apple Store, medical lab, library |
| What's the primary action? | (one thing the user must do) |

**Emotion → Visual mapping (quick reference):**
| Emotion | Shapes | Color temperature | Spacing | Motion |
|---------|--------|-------------------|---------|--------|
| Trust/Safety | Rounded, soft | Cool blues, warm neutrals | Generous | Slow, gentle |
| Power/Precision | Sharp, angular | High contrast, bold | Tight, efficient | Fast, decisive |
| Warmth/Comfort | Organic, curved | Warm, saturated | Comfortable | Natural, flowing |
| Innovation/Tech | Geometric, clean | Cool, futuristic | Airy, minimal | Smooth, precise |
| Luxury/Elegance | Thin, delicate | Muted, deep | Expansive | Slow, refined |

### Step 2: Establish the Spatial System
Load `references/visual-composition.md` for depth. Quick picks:

- **Golden ratio (1:1.618)** — Natural, balanced. For content-heavy apps, dashboards, reading.
- **Root-2 (1:√2)** — Geometric, clean. For technical tools, developer products.
- **Musical 4ths (4:3)** — Classic, stable. For enterprise, finance, medical.
- **4px grid only** — Minimalist, utilitarian. For CLI tools, developer consoles, internal tools.

### Step 3: Generate the Color Palette
Load `references/color-science.md` for depth. The generation rule:

**Never pick colors by taste.** Pick by relationship:
1. Choose ONE anchor color (the one that carries meaning)
2. Derive the rest from mathematical relationships (harmonies, contrasts, accessibility)
3. Build the neutral scale (grays aren't just grays — they carry warmth/coolness)
4. Test: do the colors work in grayscale? (Luminosity contrast = true hierarchy)

### Step 4: Choose the Typographic Voice
Fonts have personalities. Match them to the emotional brief:

| Voice | Font family | Best for |
|-------|------------|----------|
| Scientific / Precise | Inter, IBM Plex Sans | Dashboards, data, medical |
| Warm / Human | Lora, Source Serif (headings), system sans (body) | Content, reading, wellness |
| Technical / Neutral | Geist, system-ui | Developer tools, internal apps |
| Bold / Editorial | DM Sans, Space Grotesk (headings only) | Marketing, landing pages |
| Mono / Raw | JetBrains Mono, SF Mono | Code, logs, terminal |

**Rule:** Max 2 families. One for headings (voice), one for body (readability).

### Step 5: Compose the Hero Screen
The hero screen (usually the main dashboard/feed/detail) sets the design language. Everything else follows.

**Composition Decision Tree:**
```
Is the primary task BROWSE or FOCUS?
├── BROWSE (many items) → Dense layout, grid/list, sidebar, multi-column
│   ├── Hierarchical? → Tree sidebar + content area
│   └── Flat? → Grid/tiles + top filter bar
└── FOCUS (one thing) → Centered, single-column, generous whitespace
    ├── Data entry? → Form-centered, focused, step-by-step
    └── Reading/consuming? → Article layout, centered, comfortable measure
```

### Step 6: Design the Motion Language
Load `references/motion-design.md` for depth. Motion isn't decoration — it's communication.

**Motion has 4 jobs:**
1. **Orientation** — "Where am I?" (page transitions, scroll position)
2. **Causality** — "What happened because of my action?" (button press feedback, item added)
3. **Focus** — "What should I look at?" (new element, notification, highlight)
4. **Personality** — "What does this feel like?" (brand character, emotional tone)

**Quick motion tokens:**
| Feel | Duration | Easing | Character |
|------|----------|--------|-----------|
| Snappy / Professional | 150-200ms | ease-out (decelerate) | Fast start, smooth land |
| Smooth / Premium | 300-400ms | ease-in-out (cubic-bezier) | Graceful throughout |
| Playful / Delightful | 400-600ms | spring / elastic | Overshoot then settle |
| Subtle / Invisible | 100-150ms | ease-out | Barely perceptible |

## Anti-Patterns (Never Do)

- **References-first design.** Don't start by looking for inspiration. Start with the emotional brief.
- **Color-by-taste.** "I like blue" is not a color system. Derive from relationships.
- **Same font everywhere.** One sans-serif for everything = no voice. Two fonts, intentional contrast.
- **Motion as afterthought.** Motion designed after implementation looks bolted on. Design it with the visual language.
- **All screens at once.** Hero screen first. The rest inherits from it.
- **Copying without understanding.** Using a reference is fine. Copying without knowing WHY it works is not. This skill is for when you can't or won't copy.

## Reference Modules

| Domain | Reference | When to load |
|--------|-----------|-------------|
| Composition & space | `references/visual-composition.md` | Any layout/spacing/proportion decision |
| Color science | `references/color-science.md` | Generating palettes, color relationships, accessibility |
| Motion design | `references/motion-design.md` | Animation curves, easing, micro-interactions, choreography |
| Design generation | `references/design-generation.md` | Full end-to-end methodology, creative process, overcoming blank canvas |

## Skill Relationships

```
design-fluency (this)           ← CREATES original aesthetics
        ↓
enterprise-ui-design            ← SYSTEMATIZES into design tokens
        ↓
ux-patterns                     ← BEHAVIORAL layer
        ↓
react-web / react-native-mobile ← IMPLEMENTS
```

Use `design-fluency` when `enterprise-ui-design` fails — when the question isn't "what token for this button?" but "what should this product even look like?"
