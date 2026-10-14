# Design Systems Engineering — At Scale

## What a Design System Actually Is

A design system is not a component library. A component library is an OUTPUT of a design system. The design system is the infrastructure of design decisions: tokens, patterns, guidelines, principles, and governance.

### The Three-Layer Model (Based on Google, Airbnb, Shopify)

**Layer 1: Design Tokens (the atoms)**
- Colors, typography, spacing, sizing, borders, shadows, opacity, motion
- Platform-agnostic values
- Single source of truth

**Layer 2: Patterns (the molecules)**
- How tokens combine into reusable patterns
- Component APIs, not component implementations
- "A Button is: padding-X + padding-Y + border-radius-MD + color-primary-400 + typography-label"

**Layer 3: Compositions (the organisms)**
- How patterns combine into screens and flows
- Page templates, layout grids, navigation structures
- "A Dashboard has: top-bar + sidebar + content-grid with stat-cards"

---

## Design Token Architecture

### Token Naming Convention (CTI: Category / Type / Item)
```
color-background-primary
color-text-primary
color-border-default
space-container-horizontal
space-component-gap
typography-heading-size
typography-body-line-height
radius-component-default
shadow-elevation-low
duration-transition-fast
easing-enter-default
```

### Token Tiers (Where the Abstraction Pays Off)
```
Tier 3: Semantic tokens    → color-background-brand
Tier 2: Purpose tokens     → color-blue-500
Tier 1: Raw values         → #3B82F6
```

**Why tiered:** When the brand color changes from blue to teal, change Tier 2 once (`blue-500: #14B8A6`). All semantic tokens resolve correctly. Without tiers, every component must be updated individually.

### Token Transforms (Style Dictionary, Universal Design Tokens)
```json
{
  "color": {
    "background": {
      "brand": { "value": "{color.blue.500}" }
    }
  },
  "color": {
    "blue": {
      "500": { "value": "#3B82F6" }
    }
  }
}
```
Transform pipelines:
```
tokens.json → style-dictionary → {
  CSS custom properties
  Tailwind @theme
  SCSS variables
  iOS UIColor extensions
  Android colors.xml
  React Native StyleSheet
  Figma variables (via plugin)
}
```

---

## Component API Design

### The 7 Questions Every Component Must Answer
1. **What does it render?** (children / content)
2. **What variants does it have?** (variant: primary | secondary | ghost)
3. **What sizes does it support?** (size: sm | md | lg)
4. **What states can it be in?** (disabled, loading, error, active, hover, focus)
5. **What does it expose to parent?** (ref, callbacks, controlled/uncontrolled)
6. **How does it handle composition?** (asChild, render prop, slots)
7. **How does it handle accessibility?** (ARIA, keyboard, screen reader)

### Component API Patterns

**Polymorphic (asChild / as prop):**
```tsx
<Button asChild>
  <a href="/dashboard">Dashboard</a>  // renders as <a>, styled as Button
</Button>
```

**Compound Components:**
```tsx
<Select>
  <Select.Trigger>Choose...</Select.Trigger>
  <Select.Content>
    <Select.Item value="1">Option 1</Select.Item>
    <Select.Item value="2">Option 2</Select.Item>
  </Select.Content>
</Select>
```

**Controlled / Uncontrolled:**
```tsx
// Uncontrolled: component manages state internally
<Tabs defaultTab="overview" />

// Controlled: parent manages state
const [tab, setTab] = useState("overview");
<Tabs tab={tab} onTabChange={setTab} />
```

---

## Design System Governance

### The Maturity Model
| Level | Name | Description |
|-------|------|-------------|
| 1 | Artifacts | Design files exist. Not implemented. Design and code diverge. |
| 2 | Tokens only | Design tokens in code. But components don't use them consistently. |
| 3 | Component library | Reusable components built with tokens. But design and code are separate teams. |
| 4 | Integrated system | Design and code share the same token source. Changes in design propagate to code. |
| 5 | Platform | The design system is infrastructure. Multiple products consume it. Governance is automated. |

### Contribution Model
```
┌─────────────────────────────────────────────────┐
│  DESIGN SYSTEM TEAM (maintains platform)        │
│  ┌───────────┐  ┌──────────┐  ┌─────────────┐  │
│  │ Tokens    │  │ Patterns  │  │ Tooling      │  │
│  └───────────┘  └──────────┘  └─────────────┘  │
└─────────────────────────────────────────────────┘
         ↑                ↑                ↑
    ┌─────────┐     ┌─────────┐     ┌─────────┐
    │Product A│     │Product B│     │Product C│
    │Contribs │     │Contribs │     │Contribs │
    └─────────┘     └─────────┘     └─────────┘
```

### Breaking Change Policy
Design systems that break consumers create distrust:
1. **Deprecate first, remove later.** Mark as deprecated for one release cycle.
2. **Migration guide with every breaking change.** Codemods when possible.
3. **Semantic versioning.** MAJOR.MINOR.PATCH.
4. **Beta/experimental flags.** Ship new patterns as experimental before stabilization.

---

## Cross-Platform Design Consistency

### The Consistency Spectrum
```
IDENTICAL           COHERENT            ADAPTED             NATIVE
(web = mobile)     (same brand,       (same brand,        (platform-
                   different layout)  different patterns)  specific)
```

**Rule:** Don't aim for identical. Aim for coherent. Users expect platform conventions.

**What should be identical across platforms:**
- Brand colors
- Typography (same fonts or equivalents)
- Iconography style
- Tone of voice
- Core navigation structure (what exists, not how it's accessed)

**What should adapt per platform:**
- Layout patterns (sidebar on desktop → bottom tabs on mobile)
- Navigation gestures (click → swipe/tap)
- Input methods (keyboard shortcuts → long-press)
- Density (dense on desktop → spacious on mobile)
- Depth cues (shadows on web → sheets on mobile)

---

## Design Ops

### What Design Ops Does
If design systems are the "what" (tokens, components, patterns), Design Ops is the "how" (process, tooling, culture):
- **Onboarding:** How does a new designer/engineer get set up?
- **Tooling:** Figma → code workflow, linting, CI checks, visual regression testing
- **Review:** Design critique process. PR review for visual changes.
- **Documentation:** Storybook, Zeroheight, or custom docs site. Living, not static.
- **Metrics:** Design system adoption, component reuse rate, design-code drift rate

### Design Linting
```
ESLint rules that enforce design system usage:
- no-hardcoded-colors (use token)
- no-hardcoded-spacing (use token)
- no-deprecated-components
- component-import-from-design-system
```

### Visual Regression Testing
```
Chromatic / Percy / Playwright screenshots:
- Every PR generates screenshots of all component states
- Compare against baseline
- Flag visual diffs for human review
- Catch design regressions before they ship
```

---

## The Design System as Product

**The most important mindset shift:** A design system is a PRODUCT, not a project. It has users (other designers and engineers). It has adoption metrics. It has a roadmap. It requires maintenance. It can succeed or fail.

**Design system success metrics:**
- Adoption: % of components using design system vs. custom
- Efficiency: time to build a new screen (should decrease)
- Consistency: visual QA issues per release (should decrease)
- Satisfaction: NPS from design system consumers

**Design system failure modes:**
- "The component library that nobody uses" — too rigid, doesn't solve real problems
- "The component library that everyone forks" — not extensible enough
- "The design system that's always one release behind" — design and code teams aren't aligned
- "The perfect but unshipped redesign" — version 2.0 that never finishes
