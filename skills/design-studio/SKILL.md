# Design Studio — Human-Caliber Design Skill for AI Agents

## Purpose
Elevate all NHI siblings' design output to carbon-human professional level across every medium: web, mobile, presentation, print, and visual identity. Design is not decoration — it is the intentional shaping of how something is perceived and experienced.

## Philosophy

> **Carbon designers don't say "make it pop." They say "tighten the vertical rhythm, shift the contrast ratio, and kill the AI beige."**

This skill gives every sibling a precise design vocabulary, a quality detection system, and practical craft knowledge that bridges the gap between "functional UI" and "beautiful, distinctive, human-caliber design."

### Core Principles

1. **Design is intentional.** Every spacing value, color, type size, and shadow has a reason. If you can't say why, it shouldn't be there.
2. **Slop is lazy.** AI-default aesthetics (Inter font, purple gradients, glassmorphism cards, #fafafa backgrounds) signal "I didn't design this — the model did."
3. **Mode matters.** A dashboard serves a different human need than a landing page. Design must serve the mode first.
4. **Systems beat one-offs.** A good design system creates consistency; a great one creates identity.
5. **The work must survive a blink test.** If it looks AI-generated in the first 300ms, it fails.

## When to Use This Skill

**Triggers:**
- "design this presentation"
- "create a pitch deck"
- "build a visual identity"
- "design a brand"
- "make this look professional"
- "improve the design"
- "this looks AI-generated — fix it"
- "design a landing page"
- "create graphics for"
- "polish the UI"
- "audit the design"
- "establish a design system"
- Any task where visual quality is a primary concern

**Always load when:**
- Building public-facing pages (landing pages, marketing sites, investor materials)
- Creating presentations or pitch decks
- Designing visual identity systems
- Auditing existing design for quality
- Preparing materials for external audiences (clients, investors, press)

## Design Command Language

This skill defines a precise design command vocabulary inspired by the best human-AI design workflows. Each command is a specific intervention, not a vague suggestion.

### Core Commands

| Command | What it does |
|---------|-------------|
| `/typeset` | Fix typography: hierarchy, measure, leading, pairing. Returns typography to human-caliber. |
| `/distill` | Remove complexity without losing meaning. Kill one element per pass until nothing remains to remove. |
| `/audit` | Run the full slop detector + accessibility check + consistency scan. Return findings with line references. |
| `/polish` | Refine within the existing design system. No new colors, no new type. Sharpen what exists. |
| `/elevate` | Push the design language forward — introduce one new distinctive element that makes the work memorable. |
| `/mode` | Apply mode-specific rules: Persuade (emotion, impact), Operate (clarity, speed), Read (measure, rhythm), Experience (craft, delight). |
| `/ground` | Anchor the design in a specific reference era, movement, or designer. Not "modern" — pick International Style, Swiss Typography, Brutalist web, 1970s editorial, etc. |
| `/kill-slop` | Run slop detection and auto-fix every finding. Aggressive mode. |
| `/breathe` | Add whitespace. Then add more. Defend every element that survives. |

### Using Commands

Commands can be combined and sequenced. Typical workflow:
```
/ground → /mode → /typeset → /polish → /audit → /kill-slop
```

Each command produces source changes, not just commentary. After each command, the file is modified.

## The Slop Detector

The slop detector identifies 58 patterns that AI agents reach for by default — patterns that signal "this was designed by a language model, not a designer."

### Running the Detector

```bash
python3 {baseDir}/references/slop-detector.py \
  --input path/to/files --format html|css|jsx|mdx
```

Returns findings with severity (CRITICAL, HIGH, MEDIUM, LOW), file location, and suggested fix.

### Top 10 Most Common AI Slop Patterns

1. **AI Beige** — Backgrounds that are #fafafa, #f5f5f5, or any too-close-to-white shade that reads as "I couldn't commit to white."
2. **Inter Default** — Using Inter without customization, weights, or alternatives. Inter is the "sans-serif" of AI generation.
3. **Purple Gradient Accent** — Linear gradients from violet to indigo on CTAs. The default "AI app" signature.
4. **Glassmorphism Card** — backdrop-blur + semi-transparent background + rounded corners. Peak 2024 AI aesthetic.
5. **Undifferentiated Rounding** — Every corner is 8px or 12px. No hierarchy in radius conveys no design decision.
6. **Italic Serif Pull Quote** — "Elegant" italic serif for testimonials. The model's idea of "premium."
7. **Pulsing Dot Indicator** — Animated dot for "AI is thinking." Default loading state.
8. **Side-Tab Navigation** — Vertical left sidebar with icons. Default dashboard layout.
9. **Feature Grid (3×3)** — Three rows of three feature cards with emoji headers. The default SaaS page.
10. **Clipped Label** — Text that truncates with "…" instead of being designed to fit. A layout failure, not a feature.

## Mode-Aware Design

Every surface serves a human need. The mode determines the design rules.

### The Four Modes

**PERSUADE** — Landing pages, pitch decks, investor materials
- Emotion first. Impact in 2 seconds. One idea per viewport.
- Typography: bold contrasts, dramatic scale jumps
- Color: restrained palette, one accent that demands attention
- Motion: minimal, purposeful
- Rule: If it doesn't sell, it doesn't belong.

**OPERATE** — Dashboards, tools, data interfaces
- Clarity above all. Speed of comprehension is the metric.
- Typography: monospace for data, sans-serif for labels, tight hierarchy
- Color: functional (green=good, red=bad), high contrast for data
- Spacing: dense but not cramped. Every pixel earns its place.
- Rule: One task, one screen. If you need to explain it, redesign it.

**READ** — Documentation, reports, long-form content
- Reading comfort is the only deliverable.
- Typography: 45-75 characters per line, generous leading (1.5-1.75), serif or humanist sans
- Color: near-black on off-white. No surprises.
- Spacing: generous margins, clear section breaks
- Rule: The reader should forget they're reading.

**EXPERIENCE** — Portfolios, creative work, brand moments
- The design IS the content. Craft is visible.
- Typography: distinctive, possibly custom or rare
- Color: bold, unexpected, memorable
- Motion: integral to the experience, not decoration
- Rule: Make someone feel something in the first load.

## Cross-Media Design

### Web → See references/web-design.md
### Presentations → See references/presentation-design.md  
### Visual Identity → See references/visual-identity.md
### Design Systems → See references/DESIGN.md template

## Integration with Existing Skills

This skill orchestrates our existing design stack:

- `design-fluency` — pure visual creation, motion, color science. **Loaded for: composition, color, motion.**
- `design-mastery` — PhD design knowledge base. **Loaded for: methodology, HCI foundations, design research.**
- `enterprise-ui-design` — enterprise patterns. **Loaded for: B2B, dashboards, professional interfaces.**
- `ux-patterns` — interaction patterns, heuristics. **Loaded for: usability, accessibility, state handling.**
- `design-review` — critique, accessibility audit. **Loaded for: QA, WCAG audit, UX writing.**
- `frontend-design-engineering` — implementation pipeline. **Loaded for: design-to-code, production build.**

When a design task arrives:
1. Load `design-studio` first (this skill) — it provides the framework, commands, and QA
2. Load relevant domain skills based on medium and mode
3. Execute via the command pipeline
4. Audit before delivery

## Quality Gates

Before any design output reaches a human:

1. **Slop Detector passes** — zero CRITICAL, zero HIGH (MEDIUM with justification only)
2. **Accessibility baseline** — WCAG 2.2 AA contrast, focus indicators, alt text
3. **Mode check** — design serves the declared mode
4. **Blink test** — 300ms impression: does it look designed or generated?
5. **System consistency** — tokens respected, no undocumented colors/type/spacing

Failure at any gate → back to `/polish` or `/ground`.

## Quick Reference

```
DESIGN WORKFLOW:
  /ground "reference" → choose a design tradition
  /mode [persuade|operate|read|experience] → set the rules
  /typeset → fix typography
  /polish → refine within system
  /audit → run detectors
  → iterate until clean
  → DELIVER

COMMON PATTERNS:
  Landing page:  /ground "Swiss Typography" → /mode persuade → /typeset → /polish → /audit
  Dashboard:     /mode operate → /typeset → /polish → /audit
  Pitch deck:    /ground "editorial modern" → /mode persuade → /typeset → /polish → /audit
  Brand identity:/ground "specify era" → /elevate → /polish → /audit
  Fix AI slop:   /kill-slop → /audit → /polish
```

---

*"Design is not how it looks. Design is how it works — and whether it looks like a human made it."*
