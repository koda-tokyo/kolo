---
name: design-review
description: "Structured design critique, UX writing, accessibility auditing, and research synthesis for UI review workflows. Use when reviewing mockups, auditing accessibility (WCAG 2.2 AA), writing microcopy/UX copy, synthesizing user research, preparing design specs for dev handoff, or conducting heuristic evaluations. Triggers: design review, design critique, UX audit, accessibility audit, WCAG audit, microcopy, UX writing, design handoff, heuristic evaluation, design QA, UI review."
---

# Design Review

Structured design review workflows: critique, accessibility, UX writing, research synthesis, and dev handoff. Use for any UI evaluation task where quality, consistency, and accessibility matter.

## When to Use

- **Design critique** — Review a mockup, screen, or component for usability, consistency, and visual quality
- **Accessibility audit** — Audit against WCAG 2.2 AA (or specific standard)
- **UX writing** — Write or review microcopy, error states, empty states, CTAs
- **Research synthesis** — Synthesize user interviews, feedback, or testing into actionable insights
- **Dev handoff** — Prepare design specs, redlines, or component documentation for engineering

## Workflows

### Design Critique

Systematic review of any UI against heuristics and design-system consistency.

**Process:**
1. **First pass — silent scan.** Look at the whole screen. What grabs attention? What feels off? Note first impressions before analysis.
2. **Heuristic audit.** Run against these (from Nielsen/Norman + extensions):
   - Visibility of system status
   - Match between system and real world
   - User control and freedom
   - Consistency and standards (design system compliance)
   - Error prevention
   - Recognition rather than recall
   - Flexibility and efficiency of use
   - Aesthetic and minimalist design
   - Help users recognize, diagnose, and recover from errors
   - Help and documentation
3. **Design-system check.** Spacing, typography scale, color tokens, component variants — are they from the system or one-off?
4. **Comparative scan.** If competitors exist: what do they do better? What do we do better?
5. **Prioritize findings.** Critical (blocks ship) → Major (degrades experience) → Minor (polish) → Nice-to-have

**Output format:**
```
## Design Critique: [screen/component name]

### First Impressions
[2-3 sentences — what lands immediately]

### Findings
| # | Severity | Heuristic | Finding | Recommendation |
|---|----------|-----------|---------|----------------|
| 1 | 🔴 Critical | Consistency | Button variant mismatch | Use `btn-primary` from system |
| 2 | 🟡 Major | Error prevention | No confirmation on delete | Add confirm dialog |
| 3 | 🔵 Minor | Aesthetic | Spacing inconsistent below fold | Apply 8px grid |

### What's Working
[Call out 2-3 things that are done well — critique is not just problems]
```

### Accessibility Audit

Audit against WCAG 2.2 AA. For Japanese-language UIs, add JIS X 8341 considerations.

**Process:**
1. **Color & contrast** — All text/UI elements ≥ 4.5:1 (normal), ≥ 3:1 (large). Check all states (hover, focus, disabled, error).
2. **Keyboard navigation** — Tab order logical, focus visible, no keyboard traps, skip links present.
3. **Screen reader** — Semantic HTML, ARIA labels where needed, alt text on images, landmarks defined.
4. **Forms** — Labels associated, error messages clear and linked, required fields indicated beyond color.
5. **Typography & readability** — Minimum 16px body, line-height ≥ 1.5, max line length ≤ 80ch, zoom to 200% without loss.
6. **Motion & timing** — Respect `prefers-reduced-motion`, no content that flashes >3x/second, timeouts with warning.
7. **Touch targets** — ≥ 44×44px (AAA: 48×48px), adequate spacing between tappable elements.

**Japanese-specific (JIS X 8341):**
- Furigana/ruby where needed for difficult kanji
- Font choice supports Japanese character rendering (no Chinese fallback glyphs)
- Vertical text considerations if applicable
- 敬語 level consistent and appropriate for audience

**Output format:**
```
## Accessibility Audit: [screen/component]

### WCAG 2.2 AA Compliance
| # | Criterion | Level | Status | Issue | Fix |
|---|-----------|-------|--------|-------|-----|
| 1 | 1.4.3 Contrast | AA | ❌ | Gray text #999 on white = 2.8:1 | Use #767676 or darker |
| 2 | 2.4.7 Focus Visible | AA | ❌ | Focus ring missing on nav items | Add :focus-visible outline |
| 3 | 1.3.1 Info & Relationships | A | ✅ | Form labels properly associated | — |

### Summary
- Passed: 12/15 criteria
- Failed: 3 (2 AA, 1 A)
- Blockers: 0
```

### UX Writing

Write or review microcopy — the small words that guide, reassure, and convert.

**Process:**
1. **Audit existing copy.** Map every text element: CTAs, labels, errors, empty states, tooltips, confirmation messages.
2. **Evaluate against principles:**
   - **Clear > clever.** User understands immediately.
   - **Specific > generic.** "Upload your referral letter" not "Upload file."
   - **Active > passive.** "We couldn't verify your address" not "Address verification was unsuccessful."
   - **Helpful > blaming.** "Enter your 患者ID (10 digits)" not "Invalid input."
   - **Consistent.** Same term for same thing everywhere.
3. **State coverage.** Every UI state has copy: loading, empty, error, success, edge case.
4. **Tone calibration.** Match the context — medical UI is reassuring not playful; dev tools are direct not apologetic.

**States to cover:**
| State | Question to answer |
|-------|-------------------|
| Empty (first use) | What goes here? Why should they care? |
| Empty (no results) | Why is it empty? What do they do next? |
| Loading | What's happening? How long? |
| Error (system) | What failed? Is it their fault? What now? |
| Error (validation) | What's wrong? How do they fix it? |
| Success | Did it work? What just happened? What's next? |
| Confirmation | Are they sure? What are the consequences? |
| Edge case | Rare but real — handled gracefully |

### Research Synthesis

Synthesize raw user research into actionable insights for design and product decisions.

**Process:**
1. **Gather inputs.** Interview transcripts, usability test recordings, survey results, support tickets, analytics.
2. **Extract observations.** Atomic facts: "User X did Y in context Z."
3. **Cluster into themes.** Group observations by pattern, not by source.
4. **Rank by impact.** Frequency × severity × strategic alignment.
5. **Formulate insights.** Not just "users struggle with X" but "users struggle with X because their mental model is Y, which suggests Z solution."
6. **Recommend actions.** Specific, prioritized, owner-assignable.

**Output format:**
```
## Research Synthesis: [study/topic]

### Top Insights
1. **[Insight headline]** — [1-paragraph: what, why, evidence, implication]

### Theme Map
| Theme | Observations | Impact | Recommendation |
|-------|-------------|--------|----------------|
| Navigation confusion | 7/12 users couldn't find settings | 🔴 High | Move settings to persistent sidebar |

### Action Items
| # | Action | Owner | Priority | Evidence |
|---|--------|-------|----------|----------|
| 1 | Redesign settings access | Design | P0 | 7/12 users failed task |
```

### Dev Handoff

Prepare design specs for engineering handoff. Reduce back-and-forth.

**Spec checklist:**
- [ ] Component tree with variant names (match code components, not design-only names)
- [ ] Responsive behavior per breakpoint
- [ ] States documented: default, hover, focus, active, disabled, loading, error, empty
- [ ] Animation/transition specs (duration, easing, property)
- [ ] Edge cases: long text, missing data, RTL (if supported), zoom, keyboard
- [ ] Accessibility annotations: headings, landmarks, labels, focus order
- [ ] Design tokens referenced (not hardcoded values)
- [ ] Assets exported (icons SVG, images WebP @2x, fonts)
- [ ] Known design debt or intentional deviations from system

**Handoff document template:**
```
## Handoff: [Feature/Component]

### Component Inventory
| Component | Variant | States | Notes |
|-----------|---------|--------|-------|

### Responsive Behavior
| Breakpoint | Layout Change |
|------------|---------------|

### Accessibility Notes
[Landmarks, heading hierarchy, focus order, ARIA]

### Design Tokens Used
[Colors, spacing, typography, shadows — reference, don't copy]

### Open Questions
[Anything unresolved — flag, don't guess]
```

## Principles

1. **Critique the work, not the worker.** "This button lacks contrast" not "you chose bad colors."
2. **Every problem gets a recommendation.** Findings without fixes are complaints.
3. **Call out what's working.** Critique that's only negative trains people to avoid review.
4. **Severity over volume.** 3 critical findings > 30 minor nits.
5. **Context matters.** A medical UI has different standards than a marketing landing page.
6. **Specify don't assume.** "Use the secondary button variant" not "make it less prominent."
