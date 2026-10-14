# Motion Design — Animation as Communication

## Motion Is Not Decoration

Every animation should answer one of these questions:
- **Where did that go?** (orientation in space)
- **What just happened?** (causality / feedback)
- **Where should I look?** (attention direction)
- **What does this feel like?** (personality / brand)

If an animation answers none of these, it's decoration. Cut it.

---

## The Animation Lexicon

### Duration — How Long?

| Context | Duration | Why |
|---------|----------|-----|
| Micro-interaction (button press, toggle, hover) | 100-150ms | Below 100ms is invisible. Above 200ms feels sluggish for direct manipulation. |
| Element entry/exit (modal open, tooltip, dropdown) | 150-250ms | Enough to be visible, fast enough to feel responsive. |
| Page transition (route change, view switch) | 200-400ms | Slower — signals a larger context change. |
| Complex choreography (staggered list, dashboard load) | 300-600ms total (50-100ms stagger per item) | Orchestrated entrance. Each item fast, but staggered. |
| Ambient / atmospheric (background, idle states) | 1000-3000ms | Slow enough to be subliminal. |

**The 200ms threshold:** Below 200ms = "I did something" (reactive). Above 200ms = "something is happening" (narrative).

**Duration and distance:** Larger movements need more time. Small movements at 300ms feel sluggish. Large movements at 100ms feel jarring.

### Easing — How Does It Move?

**Linear:** Constant speed. **Never use for UI.** Nature doesn't move linearly. It looks robotic.

**Ease-out (decelerate):** Fast start, slow end. Default for UI elements entering the screen. The eye tracks the landing point — make the landing gentle.

**Ease-in (accelerate):** Slow start, fast end. Use for elements LEAVING the screen. The eye doesn't need to track the exit point.

**Ease-in-out:** Slow start, slow end, fast middle. Use for elements that move within the same view (carousel, tab switch, position change). Symmetrical = natural.

**Spring (physics-based):** Overshoot then settle. Use for playful interactions (pull-to-refresh, drag release, notification bounce). Never for frequent UI — spring fatigue is real.

### Easing Curve Reference (CSS cubic-bezier)

| Name | cubic-bezier() | Feel | When |
|------|---------------|------|------|
| Ease Out (standard) | `cubic-bezier(0.25, 0.1, 0.25, 1.0)` | Smooth deceleration | Default for enter animations |
| Ease In | `cubic-bezier(0.42, 0.0, 1.0, 1.0)` | Accelerating exit | Elements leaving screen |
| Ease In Out | `cubic-bezier(0.42, 0.0, 0.58, 1.0)` | Symmetrical | In-view transitions |
| Sharp (custom) | `cubic-bezier(0.2, 0.0, 0.0, 1.0)` | Snappy, professional | Enterprise UI, data dashboards |
| Bouncy (custom) | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` | Playful overshoot | Consumer apps, delight moments |
| Smooth (custom) | `cubic-bezier(0.4, 0.0, 0.2, 1.0)` | Material Design standard | All-purpose Google-style |

**Tailwind v4 equivalents:**
```css
@theme {
  --ease-out: cubic-bezier(0.25, 0.1, 0.25, 1);
  --ease-in: cubic-bezier(0.42, 0, 1, 1);
  --ease-in-out: cubic-bezier(0.42, 0, 0.58, 1);
  --ease-sharp: cubic-bezier(0.2, 0, 0, 1);
  --ease-bouncy: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-material: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## Motion Design Patterns

### Pattern 1: Page Transitions

**Fade + slight Y shift (10-20px):**
```css
.page-enter {
  animation: fade-in 300ms var(--ease-out),
             slide-up 300ms var(--ease-out);
}
@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes slide-up { from { transform: translateY(12px); } to { transform: translateY(0); } }
```
**When:** Route changes in SPAs, modal opens, view switches.
**Direction:** Forward = slide-up. Back = slide-down. Hierarchy = slide-left. Detail = slide-right.

### Pattern 2: Staggered List Entry

```
Item 1: delay 0ms,   duration 200ms
Item 2: delay 50ms,  duration 200ms
Item 3: delay 100ms, duration 200ms
Item 4: delay 150ms, duration 200ms
...
```
**When:** Dashboard load, search results, timeline entries.
**Max items to stagger:** 10-15. Beyond that the total time feels slow. Switch to instant load.
**Algorithm:** staggerMs = min(50, 600 / itemCount). Never exceed 600ms total.

### Pattern 3: Micro-Interactions

**Button press:** Scale 1.0 → 0.97 → 1.0 in 100ms. Barely visible, but the finger "feels" it.
**Toggle switch:** Thumb slides with ease-out in 150ms. Color changes simultaneously.
**Checkbox:** Check mark draws in 100ms (stroke-dashoffset animation).
**Favorite/Like:** Scale 1.0 → 1.3 → 1.0 in 300ms with spring easing. Color change simultaneous.

### Pattern 4: Skeleton Loading

```css
.skeleton {
  background: linear-gradient(90deg, 
    var(--color-surface-700) 25%, 
    var(--color-surface-600) 50%, 
    var(--color-surface-700) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
```
**Duration:** 1.5s for shimmer cycle. Faster = anxiety. Slower = feels broken.

### Pattern 5: Attention / Notification

**Gentle pulse:** Scale 1.0 → 1.05 → 1.0 over 400ms, once. Subtle.
**Badge count change:** Scale pop on new number. Old number slides up and out.
**Toast notification:** Slide in from top/right (300ms ease-out), auto-dismiss after 5s with fade (200ms ease-in).

---

## Motion Design System — Define These Tokens

Every product needs these motion tokens defined before implementation:

```css
@theme {
  /* Durations */
  --duration-instant: 100ms;    /* Button press, toggle, hover feedback */
  --duration-fast: 150ms;       /* Element enter/exit, dropdown, tooltip */
  --duration-normal: 250ms;     /* Modal, sheet, dialog */
  --duration-slow: 400ms;       /* Page transition, view switch */
  --duration-glacial: 1000ms;   /* Ambient, background animations */

  /* Easings */
  --ease-out: cubic-bezier(0.25, 0.1, 0.25, 1);      /* Enter */
  --ease-in: cubic-bezier(0.42, 0, 1, 1);             /* Exit */
  --ease-in-out: cubic-bezier(0.42, 0, 0.58, 1);      /* In-view movement */
  --ease-sharp: cubic-bezier(0.2, 0, 0, 1);            /* Enterprise snappy */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);   /* Delight */

  /* Scale values for micro-interactions */
  --scale-press: 0.97;
  --scale-pop: 1.05;
  --scale-bounce: 1.15;
}
```

---

## Choreography Principles

### Principle 1: One Thing at a Time
Don't animate everything simultaneously. The eye can only track one moving thing. Stagger. Lead with the most important element, follow with the rest.

### Principle 2: Motion Has Direction
Elements should move in a direction that makes spatial sense. Modal? Comes from the element that triggered it. New page? Slides in the direction of "forward." Back? Reverse direction.

### Principle 3: Speed Communicates Importance
Fast = urgent, reactive, system-initiated. Slow = deliberate, narrative, user-paced.

### Principle 4: Respect Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
Some users have vestibular disorders. Motion makes them physically ill. Always honor this.

### Principle 5: Motion Should Be Subtle by Default
If someone NOTICES your animation on first use, it might be too much. Good motion is felt, not seen. Reserve noticeable animation for moments of delight (completion, achievement, welcome).

---

## The Motion Design Checklist

Before shipping any animation:
- [ ] What question does this animation answer? (orientation/causality/focus/personality)
- [ ] Duration appropriate for the context?
- [ ] Easing curve intentional, not default?
- [ ] `prefers-reduced-motion` respected?
- [ ] Does it survive 100 repetitions? (If annoying at 100x, it's annoying at 5x)
- [ ] Works at 60fps on target devices? (No jank, no dropped frames)
- [ ] Entry AND exit animations defined? (Elements that appear must also disappear gracefully)
