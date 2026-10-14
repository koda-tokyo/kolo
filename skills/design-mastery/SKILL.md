---
name: design-mastery
description: "Master-level frontend design and UI engineering knowledge — the intellectual tradition from Engelbart to the MIT Media Lab, Stanford d.school, CMU HCDE. Encodes graduate-level knowledge in HCI, visual design, interaction design, design systems engineering, emerging interfaces, inclusive design, design research, and frontend architecture. This is not a tool skill — it is a knowledge transformation system. Use for any task requiring design judgment, creative direction, design critique, or engineering decisions where design quality matters. The knowledge in this skill should inform every frontend decision, not just when explicitly triggered. Triggers: design mastery, design judgment, design critique, design direction, HCI, human-centered design, frontend architecture, design system engineering, Media Lab, d.school, design thinking, interaction design, visual design mastery, design research, Marianas Trench depth design."
---

# Design Mastery — The Deep Knowledge

This is not a workflow skill. It is a body of knowledge — the intellectual tradition of human-centered design and frontend engineering at the level of the world's leading institutions. Load this when you need to think like a master designer, not just apply design tokens.

## Knowledge Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  DESIGN MASTERY (this skill) — Knowledge & Judgment          │
│  "How to think about design"                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ FOUNDATIONS       │ METHODOLOGY      │ PERCEPTION   │    │
│  │ hci-foundations   │ design-method    │ visual       │    │
│  │ Cognitive science │ Design thinking  │ mastery      │    │
│  │ Engelbart → now   │ Abductive logic  │ Gestalt      │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ INTERACTION       │ EMERGING         │ SYSTEMS      │    │
│  │ interaction       │ emerging         │ design       │    │
│  │ mastery           │ interfaces       │ systems      │    │
│  │ Fitts', Hick's    │ Tangible, VR/AR  │ engineering  │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ENGINEERING       │ INCLUSIVE        │ RESEARCH     │    │
│  │ frontend          │ inclusive        │ design       │    │
│  │ architecture      │ design           │ research     │    │
│  │ Core Web Vitals   │ Universal design │ Ethnography  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  APPLIED SKILLS (separate — consume this knowledge)         │
│  design-fluency → enterprise-ui-design → ux-patterns        │
│  → react-web / react-native-mobile                          │
│  → frontend-design-engineering (orchestrator)               │
└─────────────────────────────────────────────────────────────┘
```

**How to use:** This skill provides the *intellectual foundation* that informs every design decision. The applied skills (`design-fluency`, `enterprise-ui-design`, etc.) are the *tools*. This is the *mind*.

## Reference Map — Load by Domain

| Domain | Reference | Institution | When to Load |
|--------|-----------|-------------|-------------|
| HCI Foundations | `references/hci-foundations.md` | MIT, CMU, Stanford, PARC | Understanding *why* design works. Cognitive science of interaction. |
| Design Methodology | `references/design-methodology.md` | Stanford d.school, CMU HCDE | Structuring the creative process. Design thinking, reframing, prototyping. |
| Visual Mastery | `references/visual-mastery.md` | RISD, Bauhaus, Yale, MIT Media Lab | Perception science, Gestalt, advanced typography, color theory, semiotics. |
| Interaction Mastery | `references/interaction-mastery.md` | CMU HCII, MIT CSAIL, Georgia Tech | Fitts' Law, Hick's Law, information foraging, micro-interactions, haptics. |
| Emerging Interfaces | `references/emerging-interfaces.md` | MIT Media Lab, Stanford HCI | Tangible bits, VR/AR/MR, ambient displays, ubiquitous computing, conversational UI. |
| Design Systems Engineering | `references/design-systems.md` | Industry (Google, Airbnb, IBM) | Large-scale design tokens, cross-platform consistency, design ops. |
| Frontend Architecture | `references/frontend-architecture.md` | Industry (Vercel, Meta, Google) | Rendering, Core Web Vitals, state machines, cross-platform patterns. |
| Inclusive Design | `references/inclusive-design.md` | Microsoft, W3C, University of Washington | Universal design, cognitive accessibility, global/international design, equity. |
| Design Research | `references/design-research.md` | CMU HCDE, Stanford, IDEO | Ethnography, usability, metrics, design quality frameworks. |

## Core Principles — The Master's Mindset

### 1. Design is not decoration. It is intent made visible.
Every visual element must answer: what does this communicate? What action does it invite? What feeling does it evoke? If an element serves none of these, it is noise.

### 2. The user is not like you.
Expertise blindness is the designer's original sin. What is obvious to you is opaque to a first-time user. What excites you may confuse them. Design for the person who has never seen your product, is in a hurry, and is on a bad connection.

### 3. Constraints create creativity.
The blank canvas is not freedom — it is paralysis. Design flourishes within constraints: platform, performance, accessibility, brand, timeline. Name your constraints before you name your solutions.

### 4. Good design is invisible. Great design is unforgettable.
Most design should simply work — the user never notices it. But key moments (onboarding, completion, delight) should be memorable. Know which kind you're designing.

### 5. Design is a team sport, not a solo art.
The lone genius designer is a myth. Great design emerges from: research (understanding users), engineering (understanding constraints), business (understanding viability), and craft (making it beautiful).

### 6. Ship the smallest thing that teaches you something.
Prototypes are questions, not answers. The goal of a prototype is not to be right. It is to learn what is wrong, faster.

### 7. Accessibility is not a feature. It is a requirement.
Designing for disability produces better design for everyone. Curb cuts, closed captions, and high-contrast modes were all accessibility innovations that became universal expectations.

### 8. Speed is a design feature.
Performance is UX. A 100ms response feels instant. 1 second feels like a context switch. 10 seconds feels like abandonment. Every millisecond of latency is a design decision.

## How This Knowledge Transforms Practice

### Without mastery (applying rules mechanically):
- "I'll use blue because it's the brand color."
- "I'll use the golden ratio because it looks good."
- "I'll add animation because it's engaging."

### With mastery (designing from understanding):
- "Blue signals trust and stability in healthcare contexts, but we need warmth in our neutral scale to avoid clinical coldness. Our specific blue (H:215, cool-gray neutrals) creates a 'competent but approachable' feel appropriate for a medical AI that doctors interact with daily."
- "The golden ratio (1.618) creates natural-feeling proportions because it appears throughout biological systems and our visual cortex has evolved to find it harmonious. For this data dashboard, however, a root-2 ratio (1.414) is more appropriate — it produces geometric, precise proportions that reinforce the analytical, engineering character of the tool."
- "This page transition uses a 300ms ease-out curve because: (1) it's a context change requiring orientation (needs to be visible), (2) 300ms is fast enough to feel responsive, (3) ease-out deceleration mimics natural object settling, and (4) it respects reduced-motion preferences."

## Anti-Patterns of the Half-Trained

- **Designing in a vacuum** — No research, no users, no context. Making decisions based on personal taste.
- **Premature visual polish** — Making things beautiful before making them work. Visual polish on broken UX is a lie.
- **One-state design** — Designing only the ideal state. The real product exists in loading, empty, error, and edge cases.
- **Placating over solving** — Adding things because stakeholders ask, not because users need.
- **Trend-chasing** — Following design trends without understanding why they emerged or whether they fit your context.
- **Accessibility as afterthought** — "We'll make it accessible later" = "We'll never make it accessible."
- **Engineer-splaining** — Using technical architecture as an excuse for bad UX. "The API doesn't support that" is an engineering problem to solve, not a design constraint to accept.

## The Designer's Reading List

The intellectual tradition this skill encodes:

- Don Norman, *The Design of Everyday Things* (1988/2013) — Affordances, signifiers, conceptual models
- Bill Buxton, *Sketching User Experiences* (2007) — Design as exploration, not execution
- Bill Moggridge, *Designing Interactions* (2006) — The history of interaction design from the people who invented it
- Edward Tufte, *The Visual Display of Quantitative Information* (1983) — Data visualization as design
- Jef Raskin, *The Humane Interface* (2000) — Cognitive engineering of interfaces
- Hiroshi Ishii, *Tangible Bits* (1997) — Beyond the screen, physical-digital integration
- Christopher Alexander, *A Pattern Language* (1977) — The original pattern library, from architecture to software
- John Maeda, *Laws of Simplicity* (2006) — Simplicity as design strategy
- Alan Cooper, *About Face* (1995-2014) — Interaction design as a discipline
- Brenda Laurel, *Computers as Theatre* (1991) — Dramatic structure in interface design
- Terry Winograd, *Bringing Design to Software* (1996) — The Stanford d.school lineage
- Richard Buchanan, *Wicked Problems in Design Thinking* (1992) — The theoretical foundation of design thinking

## Relationship to Other Skills

```
design-mastery (KNOWLEDGE) ← YOU ARE HERE
    │
    ├──→ design-fluency (CREATION) — original aesthetics from first principles
    │       │
    │       └──→ enterprise-ui-design (SYSTEM) — design tokens, consistency
    │               │
    │               └──→ ux-patterns (BEHAVIOR) — flows, states, accessibility
    │                       │
    │                       └──→ react-web / react-native-mobile (CODE)
    │
    └──→ frontend-design-engineering (ORCHESTRATION) — pipeline, quality gates
```

**Rule:** When making any design decision, the knowledge in this skill is the *why*. The applied skills are the *what* and *how*.
