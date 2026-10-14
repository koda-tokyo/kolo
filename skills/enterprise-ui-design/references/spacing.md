# Spacing & Layout

## Base Unit

**8px base unit** for all UI spacing. Every dimension should be a multiple of 8.

For fine control, use 4px increments.

## Spacing Scale

```
0:   0px
0.5: 2px   — Tiny gaps (icon-text)
1:   4px   — Minimal spacing
2:   8px   — Tight spacing
3:   12px  — Compact groups
4:   16px  — Default gap
5:   20px  — Medium spacing
6:   24px  — Section gaps
8:   32px  — Large spacing
10:  40px  — Section separation
12:  48px  — Major sections
16:  64px  — Page sections
20:  80px  — Hero spacing
24:  96px  — Maximum
```

### Tailwind Mapping

```
p-0.5: 2px
p-1:   4px
p-2:   8px
p-3:   12px
p-4:   16px
p-5:   20px
p-6:   24px
p-8:   32px
p-10:  40px
p-12:  48px
p-16:  64px
```

## Grid System

### Column Grid

Use 12-column grid for maximum flexibility:

```
1 col  = 8.33%
2 col  = 16.67%
3 col  = 25%
4 col  = 33.33%
6 col  = 50%
8 col  = 66.67%
12 col = 100%
```

### Gutters

- Desktop: 24-32px gutters
- Tablet: 16-24px gutters
- Mobile: 16px gutters

### Container Max Widths

```
sm:  640px
md:  768px
lg:  1024px
xl:  1280px
2xl: 1536px
```

### Content Max Width

Body text content: `max-width: 65ch` or `600-700px`

## Responsive Breakpoints

```css
/* Mobile first */
sm:  640px
md:  768px
lg:  1024px
xl:  1280px
2xl: 1536px
```

## Component Spacing

### Cards

```
Padding: 16px (compact) / 24px (default) / 32px (spacious)
Gap between cards: 16px / 24px
Border radius: 8px / 12px
```

### Forms

```
Label to input: 4px
Input height: 40px (default) / 36px (compact) / 48px (large)
Field to field: 16px / 24px
Group to group: 32px
```

### Tables

```
Cell padding: 12px 16px
Row height: 52px (compact: 40px)
Header border: 1px
Row divider: 1px or alternating backgrounds
```

### Buttons

```
Height: 36px (small) / 40px (medium) / 48px (large)
Padding: 12px 16px (sm) / 16px 24px (md) / 20px 32px (lg)
Gap between buttons: 8px / 12px
```

### Navigation

```
Nav item padding: 8px 16px
Nav item height: 40px (horizontal) / 44px (vertical)
Sidebar width: 240px (compact) / 280px (comfortable)
```

### Modals

```
Padding: 24px
Width: 400px (small) / 500px (medium) / 600px (large) / 800px (wide)
Max width: 90vw
```

## Vertical Rhythm

Maintain consistent vertical spacing:

1. **Within components:** 8px, 12px, 16px
2. **Between components:** 24px, 32px
3. **Between sections:** 48px, 64px
4. **Between page areas:** 80px, 96px

## Touch Targets

Minimum touch target: **44x44px** (Apple HIG / WCAG)

Even if the visual element is smaller, ensure the clickable area is 44x44px.

```css
.small-button {
  padding: 8px 12px; /* Visual */
  min-height: 44px;  /* Touch target */
}
```

## White Space Principles

**More space = more importance.** Give primary content room to breathe.

**Proximity = relationship.** Group related items tightly; separate unrelated items.

**Consistency = professionalism.** Use the same spacing values throughout.

### Common Mistakes

- Inconsistent margins between sections
- Too little padding in cards
- Crowded tables
- No breathing room around CTAs
- Different spacing for similar components
