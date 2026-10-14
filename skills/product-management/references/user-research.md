# User Research

## Research Methods

### Method Selection Matrix

| Method | Good For | Effort | Sample Size | Startup-Friendly? |
|--------|----------|--------|-------------|-------------------|
| **User interviews** | Deep understanding, why behind behavior | Medium | 5–12 | ★★★★★ Best |
| **Contextual observation** | Real workflow, environment, constraints | High | 3–8 | ★★★★ When possible |
| **Usability testing** | Interaction problems, task completion | Medium | 5–8 | ★★★★ Remote OK |
| **Surveys** | Breadth, quantification, trends | Low | 50+ | ★★★ OK for validation |
| **Analytics / product data** | Actual behavior at scale | Low (once set up) | All users | ★★★★★ Always |
| **Diary studies** | Longitudinal behavior, change over time | High | 8–15 | ★★ Rarely worth it |
| **Card sorting** | Information architecture, mental models | Low | 15–30 | ★★★ When reorganizing |
| **A/B testing** | Causal inference on specific changes | Medium | 100+ | ★★ Need volume |

### When to Use Which

- **Early discovery / new product:** Interviews + contextual observation. Nothing
  replaces watching a physician use your product in a real consultation.
- **Feature validation:** Usability testing with a clickable prototype. 5 physicians,
  30 minutes each, find the top 3 friction points.
- **Prioritization input:** Analytics (what are users actually doing?) + targeted
  survey on specific trade-offs. Never survey "what features do you want?" — users
  are bad at feature ideation.
- **Post-launch:** Analytics + NPS survey + targeted follow-up interviews with
  detractors and promoters.

## Research Planning (Lightweight)

Full research plans are for agencies. For a startup, use this 4-question plan:

1. **What decision will this research inform?**
   _Good: "Should we build auto-SOAP or dictation-first?"_
   _Bad: "Let's understand our users." (Too vague to drive action)_

2. **What do we need to learn?**
   _List 3–5 specific learning goals. Not "understand workflow" but "understand at
   which point in the consultation physicians switch from listening to typing."_

3. **Who do we need to learn from?**
   _Specific segments. "5 primary care physicians in Tokyo clinics, mix of
   early-career (under 40) and veteran (50+)" is better than "some doctors."_

4. **How will we know we're done?**
   _Saturation. When the last 3 interviews produced no new insights, stop. Typically
   5–8 interviews per segment._

## Insight Synthesis

### The "What? So What? Now What?" Format

After every research session, write 3 bullets:

```
What?     — Physicians keep a physical notepad next to the keyboard during consultations.
So What?  — The digital tool is not replacing their note-taking; it's additive.
            This suggests they don't fully trust the digital output yet.
Now What? — Prototype a side-by-side view that mirrors their physical notepad workflow.
            Test whether reducing the physical/digital gap increases trust.
```

### Affinity Mapping (Lightweight)

1. Write each insight on a sticky (physical or Miro/MURAL)
2. Group related insights
3. Name each group (these become themes)
4. Rank themes by: frequency × impact on user behavior × alignment with strategy
5. Convert top 3 themes into roadmap implications

**Timebox:** 90 minutes max for a batch of 5–8 interviews. Done is better than perfect.

## Persona Development (Lightweight)

Skip the glossy 4-page persona documents. Use a one-paragraph snapshot:

```
Dr. Tanaka, 42, Internal Medicine, Tokyo Clinic (5 physicians)
- Sees 40–60 patients/day, 6–8 min per consultation
- Uses EMR (ORCA) but finds it slow; types with one finger
- Adopted tablet-based tools before (failed — too slow during consultation)
- Key motivation: Reduce overtime documentation (currently 2 hrs/day after clinic)
- Key fear: AI making a recommendation that contradicts a senior colleague
- "I don't need another tool. I need one that replaces the 3 I already use."
```

**When to create a persona:** When the team is building for "users" rather than
specific people they can name. If everyone on the team can name 3 real users and
describe their context, skip the persona.

## Jobs-to-Be-Done (JTBD) Interviewing

### The JTBD Question Format

Don't ask: "What features do you want?"
Ask: "When was the last time you [context]? Walk me through it."

### JTBD Interview Structure (30 min)

1. **Context (5 min):** "Tell me about the last time you had to document a
   consultation. What happened before, during, and after?"
2. **Trigger (5 min):** "What made you realize the current way wasn't working?
   Was there a specific moment?"
3. **Switching (10 min):** "What did you try instead? What made you consider
   changing? What held you back?"
4. **Resolution (5 min):** "How did you end up solving it? What's better now?
   What's still not great?"
5. **Reflection (5 min):** "If you could wave a magic wand, what would the ideal
   solution do?"

### The JTBD Forces Diagram

```
Push (from current)  ←→  Pull (toward new)
        │                      │
        └──────────┬───────────┘
                   │
          Anxiety (about new)
          Inertia (habit of current)
```

Interview for ALL FOUR forces, not just the pull toward your product. Most startups
only ask about the pull and miss why people don't switch.

## Japanese Healthcare User Research Specifics

### Cultural Considerations

1. **Hierarchy matters.** A department head's opinion will cascade. Interview the
   部長 first. If they're bought in, the 医局 will follow. If not, no amount of
   individual physician enthusiasm will close the deal.

2. **Honest feedback is rare in group settings.** Japanese physicians will not
   criticize your product in front of you if colleagues are present — even if they
   hate it. Always do 1:1 interviews. Never do focus groups for critical feedback.

3. **The "consideration pause" is real.** When a Japanese physician says "検討します"
   (I'll consider it), it means no. Push for specific concerns: "何が一番気になりますか？"

4. **Build trust before asking about pain points.** First 10 minutes: build rapport,
   show you understand their clinical context. Then ask workflow questions. Only at
   minute 20+ do you ask about pain points. Rushing = shallow answers.

5. **Clinical validity is the price of entry.** Before any UX or workflow discussion,
   physicians need to trust that the clinical output is sound. Bring clinical
   evidence or a respected KOL endorsement to the first meeting.

### Recruitment (Japanese Healthcare)

- **KOLs:** Personal introductions only. Cold emails get zero response. Leverage
  your clinical advisory board for warm intros.
- **Community physicians:** Medical association 紹介, university hospital alumni
  networks, or M3.com (Japanese physician portal).
- **Compensation:** 図書カード (book vouchers) are standard and culturally appropriate.
  Cash is awkward. 10,000–30,000 yen for a 60-minute interview is typical.
- **IRB/ethics:** If you're collecting data for publication, you need IRB approval
  from the physician's institution. Factor 2–3 months for this.

### Remote vs In-Person

- **In-person at the clinic is gold.** You see the EMR setup, the physical layout,
  the interruptions. Nothing replaces this.
- **Remote (Zoom/Teams) is acceptable** for follow-ups or if the physician is
  tech-comfortable (younger cohort).
- **Never do phone-only.** You lose facial expressions that signal hesitation,
  confusion, or skepticism — critical signals in Japanese communication where
  verbal feedback is filtered.

### Language and Interpretation

- Conduct interviews in Japanese. Physicians' English reading is usually good
  (they read English journals), but spoken English for nuanced UX feedback is
  unreliable.
- If a non-Japanese-speaking PM needs to observe, use a bilingual moderator and
  live whisper translation. The PM watches body language and tone.
- Record and transcribe. Use a Japanese medical-grade transcription service
  (Amivoice or similar). Standard ASR fails on medical terminology.
