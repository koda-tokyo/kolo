---
name: ux-patterns
description: Interaction design patterns, UX heuristics, accessibility guidelines, and behavioral design for web and mobile applications. Covers navigation patterns, form UX, state handling (loading/empty/error), mobile UX, WCAG 2.2 accessibility, and UX copywriting. Use when designing user flows, interaction patterns, or evaluating UI usability.
---

# UX Patterns

Behavioural design layer — sits between visual design (`enterprise-ui-design`) and code (`react-web` / `react-native-mobile`). Covers how things **work**, not how they **look**.

## Boundary — Which Skill Owns What?

| Skill | Concern |
|-------|---------|
| `enterprise-ui-design` | **Visual**: colours, typography, spacing, icons, border-radius, shadows |
| **`ux-patterns`** (this) | **Behavioural**: interaction flows, loading/empty/error states, accessibility, UX copy, platform conventions |
| `react-web` / `react-native-mobile` | **Code**: implementation of both layers |

When you ask "what colour should this button be?" → `enterprise-ui-design`. When you ask "what should the button label say and what happens after click?" → this skill.

## Reference Table — Load What You Need

| Domain | Reference | When to Load |
|--------|-----------|--------------|
| Navigation | `references/navigation.md` | Top nav, sidebar, tabs, breadcrumbs, ⌘K, search, mega menus |
| Interaction | `references/interaction.md` | Progressive disclosure, optimistic updates, inline edit vs modal, drag-and-drop, keyboard shortcuts |
| Forms | `references/forms.md` | Layout, inline validation, multi-step wizards, auto-save, undo, submit states |
| States | `references/states.md` | Loading, empty, error, no-results, ideal, edge cases |
| Mobile | `references/mobile.md` | Touch targets, thumb zones, gestures, sheets vs modals, safe areas, haptics |
| Accessibility | `references/accessibility.md` | WCAG 2.2 AA, focus management, ARIA, screen readers, keyboard nav, reduced motion |
| Copywriting | `references/copywriting.md` | Button labels, error messages, empty states, confirmations, tone |

## Decision Matrix — Common Tradeoffs

| Decision | Choose A when... | Choose B when... |
|----------|-----------------|------------------|
| **Infinite scroll** vs **Pagination** | Content is discovery/feed (social, news). User browses casually. | User needs to find specific items (search results, tables). User needs to know position and total count. |
| **Skeleton** vs **Spinner** | Page/section load ≤2s. Layout is known in advance. Reduces perceived wait. | Initial app load. Simple action feedback (save, submit). Layout is unpredictable. |
| **Sheet** vs **Modal** | Task is part of current flow (filters, compose). Mobile-first. Non-blocking. | Critical decision (delete, confirm). Requires full user attention. Complex forms needing focus. |
| **Inline edit** vs **Edit modal** | Single-field change. User stays in context without losing scroll position. | Multi-field form. Validation-heavy. Preview needed before saving. |

## Design Review Checklist

Use `assets/ux-checklist.json` — a 34-item structured checklist across all 7 domains. Run before shipping any UI change. Quick highlights:

1. **Navigation** — Every page reachable in ≤3 clicks? Current location always visible?
2. **Interaction** — Destructive actions have undo? Loading states for all async operations?
3. **Forms** — Validation on blur? Errors next to the offending field?
4. **States** — Every screen designed for loading, empty, error, and ideal states?
5. **Mobile** — Touch targets ≥44×44px? Layout works at 320px wide?
6. **Accessibility** — Keyboard-navigable? Passes WCAG 2.2 AA?
7. **Copywriting** — Button labels predict outcome? Error messages say what to do next?

## How to Use This Skill

1. **Designing a new flow**: Start with `navigation.md` → `forms.md` → `states.md` → `copywriting.md`
2. **Auditing existing UI**: Run `ux-checklist.json`. Flagged items → load the relevant reference for fix patterns.
3. **Mobile**: Always cross-reference `mobile.md` even for responsive web. Start mobile-first.
4. **Accessibility**: `accessibility.md` is non-negotiable. Apply its checklist to every screen.

## Resources

- `references/` — 7 domain reference files. Load the one matching your task.
- `assets/ux-checklist.json` — 34-item structured design review checklist across all categories.
