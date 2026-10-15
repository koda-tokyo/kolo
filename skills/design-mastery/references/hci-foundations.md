# HCI Foundations — The Intellectual Tradition

## The Lineage

Human-Computer Interaction as a discipline emerged from a single insight: **the computer is a tool for human augmentation, not replacement.** This insight, articulated by Douglas Engelbart in 1962, remains the ethical core of the field.

### Engelbart (Stanford Research Institute, 1962-1968)

**Core contribution:** The Mother of All Demos (1968). In 90 minutes, Engelbart demonstrated: the mouse, hypertext, collaborative editing, video conferencing, windowing systems, and the graphical user interface. Everything we build today descends from that room.

**Key concept — Augmentation, not automation:** "The goal is to augment the human intellect, not to replace it." This is the foundational ethic of HCI. When building AI interfaces, this question remains: are we augmenting or replacing human judgment?

**The NLS (oN-Line System):** The first implementation of hypertext, the first mouse-driven interface, the first collaborative real-time editing. All in 1968. Most of what we call "modern" UX patterns were working before the moon landing.

### Alan Kay (Xerox PARC, 1970-1981)

**Core contribution:** The Dynabook concept (1968-1972) — a portable interactive personal computer for children. This was the vision that produced the graphical user interface as we know it: overlapping windows, icons, desktop metaphor, object-oriented programming, and Smalltalk.

**Key concept — "The best way to predict the future is to invent it":** Kay didn't iterate on existing paradigms. He imagined a future and built backward from it. The Dynabook wasn't possible with 1970 hardware. He built it anyway, knowing hardware would catch up.

**The desktop metaphor's double edge:** Kay later criticized the desktop metaphor as limiting — "the computer is a medium, not a tool." He envisioned computers as dynamic, creative, expressive media, not just filing cabinets and calculators. This tension between "tool" and "medium" remains unresolved in modern interface design.

### Xerox PARC (1970-1983)

**What came from PARC:** The GUI (windows, icons, menus, pointer), Ethernet, laser printing, object-oriented programming, PostScript, WYSIWYG editing, and the modern personal computer concept.

**The PARC lesson for us:** A small group of brilliant people, given resources and intellectual freedom, can invent the future. But PARC also failed to commercialize most of its inventions — Apple and Microsoft did. Invention without execution leaves value on the table. This is the Kurahi/KODA KENKŌ challenge: can we both invent AND execute?

### Don Norman (UCSD, Apple, Nielsen Norman Group)

**Core contribution:** Brought cognitive science to interface design. Coined "user experience" (1993, at Apple). Wrote _The Design of Everyday Things_ (1988), which remains the most important single book in design.

**Key concepts:**

- **Affordances:** The perceived and actual properties of an object that determine how it can be used. A button affords pressing. A handle affords pulling. Good design makes affordances visible.
- **Signifiers:** The perceivable indicators that communicate where actions should take place. A label on a button. An underline on a link. Signifiers make affordances discoverable.
- **Conceptual models:** The user's mental model of how something works. Design must bridge the gap between the system model (how it actually works) and the user's mental model (how they think it works). The smaller the gap, the more intuitive the interface.
- **Gulf of Execution vs. Gulf of Evaluation:**
  - _Gulf of Execution:_ The gap between the user's goal and the actions needed to achieve it. Reduce by making actions match intentions.
  - _Gulf of Evaluation:_ The gap between the system state and the user's understanding of it. Reduce by making system state visible and interpretable.
- **7 Stages of Action:** Goal → Plan → Specify → Perform → Perceive → Interpret → Compare. This cycle describes every human interaction with any system. Design for each stage.

### Ben Shneiderman (University of Maryland)

**Core contribution:** Direct manipulation, information visualization, the 8 Golden Rules of Interface Design.

**8 Golden Rules:**

1. Strive for consistency
2. Enable frequent users to use shortcuts
3. Offer informative feedback
4. Design dialogs to yield closure
5. Offer simple error handling
6. Permit easy reversal of actions
7. Support internal locus of control (users feel in charge)
8. Reduce short-term memory load

**Direct manipulation principles:**

- Continuous representation of the object of interest
- Physical actions or labeled button presses instead of complex syntax
- Rapid, incremental, reversible operations whose impact is immediately visible

### Jef Raskin (Apple, 1978-1982; _The Humane Interface_, 2000)

**Core contribution:** Initiated the Macintosh project. Later wrote the most rigorous theoretical treatment of interface design.

**Key concepts:**

- **Modelessness:** A mode is a state where the same action produces different results. Modes cause errors because the user loses track of the current mode. VI has modes; emacs-style editors are modeless. Modal dialogs should be avoided when possible.
- **Monotony of interface:** The same action should always produce the same result, everywhere in the system. This is violated constantly in modern software.
- **Locus of attention:** Design for where the user's attention is, not where you want it to be. The user's attention is a single, limited resource. Don't steal it.
- **Quantification of interaction:** Raskin proposed GOMS (Goals, Operators, Methods, Selection rules) as a way to mathematically measure interface efficiency. He argued that interface quality can be measured, not just felt.

---

## Cognitive Foundations

### Mental Models (Johnson-Laird, 1983; Gentner & Stevens, 1983)

Users construct mental models of how systems work. These models are:

- **Incomplete:** Users don't need to know everything
- **Unstable:** Details are forgotten over time
- **Unsystematic:** Users don't reason logically about systems; they pattern-match
- **Parsimonious:** Users prefer simple explanations over accurate ones
- **Superstitious:** Users develop causal beliefs about unrelated events

**Design implication:** Never expect users to understand your system architecture. Design for their mental model, not your code model.

### Cognitive Load Theory (Sweller, 1988)

Working memory is limited (Miller's 7±2, more like 4±1 for complex items). Design must manage three types of cognitive load:

- **Intrinsic load:** The inherent complexity of the task. Can't be reduced without changing the task.
- **Extraneous load:** Unnecessary cognitive burden imposed by poor design. THIS IS WHAT GOOD DESIGN ELIMINATES.
- **Germane load:** The mental effort used for learning and schema formation. THIS IS WHAT GOOD DESIGN PRESERVES.

**The design goal:** Eliminate extraneous load, manage intrinsic load, and create space for germane load.

### Fitts' Law (Fitts, 1954) — The fundamental law of interaction

```
MT = a + b × log₂(2D/W)

Where:
MT = Movement Time (how long it takes to reach a target)
D  = Distance to target
W  = Width of target
```

**Corollaries:**

- Larger targets are faster to hit (logarithmic scaling)
- Closer targets are faster to hit (logarithmic scaling)
- Screen edges and corners are "infinite" targets (W = ∞, MT = 0)
- Pixel-level targets are impossible to hit reliably (W → 0, MT → ∞)

**For us:**

- macOS menu bar at top edge = infinite height target. Windows taskbar at bottom = same.
- Buttons should be at least 44×44px (24×24 is too small — MT is 2× longer)
- Important actions should be closer to the user's current cursor/finger position
- Context menus at the cursor position exploit Fitts' Law maximally (D ≈ 0)

### Hick's Law (Hick, 1952; Hyman, 1953)

```
RT = a + b × log₂(n)

Where:
RT = Reaction Time (decision time)
n  = Number of choices
```

**The logarithmic nature is forgiving but real:** Going from 1 to 2 choices doubles decision time. From 2 to 4 doubles again. From 4 to 8 doubles again. BUT: after about 8 items, additional items add very little extra time. This is why 5-9 items is the sweet spot for menus.

**For us:**

- Navigation menus: ≤ 7 items
- Filter categories: group into ≤ 7 logical chunks
- Form fields: progressive disclosure rather than all at once
- Settings pages: search, don't browse

### Steering Law (Accot & Zhai, 1997)

Fitts' Law for paths (tunnels, sliders, scroll bars). Moving through a constrained path:

```
MT = a + b × (A/W)

Where:
A = Path length (amplitude)
W = Path width (constraint tightness)
```

**For us:**

- Sub-menus (the path through nested menus) follow the Steering Law
- Nested dropdowns are inherently slow because the path is narrow
- Cascading menus should be avoided for frequent operations

### Power Law of Practice (Snoddy, 1926; Newell & Rosenbloom, 1981)

```
T_n = T_1 × n^(-α)

Where:
T_n = Time on nth trial
T_1 = Time on first trial
α   = Learning rate (typically 0.2-0.4)
```

Time to perform a task decreases predictably with practice (≈20% reduction per doubling of trials). After 100 repetitions, a task takes about 40% of the original time.

**For us:**

- Novice and expert users have fundamentally different needs
- Shortcuts are valuable (they cut a path through the practiced task)
- Don't optimize the UI for first-time use at the expense of repeated use
- Onboarding should be a gradient: guide novices, get out of experts' way

---

## The Ethics of Interface Design

### Tristan Harris (Google, Center for Humane Technology)

**Core warning:** Design that maximizes engagement can maximize addiction. The same techniques that make interfaces "sticky" (variable rewards, infinite scroll, notification anxiety) exploit the same neural pathways as slot machines.

**For us (healthcare AI context):**

- Never design for "engagement" when the user is a doctor making clinical decisions
- Don't optimize for time-in-app — optimize for task completion and accuracy
- If our product makes doctors spend MORE time with screens and LESS time with patients, we have failed
- Clinical AI should reduce cognitive burden, not add notification burden

### Value-Sensitive Design (Friedman & Kahn, 1992-present)

Design encodes values, whether intentionally or not. A system that prioritizes speed over accuracy encodes a value. A system that defaults to sharing data over privacy encodes a value.

**For us:**

- KODA KENKŌ must encode: patient wellbeing, clinical accuracy, doctor autonomy, data privacy
- These values must be visible in the interface, not just the privacy policy
- Default settings should reflect the safest, most private option
