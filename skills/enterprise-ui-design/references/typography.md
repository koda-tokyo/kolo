# Typography

## Font Selection

### Recommended Fonts

**UI / Interface:**
- Inter (free, variable weight, excellent for screens)
- IBM Plex Sans (free, corporate, great x-height)
- SF Pro (Apple ecosystem)
- Segoe UI (Windows ecosystem)

**Headlines (if different from body):**
- Inter Display
- IBM Plex Sans Condensed
- Manrope

**Monospace (code, data):**
- JetBrains Mono
- IBM Plex Mono
- SF Mono

### Never Use
- Comic Sans, Papyrus, cursive fonts
- More than 2 font families per project
- Fonts without proper language support

## Type Scale

Use a consistent ratio. Recommended: 1.25 (Major Third) or 1.2 (Minor Third).

```
Base: 16px

12px  — Caption, helper text
14px  — Body small, table cells
16px  — Body, default
18px  — Body large, lead text
20px  — H5
24px  — H4
30px  — H3
36px  — H2
48px  — H1
60px  — Display
```

### Implementation (CSS/Tailwind)

```css
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
--text-4xl: 2.25rem;   /* 36px */
--text-5xl: 3rem;      /* 48px */
--text-6xl: 3.75rem;   /* 60px */
```

## Font Weights

Use 3-4 weights maximum:

| Weight | Use |
|--------|-----|
| 400 Regular | Body text |
| 500 Medium | UI elements, buttons, labels |
| 600 Semibold | Headings, emphasis |
| 700 Bold | Strong emphasis only |

### Never Use
- Light (300) for body text — accessibility issue
- Black (900) — too heavy for enterprise
- More than 4 weights per project

## Line Height (Leading)

Line height is proportional to font size:

| Font Size | Line Height |
|-----------|-------------|
| 12-14px | 1.5 (150%) |
| 16-18px | 1.5-1.625 |
| 20-24px | 1.4 |
| 30-36px | 1.3 |
| 48px+ | 1.2 |

**Rule:** Larger text needs tighter line height.

## Line Length

Optimal reading: 50-75 characters per line.

```css
max-width: 65ch; /* Characters */
/* or */
max-width: 600px; /* Fixed */
```

## Letter Spacing

Most fonts are designed with correct spacing. Only adjust when:

```css
/* All caps text — increase tracking */
.uppercase { letter-spacing: 0.05em; }

/* Large headlines — tighten slightly */
.display { letter-spacing: -0.02em; }

/* Don't touch body text */
```

## Text Case

| Element | Case |
|---------|------|
| Headings | Sentence case |
| Body | Sentence case |
| Buttons | Sentence case |
| Labels | Sentence case |
| Navigation | Sentence case |
| Tabs | Sentence case |

**Never:** ALL CAPS for paragraphs or long text.

**Rarely:** Title Case (use only for proper nouns, product names).

## Alignment

**Flush left (default):** Best for readability. Use for all body text.

**Center:** Headlines only. Never body text.

**Right:** Numbers in tables only.

**Justify:** Never in digital interfaces.

## Typographic Details

### Punctuation
- Use proper quotes: "curly" not "straight"
- Use em dashes (—) not double hyphens (--)
- Use ellipsis character (…) not three dots (...)

### Numbers
- Use tabular figures for tables and data
- Use proportional figures for body text
- Align decimal points in columns

### Common Mistakes
- Grey text on colored backgrounds (use white or darken)
- Orphans and widows in headings
- Hyphenation in short columns
- Underlines that aren't links
