---
name: Tiered Context Loader
description: Intelligent workspace loading with three tiers (L0: tree, L1: metadata+previews, L2: full content) for token-efficient progressive disclosure. Triggers: tiered load, progressive load, lazy load workspace.
---

# Tiered Context Loader Skill

## Description
Intelligent workspace loading with three tiers of detail. Agents can load context progressively, starting with minimal overhead and drilling down as needed.

## Tiers

### L0: Directory Tree
- File names and structure
- Size indicators
- Last modified times
- ~50-100 tokens per directory

### L1: Metadata + Previews
- File metadata (type, size, encoding)
- First 50 lines of each file
- Auto-generated summaries for large files
- ~200-500 tokens per file

### L2: Full Content
- Complete file contents
- On-demand loading
- Respects .gitignore patterns
- Token budget awareness

## Triggers
- On workspace initialization
- Manual via `kolo load <path> --tier L0|L1|L2`
- Automatic upgrade when user references specific files

## Usage

```typescript
import { TieredLoader } from './tiered-loader';

const loader = new TieredLoader({ basePath: '/path/to/workspace' });

// Quick overview
const tree = await loader.loadL0();

// More detail for specific path
const metadata = await loader.loadL1('src/');

// Full content when needed
const content = await loader.loadL2('src/index.ts');
```

## Benefits
- 10-100x faster initial load
- Token-efficient context building
- Progressive disclosure matches how developers explore
