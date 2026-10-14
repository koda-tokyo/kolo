# Design Research — Understanding Users and Measuring Quality

## Research is Not Validation

The most common design research mistake: using research to prove you're right. That's not research — that's confirmation bias with data. True research seeks to be wrong, early and often.

---

## Research Methods by Phase

### Generative Research (Before Design — "What should we build?")
Goal: Discover needs, opportunities, and contexts.

**Methods:**
- **Contextual inquiry:** Observe users in their actual environment. What they DO, not what they SAY they do.
- **Diary studies:** Users self-report over days/weeks. Reveals patterns invisible in one-off sessions.
- **Ethnography:** Extended observation. Understand culture, context, and hidden workflows.
- **Competitive analysis:** Not just feature comparison — what mental models do competitors' users bring?
- **Stakeholder interviews:** Business goals, constraints, assumptions. What does success look like to the business?

**For KODA KENKŌ:** Shadow doctors on rounds. Watch nurses at shift change. Sit with administrators during reporting. The clinical environment reveals constraints no interview will surface.

### Formative Research (During Design — "Are we building the right thing?")
Goal: Test concepts, flows, and prototypes before investing in development.

**Methods:**
- **Usability testing (qualitative):** 5 users. Think-aloud protocol. Find problems, not statistics.
- **First-click testing:** Where do users click first? If wrong, the rest of the flow won't save you.
- **Card sorting:** How do users mentally organize information? Informs IA.
- **Tree testing:** Can users find things in your proposed navigation structure? Without visual distraction.
- **Paper prototyping:** Test concepts before writing code. The cheapest way to throw away a bad idea.

### Summative Research (After Design — "Did we build it right?")
Goal: Measure performance, find remaining issues, benchmark.

**Methods:**
- **Usability benchmarking:** Measure: task completion rate, time on task, error rate, satisfaction. Compare against baseline or competitor.
- **A/B testing:** Compare two versions with real users. Statistical significance, not opinion.
- **Analytics:** Behavior at scale. Where do users drop off? What features are never used?
- **Surveys:** SUS (System Usability Scale), NPS, CSAT. Standardized instruments for comparison.

---

## Usability Testing Protocol

### The Think-Aloud Method
```
"Please speak your thoughts aloud as you complete this task.
What are you looking at? What are you trying to do?
What do you expect to happen? What confuses you?"

Researcher: SILENT. Do not explain. Do not help. Do not defend.
```

**What to watch for:**
- Where do they pause? (confusion)
- Where do they backtrack? (wrong mental model)
- What do they say they expect? (mental model gap)
- Where do they succeed but look uncertain? (weak confidence)
- Where do they fail? (blocker)

**What NOT to do:**
- Don't explain the design ("what we meant was...")
- Don't help ("click there instead")
- Don't defend ("most users find that intuitive")
- Don't lead ("don't you think it would be better if...")

### Task Design
**Bad task:** "Create a new patient record." (too open-ended, tests domain knowledge not UI)
**Good task:** "Add a new patient named Maria Santos, born March 15, 1985, with a penicillin allergy."

**Task rules:**
- Tasks should be achievable in 2-5 minutes
- Write tasks that test SPECIFIC features, not general exploration
- Avoid using UI terminology in the task ("click the sidebar" — now you've told them where to look)
- Every task should have a clear success criterion

---

## Measuring Design Quality

### System Usability Scale (SUS) — Brooke, 1996
10 questions, 5-point Likert. The industry standard.
- Score: 0-100 (not percentages — 68 is average)
- Above 80: excellent
- Above 68: good (industry average)
- Below 51: poor
- Below 30: unacceptable

### Standardized Usability Questions (Post-task)
1. Overall, how difficult or easy was this task? (single ease question / SEQ)
2. I was able to complete this task successfully. (agree/disagree)
3. I felt confident while completing this task. (agree/disagree)

### The HEART Framework (Google, 2013)
| Metric | Question | Example |
|--------|----------|---------|
| Happiness | How satisfied are users? | Satisfaction survey |
| Engagement | How deeply do users engage? | Sessions per week |
| Adoption | How many users start using? | New accounts / month |
| Retention | How many users come back? | Day-30 retention rate |
| Task Success | Can users accomplish their goals? | Completion rate, error rate |

**For each product, pick the metrics that matter.** Not all HEART metrics apply to all products. A one-time-use tax filing app doesn't need retention. A social app doesn't need task success rate.

### UX Scorecard
A dashboard that tracks UX quality over time:
```
Metric              Current    Target    Trend
Task completion     87%         90%      ↑2%
Time on task        2:34        2:00      ↓0:12
Error rate          8%          5%        ↓3%
SUS score           72          80        ↑5
Accessibility score 91/100     95/100    →
CSAT                4.2/5       4.5/5     ↑0.1
```

---

## Ethical Research Practices

### Informed Consent
- Participants must understand: what they're doing, why, how long, what data is collected
- Participants must know they can stop at any time
- Compensation should not be coercively high
- In medical contexts: IRB approval, HIPAA compliance, patient consent

### Data Privacy
- Recordings: encrypted, access-controlled, deleted after analysis
- Anonymize: remove names, faces, voices when possible
- Data minimization: collect only what's needed, store only as long as needed
- Right to deletion: participants can request their data be destroyed

### Research with Vulnerable Populations
Extra care for: children, elderly, patients, disabled, economically disadvantaged, non-native speakers, refugees:
- Enhanced consent processes
- Cultural and linguistic appropriateness
- Community consultation
- Benefit must outweigh burden
- Avoid extractive research (learn and leave)

---

## From Research to Action

### The Research Insight Format
```
OBSERVATION: What we saw (specific, behavioral, not interpreted)
↓
INSIGHT: What it means (interpretation, pattern, implication)
↓
DESIGN PRINCIPLE: How it guides design (actionable, not vague)
↓
METRIC: How we'll know if we fixed it
```

**Example:**
```
OBSERVATION: 4 of 5 doctors clicked the patient name instead of 
the "View Details" button. They said "I just wanted to see the chart."

INSIGHT: Doctors think of the patient name as the gateway to 
clinical information, not as a label. The "View Details" button 
creates unnecessary separation between the patient identity and 
their clinical data.

DESIGN PRINCIPLE: The patient identifier should BE the navigation 
to the patient record. Make the entire patient name row clickable.

METRIC: First-click success on "View patient details" task should 
increase from 20% to >80%.
```

### Communicating Research
- **Don't:** "We did 8 interviews and here are all 8 transcripts."
- **Do:** "We identified 3 key patterns. Here they are, with evidence."
- **Don't:** "Users want a dashboard redesign." (conclusion without evidence)
- **Do:** "6 of 8 doctors couldn't find the patient's latest lab results in under 30 seconds. The current layout buries recent data below historical summaries. Design principle: recent clinical data must be visible at the top of the patient overview." (evidence → insight → principle)
