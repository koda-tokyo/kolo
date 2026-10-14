# Design Methodology — How Master Designers Think

## Two Modes of Reasoning

### Deductive Logic (the engineer's default)
```
Given: All humans are mortal
Given: Socrates is human
Therefore: Socrates is mortal
```
Deduction moves from general rules to specific conclusions. It is 100% certain when premises are true. This is how engineers think: given requirements, derive implementation.

**Limitation for design:** Deduction cannot generate new knowledge. It only reveals what is already implicit in the premises. If you don't know what you're building, deduction won't tell you.

### Inductive Logic (the scientist's tool)
```
Observation: Every swan I have seen is white
Therefore: All swans are white
```
Induction moves from specific observations to general rules. It is probabilistic, not certain. A single black swan disproves the theory.

**Limitation for design:** Induction tells you what IS. It doesn't tell you what COULD BE. User research tells you what frustrates users now. It doesn't tell you what would delight them.

### Abductive Logic (THE DESIGNER'S MODE)
```
Observation: This interface feels confusing
Hypothesis: IF we organized by task instead of by feature, THEN it would feel clearer
Therefore: Let's try organizing by task and see
```
Abduction moves from observation to possible explanation to testable hypothesis. It generates new possibilities. It is the logic of "what if?"

**This is the Stanford d.school's core intellectual move.** Design thinking = abductive reasoning made systematic. Generate hypotheses about what COULD work, prototype them, test, iterate.

---

## The Design Thinking Framework (Stanford d.school)

### Empathize → Define → Ideate → Prototype → Test

**This is NOT a linear process.** It is a set of modes that the designer moves between fluidly. The arrows should point in all directions.

### 1. Empathize — Understand the human
**Not:** "What do users say they want?"
**But:** "What do users actually need, do, think, and feel?"

**Methods:**
- **Contextual inquiry:** Watch them work in their real environment. What they DO differs from what they SAY they do.
- **Think-aloud protocol:** User narrates their thoughts while performing tasks. Surfaces mental models and pain points.
- **Diary studies:** Users log their experiences over time. Reveals patterns invisible in one-off testing.
- **Extreme users:** Study outliers — the most expert user, the most struggling user. They reveal different truths.
- **Analogous empathy:** Study parallel situations. How do air traffic controllers manage attention? How do librarians organize information? Cross-domain insight.

**Trap:** "Empathy" as a checkbox. One interview is not empathy. Empathy is a continuous practice of seeking to understand, not a step to complete.

### 2. Define — Frame the right problem
**The most important design skill is problem framing.** The way you define the problem determines the space of possible solutions.

**Reframing moves:**
- "Users want a faster checkout" → "Users want to feel confident their purchase is correct"
- "We need a better search feature" → "Users need to find relevant information without knowing the right keywords"
- "The dashboard is cluttered" → "Doctors need to see the 3 most critical things at a glance"

**How to reframe:**
1. State the problem as given
2. Ask "WHY?" 5 times (root cause analysis)
3. Ask "What's the real need?" (not "what's the requested feature?")
4. Ask "What would success look like?" (not "what would the solution look like?")
5. Restate as a human need, not a technical requirement

**Point of View (POV) statement format:**
```
[USER] needs [NEED] because [INSIGHT]
```

### 3. Ideate — Generate possibilities
**Divergent thinking first, convergent later.** Generate many ideas before judging any.

**Rules of brainstorming (IDEO):**
1. Defer judgment — no criticism during generation
2. Encourage wild ideas — the practical solution may start absurd
3. Build on the ideas of others — "Yes, AND..."
4. Stay focused on the topic — diverge within a frame
5. One conversation at a time — no side discussions
6. Be visual — sketch, don't just talk
7. Go for quantity — aim for 100 ideas in a session

**After divergence → convergence:**
- Cluster ideas by theme
- Vote on most promising
- Reality-check against constraints
- Select 2-3 directions to prototype

### 4. Prototype — Make it tangible
**A prototype is a question, not an answer.** The goal is learning, not validation.

**Prototype fidelity ladder:**
1. Paper sketch (5 min) — "Does this flow make sense?"
2. Wireframe (30 min) — "Is this layout usable?"
3. Interactive prototype (2 hours) — "Does this interaction work?"
4. Coded prototype (1 day) — "Is this technically feasible?"
5. Production feature (1 week+) — "Does this work at scale?"

**Rule: Match fidelity to the question.** Don't build a coded prototype to test if the concept makes sense. Don't use a paper sketch to test technical feasibility.

### 5. Test — Learn and iterate
**Testing is not validation. Testing is learning.**

**What to test:**
- Can users complete the task? (effectiveness)
- How fast? How many errors? (efficiency)
- What confused them? (mental model gaps)
- What delighted them? (emotional response)
- Would they use this? (adoption potential)

**How to test:**
- 5 users find ~85% of usability problems (Nielsen, 2000)
- Don't test with 30 users at once. Test with 5, fix issues, test with 5 more.
- Test early, test often, test cheaply
- The best test is watching someone use your product for the first time, in silence

---

## Beyond Stanford — Other Design Methodologies

### Double Diamond (UK Design Council, 2005)
```
Discover → Define → Develop → Deliver
  (divergent) (convergent) (divergent) (convergent)
```
**Key insight:** Design has TWO divergent/convergent cycles. First: understand the problem (discover → define). Second: create the solution (develop → deliver). Most teams skip the first diamond and jump straight to solutions for the wrong problem.

### Human-Centered Design (ISO 9241-210)
The international standard. Four principles:
1. Understand users, tasks, and environments
2. Involve users throughout design and development
3. Drive design by user-centered evaluation
4. Iterate until requirements are met

### Lean UX (Gothelf & Seiden, 2013)
**Core move:** Replace design documentation with cross-functional collaboration and rapid experimentation.
- Assumptions → Hypotheses → Minimum Viable Experiments → Learn → Pivot/Persevere
- Design is everyone's job, not a phase owned by designers
- Outcomes over outputs (measure behavior change, not feature count)

### Design Sprints (Google Ventures, Knapp, 2016)
5-day structured process:
- Monday: Map the problem
- Tuesday: Sketch solutions
- Wednesday: Decide on the best
- Thursday: Build a realistic prototype
- Friday: Test with 5 real users

**When to use:** Big bets, tight timelines, stuck on a hard problem.

---

## The Master Designer's Judgment

### Taste vs. Principles
Taste is personal and unarguable. Principles are shared and debatable. When giving design feedback:
- **Wrong:** "I don't like how this looks." (taste)
- **Right:** "The visual hierarchy puts the secondary button at level 1. The primary CTA should be the most visually dominant element." (principle)

### The Critique Culture
At the best design schools (RISD, Art Center, d.school), critique is the primary learning method. Not "is this good or bad?" but "what is this trying to do and does it achieve it?"

**Critique format:**
1. Designer presents: "This is what I made and what it's trying to do."
2. Critiquers ask clarifying questions first (no judgment)
3. Critiquers offer: "Here's what's working toward your goal..." then "Here's what might be working against it..."
4. Designer reflects, doesn't defend
5. Designer decides what feedback to incorporate

### Design Quality Frameworks

**Dieter Rams' 10 Principles of Good Design:**
1. Good design is innovative
2. Good design makes a product useful
3. Good design is aesthetic
4. Good design makes a product understandable
5. Good design is unobtrusive
6. Good design is honest
7. Good design is long-lasting
8. Good design is thorough down to the last detail
9. Good design is environmentally friendly
10. Good design is as little design as possible

**The Nielsen-Norman Usability Heuristics:**
1. Visibility of system status
2. Match between system and real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, and recover from errors
10. Help and documentation

### When to Break the Rules
Masters know the rules AND know when to break them:
- Break rules intentionally, not accidentally
- Break rules for a specific effect, not because you didn't know
- Test rule-breaking twice as hard — the burden of proof is on the deviant
