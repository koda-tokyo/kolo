# Roadmap Planning

## Core Philosophy: No Fake Dates

Traditional roadmaps with quarterly date commitments kill startup credibility.
Dates in Japanese healthcare are especially dangerous — regulatory timelines,
hospital procurement cycles, and clinical validation all introduce unpredictable
delays. A date you set in January for "Q3 shipping" will 100% be wrong.

**Use now/next/later format instead.**

## The Now / Next / Later Format

| Column | Meaning | Time Horizon | Detail Level |
|--------|---------|-------------|--------------|
| **Now** | Actively building. In current or next sprint. | 0–6 weeks | High (specs exist) |
| **Next** | Up next. Discovery done, ready to build after Now. | 6 weeks – 3 months | Medium (problem defined) |
| **Later** | On the radar. Worth exploring but not committed. | 3–12 months | Low (outcome or theme) |

**Rules:**
- **Now** is capped at what the team can actually deliver. If Now has 12 items,
  you have a prioritization problem, not a roadmap.
- **Next** items have a clear "definition of ready" — problem validated, regulatory
  path understood, rough sizing done.
- **Later** is intentionally fuzzy. It's a direction, not a promise. Things will
  move in and out of Later as you learn.
- Any stakeholder asking "when exactly?" about a Later item → you haven't communicated
  the format clearly enough. Educate, don't cave.

## Outcome-Based Roadmapping

Don't roadmap features. Roadmap outcomes.

**Bad roadmap item:** "Build patient-facing summary view"
**Good roadmap item:** "Patients understand their consultation results without
physician re-explanation (target: 80% comprehension rate)"

### Outcome to Feature Flow

1. **Define the outcome** — What user/customer behavior change are we driving?
2. **Identify leading indicators** — What can we measure in weeks, not months?
3. **Brainstorm features** — Multiple ways to achieve the outcome
4. **Pick the smallest bet** — Ship the minimum to test the causal link
5. **Measure → Learn → Pivot or Double Down**

**Example for KODA KENKŌ:**
- **Outcome:** Reduce physician documentation time by 30% during consultation
- **Leading indicator:** Number of consultations where auto-generated SOAP note is
  used without post-edit
- **Smallest bet:** Auto-generate 相談内容 section only; measure edit distance
- **If it works:** Expand to full SOAP note; if not, try dictation-first approach

## OKR Alignment

Roadmaps bridge strategy (OKRs) and execution (sprints).

### OKR → Roadmap Mapping

```
Company OKR: Achieve 50 paying clinic contracts by Q4 2026
  │
  ├─ Product KR: 80% pilot-to-paid conversion rate
  │   └─ Roadmap items: Onboarding flow redesign, "aha moment" analytics,
  │       automated usage reports for clinic directors
  │
  ├─ Product KR: NPS > 40 from physician users
  │   └─ Roadmap items: Consultation speed optimization, accuracy improvements,
  │       physician feedback loop
  │
  └─ Product KR: Launch chronic disease management module (3 conditions)
      └─ Roadmap items: Diabetes decision support, hypertension monitoring,
          dyslipidemia guidelines integration
```

**Anti-pattern:** Roadmap items that don't trace to any KR. If you can't draw a
line from a Now item to a current OKR, it's either (a) invisible infrastructure
(which is fine, but label it as such) or (b) pet-project drift.

## Theme-Based Planning

Group roadmap items into themes rather than listing individual features:

**Theme: "Reduce Physician Cognitive Load" (Q2 2026)**
- Auto-draft SOAP note from consultation audio (Now)
- Drug interaction check integrated into prescribing workflow (Now)
- Patient history summary at consultation start (Next)
- Clinical guideline prompts for common presentations (Later)

Themes give teams autonomy on implementation while keeping direction aligned.
They also communicate better to stakeholders than a feature laundry list.

## The Lag Problem (Japanese Healthcare Specific)

In Japanese healthcare, there is a 6–18 month lag between product decision and
revenue impact. Your roadmap must account for this.

### Timeline of a feature that requires clinical validation:
1. **Build** (4–8 weeks) — Feature development
2. **Internal validation** (2–4 weeks) — Clinical team reviews output quality
3. **KOL pilot** (4–12 weeks) — 2–3 design partners test in real consultations
4. **Iterate** (4–8 weeks) — Fix issues, improve accuracy
5. **Ethics/IRB approval** (4–16 weeks) — If research data is involved
6. **PMDA pre-consultation** (8–12 weeks) — If regulatory pathway is unclear
7. **Commercial rollout** (4–8 weeks) — Training, onboarding
8. **Revenue impact** (from contract renewal) — 3–6 months after rollout

**Total:** 25–68 weeks from "let's build this" to "it's generating revenue."

**Implication:** Your roadmap must commit to things now that you won't see revenue
from for 6–12 months. This is why roadmap discipline matters more here than in
consumer SaaS.

## Stakeholder Roadmap Communication

### Internal Team Roadmap
- **Format:** Now/Next/Later on a shared board (Notion/Linear/Figma)
- **Detail:** Now = specs, Next = problem statements with success criteria, Later = themes
- **Cadence:** Review weekly, reprioritize monthly
- **Goal:** Alignment, not micromanagement

### Investor / Board Roadmap
- **Format:** 1-page written narrative + Now/Next/Later summary
- **Detail:** Outcomes, not features. Revenue implications, not technical milestones.
- **Cadence:** Monthly in written form, quarterly live review
- **Goal:** Confidence that we're on track and making smart trade-offs

### Customer / KOL Roadmap
- **Format:** Thematic Now/Next/Later without internal dates or revenue metrics
- **Detail:** "Here's what we're working on, here's what's coming, here's where we're
  going. We'd love your input on Next items."
- **Cadence:** Quarterly
- **Goal:** Build trust, gather input, never over-promise

### The "No" Communication
When a stakeholder asks for something that isn't on the roadmap:
1. **Acknowledge the need** — "That's a real problem, we hear you"
2. **Connect to strategy** — "Right now we're focused on [outcome X] because [reason]"
3. **Put it in Later** — "We'll revisit this when we plan the next cycle"
4. **Never say "no" flatly** — Say "not now, because we're doing Y first"

## When to Change the Roadmap

The roadmap is a hypothesis, not a contract. Change it when:

1. **New data invalidates an assumption** — "We thought physicians wanted X, but
   10/10 interviews said Y" → Reprioritize immediately
2. **A competitor moves** — If a competitor launches a feature that changes the
   market's baseline expectations, reassess
3. **Regulatory change** — MHLW guideline update or PMDA reclassification → roadmap
   must adapt
4. **Strategic pivot** — Company strategy changes → roadmap follows
5. **Capacity change** — Team grows or shrinks → re-scope Now

**What NOT to change the roadmap for:**
- A single customer's loud request (that's feedback, not direction)
- A competitor's press release (PR ≠ shipped product)
- Shiny object syndrome (new tech that doesn't serve your outcome)
- Internal "wouldn't it be cool if" without user validation
