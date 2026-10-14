# Quality Gates — Per-Phase Checklist

Run these at the boundary of each phase. Do not proceed to the next phase until the current gate passes.

---

## Phase 1 Gate: Design Foundation

### Visual System
- [ ] Design tokens defined: colors (10-shade scales), typography (4-5 sizes), spacing (4px base), border-radius, shadows
- [ ] Single accent color chosen with semantic purpose
- [ ] Neutral palette covers all UI needs (background, surface, border, text primary/secondary/disabled)
- [ ] Color contrast meets WCAG AA (4.5:1 small text, 3:1 large text)
- [ ] Typography: max 2 font families, consistent scale, sentence case for UI text
- [ ] Icons: single library (Lucide), 24x24 base, 2px stroke, consistent sizing

### Component Primitives
- [ ] Button variants defined: primary, secondary, ghost, destructive + sizes
- [ ] Input variants: text, select, textarea, checkbox, radio, toggle
- [ ] Card, modal, sheet, dialog patterns defined
- [ ] Table/list patterns defined
- [ ] Navigation component styles defined (header, sidebar, tabs)
- [ ] Empty, loading, error state visual patterns defined

### Consistency
- [ ] Same element type uses same border-radius everywhere
- [ ] Shadows used sparingly and consistently (elevation system)
- [ ] Borders and shadows never on same element
- [ ] No emojis in UI — SVG icons only

### Token Output
- [ ] Design tokens ready to translate to Tailwind `@theme` or CSS custom properties
- [ ] Token naming follows convention: `color-surface-primary`, `space-md`, `text-lg`, etc.

---

## Phase 2 Gate: UX Architecture

### Screen Completeness
- [ ] Every screen designed for ideal state
- [ ] Every screen designed for loading state (skeleton or spinner)
- [ ] Every screen designed for empty state (helpful, not dead)
- [ ] Every screen designed for error state (clear, recoverable)
- [ ] Edge cases documented (long text, many items, no permission, offline)

### Navigation
- [ ] Every page reachable in ≤ 3 clicks/taps
- [ ] Current location always visible (breadcrumb, active nav, page title)
- [ ] Back button works predictably (web: browser back, mobile: gesture + button)
- [ ] Deep linking supported for shareable URLs

### Forms
- [ ] Validation on blur (not just on submit)
- [ ] Errors displayed next to the offending field
- [ ] Submit button disabled during submission
- [ ] Success feedback (toast, inline, redirect)
- [ ] Multi-step forms: progress indicator, can go back, data preserved
- [ ] Auto-save for long forms when possible

### Accessibility (WCAG 2.2 AA)
- [ ] All interactive elements keyboard-navigable (Tab, Enter, Escape, arrows)
- [ ] Focus visible (visible focus ring, logical tab order)
- [ ] No focus traps (except modals — Escape closes)
- [ ] All images have alt text (decorative: empty alt)
- [ ] Form inputs have labels (not placeholder-only)
- [ ] Color never sole conveyor of meaning
- [ ] Screen reader structure: landmark regions, heading hierarchy
- [ ] `prefers-reduced-motion` respected
- [ ] Touch targets ≥ 44×44px on mobile

### Copywriting
- [ ] Button labels predict outcome ("Save changes" not "OK")
- [ ] Error messages explain what happened + what to do next
- [ ] Empty states explain what belongs here + CTA if applicable
- [ ] Confirmations describe what just happened
- [ ] Tone consistent (professional, not robotic; warm, not cutesy)

### Mobile (if applicable)
- [ ] Layout works at 320px width
- [ ] Touch targets ≥ 44×44px
- [ ] Thumb zone considered for primary actions (bottom of screen)
- [ ] Safe areas respected (notch, home indicator)
- [ ] Gestures have fallback buttons

---

## Phase 3 Gate: Implementation

### Design Fidelity
- [ ] Design tokens faithfully translated to Tailwind/CSS
- [ ] Component library matches design specs (spacing, colors, typography, radius)
- [ ] No hardcoded values — all styling uses design tokens
- [ ] Visual comparison: implementation vs design — no obvious drift

### State Implementation
- [ ] Loading state implemented for every async view
- [ ] Empty state implemented for every list/table/feed
- [ ] Error state implemented with recovery action
- [ ] Edge cases from Phase 2 handled

### Code Quality
- [ ] TypeScript strict mode, no `any` without documented justification
- [ ] Components follow project conventions (Server/Client boundary clear)
- [ ] No unused imports, dead code, or console.log
- [ ] Responsive: tested at 320px, 768px, 1024px, 1440px
- [ ] No layout shift on load (CLS < 0.1)

### Accessibility in Code
- [ ] Semantic HTML: `<nav>`, `<main>`, `<header>`, `<button>`, `<form>`
- [ ] ARIA labels where needed (not where redundant with semantic HTML)
- [ ] Focus management: modals trap focus, route changes move focus to heading
- [ ] `alt` text on all images
- [ ] Form controls have associated `<label>` elements

### Mobile Implementation (if applicable)
- [ ] Viewport meta tag correct
- [ ] Touch targets hit 44×44px minimum
- [ ] No horizontal overflow at 320px
- [ ] Safe area padding for notched devices

---

## Phase 4 Gate: Cross-Layer QA

### Visual → UX Consistency
- [ ] Do visual hierarchy decisions match UX priority? (Primary action = most visually prominent)
- [ ] Do color meanings match behavior? (Red = destructive, not decorative)
- [ ] Is loading state visual style consistent across the app?

### UX → Code Consistency
- [ ] Do implemented interactions match UX spec? (validation timing, navigation behavior)
- [ ] Are all UX states actually reachable in code? (Can empty state be triggered?)
- [ ] Does keyboard navigation match UX spec?

### End-to-End
- [ ] Full user journey: can a new user complete the primary task without help?
- [ ] Error recovery: can user recover from common errors (network loss, validation failure)?
- [ ] Performance: LCP < 2.5s, INP < 200ms, CLS < 0.1
- [ ] Cross-browser: tested in Chrome, Firefox, Safari
- [ ] Cross-device: tested on phone, tablet, desktop

### Ship Decision
- [ ] All critical bugs fixed
- [ ] All gates Phase 1-3 passed
- [ ] Known issues documented
- [ ] Ready for user testing or production
