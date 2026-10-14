---
name: product-management
description: Product management OS for KodaSōken — product strategy, roadmap, user research, feature prioritization, competitive analysis, and stakeholder communication. Use when working on product strategy decisions, roadmap planning, feature scoping, user research design, competitive landscape analysis, or any PM task in the Japanese healthcare AI / KODA KENKŌ context. Startup PM style (lightweight, outcome-focused), not big-tech.
---

# Product Management OS

Product management operating system for KodaSōken. Covers the full PM lifecycle:
product strategy → discovery → prioritization → delivery → stakeholder communication.
Designed for a startup building in Japanese healthcare AI — lightweight, practical,
bias toward action.

## Decision Tree

When faced with a PM question, walk this tree to find the right reference:

```
PM QUESTION RECEIVED
│
├─ "What should we build?" / "Where are we going?"
│   └─ → product-strategy.md (vision, PMF, make vs buy, platform vs point)
│
├─ "When will it ship?" / "What comes next?"
│   └─ → roadmap-planning.md (now/next/later, OKR alignment, themes)
│
├─ "What do users actually need?" / "Are we building the right thing?"
│   └─ → user-research.md (interviews, JTBD, personas, JP healthcare specifics)
│
├─ "Which feature should we do first?" / "Help me prioritize"
│   └─ → feature-prioritization.md (RICE, Kano, opportunity-solution trees, cost of delay)
│
├─ "What is competitor X doing?" / "How do we position against Y?"
│   └─ → competitive-analysis.md (landscape mapping, tear-downs, win/loss)
│
├─ "I need a template" (brief, spec, interview guide, matrix)
│   └─ → assets/pm-toolkit.json
│
└─ "I need to communicate this to stakeholders"
    └─ → SKILL.md section below + roadmap-planning.md (stakeholder comm section)
```

## Hard-Won Lessons (Startup PM in Japanese Healthcare)

1. **Regulation is your roadmap.** PMDA/MHLW timelines and 医師法 constraints are
   not optional — they define what's shippable. Always check the regulatory path
   before committing to features. See: references/product-strategy.md § Regulatory Gates.

2. **Japanese healthcare sales cycles are 6–18 months.** Product decisions made
   today may not hit revenue for a year. Roadmaps must account for this lag.
   See: references/roadmap-planning.md § The Lag Problem.

3. **医師 (physicians) are your hardest users.** They are time-poor, hierarchy-conscious,
   and skeptical of AI. User research design must account for this. Never send a
   survey when a 5-minute 対面 interview with a KOL will give you 10x the signal.
   See: references/user-research.md § Japanese Healthcare Specifics.

4. **Point solutions win in Japan, platforms come later.** Japanese hospitals buy
   point solutions from trusted vendors. Platform plays require a beachhead.
   See: references/product-strategy.md § Platform vs Point Solution.

5. **Prioritization in a startup is about what you kill, not what you build.**
   You will always have more ideas than capacity. Use RICE + cost of delay + a
   "what are we willing to say no to" conversation every cycle.

## Stakeholder Communication Patterns

### Upward (Investors / Board / Papa)
- **What they care about:** Traction signals, revenue path, market defensibility
- **Format:** 1-pager with: top-line metric → what changed → what we learned → what's next
- **Cadence:** Monthly written, ad-hoc when big decisions land
- **Anti-pattern:** Slide decks with no data. Just write it in plain Japanese/English.

### Outward (KOLs / Design Partners / Customers)
- **What they care about:** When they get value, that we're listening
- **Format:** Roadmap snapshot (now/next/later, no dates) + specific ask ("we'd love your input on X")
- **Cadence:** Quarterly for design partners, ad-hoc for KOLs
- **Anti-pattern:** Over-promising dates. Use "now / next / later" always.

### Inward (Engineering / Design / Data Science)
- **What they care about:** Clear problem definition, user context, success criteria
- **Format:** Lightweight feature spec (see assets/pm-toolkit.json) + direct conversation
- **Cadence:** Continuous (standups, planning sessions)
- **Anti-pattern:** Handing off a PRD without context. Bring the user voice.

### Cross-functional (Regulatory / Clinical / Business)
- **What they care about:** Compliance risk, clinical validity, business model fit
- **Format:** Product brief with explicit regulatory/commercial sections
- **Cadence:** Pre-sprint for major features, ad-hoc for compliance gates

## PM Toolkit

See `assets/pm-toolkit.json` for reusable templates:
- Product brief template
- Feature spec template
- Competitive matrix schema
- User interview guide
- Prioritization matrix

## References

Load the relevant reference file based on the decision tree above:

| File | When to Load |
|------|-------------|
| `references/product-strategy.md` | Vision, PMF, make vs buy, platform vs point solution questions |
| `references/roadmap-planning.md` | Roadmap design, OKR alignment, stakeholder roadmaps, when to pivot |
| `references/user-research.md` | Research method selection, interview design, JTBD, JP healthcare specifics |
| `references/feature-prioritization.md` | Scoring frameworks, trade-off decisions, stakeholder negotiation |
| `references/competitive-analysis.md` | Competitive landscape, tear-downs, positioning, win/loss analysis |
