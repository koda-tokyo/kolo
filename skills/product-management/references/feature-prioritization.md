# Feature Prioritization

## Core Principle: Kill More Than You Build

In a startup, the default answer to any feature request is "no." The burden of proof
is on the feature to justify its existence. You will have capacity for maybe 3–4
meaningful things per quarter. Everything else is noise.

## RICE Scoring (Primary Framework)

RICE = Reach × Impact × Confidence ÷ Effort. Use for 90% of prioritization decisions.

### Components

| Factor | Definition | Scale |
|--------|------------|-------|
| **Reach** | How many users will this affect in a given period? | 1–10 (1 = single user, 10 = all users) |
| **Impact** | How much will this move the needle for those users? | 0.25 (minimal), 0.5 (low), 1 (medium), 2 (high), 3 (massive) |
| **Confidence** | How sure are we about reach/impact/effort estimates? | 20% (wild guess), 50% (some data), 80% (user validated), 100% (proven) |
| **Effort** | How much work (person-weeks)? | Use actual person-weeks, not story points |

### RICE Score = (Reach × Impact × Confidence) / Effort

**Example for KODA KENKŌ:**

| Feature | R | I | C | E | RICE |
|---------|---|---|---|---|------|
| Auto-SOAP note from consultation audio | 8 | 3 | 80% | 6 pw | 3.2 |
| Patient-facing summary export | 6 | 2 | 50% | 3 pw | 2.0 |
| Drug interaction alert (integrated) | 7 | 2 | 100% | 4 pw | 3.5 |
| Multi-language patient output (EN/CN) | 2 | 1 | 50% | 2 pw | 0.5 |
| Custom clinic branding | 3 | 0.5 | 80% | 1 pw | 1.2 |

→ Priority: Drug interaction alert > Auto-SOAP > Patient summary > Branding > Multi-language

### RICE Traps

- **Inflating Reach to make a pet feature score higher.** Reach must mean "users
  who will actually experience the change," not "users who theoretically could."
- **Confidence creep.** If you haven't talked to a user about this specific feature,
  confidence maxes at 50%. User-validated = 80%. Shipped-before-and-measured = 100%.
- **Effort sandbagging.** Engineers will pad effort estimates for features they
  don't want to build. PM's job is to calibrate.

## Kano Model (For Feature Classification)

Use Kano to understand what kind of feature you're building, not to score it:

| Type | Definition | Strategy |
|------|------------|----------|
| **Basic (Must-have)** | Users expect it. Absence = dissatisfaction. | Ship the minimum. Don't over-invest. |
| **Performance** | More = more satisfaction. Linear relationship. | Invest proportionally to user value. |
| **Excitement (Delighters)** | Users don't expect it. Presence = delight. | Ship one per release. Cheap to build, high surprise. |
| **Indifferent** | Users don't care either way. | Don't build. |
| **Reverse** | Some users love it, some hate it. | Segment your users before building. |

### Kano Survey Question Format (ask both):

1. "How would you feel if this feature WAS available?"
   → I like it / I expect it / I'm neutral / I can tolerate it / I dislike it

2. "How would you feel if this feature was NOT available?"
   → Same scale

**Japanese physician example:** Auto-generated patient summary in plain Japanese.
- **Presence:** "I like it" (saves 2 min per patient)
- **Absence:** "I'm neutral" (they don't expect it yet)
→ **Excitement feature today.** Will become **Performance** as competitors add it.
Will become **Basic** once patients expect it.

## Opportunity-Solution Trees (Torres)

Use when you have a clear outcome but aren't sure which opportunity to pursue:

```
OUTCOME: Reduce physician documentation time by 30%
│
├─ OPPORTUNITY 1: Physicians spend time structuring notes
│   ├─ Solution A: Auto-SOAP from consultation audio
│   ├─ Solution B: Smart templates based on chief complaint
│   └─ Solution C: Voice dictation with medical NLP
│
├─ OPPORTUNITY 2: Physicians duplicate data across systems
│   ├─ Solution D: EMR write-back integration
│   ├─ Solution E: Unified patient summary across sources
│   └─ Solution F: Smart copy-paste between EMR and KODA KENKŌ
│
├─ OPPORTUNITY 3: Physicians search for information during consultation
│   ├─ Solution G: Inline drug reference lookup
│   ├─ Solution H: Guideline prompts for common presentations
│   └─ Solution I: Patient history timeline at consultation start
│
└─ OPPORTUNITY 4: Physicians write for compliance, not care
    ├─ Solution J: Automated 保険請求 (insurance claim) fields
    ├─ Solution K: Compliance checklist from clinical content
    └─ Solution L: One-click 紹介状 (referral letter) generation
```

**Process:**
1. Define the outcome (aligned with OKR)
2. Brainstorm opportunities (user pain points that block the outcome)
3. Assess each opportunity: how many users? how painful? how often?
4. Pick the top opportunity by evidence, not opinion
5. Brainstorm solutions for that opportunity only
6. Test the smallest solution first

## ICE Scoring (Quick Alternative to RICE)

When RICE is too heavy (early-stage, pre-data):

**ICE = Impact × Confidence × Ease** (1–10 each)

Use ICE for:
- Early-stage ideas with no usage data
- "Should we even explore this?" decisions
- Quick gut-check before deeper analysis

Don't use ICE for roadmap-level decisions. RICE is better when you have data.

## Cost of Delay

Some features have a cost to not shipping them now:

| Cost Type | Example | When It Matters |
|-----------|---------|-----------------|
| **Revenue** | Hospital contract requires feature for renewal | Now: lose contract |
| **Regulatory** | PMDA guideline change requires update by deadline | Now: compliance risk |
| **Competitive** | Competitor just launched similar feature | Soon: lose positioning |
| **Technical debt** | Critical library EOL, security vulnerability | Soon: risk increases over time |
| **User trust** | Bug causing incorrect clinical suggestions | Emergency: trust is binary |

**Cost of delay trumps RICE score.** A RICE 1.5 feature with critical cost of delay
beats a RICE 4.0 feature with no urgency.

## Maintenance vs Features

### The 30% Rule
Budget 30% of engineering capacity for maintenance, tech debt, bugs, and small
improvements. This is non-negotiable in healthcare — bugs aren't "annoying," they're
potentially dangerous.

### When Maintenance Wins
- Bug affects clinical accuracy → drop everything (emergency)
- Performance degradation is measurable (consultation load time >3 seconds) →
  scheduled in current cycle
- Security vulnerability → scheduled in current cycle
- Dependency EOL → plan 1–2 cycles ahead
- Refactoring that unblocks future velocity → negotiate 20% of Next capacity

### When Features Win
- Customer contract requires a feature by a deadline
- A competitor just launched something that changes the market baseline
- User research unambiguously points to a high-impact opportunity
- A feature unlocks a new revenue stream

## Stakeholder Negotiation

### The "One In, One Out" Rule

When a stakeholder (investor, KOL, executive) requests a new feature:
> "If we add X to Now, what should we move to Next or kill?"

This forces the conversation from "can we add this?" to "what are we willing to
trade?" — which is the actual prioritization conversation.

### Handling HiPPOs (Highest Paid Person's Opinion)

1. **Don't say no.** Say "Let me understand the outcome you're driving at."
2. **Translate to user value.** "So if I understand, this would help physicians
   with [X]. Let me test that with 3 physicians this week."
3. **Bring data back.** "I spoke with 5 physicians. 2 said it would help, 3 said
   [competing need Y] is more urgent. Here's what I recommend..."
4. **Make them part of the process.** "Would you join me for one of these
   interviews next week?"

### The Prioritization Meeting Agenda (Monthly)

1. **Review:** What we shipped, what we learned, what metrics moved (10 min)
2. **Re-score:** Update RICE for existing Next items based on new data (15 min)
3. **New candidates:** Quick RICE for new feature candidates (10 min)
4. **Trade-offs:** What moves? What gets killed? (15 min)
5. **Commit:** Lock Now/Next/Later for the next cycle (10 min)

**Total:** 60 min. No slide decks. Raw data on a shared board.
