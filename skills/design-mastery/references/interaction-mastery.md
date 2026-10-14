# Interaction Mastery — Advanced IxD Theory and Practice

## The Laws of Interaction (Beyond Fitts' and Hick's)

### Steering Law (Accot & Zhai, 1997)
Generalization of Fitts' Law for constrained paths (tunnels, menus, sliders):
```
MT = a + b × (A/W)
```
**Key insight:** The wider the path relative to its length, the faster the movement.
- Cascading menus (narrow path, long distance) = slow
- Linear menus (direct path, wide target) = fast
- Radial/pie menus (short distance, wedge-shaped targets) = very fast

### The Serial Position Effect
Users remember first and last items best (primacy and recency effects). Middle items are forgotten.
**For navigation:** Put most important items first. Put second-most important items last. Everything else in the middle.

### Miller's Law (7±2) — Corrected
Miller found that short-term memory holds 7±2 "chunks." But a "chunk" is variable. A random digit string of 7 is memorizable. A random word string of 7 is memorizable. But a string of 7 unrelated concepts? No.

**Modern understanding:** Working memory is closer to 4±1 for complex items (Cowan, 2001). For interface design, assume the user can hold 3-5 things in mind while interacting.

**For forms, wizards, and multi-step processes:** Show completed steps. Don't make users remember what they entered on page 1 while filling page 3.

### Tesler's Law (Conservation of Complexity)
"Every application has an inherent amount of irreducible complexity. The only question is who will have to deal with it — the developer or the user."

**The corollary (Larry Tesler's actual argument):** Make the engineer deal with complexity so the user doesn't have to. This is why we have engineers. If a user has to understand your database schema to use the UI, you've failed.

### The Pareto Principle (80/20 Rule)
80% of users use 20% of features. Design for the 20% that 80% use. Don't make the 20% harder to find because of the 80% that most users never touch.

**Implementation:** Progressive disclosure. Common features visible. Advanced features one click deeper.

### Jakob's Law
"Users spend most of their time on other websites."
Your users bring expectations from the entire web. If your checkout looks nothing like any other checkout, users will struggle.

**Practical:** Use conventions. The search bar goes at the top. The logo links to home. The cart is in the top right. Undo is Ctrl+Z. Don't innovate here. Innovate where it matters.

### Postel's Law (Robustness Principle)
"Be conservative in what you do, be liberal in what you accept from others."
- Accept flexible input (spaces in credit cards, dashes in phone numbers, "y" for "yes")
- Provide predictable output (consistent behavior, clear feedback)
- Handle edge cases gracefully (not "invalid input" — "Enter your phone as XXX-XXX-XXXX")

### The Peak-End Rule (Kahneman)
People judge experiences by their peak (most intense moment) and their end (how it finishes). The duration of the experience is barely weighted.

**For UX:**
- Make the completion moment satisfying (confetti, clear success message)
- Handle errors well — a single bad error experience defines the whole interaction
- The end of a flow matters disproportionately (order confirmation, task completion, welcome screen)

### The Aesthetic-Usability Effect (Kurosu & Kashimura, 1995; Tractinsky, 2000)
Users perceive aesthetically pleasing interfaces as more usable — even when they're functionally identical. Beautiful design creates a halo of perceived quality that makes minor usability issues more forgivable.

**This is why visual design matters.** It's not vanity. It's functional. But: the effect only works for MINOR usability issues. A beautiful interface that deletes user data won't be forgiven.

### The Von Restorff Effect (Isolation Effect)
When multiple similar objects are present, the one that differs from the rest is most likely to be remembered.
**For CTAs:** Make the primary button visually distinct. If all buttons look the same, none stands out. The primary CTA should be the "one that differs."

---

## Micro-Interaction Architecture (Saffer, 2013)

Every micro-interaction has four parts:

### 1. Trigger — What starts it?
- **User-initiated:** Button click, swipe, voice command, keyboard shortcut
- **System-initiated:** Notification, alarm, condition met, time elapsed

**Design rules:**
- Triggers must be discoverable (user-initiated) or non-disruptive (system-initiated)
- False triggers are frustrating (accidental activation)
- Missed triggers are missed functionality
- The trigger should communicate what will happen (label, icon, affordance)

### 2. Rules — What happens?
The logic that determines the micro-interaction's behavior.
**Design rules:**
- Rules should be deterministic and predictable
- Same trigger = same result (modelessness, per Raskin)
- Rules should be discoverable through use (not requiring documentation)

### 3. Feedback — What does the user perceive?
Visual, auditory, or haptic response that communicates what happened.
**Design rules:**
- Feedback must be immediate (within 100ms for direct manipulation)
- Feedback must be proportional (small action = small feedback)
- Feedback should answer: "Did it work? What happened? What's the new state?"

### 4. Loops and Modes — What happens over time?
Does the interaction repeat? Does it change state?
**Design rules:**
- Loops should have clear exit conditions (infinite loops are infinite frustration)
- Modes should be clearly indicated (if the same action now does something different, the user must know)
- Long-running loops need progress indicators (not spinners — progress bars)

---

## Advanced Input Modalities

### Touch (Mobile-First Physics)
**Thumb zones (Scott Hurff, 2014):**
```
┌──────────────────┐
│  HARD TO REACH   │ ← Top of screen
│                  │
│  STRETCH         │
│                  │
│══════════════════│ ← Natural thumb arc
│  EASY / NATURAL  │
│                  │
│  BEST ZONE       │ ← Bottom of screen
└──────────────────┘
```
- Primary actions: bottom of screen
- Navigation: bottom tab bar
- Destructive actions: top (harder to accidentally trigger) or require confirmation
- One-handed use: 75% of users use phones one-handed (Google research)

### Gesture Design Principles
1. **Gestures are hidden affordances** — they must be taught or discovered
2. **Every gesture needs a visible alternative** — accessibility requirement
3. **Gestures should feel physical** — inertia, friction, spring-back
4. **Avoid gesture conflicts** — don't let swipe-to-delete conflict with swipe-to-navigate
5. **Distinguish by context** — same gesture, different meaning depending on where/when

### Keyboard Interaction
**For power users and accessibility:**
- Tab order must be logical (DOM order = visual order)
- All interactive elements must be focusable
- Escape closes modals, dropdowns, popups
- Enter confirms, Space toggles
- Arrow keys navigate within components (tabs, menus, lists, sliders)
- Keyboard shortcuts for frequent operations (⌘K command palette, ⌘S save)

### Voice / Conversational UI
**When voice works:**
- Hands-free contexts (driving, cooking, surgery)
- Simple, constrained commands ("set timer for 10 minutes")
- Information retrieval with clear answers ("what's my next meeting?")

**When voice fails:**
- Complex data entry (spreadsheets, forms)
- Browsing/discovery (you can't "skim" audio)
- Privacy-sensitive contexts (public spaces, sensitive content)
- Multi-step processes without clear mapping

---

## Information Architecture (Morville & Rosenfeld)

### The Four IA Systems
1. **Organization:** How information is categorized and structured (taxonomy, hierarchy)
2. **Navigation:** How users move through information (menus, search, links)
3. **Labeling:** How information is named (terminology, icon labels, headings)
4. **Search:** How users find specific information (search bar, filters, facets)

### Information Scent (Pirolli & Card, 1999)
Users "forage" for information like animals forage for food. They follow "scent" — cues that suggest relevant information lies ahead. If the scent is weak (ambiguous labels, unclear navigation), users abandon the path.

**Information foraging theory:**
- Users evaluate: is the expected value of continuing > expected cost?
- If navigation labels are clear (strong scent) → continue
- If navigation labels are vague (weak scent) → abandon, try search, or leave
- Users optimize for satisficing (good enough), not optimizing (best possible)

**Practical:**
- Navigation labels must predict content accurately
- Link text must describe the destination (never "click here")
- Search results must show context (not just titles)

### Faceted Classification
Instead of single hierarchy, allow filtering by multiple independent dimensions (facets):
- E-commerce: Size + Color + Brand + Price
- Medical records: Date + Department + Severity + Doctor
- Files: Type + Date Modified + Owner + Project

**Why facets win:** Single hierarchies force one viewpoint. Facets support multiple mental models simultaneously.
