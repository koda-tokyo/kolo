---
name: frontend-design-engineering
description: "Super-skill for complete frontend design and UI/UX engineering — orchestrates visual design, interaction patterns, and production implementation into one unified pipeline. Covers the full spectrum: design systems, UX architecture, Figma-to-code, React web, React Native mobile, accessibility compliance, and design QA. Use for any end-to-end frontend project: building a product from scratch, redesigning an existing UI, creating design systems, implementing Figma designs, full-stack frontend features, or any task spanning both design AND implementation. Triggers: frontend project, full-stack frontend, design + build, UI engineering, product design implementation, design system + code, redesign, frontend architecture, end-to-end UI, design-to-code pipeline."
---

# Frontend Design Engineering — Super-Skill

Orchestrates the complete frontend lifecycle from visual design through UX architecture to production code. This skill is the project lead — it delegates to sub-skills at each phase and ensures consistency across all layers.

## Architecture — The Three-Layer Stack

```
┌──────────────────────────────────────────────┐
│  THIS SKILL — Orchestration & Quality Gates  │
├──────────────────────────────────────────────┤
│  Layer 1: VISUAL                              │
│  enterprise-ui-design → colors, type, icons   │
├──────────────────────────────────────────────┤
│  Layer 2: BEHAVIORAL                          │
│  ux-patterns → flows, states, a11y, copy      │
├──────────────────────────────────────────────┤
│  Layer 3: CODE                                │
│  react-web / react-native-mobile → implement  │
│  figma → design extraction (input source)     │
└──────────────────────────────────────────────┘
```

**Rules of the stack:**
- Never skip a layer. Visual decisions inform UX. UX informs code.
- Each layer's output becomes the next layer's spec.
- Changes at any layer cascade downward — revalidate gates below.
- `figma` provides design input but is not a design layer — it's a data source.

## Quick Decision — Which Skills Do I Need?

| Scenario | Skills to load |
|----------|---------------|
| Building a new product from scratch | All layers: `enterprise-ui-design` → `ux-patterns` → `react-web` or `react-native-mobile` |
| Implementing a Figma design | `figma` (extract) → `react-web` / `react-native-mobile` (build). Validate with `enterprise-ui-design` + `ux-patterns` |
| Redesigning existing UI | `enterprise-ui-design` (visual refresh) + `ux-patterns` (fix flows). Then re-implement |
| Adding a feature to existing app | `ux-patterns` (flow design) → `react-web` / `react-native-mobile` (build) |
| Design system only (no code) | `enterprise-ui-design` + `ux-patterns`. Stop at specs |
| Mobile app from scratch | `enterprise-ui-design` → `ux-patterns` → `react-native-mobile` |
| Figma → production | See detailed workflow below |

## The Unified Workflow

### Phase 0: Scoping
**What to do:** Define what's being built. Identify platforms (web, mobile, both). Determine if there's existing design (Figma link, mockup, reference app).

**Delegates to:** Nothing yet — this is pure scoping.

**Output:** Platform decision, design source identified, scope boundary clear.

### Phase 1: Design Foundation
**What to do:** Establish the visual language. Colors, typography, spacing, iconography, component primitives. This is the design system layer.

**Delegates to:** `enterprise-ui-design`
- Load `references/typography.md`, `references/color.md`, `references/spacing.md`, `references/icons.md`
- Define design tokens as Tailwind `@theme` or CSS custom properties
- Create component pattern library (buttons, inputs, cards, modals, etc.)

**If Figma source exists:** Extract with `figma` skill first, then normalize into the design system.

**Output:** Design token file, component pattern spec, visual hierarchy rules.

**Gate:** Run the `enterprise-ui-design` checklist. All 10 items must pass.

### Phase 2: UX Architecture
**What to do:** Design how things work. Navigation, forms, states (loading/empty/error/edge), accessibility, copywriting. This is the behavioral layer.

**Delegates to:** `ux-patterns`
- Load relevant references from `ux-patterns/references/` based on project needs
- Design all screens in all states
- Run the 34-item UX checklist (`ux-patterns/assets/ux-checklist.json`)

**Critical outputs:**
- Screen map / user flow diagram
- Every screen designed for: ideal, loading, empty, error states
- Accessibility spec (WCAG 2.2 AA minimum)
- UX copy for buttons, errors, empty states, confirmations

**Output:** UX spec document, screen state matrix, accessibility compliance plan.

**Gate:** Run the full `ux-checklist.json`. All applicable items must pass or have documented exceptions.

### Phase 3: Implementation
**What to do:** Build it. Convert design + UX specs into production code.

**Delegates to:** `react-web` and/or `react-native-mobile`

**Web workflow (`react-web`):**
1. Scaffold with Next.js 15 + Tailwind v4 + shadcn/ui
2. Implement design tokens from Phase 1 as Tailwind `@theme`
3. Build component library (shadcn/ui as base, customize to match design)
4. Implement screens from Phase 2 (all states)
5. Add data fetching, auth, AI integration as needed
6. Apply accessibility markup (ARIA, keyboard nav, focus management)

**Mobile workflow (`react-native-mobile`):**
1. Scaffold with Expo SDK 52+ + NativeWind
2. Implement design tokens as NativeWind theme
3. Build components following mobile UX patterns
4. Implement screens with platform-native feel
5. Handle offline, push notifications, deep linking

**For both:** Use `context7` skill for live API docs when integrating libraries.

**Output:** Production-ready code, all states implemented, accessible, responsive.

**Gate:** Implementation review — does code match design? All states present? Accessibility verified?

### Phase 4: Quality Assurance
**What to do:** Cross-layer validation. Does the implementation faithfully reproduce the design and UX intent?

**Checks:**
1. **Visual match** — Compare implementation against design tokens. Colors, spacing, typography, border-radius all correct?
2. **State completeness** — Every screen has loading, empty, error, and ideal states?
3. **Accessibility** — Keyboard navigable? Screen reader tested? WCAG 2.2 AA?
4. **Responsive** — Works at 320px, 768px, 1024px, 1440px?
5. **Performance** — LCP < 2.5s, no layout shift, smooth interactions?
6. **Cross-layer consistency** — Visual design decisions are reflected in UX behavior? UX decisions are faithfully implemented?

**Delegates to:** `quality-assurance` skill if available. Otherwise run manual checks.

**Output:** QA report, bug list, sign-off.

## Sub-Skill Quick Reference

Full decision matrix at [references/skill-matrix.md](references/skill-matrix.md).

| Skill | When to invoke | Key resources |
|-------|---------------|---------------|
| `enterprise-ui-design` | Any visual decision: colors, type, spacing, icons, components | `references/typography.md`, `references/color.md`, `references/spacing.md`, `references/icons.md`, `references/components.md`, `references/patterns.md` |
| `ux-patterns` | Any behavioral decision: flows, states, forms, a11y, copy | `references/navigation.md`, `references/interaction.md`, `references/forms.md`, `references/states.md`, `references/mobile.md`, `references/accessibility.md`, `references/copywriting.md`, `assets/ux-checklist.json` |
| `react-web` | Building web apps with React 19 + Next.js 15 + Tailwind v4 + shadcn/ui | `references/nextjs-patterns.md`, `references/tailwind-v4.md`, `references/shadcn-patterns.md`, `references/server-components.md`, `references/data-fetching.md`, `references/auth-patterns.md`, `references/ai-integration.md`, `references/html-artifacts.md` |
| `react-native-mobile` | Building iOS/Android apps with React Native + Expo | Skill body + references for Expo Router, NativeWind, EAS, offline, push notifications |
| `figma` | Design input: extracting structure, styles, layout from Figma files | `scripts/figma.py` for context/list commands |
| `context7` | Live API documentation for any npm/Python package | `scripts/context7.py` for resolve + docs |

## Quality Gates — Per Phase

See [references/quality-gates.md](references/quality-gates.md) for the full checklist per phase.

### Minimum bar before shipping any frontend work:

**Design:**
- [ ] Design tokens defined and consistent
- [ ] Visual hierarchy clear at a glance
- [ ] Color has purpose (not decorative)
- [ ] Icons unified (same library, same stroke)
- [ ] Typography scale defined (4-5 sizes max)

**UX:**
- [ ] Every screen designed for all 4 states (ideal, loading, empty, error)
- [ ] Navigation ≤ 3 clicks to any page
- [ ] Touch targets ≥ 44×44px on mobile
- [ ] Keyboard navigation works for all interactive elements
- [ ] Copy is action-oriented (buttons predict outcome, errors say what to do)

**Code:**
- [ ] Design tokens match implementation pixel-perfect
- [ ] All 4 states implemented per screen
- [ ] WCAG 2.2 AA baseline met
- [ ] Responsive: 320px → 1440px+
- [ ] TypeScript strict mode, no `any` without justification

## Anti-Patterns (Never Do)

- **Skip layers.** "I'll just build it and add design later" → technical debt. Design first.
- **Design in code.** Don't design by writing components. Design in design tools or specs, then implement.
- **Mix layer concerns.** Don't make UX decisions while picking colors. Don't write code while designing flows.
- **One-state thinking.** Designing only the ideal state is designing half the experience.
- **Design-system drift.** Implementation that diverges from design tokens without updating both.
- **Emojis in enterprise UI.** Always SVG icons.
- **Accessibility as afterthought.** Build it in from Phase 2, not bolt it on in Phase 4.

## How to Use This Skill

1. **New project**: Follow the unified workflow Phase 0→4 in order. Load sub-skills at each phase.
2. **Existing project feature**: Start at Phase 2 (UX) or Phase 3 (code), but validate against Phase 1 design tokens.
3. **Design audit**: Load `enterprise-ui-design` + `ux-patterns`. Run all checklists. Report gaps.
4. **Design system creation**: Phase 1 only, but add component documentation for Phase 3 consumption.

**Always:** Run quality gates at the boundary of each phase before moving to the next.
