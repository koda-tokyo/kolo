# Color System

## Philosophy

Enterprise UI is neutral-dominant. Gray is your primary color. Accent colors have meaning, not decoration.

## Building a Palette

Every enterprise palette needs:

1. **Neutrals** (10 shades) — 90% of your UI
2. **Primary/Brand** (10 shades) — Actions, links, focus states
3. **Semantic colors** — Success, warning, error, info

### Neutral Scale (Gray)

Build 10 shades from near-white to near-black:

```
50   — Page backgrounds, subtle fills
100  — Card backgrounds, hover states
200  — Borders, dividers
300  — Disabled text, placeholders
400  — Muted text, icons
500  — Secondary text
600  — Body text
700  — Headings
800  — Strong emphasis
900  — Maximum contrast
```

### Recommended Neutral Palettes

**Cool Gray (Blue undertone):**
```
50:  #F8FAFC
100: #F1F5F9
200: #E2E8F0
300: #CBD5E1
400: #94A3B8
500: #64748B
600: #475569
700: #334155
800: #1E293B
900: #0F172A
```

**Neutral Gray (True neutral):**
```
50:  #FAFAFA
100: #F4F4F5
200: #E4E4E7
300: #D4D4D8
400: #A1A1AA
500: #71717A
600: #52525B
700: #3F3F46
800: #27272A
900: #18181B
```

**Warm Gray (Slight warmth):**
```
50:  #FAFAF9
100: #F5F5F4
200: #E7E5E4
300: #D6D3D1
400: #A8A29E
500: #78716C
600: #57534E
700: #44403C
800: #292524
900: #1C1917
```

## Primary/Accent Color

Choose ONE primary color for interactive elements:

**Blue (Trust, professionalism):**
```
500: #3B82F6 — Default
600: #2563EB — Hover
700: #1D4ED8 — Pressed
100: #DBEAFE — Background
```

**Indigo (Premium, innovation):**
```
500: #6366F1
600: #4F46E5
700: #4338CA
100: #E0E7FF
```

**Teal (Modern, clean):**
```
500: #14B8A6
600: #0D9488
700: #0F766E
100: #CCFBF1
```

### Usage Rules

- Primary color = interactive elements only (buttons, links, focus rings)
- Never use primary for backgrounds or decorative elements
- Maintain 3:1 contrast against background

## Semantic Colors

### Success (Green)
```
50:  #F0FDF4
500: #22C55E
600: #16A34A
700: #15803D
Text: #166534
```

### Warning (Amber/Yellow)
```
50:  #FFFBEB
500: #F59E0B
600: #D97706
700: #B45309
Text: #92400E
```

### Error/Destructive (Red)
```
50:  #FEF2F2
500: #EF4444
600: #DC2626
700: #B91C1C
Text: #991B1B
```

### Info (Blue)
```
50:  #EFF6FF
500: #3B82F6
600: #2563EB
700: #1D4ED8
Text: #1E40AF
```

## Accessibility

### Contrast Requirements (WCAG AA)

| Element | Minimum Ratio |
|---------|---------------|
| Body text | 4.5:1 |
| Large text (18px+) | 3:1 |
| UI components | 3:1 |
| Focus indicators | 3:1 |

### Step Rule

When pairing colors from the same scale:
- 4.5:1 contrast = 5+ steps apart
- 3:1 contrast = 4+ steps apart

Example: Gray-600 text on Gray-50 background (6 steps) = passes 4.5:1

### Testing Tools

- WebAIM Contrast Checker
- Stark (Figma plugin)
- axe DevTools

## Dark Mode Considerations

For dark mode, don't simply invert. Create a separate scale:

**Light mode:** Light backgrounds, dark text
**Dark mode:** Dark backgrounds, light text (not pure white)

```
Dark mode text: #E5E7EB (not #FFFFFF)
Dark mode background: #111827 (not #000000)
```

## Anti-Patterns

- Pure black (#000000) on pure white (#FFFFFF) — too harsh
- Colored text on colored backgrounds without contrast check
- Using saturation instead of value for hierarchy
- More than one accent color competing
- Gradients in enterprise UI (unless brand requires)
