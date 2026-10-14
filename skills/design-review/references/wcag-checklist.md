# Accessibility Reference — WCAG 2.2 AA + JIS X 8341

Quick-reference checklist for accessibility audits. Japanese-specific considerations integrated.

## Quick Audit Checklist

### 1. Perceivable
- [ ] **1.1.1 Non-text Content (A)** — All images have alt text; decorative images marked; complex images have long descriptions
- [ ] **1.2.1-1.2.5 Time-based Media (A-AA)** — Audio has transcripts; video has captions; audio description where needed
- [ ] **1.3.1 Info and Relationships (A)** — Semantic HTML; headings form outline; lists used for lists; tables have headers
- [ ] **1.3.2 Meaningful Sequence (A)** — Content order makes sense when linearized
- [ ] **1.3.3 Sensory Characteristics (A)** — No instructions relying solely on shape, color, size, or sound ("click the red button" → "click the Delete button")
- [ ] **1.3.4 Orientation (AA)** — Content works in portrait and landscape (unless essential)
- [ ] **1.3.5 Identify Input Purpose (AA)** — Autocomplete attributes on form fields collecting user data
- [ ] **1.4.1 Use of Color (A)** — Information is never conveyed by color alone
- [ ] **1.4.2 Audio Control (A)** — Auto-playing audio >3s has pause/stop/volume control
- [ ] **1.4.3 Contrast Minimum (AA)** — Text ≥4.5:1; large text (≥18px bold or ≥24px) ≥3:1
- [ ] **1.4.4 Resize Text (AA)** — Text can resize to 200% without loss of content or function
- [ ] **1.4.5 Images of Text (AA)** — Use actual text, not images of text (logos excepted)
- [ ] **1.4.10 Reflow (AA)** — Content reflows to 320px wide without horizontal scroll
- [ ] **1.4.11 Non-text Contrast (AA)** — UI components and graphics ≥3:1 against adjacent colors
- [ ] **1.4.12 Text Spacing (AA)** — No loss when user sets: line-height 1.5, paragraph spacing 2em, letter-spacing 0.12em, word-spacing 0.16em
- [ ] **1.4.13 Content on Hover or Focus (AA)** — Tooltip/popover: dismissible, hoverable, persistent

### 2. Operable
- [ ] **2.1.1 Keyboard (A)** — All functionality available from keyboard
- [ ] **2.1.2 No Keyboard Trap (A)** — Focus can move away from any component using keyboard
- [ ] **2.1.4 Character Key Shortcuts (A)** — Single-character shortcuts can be remapped or turned off
- [ ] **2.2.1 Timing Adjustable (A)** — Time limits: turn off, adjust, or extend
- [ ] **2.2.2 Pause, Stop, Hide (A)** — Moving/blinking/scrolling/auto-updating content: pause, stop, or hide
- [ ] **2.3.1 Three Flashes or Below (A)** — Nothing flashes more than 3 times per second
- [ ] **2.4.1 Bypass Blocks (A)** — Skip navigation link provided
- [ ] **2.4.2 Page Titled (A)** — Descriptive `<title>`
- [ ] **2.4.3 Focus Order (A)** — Tab order follows visual/meaningful order
- [ ] **2.4.4 Link Purpose (A)** — Link text alone conveys purpose (no "click here")
- [ ] **2.4.5 Multiple Ways (AA)** — ≥2 ways to find pages (nav, search, sitemap, etc.)
- [ ] **2.4.6 Headings and Labels (AA)** — Headings and labels describe topic or purpose
- [ ] **2.4.7 Focus Visible (AA)** — Keyboard focus indicator is visible
- [ ] **2.4.11 Focus Appearance (AA)** — Focus indicator ≥2px thick, ≥3:1 contrast
- [ ] **2.5.1 Pointer Gestures (A)** — Multi-point/path gestures have single-pointer alternatives
- [ ] **2.5.2 Pointer Cancellation (A)** — No down-event activation; can cancel on up-event
- [ ] **2.5.3 Label in Name (A)** — Visible label text is in the accessible name
- [ ] **2.5.7 Dragging (AA)** — Dragging actions have pointer-only alternatives
- [ ] **2.5.8 Target Size (AA)** — Touch targets ≥24×24px (recommended: 44×44px)

### 3. Understandable
- [ ] **3.1.1 Language of Page (A)** — `lang` attribute set correctly
- [ ] **3.1.2 Language of Parts (AA)** — Language changes marked inline
- [ ] **3.2.1 On Focus (A)** — No component changes context on focus
- [ ] **3.2.2 On Input (A)** — No component changes context on input without warning
- [ ] **3.2.3 Consistent Navigation (AA)** — Nav order same across pages
- [ ] **3.2.4 Consistent Identification (AA)** — Same function = same label across pages
- [ ] **3.2.6 Consistent Help (A)** — Help mechanisms in same relative order
- [ ] **3.3.1 Error Identification (A)** — Error described in text, item identified
- [ ] **3.3.2 Labels or Instructions (A)** — Labels/instructions provided for inputs
- [ ] **3.3.3 Error Suggestion (AA)** — Suggestions provided for errors where known
- [ ] **3.3.4 Error Prevention (AA)** — Reversible, checked, or confirmed before final submission (legal/financial/data)
- [ ] **3.3.7 Accessible Authentication (AA)** — No cognitive function test (CAPTCHA) as sole method

### 4. Robust
- [ ] **4.1.2 Name, Role, Value (A)** — Custom UI components expose name, role, value to assistive tech
- [ ] **4.1.3 Status Messages (AA)** — Status messages announced without focus change

## Japanese-Specific (JIS X 8341 / 高齢者・障害者配慮)

### Typography
- Use Japanese system fonts: `Hiragino Sans`, `Noto Sans JP`, `Yu Gothic`
- Minimum font size: 16px for body kanji (complex characters need larger size)
- Ruby/furigana: `<ruby>` element for difficult readings, especially medical/legal terms
- 全角/半角 consistency: use 全角 for Japanese punctuation（。、）、半角 for Latin alphanumeric

### Language & Tone
- 敬語 level consistent with audience (です・ます調 for general; である調 for academic)
- 難しい漢字にルビ — medical terms especially need furigana for patient-facing content
- Avoid カタカナ語 overuse — prefer 和語 where natural

### Color & Cultural
- Red (赤) = warning/error cross-culturally, but also celebratory in Japan — context matters
- White/gray (白/灰) is formal but can feel cold — warm grays for healthcare
- Never use imperial colors (金/紫/緋) inappropriately — cultural weight

### Forms
- Name fields: 姓 (family) before 名 (given) — Japanese convention
- Address: 〒 (postal mark) for postal code fields
- Date: Japanese era (令和) OR Western year — be consistent, support both
- Phone: 3-part format (090-XXXX-XXXX) with auto-formatting

### Accessibility Resources (Japan)
- JIS X 8341-3:2016 — Japanese accessibility standard (maps to WCAG 2.0 AA, with additions)
- みんなのアクセシビリティ評価 (Minna no Accessibility Hyōka) — Japanese evaluation tool
- MHLW 医療情報システム安全管理ガイドライン 6.0 — healthcare IT security/accessibility

## Contrast Quick Reference

| Text Type | Minimum Ratio | Example Good Pair |
|-----------|---------------|-------------------|
| Body text (<18px) | 4.5:1 | #333 on #FFF (12.6:1) |
| Large text (≥18px bold or ≥24px) | 3:1 | #666 on #FFF (5.7:1) |
| UI components (borders, icons) | 3:1 | #949494 on #FFF |
| Focus indicators | 3:1 | #0057FF outline on #FFF |
| Disabled text | No requirement | But don't make it invisible |

## Common Failures to Catch

1. **Placeholder as label** — Placeholder disappears on input; use real `<label>`
2. **Color-only error states** — Red border + icon = OK. Red border alone = fail.
3. **Missing focus styles** — `:focus-visible` is required, not optional
4. **Low-contrast disabled states** — Disabled doesn't mean invisible. Opacity ≥ 0.4 recommended
5. **`div` as button** — Use `<button>`. It gets keyboard, focus, role for free.
6. **Unlabeled icon buttons** — Every icon-only button needs `aria-label`
7. **Carousel without pause** — Auto-advancing carousels need pause button
8. **Modal without focus trap** — Focus must stay inside open modal
