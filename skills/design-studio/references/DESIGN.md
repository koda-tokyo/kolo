# DESIGN.md — Portable Visual Design System
# Google Stitch-compatible format
# Generated for: [PROJECT NAME]
# Version: 1.0
# Date: [DATE]

## Identity

- **Project:** [Name]
- **Brand:** [Brand Name or Parent]
- **Mode:** [Persuade | Operate | Read | Experience]
- **Mood:** [3-5 adjectives, e.g., "calm, clinical, precise, modern, trusted"]

## Anti-References

*These are things we specifically avoid:*

- [Anti-pattern 1, e.g., "Purple gradients on CTAs"]
- [Anti-pattern 2, e.g., "Glassmorphism cards"]
- [Anti-pattern 3, e.g., "AI-generated stock photography"]
- [Anti-pattern 4, e.g., "Italic serif pull quotes"]
- [Anti-pattern 5, e.g., "Featuritis: more than 3 CTAs on one screen"]

## Color Palette

### Primary
```css
--color-primary-50:  #XXXXXX;  /* lightest tint */
--color-primary-100: #XXXXXX;
--color-primary-200: #XXXXXX;
--color-primary-300: #XXXXXX;
--color-primary-400: #XXXXXX;
--color-primary-500: #XXXXXX;  /* base brand color */
--color-primary-600: #XXXXXX;
--color-primary-700: #XXXXXX;
--color-primary-800: #XXXXXX;
--color-primary-900: #XXXXXX;
--color-primary-950: #XXXXXX;  /* darkest shade */
```

### Accent
```css
--color-accent-500: #XXXXXX;  /* base accent */
--color-accent-600: #XXXXXX;  /* hover/active */
```

### Neutral
```css
--color-neutral-50:  #XXXXXX;  /* page background */
--color-neutral-100: #XXXXXX;  /* alt surface */
--color-neutral-200: #XXXXXX;  /* dividers */
--color-neutral-300: #XXXXXX;  /* borders */
--color-neutral-400: #XXXXXX;  /* disabled */
--color-neutral-500: #XXXXXX;  /* caption text */
--color-neutral-600: #XXXXXX;
--color-neutral-700: #XXXXXX;  /* secondary text */
--color-neutral-800: #XXXXXX;
--color-neutral-900: #XXXXXX;  /* primary text */
--color-neutral-950: #XXXXXX;  /* deep background (dark mode) */
```

### Semantic
```css
--color-success: #XXXXXX;
--color-warning: #XXXXXX;
--color-error:   #XXXXXX;
--color-info:    #XXXXXX;
```

## Typography

### Font Families

**Display (for hero, H1, major headings):**
```css
--font-display: '[Font Name]', [fallback], [generic];
/* Weight: [400|500|600|700|800|900] */
/* Style: sans-serif | serif | mono */
/* Source: Google Fonts | Custom | System */
/* Loading: font-display: swap | optional */
```

**UI (for body, navigation, forms, labels):**
```css
--font-ui: '[Font Name]', [fallback], [generic];
/* Weight: [400|500|600|700] */
/* OpenType features: 'kern', 'liga', 'calt' */
```

**Mono (for code, data, technical content):**
```css
--font-mono: '[Font Name]', monospace;
```

### Type Scale
```css
--text-xs:   0.75rem;   /* 12px — captions, overline, legal */
--text-sm:   0.875rem;  /* 14px — secondary, metadata, labels */
--text-base: 1rem;      /* 16px — body (FOUNDATION) */
--text-lg:   1.125rem;  /* 18px — lead, emphasized body */
--text-xl:   1.25rem;   /* 20px — H4, card titles */
--text-2xl:  1.5rem;    /* 24px — H3 */
--text-3xl:  1.875rem;  /* 30px — H2 */
--text-4xl:  2.25rem;   /* 36px — H1 */
--text-5xl:  3rem;      /* 48px — Hero */
--text-6xl:  3.75rem;   /* 60px — Display */

/* Line heights */
--leading-tight:   1.25;  /* headings */
--leading-snug:    1.375; /* headings */
--leading-normal:  1.5;   /* body (DEFAULT) */
--leading-relaxed: 1.625; /* long-form */
--leading-loose:   1.75;  /* reading experiences */

/* Letter spacing */
--tracking-tighter: -0.05em; /* large display text */
--tracking-tight:   -0.025em;/* headings */
--tracking-normal:  0;       /* body */
--tracking-wide:    0.025em; /* overline, small caps */
--tracking-wider:   0.05em;  /* captions */
```

## Spacing Scale
```css
--space-0:  0px;
--space-1:  4px;    /* micro */
--space-2:  8px;    /* compact */
--space-3:  12px;   /* tight */
--space-4:  16px;   /* base (DEFAULT) */
--space-5:  20px;   /* relaxed */
--space-6:  24px;   /* loose */
--space-8:  32px;   /* wide */
--space-10: 40px;   /* generous */
--space-12: 48px;   /* spacious */
--space-16: 64px;   /* grand */
--space-20: 80px;   /* luxurious */
--space-24: 96px;   /* heroic */
```

## Border Radius
```css
--radius-none:  0px;       /* data tables, code blocks */
--radius-sm:    4px;       /* inputs, buttons, badges */
--radius-md:    8px;       /* cards (DEFAULT) */
--radius-lg:    12px;      /* modals, dialogs */
--radius-xl:    16px;      /* large containers */
--radius-full:  9999px;    /* pills, avatars, tags */
```

## Shadows

Every shadow has a color from the brand palette — never pure black.

```css
--shadow-xs:   0 1px 2px  rgba(var(--neutral-900-rgb), 0.05);
--shadow-sm:   0 1px 3px  rgba(var(--neutral-900-rgb), 0.08);
--shadow-md:   0 4px 6px  rgba(var(--neutral-900-rgb), 0.10);
--shadow-lg:   0 10px 15px rgba(var(--neutral-900-rgb), 0.12);
--shadow-xl:   0 20px 25px rgba(var(--neutral-900-rgb), 0.15);
--shadow-2xl:  0 25px 50px rgba(var(--neutral-900-rgb), 0.20);
```

## Component Tokens

### Buttons
```css
/* Primary */
--btn-primary-bg:       var(--color-primary-500);
--btn-primary-text:     #ffffff;
--btn-primary-hover-bg: var(--color-primary-600);
--btn-primary-radius:   var(--radius-sm);
--btn-primary-padding:  var(--space-3) var(--space-6);

/* Secondary */
--btn-secondary-bg:      transparent;
--btn-secondary-text:    var(--color-primary-500);
--btn-secondary-border:  var(--color-primary-500);
--btn-secondary-hover-bg: var(--color-primary-50);

/* Ghost */
--btn-ghost-bg:       transparent;
--btn-ghost-text:     var(--color-neutral-700);
--btn-ghost-hover-bg: var(--color-neutral-100);
```

### Inputs
```css
--input-bg:           #ffffff;
--input-border:       var(--color-neutral-300);
--input-text:         var(--color-neutral-900);
--input-placeholder:  var(--color-neutral-400);
--input-focus-border: var(--color-primary-500);
--input-focus-ring:   var(--color-primary-200);
--input-error-border: var(--color-error);
--input-radius:       var(--radius-sm);
```

### Cards
```css
--card-bg:       #ffffff;
--card-border:   var(--color-neutral-200);
--card-radius:   var(--radius-md);
--card-padding:  var(--space-6);
--card-shadow:   var(--shadow-sm);
--card-hover-shadow: var(--shadow-md);
```

## Layout

```css
/* Page */
--page-max-width:   1280px;
--page-padding-x:   var(--space-6);   /* mobile */
--page-padding-x-lg: var(--space-12); /* desktop */

/* Sidebar (if applicable) */
--sidebar-width: 260px;

/* Navigation */
--nav-height:     60px;
--nav-bg:         #ffffff;
--nav-border:     var(--color-neutral-200);
```

## Motion
```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
--ease-in:     cubic-bezier(0.6, 0, 0.9, 0.5);
--ease-in-out:  cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);

--duration-fast:    150ms;   /* micro-interactions */
--duration-normal:  250ms;   /* standard transitions */
--duration-slow:    400ms;   /* page transitions */
--duration-xslow:   600ms;   /* complex animations */
```

## Breakpoints
```css
--screen-sm:  640px;   /* mobile landscape */
--screen-md:  768px;   /* tablet */
--screen-lg:  1024px;  /* laptop */
--screen-xl:  1280px;  /* desktop */
--screen-2xl: 1536px;  /* wide desktop */
```

## Design Rules (do NOT violate)

1. [Rule 1 — e.g., "No more than 3 CTAs per screen"]
2. [Rule 2 — e.g., "Every interactive element shows a visible focus ring"]
3. [Rule 3 — e.g., "Use the spacing scale — never invent a one-off padding value"]
4. [Rule 4 — e.g., "All colors must come from this palette. No undocumented hex values."]
5. [Rule 5 — e.g., "Mobile first. Every component must work at 375px width."]

## Do
- [Example of good practice]
- [Example of good practice]

## Don't
- [Example of forbidden pattern]
- [Example of forbidden pattern]

---

*This DESIGN.md follows the Google Stitch specification for portable AI-readable design systems.*
*Generated for [PROJECT NAME] by Design Studio skill — 2026-08-04*
