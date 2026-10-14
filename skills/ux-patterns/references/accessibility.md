# Accessibility Guidelines

> **Rule of thumb**: Accessibility is not a feature. It's a requirement. If it doesn't work with a keyboard and a screen reader, it's broken.

## WCAG 2.2 AA — Practical Checklist

This is the minimum standard. AAA is ideal but AA is what you must hit.

### Perceivable

- [ ] All non-text content has text alternative (alt text, aria-label, or visually hidden text)
- [ ] Video content has captions (not auto-generated — reviewed for accuracy)
- [ ] Content is not conveyed by colour alone (add icons, text labels, or patterns alongside colour)
- [ ] Text can be resized to 200% without loss of content or functionality
- [ ] Colour contrast meets minimum ratios (see below)

### Operable

- [ ] Everything works with keyboard alone (Tab, Shift+Tab, Enter, Space, Escape, arrow keys)
- [ ] No keyboard traps — focus can enter AND leave every component
- [ ] Visible focus indicator on every interactive element (do NOT `outline: none` without replacement)
- [ ] Sufficient time limits or ability to extend/pause them
- [ ] No content flashes more than 3 times per second (seizure risk)
- [ ] Skip-to-content link as first focusable element

### Understandable

- [ ] Language of page is set (`<html lang="en">`)
- [ ] Any content in a different language is marked (`lang="es"`)
- [ ] Navigation is consistent across pages
- [ ] Components with same functionality are identified consistently
- [ ] Input errors are identified, described, and suggestions provided

### Robust

- [ ] Valid, semantic HTML with proper landmark regions (`<nav>`, `<main>`, `<header>`, `<footer>`)
- [ ] Name, role, and value are programmatically determinable for all UI components

## Colour Contrast Requirements (WCAG 2.2 AA)

| Element | Minimum Ratio | Notes |
|---|---|---|
| Normal text (<18pt / <24px) | **4.5:1** | Body copy, labels, form fields |
| Large text (≥18pt bold or ≥24px) | **3:1** | Headings, large UI text |
| UI components and graphics | **3:1** | Button borders, input borders, icons |
| Disabled text | Exempt | But avoid disabled text — use tooltips instead |

**Do**: Test with a contrast checker. Don't eyeball it — the #EEE grey on white that "looks fine" is only 1.81:1 and fails for everyone over 40.

**Don't**: Rel on colour alone to convey information. A red border on an error field must also have an icon and text message.

## Focus Management

### Focus Order

Tab order must match the visual order. Don't use `tabindex > 0` — it creates a parallel tab sequence that confuses keyboard users.

### Skip Links

Every page must have a "Skip to main content" link as the first focusable element:

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

Visible on focus, hidden otherwise. This lets keyboard users bypass repetitive navigation.

### Focus Trapping

Modals, drawers, and popovers must trap focus:
- Tab inside the modal cycles through the modal's focusable elements
- Tab at the last element wraps to the first
- Shift+Tab at the first element wraps to the last

### Focus Restoration

When a modal closes, focus must return to the element that opened it. If a page navigates, focus moves to the new page's heading.

## ARIA: When to Use, When NOT to Use

**First rule of ARIA**: No ARIA is better than bad ARIA.

A button declared as a heading, a link declared as a button — these confuse screen readers more than no ARIA at all.

**Use ARIA when**:
- Building custom interactive widgets that HTML can't express (tab panels, comboboxes, tree views)
- Adding live region announcements (`aria-live="polite"` for dynamic content)
- Providing accessible names where visual text doesn't exist (icon-only buttons need `aria-label`)

**Do NOT use ARIA when**:
- Native HTML does the job — `<button>` doesn't need `role="button"`
- Overriding correct semantics — `<h1>` doesn't need `role="heading"`
- Adding `aria-hidden="true"` to content users still need to interact with
- Using `aria-label` redundantly when there's visible text that says the same thing

**Most common ARIA mistakes**:
- `role="button"` on a `<div>` that can't be activated with Space or Enter
- `aria-expanded` on something that doesn't expand
- `aria-labelledby` pointing to a non-existent ID

## Screen Reader Testing

Test with at least one screen reader before shipping:

- **macOS**: VoiceOver (built-in, ⌘F5)
- **Windows**: NVDA (free) or JAWS
- **iOS**: VoiceOver (Settings → Accessibility)
- **Android**: TalkBack (Settings → Accessibility)

**What to test**:
1. Navigate the page with the screen reader on. Does every element make sense when heard?
2. Fill out a form. Are error messages announced? Do labels read correctly?
3. Use a modal. Is focus trapped? Does the screen reader know the modal is open?
4. Dynamic content updates — are they announced via `aria-live`?

**Do**: Listen to the page at 2x speed — if you can understand it, users accustomed to screen readers will have no issue.

## Keyboard Navigation

| Key | Expected Behaviour |
|---|---|
| **Tab** | Move to next focusable element |
| **Shift+Tab** | Move to previous focusable element |
| **Enter** | Activate button/link, submit form from input |
| **Space** | Activate button, toggle checkbox, open select |
| **Escape** | Close modal/popover, cancel action, clear focus from input |
| **Arrow keys** | Navigate within composite widgets (tabs, radio groups, menus, sliders) |

**Do**: Test every screen keyboard-only. Can you complete every task without touching a mouse or trackpad?

## Prefers-Reduced-Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

This disables all motion for users with vestibular disorders. Essential: disable parallax, auto-playing carousels, and decorative animations.

## Semantic HTML as Foundation

Use the right element for the right purpose. Screen readers understand these natively:

```html
<!-- DO -->
<button>Save changes</button>
<nav aria-label="Main navigation">...</nav>
<main id="main-content">...</main>
<table>
  <caption>Q4 Revenue</caption>
  <thead>...</thead>
</table>

<!-- DON'T -->
<div onclick="save()" class="button">Save changes</div>
<div class="nav">...</div>
<div class="content">...</div>
```

## Alt Text Guidelines

**Informative images**: Describe the content and function. "Sales chart showing 20% growth in Q3" not "Chart."

**Decorative images**: Use empty alt: `alt=""`. This tells screen readers to skip it.

**Linked images**: Describe the link destination, not the image. "Home page" not "Company logo."

**Complex images (charts, diagrams)**: Provide a short alt + a longer description nearby or linked.

## Accessible Forms

- Every input has a visible `<label>` associated via `for`/`id` or wrapping
- Required fields are marked with an asterisk AND the word "required" (not colour alone)
- Error messages use `aria-describedby` to connect to the field
- Grouped inputs (radios, checkboxes) use `<fieldset>` + `<legend>`
- Placeholder text is NOT a replacement for labels — placeholders disappear, labels don't

**Do**: Test form accessibility: Tab through all fields. Does the label read before the input? Are errors announced? Can you submit with Enter?

**Don't**: Use placeholder text as the only label. When the user types, it disappears. When screen readers encounter a field with only placeholder text, they often read nothing useful.
