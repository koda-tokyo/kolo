# Tailwind CSS v4 Patterns

> **Skill:** react-web | **Stack:** Tailwind CSS v4, Next.js 15, React 19

## v4 Migration: What Changed

Tailwind v4 is a fundamental rewrite. The most significant change: **no more `tailwind.config.js` or `postcss.config.js`** (in most cases). Everything moves to CSS.

### Key Differences from v3

| v3 | v4 |
|---|---|
| `tailwind.config.js` | CSS-first config via `@theme` |
| `postcss.config.js` | Vite plugin or `@tailwindcss/postcss` |
| `content: [...]` paths | Automatic content detection |
| JS config for colors | CSS custom properties / `@theme` |
| `darkMode: "class"` | `@variant dark (&:where(.dark, .dark *))` |
| Arbitrary values `w-[327px]` | Still supported |
| `@apply` directives | Still supported (with limits) |

## CSS-Based Configuration

```css
/* app/globals.css */
@import "tailwindcss";

/* Theme customization */
@theme {
  --color-primary-50: oklch(0.98 0.01 260);
  --color-primary-100: oklch(0.95 0.02 260);
  --color-primary-200: oklch(0.90 0.04 260);
  --color-primary-300: oklch(0.82 0.08 260);
  --color-primary-400: oklch(0.72 0.12 260);
  --color-primary-500: oklch(0.62 0.16 260);
  --color-primary-600: oklch(0.52 0.18 260);
  --color-primary-700: oklch(0.42 0.16 260);
  --color-primary-800: oklch(0.32 0.12 260);
  --color-primary-900: oklch(0.22 0.08 260);

  --color-accent-500: oklch(0.70 0.18 160);
  --color-accent-600: oklch(0.60 0.16 160);

  --font-family-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-family-mono: "JetBrains Mono", ui-monospace, monospace;

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
}

/* Continue using utility classes as before */
```

## OKLCH Colors (Preferred over RGB/HSL)

Tailwind v4 defaults to OKLCH — a perceptually uniform color space:

```css
@theme {
  /* OKLCH format: oklch(lightness chroma hue) */
  --color-brand: oklch(0.65 0.20 270); /* Purple with good perceptual brightness */
  --color-success: oklch(0.65 0.18 140); /* Green */
  --color-danger: oklch(0.55 0.24 25);   /* Red */

  /* Benefits: more predictable contrast, better dark mode handling */
}
```

OKLCH means you don't need separate dark/light color palettes — the same hue shifts predictably.

## Container Queries (New in v4)

```css
/* Define a container */
.container-wrapper {
  @container;
}

/* Respond to container size, not viewport */
@container (min-width: 400px) {
  .card {
    @apply grid grid-cols-2;
  }
}

/* In Tailwind utilities: */
<div class="@container">
  <div class="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3">
    <!-- Layout responds to parent container, not viewport -->
  </div>
</div>
```

Shorthand classes: `@sm`, `@md`, `@lg`, `@xl`, `@2xl` map to container sizes.

## Dark Mode

```css
/* globals.css */
@variant dark (&:where(.dark, .dark *));

/* Usage in components */
<div class="bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
  Auto-adapts when <html class="dark"> is set
</div>

/* Theme toggle hook */
// hooks/use-theme.ts
'use client';
import { useEffect, useState } from 'react';

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const stored = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const preferred = stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(preferred);
    document.documentElement.classList.toggle('dark', preferred === 'dark');
  }, []);

  const toggle = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  return { theme, toggle };
}
```

## Responsive Breakpoints (unchanged from v3)

```css
/* Default breakpoints (can override in @theme) */
/* sm: 640px, md: 768px, lg: 1024px, xl: 1280px, 2xl: 1536px */

<div class="
  grid grid-cols-1               /* mobile first */
  sm:grid-cols-2                 /* 640px+ */
  lg:grid-cols-3                 /* 1024px+ */
  xl:grid-cols-4                 /* 1280px+ */
">
```

## Integration with shadcn/ui

shadcn/ui uses CSS variables for theming, which maps directly to Tailwind v4's `@theme`:

```css
/* globals.css — shadcn/ui compatible theme */
@import "tailwindcss";

@theme {
  /* shadcn/ui design token conventions */
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.145 0 0);
  --color-card: oklch(1 0 0);
  --color-card-foreground: oklch(0.145 0 0);
  --color-primary: oklch(0.55 0.2 265);
  --color-primary-foreground: oklch(0.985 0 0);
  --color-secondary: oklch(0.965 0.01 260);
  --color-secondary-foreground: oklch(0.205 0.04 260);
  --color-muted: oklch(0.965 0.01 260);
  --color-muted-foreground: oklch(0.556 0.02 260);
  --color-accent: oklch(0.965 0.01 260);
  --color-accent-foreground: oklch(0.205 0.04 260);
  --color-destructive: oklch(0.577 0.245 27);
  --color-border: oklch(0.922 0.01 260);
  --color-input: oklch(0.922 0.01 260);
  --color-ring: oklch(0.55 0.2 265);

  --radius: 0.5rem;
}
```

## Production Optimizations

```css
/* Enable JIT-like behavior (default in v4, but can tune) */
@import "tailwindcss";

/* Only include used classes — automatically handled in v4 */

/* Content detection is automatic from source files */
/* No need for `content: [...]` config */
```

## Gotchas

1. **No `tailwind.config.js`** — all configuration is in CSS now. If you need programmatic config (e.g., generating colors from an API), you can still use JS config as an escape hatch.
2. **Vite plugin vs PostCSS** — Next.js 15 uses PostCSS. Install `@tailwindcss/postcss` instead of the Vite plugin.
3. **OKLCH browser support** — Supported in all modern browsers (Chrome 111+, Firefox 113+, Safari 15.4+). For legacy, provide a fallback.
4. **`@apply` is still supported** but considered a code smell for complex abstractions. Prefer component composition over `@apply` for anything non-trivial.
5. **Arbitrary values** like `w-[327px]` work fine, but prefer design tokens in `@theme` for consistency.
6. **Third-party plugin compatibility** — Some v3 plugins may not work. Check for v4-compatible versions.
