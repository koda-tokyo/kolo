# Iconography

## Core Rules

1. **SVG only.** Never icon fonts, never PNGs, never emojis.
2. **One library.** Use one icon set consistently throughout the app.
3. **Consistent stroke.** Same stroke width across all icons (usually 2px).
4. **Meaningful only.** Icons support text, don't replace it.

## Recommended Icon Libraries

### Lucide (Recommended)
- 1000+ icons
- 24x24 canvas, 2px stroke
- Clean, consistent, professional
- MIT license
- https://lucide.dev

```tsx
import { Mail, Settings, User } from 'lucide-react'
```

### Heroicons
- By Tailwind team
- 24x24 outline / 20x20 solid
- 2 styles: outline and solid
- MIT license
- https://heroicons.com

```tsx
import { EnvelopeIcon } from '@heroicons/react/24/outline'
```

### Phosphor
- 6 weights (thin to bold)
- Highly customizable
- MIT license
- https://phosphoricons.com

### Tabler Icons
- 4000+ icons
- 24x24, 2px stroke
- MIT license
- https://tabler-icons.io

## Icon Specifications

### Canvas Size
- Base: 24x24px
- Minimum padding: 1px from edge
- Design area: 22x22px

### Stroke
- Width: 2px (1.5px for detailed icons)
- Caps: round
- Joins: round
- Centered strokes

### Border Radius
- Large shapes: 2px
- Small shapes (<8px): 1px

## Icon Sizes in UI

| Context | Size | Example |
|---------|------|---------|
| Inline with text | 16px | Breadcrumbs |
| Buttons | 16-20px | Action buttons |
| Navigation | 20-24px | Sidebar icons |
| Cards | 24px | Feature icons |
| Empty states | 48-64px | Illustrations |
| Hero | 64-96px | Landing pages |

### Implementation

```css
/* Icon + text alignment */
.icon-text {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

/* Icon button */
.icon-button {
  padding: 8px;
  min-width: 44px;
  min-height: 44px;
}
```

## Color

### Default State
- Use `currentColor` — inherits text color
- Gray-500 for secondary icons
- Gray-400 for disabled

### Interactive
- Primary color on hover/active
- Same as text color in buttons

### Semantic
- Success: Green-500
- Warning: Amber-500
- Error: Red-500
- Info: Blue-500

```css
.icon {
  color: currentColor;
  width: 24px;
  height: 24px;
}
```

## Accessibility

1. **Decorative icons:** `aria-hidden="true"`
2. **Meaningful icons:** Add `aria-label` or adjacent text
3. **Icon-only buttons:** Must have `aria-label`

```tsx
// Decorative (has text label)
<button>
  <MailIcon aria-hidden="true" />
  Send Email
</button>

// Icon-only (needs label)
<button aria-label="Send email">
  <MailIcon aria-hidden="true" />
</button>
```

## Custom Icons

When creating custom icons:

1. Match existing library specs (24x24, 2px stroke, round caps)
2. Use the same visual weight
3. Center by optical center of gravity, not mathematical center
4. Test at multiple sizes (16px, 24px, 48px)
5. Ensure 1px minimum clearance from edge

### SVG Template

```svg
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
>
  <!-- paths here -->
</svg>
```

## Anti-Patterns

- Emoji instead of icons (unprofessional, inconsistent rendering)
- Icon fonts (accessibility issues, single point of failure)
- Mixed icon styles (outline + filled + colored)
- Icons without labels in navigation
- Overly detailed icons at small sizes
- Icons that don't align to grid
- Different stroke widths in same UI
