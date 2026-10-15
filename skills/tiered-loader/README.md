# Tiered Context Loader

Intelligent workspace loading for Kurahi agents. Load context progressively with three tiers of detail.

## The Problem

Loading entire workspaces into context is wasteful:

- Most files aren't relevant to the current task
- Large files burn tokens quickly
- Binary files provide no value
- Agents don't need full content to understand structure

## The Solution

Three tiers of loading:

| Tier   | What You Get                | Token Cost    | Use Case                    |
| ------ | --------------------------- | ------------- | --------------------------- |
| **L0** | Directory tree with sizes   | ~50-100/dir   | Initial exploration         |
| **L1** | Metadata + 50-line previews | ~200-500/file | Understanding scope         |
| **L2** | Full file contents          | Varies        | Deep work on specific files |

## Installation

```bash
cd skills/tiered-loader
# No dependencies needed - pure TypeScript
```

## Usage

### As a Module

````typescript
import { TieredLoader } from "./tiered-loader";

const loader = new TieredLoader({
  basePath: "/path/to/my-project",
  maxDepth: 10,
  respectGitignore: true,
  previewLines: 50,
  maxFileSize: 1024 * 1024, // 1MB
  tokenBudget: 50000,
});

// L0: Quick overview
const tree = loader.loadL0();
console.log(loader.formatL0(tree.data));
// 📁 my-project
// ├── 📁 src
// │   ├── 📄 index.ts (2.1KB)
// │   └── 📄 utils.ts (1.3KB)
// └── 📄 package.json (0.5KB)

// L1: Dive into src/
const metadata = loader.loadL1("src");
console.log(loader.formatL1(metadata.data));
// ## src/index.ts
// Size: 2.1KB | Modified: 2024-03-11 | Lines: 87
// ```ts
// import { utils } from './utils';
// export function main() { ... }
// ... [37 more lines]
// ```

// L2: Get full content
const content = loader.loadL2("src/index.ts");
console.log(loader.formatL2(content.data));
// Full file content
````

### As CLI

```bash
# L0: Directory tree
npx ts-node tiered-loader.ts L0 . /path/to/project

# L1: Metadata for src/
npx ts-node tiered-loader.ts L1 src /path/to/project

# L2: Full content of a file
npx ts-node tiered-loader.ts L2 src/index.ts /path/to/project
```

### Integration Pattern

```typescript
// Recommended agent workflow
async function exploreWorkspace(loader: TieredLoader, query: string) {
  // Step 1: Always start with L0
  const tree = loader.loadL0();
  const context = [`# Workspace Structure\n${loader.formatL0(tree.data)}`];

  // Step 2: Identify relevant directories
  const relevantDirs = identifyRelevant(tree.data, query);

  // Step 3: Load L1 for relevant areas only
  for (const dir of relevantDirs) {
    if (tree.tokensUsed < 30000) {
      // Budget check
      const meta = loader.loadL1(dir);
      context.push(`# ${dir}\n${loader.formatL1(meta.data)}`);
    }
  }

  // Step 4: L2 only when specifically needed
  // (Usually during task execution, not exploration)

  return context.join("\n\n");
}
```

## Configuration

| Option             | Type    | Default  | Description                    |
| ------------------ | ------- | -------- | ------------------------------ |
| `basePath`         | string  | required | Root path for loading          |
| `maxDepth`         | number  | 10       | Max directory depth            |
| `respectGitignore` | boolean | true     | Honor .gitignore patterns      |
| `previewLines`     | number  | 50       | Lines to include in L1 preview |
| `maxFileSize`      | number  | 1MB      | Skip files larger than this    |
| `tokenBudget`      | number  | 50000    | Max tokens for L1/L2           |

## Smart Features

### Automatic Filtering

- Skips `node_modules`, `.git`, `__pycache__`, etc.
- Respects `.gitignore` patterns
- Identifies and labels binary files without reading content

### Token Awareness

- Tracks token usage in real-time
- Stops loading when budget exceeded
- Reports token usage in results

### Intelligent Summaries

- Extracts key information from code files
- Counts imports without listing them all
- Identifies exports and class definitions

## Return Value

All methods return a `LoadResult`:

```typescript
interface LoadResult<T> {
  data: T; // The actual loaded data
  tokensUsed: number; // Estimated token count
  filesProcessed: number;
  timeMs: number; // Load time
}
```

## Best Practices

1. **Always start with L0** - Understand structure before diving deep
2. **Use L1 for targeted directories** - Not the whole workspace
3. **L2 only when needed** - Full content is expensive
4. **Monitor token budget** - Each method returns token usage
5. **Cache L0 results** - Structure doesn't change often

## License

MIT - Part of the Kurahi project.
