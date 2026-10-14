# Competitive Analysis

## Competitive Landscape Mapping

### The 2×2 Positioning Map

The classic framework for understanding where you sit in the market. Pick two axes
that differentiate players. For Japanese healthcare AI:

```
                 HIGH CLINICAL DEPTH
                      │
    Ubie             │    KODA KENKŌ (target)
    (symptom         │    (consultation co-pilot,
    checker)         │    deep clinical context)
                      │
CONSUMER ─────────────┼─────────────────── PROFESSIONAL
                      │
    Generic AI        │   富士通 / NEC
    (ChatGPT, etc.)   │   (enterprise EMR-AI,
                      │    broad but shallow)
                      │
                 LOW CLINICAL DEPTH
```

**How to choose axes:**
- Axes should separate players, not cluster them
- Axes should reflect what customers actually care about
- Common axes for healthtech: clinical depth vs breadth, point solution vs platform,
  physician-focused vs patient-focused, regulated vs unregulated

### Competitive Landscape Table

| Player | Category | Strengths | Weaknesses | Our Advantage |
|--------|----------|-----------|------------|---------------|
| **Ubie** | Symptom checker / patient triage | Strong brand, large user base, hospital partnerships | Consumer-focused, not for physician workflow | Deep physician workflow integration |
| **富士通 HOPE** | EMR + AI modules | Installed base in large hospitals, trust | Slow, broad AI not deep clinical reasoning | Focused clinical depth, faster iteration |
| **AI 問診 (various)** | Patient pre-consultation questionnaire | Reimbursement path, simple value prop | Not real-time consultation support | Real-time during consultation |
| **Google / MedLM** | General medical AI | Vast resources, foundational models | Not Japan-specific, no product | Japanese-native, purpose-built |
| **PwC / Deloitte consulting** | Digital health advisory | Trusted by hospital execs | No product, just PowerPoints | We actually build |
| **Medical local startups** | Various point solutions | Agility, local knowledge | Small scale, funding constraints | KOL network, regulatory capability |

**Update this table quarterly.** Competitive landscapes in AI healthtech shift monthly.

## Feature Comparison Matrix

### Template Structure

| Feature | KODA KENKŌ | Competitor A | Competitor B | Competitor C |
|---------|------------|-------------|-------------|-------------|
| Real-time consultation support | ✓ (core) | ✗ | △ (partial) | ✗ |
| Japanese medical NLP | ✓ (native) | ✗ | ✓ (via API) | ✗ |
| EMR integration | △ (in progress) | ✓ (deep) | ✗ | ✓ (proprietary) |
| Patient-facing output | ✓ | ✓ | ✓ | ✗ |
| Drug interaction check | △ (in progress) | ✗ | ✓ | ✗ |
| PMDA SaMD pathway | △ (pre-consult) | ✗ | ✓ (Class II) | ✗ |
| Insurance claim integration | ✗ | ✓ | ✗ | ✓ |

**Legend:** ✓ = shipped, △ = in development / partial, ✗ = not available

### Using the Matrix

1. **Identify table-stakes features** (every competitor has them) → these are your
   Basics (Kano). Ship minimum versions.
2. **Identify gaps** (no competitor has them) → these are your differentiators.
   Invest here.
3. **Identify competitor advantages** (they have it, we don't) → three options:
   a) Build if it's table-stakes
   b) Partner if non-core
   c) Reposition if we can win without it
4. **Track △ → ✓ transitions** — competitor's "in development" becoming "shipped"
   is the most actionable intel

## Teardown Methodology

When a competitor launches something new, do a structured teardown:

### Teardown Template (30–60 min)

1. **What is it?** (5 min) — Feature name, announced date, availability
2. **What job does it do?** (10 min) — JTBD lens: what trigger, what outcome?
3. **How well does it do it?** (10 min) — Try it. Record first impressions.
   Strengths (3) and weaknesses (3).
4. **What's the technical approach?** (5 min) — Obvious from UI? Integration points?
   Regulatory classification?
5. **How will they sell it?** (5 min) — Pricing model? Target customer? Channel?
6. **What's our response?** (10 min) — Ignore / Watch / Match / Leapfrog / Partner?
   This is the only question that matters for action.

### Teardown Principles
- **Do it within 48 hours of competitor launch.** Insight decays fast.
- **The whole product team participates.** Engineering sees what's technically
  possible. Design sees UX patterns. PM sees positioning.
- **Output is a Slack post, not a deck.** Speed > polish.
- **Assume good intent.** Competitors are smart people solving real problems.
  Learn from them rather than dismiss them.

## Positioning Strategy

### Positioning Statement Template

```
For [target customer]
who [compelling need / pain point],
[product name] is a [product category]
that [key benefit / differentiator].
Unlike [primary competitors],
we [unique advantage].
```

**KODA KENKŌ example:**
```
For primary care physicians in Japanese clinics
who spend 40% of consultation time on documentation instead of patient care,
KODA KENKŌ is an AI consultation co-pilot
that drafts clinical notes, surfaces relevant information, and reduces
documentation time — during the consultation, not after.
Unlike generic AI tools or EMR modules,
KODA KENKŌ is built natively for Japanese clinical workflows and language.
```

### Positioning Traps
- **"AI-powered" is not positioning.** Everyone claims AI. What specific outcome?
- **Feature listing is not positioning.** "We do X, Y, and Z" → "We help you achieve [outcome]"
- **Positioning must exclude.** If you're for "every physician," you're for no one.
   Pick a wedge.

## Win/Loss Analysis

### When to Run Win/Loss
- After every significant sales outcome (won or lost a hospital contract)
- Quarterly aggregate review
- Whenever a pattern emerges ("we keep losing deals to X")

### Win/Loss Interview Structure (30 min)

Ask the sales lead (not the customer — you'll rarely get honest loss reasons from
Japanese customers directly):

1. **Context:** What was the trigger? Who was the decision-maker?
2. **Evaluation:** What did they compare us to? What were the top 3 criteria?
3. **Decision:** Why did they choose us / the competitor? Was it unanimous or split?
4. **Pricing:** Was price mentioned? Where did we sit vs alternatives?
5. **Product gaps:** What feature(s) did they ask for that we don't have?
6. **Process:** How long did the evaluation take? Any surprises?

### Win/Loss Pattern Analysis

| Pattern | Action |
|---------|--------|
| Losing on price consistently | Either our value prop isn't landing or we're targeting the wrong segment |
| Losing because of missing feature X | Is X a table-stakes feature now? Consider building. |
| Losing because "competitor has EMR integration" | Accelerate integration roadmap or partner |
| Winning because of clinical accuracy | Double down. Make this even more visible in sales. |
| Winning because of KOL endorsement | Invest in KOL program, make it scalable |
| Losing because "too new / unproven" | Build case studies, reference customers, clinical evidence |

### Japanese-Specific Win/Loss Nuances
- **You will rarely get honest loss reasons.** Japanese hospitals will say "検討します"
  or go silent rather than explain why they chose a competitor. Get intel from your
  network/channel partners instead.
- **EMR vendor influence is massive.** If the hospital uses EMR X and competitor Y
  integrates with X, you will lose — regardless of product quality. Map EMR ecosystems.
- **Reference customer power.** In Japan, "who else is using this?" matters more than
  any feature comparison. Your first 5 reference customers are worth more than any
  feature you could build.

## Market Intelligence Integration

### Signals to Track (Weekly)

| Signal | Source | What It Tells You |
|--------|--------|-------------------|
| Competitor job postings | LinkedIn, Indeed JP | What they're building next (engineering hires = product expansion) |
| Competitor press releases | PR Times, Nikkei | Official positioning, partnerships, funding |
| PMDA filings / approvals | PMDA website | Who's entering regulated space |
| MHLW policy updates | MHLW website | Regulatory tailwinds/headwinds |
| Hospital press releases | Hospital newsrooms | New tech adoption, pilot programs |
| Startup funding announcements | Bridge, TechCrunch JP | New entrants, who has resources |
| Conference speaker lists | 医学会, 医療情報学会 | Who's building mindshare with KOLs |

### Intelligence to Action Cadence

- **Weekly:** Scan signals, flag anything that changes competitive positioning
- **Monthly:** Update competitive matrix if anything changed
- **Quarterly:** Full competitive landscape review, update positioning statement if needed
- **Ad-hoc:** Within 48 hours of a major competitor launch → teardown
