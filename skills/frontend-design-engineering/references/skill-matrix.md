# Skill Matrix — When to Invoke Which Skill

## Quick Lookup by Task

| What you're doing | Primary skill | Secondary skills | Notes |
|------------------|--------------|------------------|-------|
| Pick colors for a dashboard | `enterprise-ui-design` | — | Load `references/color.md` |
| Design a multi-step form | `ux-patterns` | `enterprise-ui-design` (visual styling of form elements) | Load `references/forms.md`, `references/states.md` |
| Build a landing page | `react-web` | `enterprise-ui-design` (styling), `ux-patterns` (CTA flow, copy) | Start with HTML artifact plan |
| Implement Figma mockup | `figma` → `react-web` | `enterprise-ui-design` (normalize tokens), `ux-patterns` (validate flows) | Extract first, then build |
| Create a design system | `enterprise-ui-design` | `ux-patterns` (component behavior specs) | Output: token file + component library spec |
| Mobile app from scratch | `enterprise-ui-design` → `ux-patterns` → `react-native-mobile` | — | Follow unified workflow |
| Add dark mode | `enterprise-ui-design` | `react-web` or `react-native-mobile` | Color tokens only — same UX, different palette |
| Fix accessibility issues | `ux-patterns` | `react-web` or `react-native-mobile` (implement fixes) | Load `references/accessibility.md` |
| Design navigation structure | `ux-patterns` | — | Load `references/navigation.md` |
| Write button labels / error messages | `ux-patterns` | — | Load `references/copywriting.md` |
| Setup Next.js + shadcn project | `react-web` | `context7` (for latest docs) | Run init scripts |
| Add AI chat to app | `react-web` | `context7` (Vercel AI SDK docs) | Load `references/ai-integration.md` |
| Build offline-first mobile app | `react-native-mobile` | `ux-patterns` (offline states, sync UX) | — |
| Design-to-code pipeline | `figma` → `enterprise-ui-design` → `ux-patterns` → `react-web` | — | Full unified workflow |

## Skill Boundaries — Who Owns What

### enterprise-ui-design owns:
- Color palettes, scales, and tokens
- Typography (font family, scale, weight, line-height)
- Spacing system (4px base grid)
- Icon selection and style (Lucide, custom SVG, 24x24, 2px stroke)
- Border radius, shadows, borders
- Component visual patterns (card, button, input, modal styles)
- Light/dark mode color mapping
- Visual hierarchy (weight, size, spacing — not color)

### ux-patterns owns:
- Navigation architecture (top nav, sidebar, tabs, breadcrumbs, search)
- Interaction patterns (progressive disclosure, optimistic updates, undo)
- Form design (layout, validation, multi-step, auto-save)
- State design (loading skeletons, empty states, error recovery)
- Mobile UX (touch targets, thumb zones, gestures, safe areas)
- Accessibility (WCAG 2.2 AA, keyboard nav, screen readers, focus)
- UX copywriting (button labels, error messages, empty states, tone)
- Platform conventions (web vs iOS vs Android patterns)

### react-web owns:
- Project scaffolding (Next.js 15, Tailwind v4, shadcn/ui)
- Server Components vs Client Components decisions
- Data fetching patterns (Server Actions, TanStack Query)
- Authentication (Auth.js v5)
- AI integration (Vercel AI SDK, streaming)
- HTML artifact workflows
- Build and deployment

### react-native-mobile owns:
- Expo project scaffolding (SDK 52+)
- NativeWind styling
- Expo Router navigation
- EAS build and submit
- Offline-first data
- Push notifications
- Platform-specific adaptations

### figma owns:
- Design data extraction (component tree, styles, layout, assets)
- Frame/pages listing
- NOT design decisions — it provides raw data for the design layer

## Overlap Resolution

When two skills could apply:

| Conflict | Resolution |
|----------|-----------|
| "Style this button" (visual vs code) | `enterprise-ui-design` for the spec → `react-web` for the implementation |
| "Make this form better" (visual vs UX) | `ux-patterns` first (behavior) → `enterprise-ui-design` (visual polish) |
| "This page feels off" (UX vs visual) | `ux-patterns` first (diagnose behavior) → `enterprise-ui-design` if it's visual |
| "Build this screen" (code vs UX) | `ux-patterns` first (design all states) → `react-web` (implement) |
