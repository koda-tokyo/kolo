# Color Science — Generating Palettes from First Principles

## Color Is Math, Not Taste

Color preference is subjective. Color harmony is mathematical. Trust the math, not your gut.

---

## The Three Dimensions of Color

Every color exists in 3D space. Master these three dimensions before you touch a color picker.

### Hue (What color?)
The position on the color wheel (0-360°). Red=0°, Green=120°, Blue=240°.

### Saturation (How intense?)
0% = gray. 100% = pure color. Most UI should live in the 10-80% saturation range. Pure saturation is for accents and emphasis only. Full-saturation backgrounds are painful.

### Lightness (How bright?)
0% = black. 100% = white. The most important dimension for accessibility. Contrast = lightness difference, not hue difference.

---

## Palette Generation Strategies

### Strategy 1: Monochromatic (Safest)
**One hue + varying saturation and lightness.**
```
H: 220° (blue) — fixed
S: 20% → 10% → 5% → 2% (decreasing for lighter shades)
L: 20% → 40% → 60% → 85% → 95% (increasing for lighter shades)
```
**Feels:** Clean, focused, minimal.
**When:** Enterprise apps, dashboards, tools where content matters more than brand.
**Risk:** Can feel cold/sterile. Add warmth to neutrals (see § Neutral Scales).

### Strategy 2: Analogous (Harmonious)
**Adjacent hues on the wheel (within 30-60° of each other).**
```
Primary: H: 220° (blue)
Secondary: H: 190° (teal) or H: 250° (indigo)
```
**Feels:** Cohesive, natural, peaceful.
**When:** Wellness, health, education, environmental.
**Risk:** Low contrast between hues. Compensate with lightness difference.

### Strategy 3: Complementary (Dynamic)
**Opposite hues on the wheel (180° apart).**
```
Primary: H: 220° (blue)
Accent: H: 40° (orange/gold)
```
**Feels:** Energetic, bold, high-impact.
**When:** Consumer apps, marketing, CTAs, anything needing visual pop.
**Rule:** One color dominates (80-90% of color use). The complement is ONLY for accents/CTAs. Equal split = visual war.

### Strategy 4: Neutral + Accent (The Enterprise Default)
**Gray scale + ONE accent hue.**
```
Neutrals: No hue (or very slight warmth/coolness). S: 0-5%.
Accent: One saturated hue at various lightnesses for buttons, links, highlights.
```
**Feels:** Professional, trustworthy, invisible.
**When:** B2B SaaS, enterprise, finance, medical, government.
**Why it works:** The neutral scale carries all the UI. The accent only appears where the user needs to act. This creates natural visual hierarchy — color = action.

---

## Building a 10-Shade Scale

Every color in a UI system needs a 10-shade scale from darkest (50) to lightest (950). Here's how to generate one:

```
Shade  L%    Purpose
50     10    Text on light backgrounds (highest contrast)
100    20    Secondary text
200    30    Disabled text, subtle borders
300    40    Borders, dividers
400    55    Placeholder text, icons
500    70    Middle — rarely used directly
600    80    Light backgrounds, hover states
700    88    Surface backgrounds (cards on white)
800    93    Page background (light gray)
900    97    Page background (near-white)
950    100   White
```

**The curve is logarithmic, not linear.** Lightness steps get smaller as you go lighter (more steps in the bright range where subtlety matters).

### Accent Scale (colored)
```
Shade  L%    Purpose
50     15    Text on accent backgrounds
100    25    —    
200    35    —
300    45    —  
400    55    Primary button background
500    65    Primary button hover
600    75    Light accent background
700    85    Very light accent background
800    92    Accent surface color
900    96    Subtle accent tint
```

---

## Neutral Scales — Grays with Character

"Gray" is never truly neutral. Every gray has a temperature. Choose consciously:

**Cool grays (blue undertone):**
- `hsl(220, 5%, L%)` — Clean, modern, technological
- Best for: SaaS, developer tools, data visualization
- Risk: Can feel cold/institutional

**Warm grays (yellow/red undertone):**
- `hsl(30, 5%, L%)` — Soft, human, approachable
- Best for: Health, wellness, content, social
- Risk: Can feel "dirty" if too warm

**True neutral:**
- `hsl(0, 0%, L%)` — Actually neutral
- Best for: Photography, design tools, color-critical apps
- Risk: Can feel lifeless

**Rule of thumb:** If your accent is cool (blue, green, indigo), use cool grays. If your accent is warm (orange, red, amber), use warm grays.

---

## Accessibility by Construction

### Contrast Ratios (WCAG 2.2)
- **AA normal text:** 4.5:1 minimum
- **AA large text (≥18px bold or ≥24px):** 3:1 minimum
- **AAA normal text:** 7:1 minimum

### Build contrast into the scale
Don't check contrast after designing. Build scales that are contrast-safe by construction:

```
Text color:      Shade 50  (L:10%) on Shade 950 (L:100%) → ~15:1 ✓
Secondary text:  Shade 100 (L:20%) on Shade 950 (L:100%) → ~10:1 ✓
Disabled text:   Shade 300 (L:40%) on Shade 950 (L:100%) → ~4:1  ✓ (large text only)
```

### The Grayscale Test
Toggle the design to grayscale. If the hierarchy disappears, color was doing all the work. Fix the lightness values.

---

## Color Psychology — The Quick Map

| Color | Primary association | Best product fit | Avoid when |
|-------|-------------------|-----------------|------------|
| Blue | Trust, stability, professionalism | Enterprise, finance, healthcare, SaaS | Food, environmental (unless water) |
| Green | Growth, health, nature, success | Health, wellness, fintech, environmental | Luxury (unless emerald/dark) |
| Red | Urgency, passion, danger, excitement | CTAs, food delivery, sales, gaming | Healthcare (red = blood/error), finance (red = loss) |
| Orange | Energy, warmth, affordability | Consumer, education, food, CTAs | Luxury, formal enterprise |
| Purple | Luxury, creativity, wisdom | Beauty, education, AI, gaming, spirituality | Industrial, military |
| Teal | Calm, clarity, sophistication | Healthcare, wellness, HR, mental health | High-energy brands, sports |
| Yellow | Optimism, clarity, warning | Education, children, "caution" states | Long-form reading, healthcare (jaundice) |
| Pink | Compassion, femininity, playfulness | Beauty, fashion, social, women's health | Male-targeted products, enterprise |

---

## Quick Palette Generator

Given a single anchor color (chosen for meaning, not taste):

1. **Find the hue** (H value)
2. **Generate analogous neighbors** (±15-30° for a 3-hue palette)
3. **Build the neutral scale** (cool or warm, matching accent warmth)
4. **Add semantic colors** (red=error, amber=warning, green=success, blue=info)
5. **Build the 10-shade scale for each**
6. **Test grayscale** → Adjust lightness until hierarchy holds without color
7. **Test contrast** → All text passes AA minimum against its background

**Never:** Pick palette from a website without understanding the hue relationships. Copying hex codes without the underlying harmony math is cargo-cult design.
