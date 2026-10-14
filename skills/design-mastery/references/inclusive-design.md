# Inclusive Design — Universal, Accessible, Equitable

## Beyond Accessibility Compliance

WCAG 2.2 AA is the floor, not the ceiling. Inclusive design goes beyond checklists to fundamental questions: Who are we excluding? Why? How do we include them?

### The Three Dimensions of Inclusive Design (Microsoft, 2016)

1. **Recognize exclusion.** Design is always biased toward the designer's abilities, context, and assumptions. Recognizing this is the first step.

2. **Learn from diversity.** People with disabilities, people from different cultures, people with different cognitive styles — they are not edge cases. They are experts in their own experience. Design WITH them, not FOR them.

3. **Solve for one, extend to many.** Designing for a specific disability often produces solutions that benefit everyone. Closed captions → used in noisy bars. Curb cuts → used by cyclists, strollers, luggage. High-contrast mode → used in sunlight.

---

## The Spectrum of Ability (Not Binary)

### Visual
**Spectrum, not binary blind/sighted:**
- Low vision (acuity, contrast sensitivity)
- Color blindness (8% of males, 0.5% of females)
- Tunnel vision (field loss)
- Blur (focus issues)
- Light sensitivity (photophobia)

**Design implications:**
- Don't rely on color alone to convey information (always add text/icon/shape)
- Support 200-400% zoom without horizontal scrolling
- Ensure 4.5:1 contrast minimum, 7:1 preferred
- Don't disable pinch-to-zoom on mobile (accessibility + usability violation)

### Motor
**Spectrum, not binary abled/paralyzed:**
- Tremor (essential tremor, Parkinson's)
- Limited reach/range of motion
- Fine motor control reduction (arthritis, aging)
- Temporary motor impairment (broken arm, holding baby)
- Situational (gloves, wet hands, one-handed phone use)

**Design implications:**
- Touch targets ≥ 44×44px (48×48 for medical applications)
- Adequate spacing between interactive elements (no mis-taps)
- Keyboard navigation for everything (not just "accessible enough")
- Voice input as alternative to typing/handwriting
- Undo for destructive actions (tremor mis-clicks are inevitable)
- No time-dependent interactions (no "click within 5 seconds")

### Auditory
**Spectrum, not binary hearing/deaf:**
- Partial hearing loss (age-related, noise-induced)
- Single-sided deafness
- Auditory processing disorder (hear but don't understand)
- Situational (noisy environment, can't use speakers)

**Design implications:**
- All audio must have text alternatives (transcripts, captions)
- Alerts must have visual + haptic alternatives to sound
- Don't auto-play audio
- Captions should identify speaker and describe significant sounds

### Cognitive
**Spectrum, not binary neurotypical/neurodivergent:**
- ADHD (attention regulation)
- Dyslexia (reading difficulty)
- Autism spectrum (different information processing)
- Memory impairment
- Anxiety disorders (form fatigue, decision paralysis)
- Traumatic brain injury
- Situational (stress, fatigue, multitasking, intoxication)

**Design implications:**
- Clear, consistent navigation (reduces cognitive load for everyone)
- Progressive disclosure (show only what's needed now)
- Plain language (Flesch-Kincaid grade 8 or lower for general content)
- Predictable interactions (same action = same result)
- Graceful error recovery (don't punish mistakes)
- No time pressure unless absolutely necessary
- No auto-advancing carousels (steals control, causes anxiety)
- Reduce motion option (vestibular disorders)

---

## Global and Cross-Cultural Design

### Cultural Design Dimensions (Hofstede applied to UI)
- **Power distance:** High PDI cultures prefer explicit hierarchy, status indicators, formal language. Low PDI cultures prefer flat navigation, informal tone.
- **Individualism vs. collectivism:** Individualist cultures prefer personalization, "my" accounts. Collectivist cultures prefer group features, shared spaces.
- **Uncertainty avoidance:** High UA cultures prefer clear rules, wizards, guidance. Low UA cultures prefer exploration, flexibility.
- **Long-term orientation:** Short-term oriented cultures prefer immediate results and gratification. Long-term oriented cultures prefer saving, planning, persistence.

### Localization Beyond Translation
- **Date formats:** MM/DD/YYYY (US) vs. DD/MM/YYYY (most of world) vs. YYYY/MM/DD (Japan, China)
- **Name formats:** Given-Family (Western) vs. Family-Given (East Asian, Hungarian)
- **Address formats:** Building-Street-City-Country (most), Country-City-District-Building (Japan), flexible (many)
- **Number formats:** 1,234.56 (US/UK) vs. 1 234,56 (most of Europe) vs. 1'234.56 (Switzerland)
- **Color meanings:** Red = danger/stop (Western), luck/prosperity (China), purity (India)
- **Icon meanings:** Checkmark = correct (Western), incorrect in some Asian education systems. Thumbs up = good (West), offensive in some Middle Eastern countries.
- **Imagery:** People in imagery should represent the user population. Not stock photos of one demographic.

### International Typography
Fonts that work in Latin script don't necessarily work in CJK, Arabic, Devanagari, Cyrillic, Thai, Hebrew:
- **System font stacks per script** are essential
- CJK text needs larger minimum size (complex characters at 12px are illegible)
- Arabic/RTL: entire layout must flip (not just text direction — visual hierarchy, icon placement, timeline direction)
- Line height varies by script (CJK needs taller lines)

---

## Equity-Focused Design

### Design Justice Principles (Sasha Costanza-Chock, 2020)
1. Design is always political. There is no neutral design.
2. Design processes centered on marginalized communities produce better outcomes for all.
3. Design should be led by and with the communities it serves, not imposed on them.
4. Design justice requires redistribution of design's benefits and burdens.

### Health Equity in Digital Health (KODA KENKŌ context)
- **Health literacy:** Grade 6-8 reading level for patient-facing content. Medical terminology in context, with explanations.
- **Digital divide:** Not all patients have smartphones or reliable internet. Design for SMS fallback, clinic-based access, printed alternatives.
- **Language justice:** Translation is the minimum. Cultural adaptation of health concepts matters more.
- **Data sovereignty:** Patients own their health data. Design for data access, portability, and deletion.

### The Curb-Cut Effect
The curb cut (wheelchair ramp at sidewalk corners) was fought for by disability activists. Once installed, it benefited: parents with strollers, cyclists, delivery workers, travelers with luggage, elderly with walkers, children on scooters.

**Principle:** When you design for the excluded, you often solve problems the "included" didn't know they had. Accessibility features become universal expectations.

---

## Accessible Design Patterns

### Focus Management
```
Page load → focus moves to <h1> or skip-link target
Modal open → focus moves to modal container, trapped inside
Modal close → focus returns to triggering element
Route change → focus moves to new page heading
Dynamic content → announce via aria-live region
```

### Screen Reader UX
- Semantic HTML IS accessibility (use `<button>` not `<div onclick>`)
- Headings create a document outline (h1 → h2 → h3, don't skip levels)
- Landmarks: `<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>`
- Alt text: describe what a sighted person would learn from the image
- Decorative images: `alt=""` (empty — not missing)
- Complex images/charts: provide text description nearby, not just alt text

### Forms and Errors
- Every input has a visible, associated `<label>`
- Required fields marked with text, not just color ("Required" next to asterisk)
- Error messages: what's wrong + how to fix it + linked to the field
- Success messages: what just happened + what to do next
- Validation on blur (not just submit), but error doesn't disappear until fixed

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```
This respects users with vestibular disorders for whom motion causes dizziness, nausea, or pain.
