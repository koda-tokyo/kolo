---
name: enterprise-ui-design
description: Design enterprise-grade UI for websites, platforms, and apps. Use for any frontend design task requiring professional, clean, light-mode interfaces with SVG icons. Covers typography, color systems, spacing, grid layouts, iconography, and component patterns. Triggers for UI design, dashboard layout, enterprise app design, B2B SaaS interface, professional styling, or any visual design guidance.
---

# Enterprise UI Design

Design system for professional, enterprise-grade interfaces. Light mode. Clean. No emojis. SVG icons only.

## Core Philosophy

**Less is more.** Enterprise users need clarity, not decoration. Every element must earn its place.

**Hierarchy through contrast, not color.** Use weight, size, and spacing to create visual hierarchy. Reserve color for meaning.

**Consistency builds trust.** Repeat patterns. Use tokens. Enterprise software must feel predictable.

## Quick Reference

| Element | Guidance |
|---------|----------|
| Icons | Lucide or custom SVG. 24x24 base. 2px stroke. No emojis. |
| Colors | Neutral-dominant. Single accent. 10-shade scales. |
| Typography | Inter/IBM Plex. 4-5 sizes max. Sentence case. |
| Spacing | 4px base unit. 8px for UI. Multiples: 4, 8, 12, 16, 24, 32, 48, 64. |
| Borders | Use sparingly. Prefer shadows, spacing, or background contrast. |
| Radius | 4px small, 8px medium, 12px large. Consistent per element type. |

## Detailed Guidelines

### Typography → [references/typography.md](references/typography.md)
### Color System → [references/color.md](references/color.md)
### Spacing & Layout → [references/spacing.md](references/spacing.md)
### Iconography → [references/icons.md](references/icons.md)
### Components → [references/components.md](references/components.md)
### Patterns → [references/patterns.md](references/patterns.md)

## Design Checklist

Before shipping any UI:

1. **Contrast check** — Text readable? WCAG AA minimum (4.5:1 small text, 3:1 large).
2. **Hierarchy clear** — Can you identify primary, secondary, tertiary elements instantly?
3. **Spacing consistent** — All spacing uses defined tokens?
4. **Icons unified** — Same stroke width, same source library, same size?
5. **Color purposeful** — Accent color has meaning? Not decorative?
6. **Mobile-first** — Does it work at 375px width?
7. **Touch targets** — Buttons minimum 44x44px on mobile?
8. **Empty states** — What does user see with no data?
9. **Loading states** — Skeleton loaders, not spinners?
10. **Error states** — Clear, helpful, non-alarming?

## Anti-Patterns (Never Do)

- Emojis in enterprise UI
- Rainbow gradients
- More than 2 font families
- Shadows on everything
- Borders AND shadows on same element
- Center-aligned body text
- All caps body text
- Icon fonts (use SVG)
- Color alone to convey meaning
- Placeholder text as labels
