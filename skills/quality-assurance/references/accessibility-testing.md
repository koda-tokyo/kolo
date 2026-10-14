---
title: "Accessibility Testing"
type: reference
product: all
last_reviewed: 2026-05-20
review_cycle_days: 180
owner: qa-team
status: published
---

# Accessibility Testing

## WCAG 2.2 AA — Our Minimum Standard

KodaSōken products target WCAG 2.2 Level AA compliance. This is not aspirational — it is the minimum quality bar. KODA KENKŌ has additional MHLW patient accessibility requirements (see below).

### WCAG Levels Explained
- **Level A (minimum):** Basic accessibility. No keyboard traps, non-text content has alternatives, form inputs have labels. This is the legal minimum in Japan (JIS X 8341-3).
- **Level AA (our standard):** Adds contrast requirements (4.5:1), focus visibility, consistent navigation, meaningful heading hierarchy, error suggestions.
- **Level AAA (nice, not required):** Enhanced contrast (7:1), sign language, extended timeouts, reading level targets.

### What AA Means in Practice
| Requirement | How We Test |
|------------|-------------|
| 1.4.3 Contrast (Minimum) | axe-core automated + manual check for edge cases |
| 1.4.4 Resize Text | 200% browser zoom manual test |
| 2.4.6 Headings and Labels | axe-core + manual audit of heading hierarchy |
| 2.4.7 Focus Visible | Keyboard navigation manual test |
| 3.3.4 Error Prevention | Manual review of form error handling |
| 4.1.3 Status Messages | Screen reader testing (NVDA/VoiceOver) |

## Automated Tools

### axe-core — Primary Automated Audit
- Integrated into unit tests via `jest-axe` for component-level checks
- Integrated into E2E tests via `@axe-core/playwright` for page-level checks
- Built into Lighthouse for CI performance + accessibility audits

```typescript
// jest-axe in a component test
import { axe, toHaveNoViolations } from 'jest-axe';
expect.extend(toHaveNoViolations);

it('MedicationCard has no accessibility violations', async () => {
  const { container } = render(<MedicationCard medication={mockMed} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

```typescript
// @axe-core/playwright in E2E
import { injectAxe, checkA11y } from 'axe-core/playwright';

test('patient dashboard is accessible', async ({ page }) => {
  await page.goto('/patients/123/dashboard');
  await injectAxe(page);
  await checkA11y(page, null, {
    detailedReport: true,
    detailedReportOptions: { html: true },
  });
});
```

### Lighthouse A11Y Audit
Run on every deploy to staging. Score tracked over time. Minimum score: 90. Scores below 90 block production deploy.

### CI Integration
- axe-core violations in unit tests = test failure = blocked merge
- axe-core violations in E2E = test failure = blocked merge
- Lighthouse a11y score <90 = warning on staging, blocked on production

## Manual Testing

Automated tools catch ~30-40% of accessibility issues. Manual testing is required for the rest.

### Screen Reader Testing

#### Primary Screen Readers
| Platform | Screen Reader | Browser |
|----------|--------------|---------|
| Windows | NVDA (free) | Chrome / Firefox |
| macOS | VoiceOver (built-in) | Safari |
| iOS | VoiceOver | Safari |
| Android | TalkBack | Chrome |

#### Screen Reader Test Script
1. **Navigate by headings:** Press `H` key (NVDA) or `VO + Command + H` (VoiceOver). Can you reach all sections?
2. **Navigate by landmarks:** Press `D` key (NVDA). Are all regions properly labeled?
3. **Navigate by links:** Press `K` key (NVDA). Are link texts meaningful? No "click here" or "こちら" with no context.
4. **Navigate forms:** Press `F` key (NVDA). Are labels announced? Are errors announced?
5. **Read content linearly:** Let the screen reader read from top to bottom. Does the order make sense?

### Keyboard-Only Navigation
**No mouse, no trackpad.** Tab through every interactive element. Verify:
- Tab order is logical (left-to-right, top-to-bottom for LTR, right-to-left for RTL)
- Every interactive element is focusable (buttons, links, form controls, custom widgets)
- Focus is never trapped (except in modals, where Esc closes)
- Focus is always visible (outline or custom focus ring, never `outline: none` without replacement)
- Skip-to-content link is the first focusable element

### 200% Zoom
Browser zoom at 200%. Verify:
- No content is cut off or hidden
- No horizontal scrolling required (except for data tables, which may scroll horizontally)
- Text reflows correctly (doesn't overflow containers)
- Interactive elements remain clickable

## Focus Management

### Visible Focus Indicators
Never remove the default focus outline without providing a custom one that is at least as visible. `:focus-visible` is preferred over `:focus` for mouse users.

```css
/* ✅ Good — enhances default focus */
:focus-visible {
  outline: 3px solid #2563eb;
  outline-offset: 2px;
}

/* ❌ Bad — removes focus visibility */
*:focus { outline: none; }
```

### Logical Tab Order
The DOM order should match the visual order. If visual design places an element differently, the tab order still follows the DOM. Use `tabindex="-1"` to remove non-interactive content from tab order, and `tabindex="0"` to add custom interactive elements.

### Focus Trapping in Modals
When a modal opens:
1. Focus moves to the first focusable element in the modal
2. Tab cycles through modal elements only (focus is trapped)
3. Esc closes the modal
4. Focus returns to the element that triggered the modal
5. Background content is `aria-hidden="true"`

## Color Contrast

### Minimum Ratios (WCAG 2.2 AA)
| Content Type | Ratio | Notes |
|---|---|---|
| Normal text (<18pt / <24px) | **4.5:1** | Minimum |
| Large text (≥18pt bold / ≥24px) | **3:1** | Easier to read at size |
| UI components / graphics | **3:1** | Buttons, inputs, icons |
| Logotypes | No requirement | Brand flexibility |

### Testing Tools
- axe-core (automated, catches most)
- Chrome DevTools color picker (shows contrast ratio)
- WebAIM Contrast Checker (manual spot-checking)
- Sim Daltonism (macOS app — test with common color vision deficiencies)

### Common Contrast Traps
- Gray text on white backgrounds (#999 on #fff = 2.85:1 — too low)
- Light blue links on white (#4FC3F7 on #fff = 2.25:1 — fail)
- Placeholder text (often too light — use `::placeholder { opacity: 1; color: #666; }`)
- Disabled states (lower contrast is acceptable, but consider hiding rather than graying-out)

## Semantic HTML

### Heading Hierarchy
- One `<h1>` per page (the page title)
- No skipped levels (`<h2>` → `<h4>` without `<h3>`)
- Headings describe structure, not visual style. Font size alone is not a heading.

### Landmark Regions
Use HTML5 semantic elements or ARIA roles to define document regions:
- `<header role="banner">` — page header (one per page)
- `<nav>` — navigation regions (can be multiple, label with `aria-label`)
- `<main>` — primary content (one per page)
- `<aside>` — complementary content
- `<footer role="contentinfo">` — page footer (one per page)

### Form Labels
Every input has a visible label. Use `<label for="id">` or wrap the input:

```html
<!-- ✅ Explicit association -->
<label for="medication-name">薬剤名</label>
<input id="medication-name" type="text" />

<!-- ✅ Implicit association -->
<label>薬剤名 <input type="text" /></label>

<!-- ❌ Placeholder-only — no label -->
<input type="text" placeholder="薬剤名" />
```

### Alt Text
Every `<img>` has `alt` text. Decorative images use `alt=""` (empty string, not missing). Complex images (charts, diagrams) have a longer description nearby or in `aria-describedby`.

```html
<!-- ✅ Informative image -->
<img src="dosage-chart.png" alt="服用量チャート: アムロジピン5mg 朝食後" />

<!-- ✅ Decorative image -->
<img src="decorative-wave.svg" alt="" />

<!-- ❌ Missing alt -->
<img src="chart.png" />
```

## Japanese Language Specifics

### Ruby Text (Furigana)
Medical terminology often uses kanji that patients may not know. Use `<ruby>` elements for reading assistance:

```html
<ruby>膵臓<rp>(</rp><rt>すいぞう</rt><rp>)</rp></ruby>がん
```

Verify that screen readers handle ruby text correctly (NVDA's default is to read both; may need configuration).

### Vertical Text
Japanese text can be set vertically (`writing-mode: vertical-rl`). Test:
- Focus order follows vertical flow (top-to-bottom, right-to-left)
- Scroll behavior is horizontal, not vertical
- Form controls and interactive elements still work in vertical mode

### Screen Reader Pronunciation (Japanese)
Japanese screen readers (PC-Talker, NVDA Japanese voice) may mispronounce:
- Medical katakana terms (テストステロン, ヘモグロビン)
- English acronyms in Japanese text (CT, MRI, AI)
- Numbers (readings change with units: 1錠 = いちじょう, 1日 = いちにち)

Test critical medical instructions with an actual Japanese screen reader. Don't assume.

### Input Method Editor (IME)
Test that form inputs work with Japanese IME (Microsoft IME, Google 日本語入力, macOS 日本語入力):
- Can type in hiragana, convert to kanji, commit the text
- Conversion candidates display without being clipped
- Form validation doesn't fire on intermediate IME input (use `compositionend` event)

## Accessibility Statement

### What to Include
Every user-facing product must have an accessibility statement (accessibility page). Minimum content:
1. **Commitment:** Statement of commitment to accessibility
2. **Standard:** Which standard we target (WCAG 2.2 AA, JIS X 8341-3)
3. **Known issues:** List of known accessibility barriers and workarounds
4. **Feedback channel:** Contact email or form for reporting accessibility issues
5. **Last updated:** Date the statement was last reviewed

### Where to Publish
- Footer link on every page: 「アクセシビリティについて」
- Linked from the site's user help section
- KODA KENKŌ: Included in 安全管理ガイドライン documentation package

### MHLW Patient Accessibility Requirements (KODA KENKŌ)
For KODA KENKŌ (healthcare products used by Japanese patients):
- **Accessible patient portal:** Patients of all abilities must be able to access their health records.
- **Alternative formats:** Patient education materials available in alternative formats on request.
- **Elderly users:** Default font size consideration (many users over 65), simplified navigation, clear error recovery.
- **Disability accommodation:** Per 障害者差別解消法 (Act for Eliminating Discrimination against Persons with Disabilities), reasonable accommodation must be provided.
- **Annual accessibility audit:** Documented, with remediation plan for findings.
