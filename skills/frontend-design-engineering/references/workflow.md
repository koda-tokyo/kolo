# Detailed Workflows — End-to-End Examples

## Workflow A: New Product from Scratch

**Scenario:** "Build a patient dashboard for KODA KENKŌ"

### Phase 0 — Scoping
- Platform: Web (desktop-first, responsive)
- Design source: None (start from scratch)
- Key screens: Login, patient list, patient detail, analytics overview
- Users: Doctors, administrators
- Compliance: MHLW data residency, WCAG 2.2 AA

### Phase 1 — Design Foundation
1. Load `enterprise-ui-design`
2. Load `references/color.md` → Choose medical-appropriate palette (blue accent, neutral grays)
3. Load `references/typography.md` → Inter for UI, system font stack for data
4. Load `references/spacing.md` → Dense layout for data-heavy screens
5. Load `references/icons.md` → Lucide medical icons (stethoscope, heartbeat, user, calendar)
6. Load `references/components.md` → Define: data table, stat card, patient avatar, status badge
7. Output: `design-tokens.css` with all tokens

### Phase 2 — UX Architecture
1. Load `ux-patterns`
2. Load `references/navigation.md` → Sidebar (patient list, analytics, settings) + top bar (search, profile)
3. Load `references/states.md` → Every screen: ideal, skeleton loading, empty patient list, error (API down)
4. Load `references/accessibility.md` → High contrast data, keyboard-navigable tables, screen reader labels
5. Load `assets/ux-checklist.json` → Run full 34-item checklist
6. Output: Screen map, state matrix, UX spec per screen

### Phase 3 — Implementation
1. Load `react-web`
2. Scaffold: `npx create-next-app@latest acme-dashboard --typescript --tailwind --app --src-dir`
3. Init shadcn: `npx shadcn@latest init -d`
4. Install design tokens as Tailwind `@theme`
5. Build component library matching design specs
6. Implement each screen with all 4 states
7. Add Auth.js v5 for doctor/admin auth
8. Add data tables with sorting, filtering, pagination

### Phase 4 — QA
Run all Phase 4 gates. Test with real doctors if possible.

---

## Workflow B: Figma Design → Production

**Scenario:** "Implement this Figma design" (Figma URL provided)

### Phase 0 — Scoping
- Platform: Determined from Figma (web, mobile, or both)
- Design source: Figma file URL
- Scope: Screens visible in the provided frame

### Phase 1 — Extract & Normalize
1. Load `figma` skill
2. Run: `python3 figma.py context "<figma-url>"`
3. Extract: frame dimensions, colors, typography, spacing, component tree
4. **Normalize:** Raw Figma values → design tokens
   - Figma colors → 10-shade scales
   - Figma text styles → typography scale
   - Figma spacing → 4px grid tokens
   - Figma components → component pattern library
5. Load `enterprise-ui-design` → Validate translation against design principles
6. Output: Design token file derived from Figma

### Phase 2 — Validate UX
1. Load `ux-patterns`
2. Review Figma screens for state coverage
3. **Gap fill:** Figma usually shows ideal state only. Design loading, empty, error states
4. Add accessibility annotations to Figma-sourced screens
5. Write UX copy for all states
6. Run `ux-checklist.json`

### Phase 3 — Implementation
Same as Workflow A, Phase 3. Build from normalized tokens, not raw Figma values.

### Phase 4 — Visual QA
1. Compare implementation screenshots against Figma frames
2. Check: colors, spacing, typography, border-radius, shadows
3. Pixel-level accuracy for key screens
4. Run cross-layer QA gates

---

## Workflow C: Redesign Existing App

**Scenario:** "Redesign the KoLo dashboard — it looks dated"

### Phase 0 — Scoping
- Audit current app: what screens exist? What works? What doesn't?
- Define scope: full redesign or specific screens?
- Preserve: data structures, API contracts, auth

### Phase 1 — Visual Refresh
1. Load `enterprise-ui-design`
2. Audit current visual system: what tokens exist? What's inconsistent?
3. Design new visual system: modern palette, cleaner typography, consistent spacing
4. Map old → new tokens (migration plan)

### Phase 2 — UX Improvements
1. Load `ux-patterns`
2. Audit current UX: pain points, missing states, accessibility gaps
3. Design improved flows while preserving existing mental model
4. Prioritize: fix biggest pain points first

### Phase 3 — Incremental Implementation
1. Update design tokens in code (old → new mapping)
2. Refactor components one by one (most used first)
3. Keep old and new co-existing during transition (feature flags or route-based)
4. Add missing states from Phase 2

### Phase 4 — Regression QA
1. Visual regression testing: screenshot comparison old vs new
2. Functional regression: all existing features still work
3. User testing: is the redesign actually better?

---

## Workflow D: Mobile App

**Scenario:** "Build a KODA KENKŌ mobile app for doctors"

### Phase 1 — Design (Mobile-First)
1. Load `enterprise-ui-design`
2. Design for mobile viewport first (375px base)
3. Larger touch targets (48px minimum recommended for medical)
4. Simplified navigation (bottom tabs, not sidebar)

### Phase 2 — Mobile UX
1. Load `ux-patterns/references/mobile.md`
2. Bottom tab bar (3-5 items max)
3. Thumb-zone primary actions
4. Swipe gestures for common actions
5. Haptic feedback for critical actions
6. Offline-first design (hospital WiFi is unreliable)
7. Load `ux-patterns/references/accessibility.md` — mobile screen reader testing

### Phase 3 — Implementation
1. Load `react-native-mobile`
2. Scaffold with Expo SDK 52+
3. NativeWind for Tailwind-compatible styling
4. Expo Router for file-based routing
5. Implement offline storage (WatermelonDB or SQLite)
6. Push notifications for urgent results
7. EAS for build and submit

### Phase 4 — Mobile QA
1. Test on real devices (iOS + Android)
2. Test offline → online transitions
3. Test push notifications
4. Test battery impact
5. App Store / Google Play review readiness
