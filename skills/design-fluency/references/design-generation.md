# Design Generation — The Creative Methodology

## The Blank Canvas Problem

Starting without reference is the hardest design skill. The empty screen paralyzes. References provide a starting point but constrain originality.

**The fix:** Don't start from "what should this look like?" Start from constraints. Design is decision-making under constraints. Add constraints deliberately and creativity becomes a series of choices, not a divine bolt.

---

## The 6-Step Generation Method

### Step 1: Define the Container
**Decision:** What's the viewport? 375px mobile? 1440px desktop? Both?
**Why first:** Every composition decision hangs on the frame. You can't arrange things without knowing the edges.
**Output:** Width × height. Responsive breakpoints if multi-device.

### Step 2: Name the Feeling
**Decision:** One emotion. Not a color, not a layout, not a font. A feeling.
**Why second:** Feeling drives all visual decisions. "Clean and trustworthy" produces different shapes than "bold and disruptive."
**Prompt:** "When a user opens this, they should feel _______."
**Anti-pattern:** Skipping this step. Going straight to "I'll use blue" is designing without intent. Blue might be wrong for the feeling.

### Step 3: Choose the Spatial System
**Decision:** Proportion system + composition pattern. Pick from `visual-composition.md`.
**Why third:** The skeleton goes down before the paint. Get the bones right and the surface almost paints itself.
**Test:** Wireframe one screen in grayscale rectangles. Does the layout work without color, typography, or content? If not, the skeleton is wrong.

### Step 4: Build the Color Palette
**Decision:** Color strategy from `color-science.md`.
**Why fourth:** Color applied to a bad skeleton can't fix it. Color applied to a good skeleton amplifies it.
**Test:** Apply palette to the grayscale wireframe. Run the grayscale test again. Hierarchy must hold.

### Step 5: Select the Typographic Voice
**Decision:** Heading font + body font from `visual-composition.md § Typographic Voice`.
**Why fifth:** Type is the last visual layer — it needs the color and space context to work.
**Test:** Set real text (not lorem ipsum) in the wireframe with real colors. Does it read naturally?

### Step 6: Add the Motion Language
**Decision:** Motion tokens from `motion-design.md`.
**Why last:** Motion is icing. You need the cake first.
**Test:** Animate one interaction. Does it answer one of the 4 motion questions? If not, cut it.

---

## The Constraint Injection Trick

When stuck, ADD constraints instead of removing them. Constraints reduce the decision space:

| Stuck on... | Add this constraint |
|-------------|-------------------|
| Layout | "This must work at 375px first" |
| Colors | "Only one hue, plus grays" |
| Typography | "Only system fonts" |
| Spacing | "Only multiples of 8px" |
| Overall direction | "This is for a medical setting — nothing playful" |

Paradoxical truth: **More constraints = easier design.** Unlimited freedom is the hardest brief.

---

## The Hero Screen Method

Don't design all screens at once. Design ONE hero screen to completion (visual, UX, copy, states). The hero screen is the most representative screen — usually the main dashboard, the primary feed, or the key detail view.

**Why it works:** The hero screen forces all the design decisions (colors, type, spacing, composition, component style). Every other screen inherits from it. You're not designing N screens — you're designing 1 system and applying it N times.

**How to pick the hero:**
- If the app has a dashboard → dashboard
- If it's content-first → article/reading view
- If it's a tool → the primary task screen
- If it's social → the feed

---

## The 3-Version Iteration

For any screen, generate 3 versions rapidly before refining:

1. **The Safe Version:** What everyone else does. Conservative. Works but generic.
2. **The Bold Version:** Push one thing to extreme. Giant typography, or minimal chrome, or maximal whitespace.
3. **The Weird Version:** Break one rule deliberately. What if the navigation was at the bottom? What if there was no header?

**Why:** The final design often lives between versions 1 and 2, with one idea stolen from version 3. You can't see the middle ground until you've mapped the edges.

---

## Design Decision Journal

When generating original designs, keep a running decision log:

```
Decision: [What was chosen]
Why: [Reasoning — emotional brief, constraint, or principle]
Alternatives considered: [What else was possible]
Test result: [Did it work when applied?]
```

**Why:** Original design involves 50-100 micro-decisions. Without a journal, you forget WHY you chose something and can't iterate intelligently. The journal also prevents endless cycling — "we already tried the warm palette and rejected it because it felt consumer-y, not clinical."

---

## Common Generation Failures (and Fixes)

| Failure | Cause | Fix |
|---------|-------|-----|
| "It looks like everything else" | Started with reference, not constraints | Go back to Step 2. What feeling? What makes this product DIFFERENT? |
| "It looks chaotic" | No proportion system locked in | Step 3. Pick ONE proportion system. Enforce it everywhere. |
| "It looks cold/lifeless" | Neutral grays, no warmth | Warm the neutral scale by 15-30° hue. Add one organic shape or curve. |
| "The hierarchy is flat" | Spacing and lightness too uniform | Increase contrast. Make the level-1 element BIGGER. Add more negative space around it. |
| "The colors clash" | Multiple saturated hues competing | Reduce saturation on everything except ONE accent. Move secondary hue to analogous (within 30°). |
| "It looks like a wireframe" | Skeleton without surface | Colors and typography are too neutral. Add the accent. Add a second font for contrast. Add subtle texture (border, shadow, gradient). |
| "It's too busy" | Every element competing for attention | Kill 30% of elements. Then kill 30% of what remains. Negative space = confidence. |

---

## When to Use This Skill vs. Others

| Scenario | Use |
|----------|-----|
| "I have no idea what this should look like" | `design-fluency` — full generation method |
| "I have screenshots of something similar" | `enterprise-ui-design` — systematize the reference |
| "I have a Figma file to implement" | `figma` → `enterprise-ui-design` → `react-web` |
| "I have design tokens, need UX flows" | `ux-patterns` |
| "I have everything designed, need code" | `react-web` / `react-native-mobile` |
| "I have a complete product, need QA" | `frontend-design-engineering` Phase 4 gates |

**Rule of thumb:** If the question starts with "What should...", use `design-fluency`. If it starts with "How should I implement...", use a code skill.
