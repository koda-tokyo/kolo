---
name: figma
description: "Fetch design context from a Figma file or frame — get component structure, styles, layout, colors, typography for code generation. Use when given a Figma URL, when asked to implement a design, or when you need to understand a UI mockup. Triggers for: figma link, figma file, implement this design, build this UI, design to code, figma frame, what does this design look like."
homepage: https://figma.com
metadata:
  {
    "Kurahi":
      {
        "emoji": "🎨",
        "requires": { "bins": ["python3"], "env": ["FIGMA_TOKEN"] },
        "primaryEnv": "FIGMA_TOKEN",
      },
  }
---

# Figma — Design Context for Code Generation

Fetches structured design data from Figma files and frames. Use to understand layout, components, colors, and typography before generating implementation code.

## Quick Start

```bash
# Get design context from a Figma file URL
python3 {baseDir}/scripts/figma.py context "https://www.figma.com/file/ABC123/MyDesign?node-id=1:2"

# List all pages and frames in a file
python3 {baseDir}/scripts/figma.py list "https://www.figma.com/file/ABC123/MyDesign"

# Get component structure as JSON
python3 {baseDir}/scripts/figma.py context "https://www.figma.com/file/ABC123/MyDesign?node-id=1:2" --json
```

## API Token

Get from figma.com → Account Settings → Personal access tokens.

Set `FIGMA_TOKEN` or configure in `~/.kolo/kolo.json`:

```json
{ "skills": { "figma": { "token": "figd_..." } } }
```

## Workflow

1. Paste the Figma frame URL (copy with Cmd+L in Figma)
2. Run `context` to get structured design data
3. Use the output to generate accurate implementation code

## What It Returns

- Frame dimensions and layout (auto-layout, grid, padding)
- Component tree with names and types
- Colors (fills, strokes) as hex values
- Typography (font family, size, weight, line height)
- Spacing and border radius values
- Asset export URLs for images/icons
