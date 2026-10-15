# Context Optimizer

Pre-reasoning hook system for Kurahi agents. Automatically optimizes context before LLM processing to reduce token usage and improve reasoning quality.

## Why This Exists

LLMs have context limits. As conversations grow, tool results accumulate, and memory files expand, agents can hit these limits or suffer from "lost in the middle" syndrome where important information gets buried.

This skill provides:

- **Token counting** - Know how much context you're using
- **Automatic compaction** - Shrink verbose content while preserving meaning
- **Smart prioritization** - Recent and critical information is preserved
- **Metrics logging** - Track optimization over time

## Installation

```bash
cd skills/context-optimizer
npm install  # No deps, but prepares for ts-node
```

## Usage

### As a Module

```typescript
import { ContextOptimizer, estimateTokens } from "./context-optimizer";

// Create optimizer with custom config
const optimizer = new ContextOptimizer({
  maxTokens: 100000, // Your model's context limit
  compactionThreshold: 0.7, // Trigger optimization at 70%
  preserveRecent: 5, // Always keep last 5 tool results
  verbose: true, // Log to console
});

// Check if optimization is needed
if (optimizer.needsOptimization(context)) {
  const { optimized, result } = optimizer.optimizeContext(blocks);
  console.log(`Saved ${result.originalTokens - result.optimizedTokens} tokens`);
}

// Quick token estimate
const tokens = estimateTokens("Your text here");
```

### As CLI

```bash
# Check token status
npx ts-node context-optimizer.ts status myfile.txt

# Optimize a file
npx ts-node context-optimizer.ts optimize context.txt 50000
```

### Integration with Kurahi Agents

Add to your agent's boot sequence:

```typescript
// In agent startup
import { ContextOptimizer } from "./skills/context-optimizer/context-optimizer";

const contextOptimizer = new ContextOptimizer({
  maxTokens: 100000,
  compactionThreshold: 0.7,
});

// Before each reasoning step
function preReasoning(context: ContextBlock[]) {
  const status = contextOptimizer.getTokenStatus(context);

  if (status.needsOptimization) {
    const { optimized, result } = contextOptimizer.optimizeContext(context);
    console.log(`[Pre-Reasoning] Optimized: ${result.ratio.toFixed(2)}x compression`);
    return optimized;
  }

  return context;
}
```

## API Reference

### `ContextOptimizer`

Main class for context optimization.

#### Constructor Options

| Option                | Type    | Default                              | Description                  |
| --------------------- | ------- | ------------------------------------ | ---------------------------- |
| `maxTokens`           | number  | 100000                               | Maximum token budget         |
| `compactionThreshold` | number  | 0.7                                  | Trigger compaction at this % |
| `preserveRecent`      | number  | 5                                    | Always keep N recent items   |
| `logPath`             | string  | ~/.kolo/logs/context-optimizer.jsonl | Metrics log path             |
| `verbose`             | boolean | false                                | Console logging              |

#### Methods

- `needsOptimization(context)` - Check if optimization is needed
- `getTokenStatus(context)` - Get current token usage
- `optimizeToolResults(results)` - Optimize tool result array
- `optimizeMemory(entries)` - Optimize memory entries
- `optimizeContext(blocks)` - Full context optimization
- `optimizeRawContext(text, targetTokens?)` - Quick string optimization

### Standalone Functions

- `estimateTokens(text)` - Fast token count estimation
- `compactToolResult(result, maxTokens?)` - Compact a single tool result
- `compactMemory(entry, maxTokens?)` - Compact a memory entry
- `deduplicateBlocks(blocks)` - Remove duplicate blocks

## Compaction Strategies

### Tool Results

1. Keep first line (usually most important)
2. Extract all error lines
3. Keep key-value pairs
4. Discard verbose output
5. Add truncation notice

### Memory

1. Keep first paragraph
2. Extract bullet points
3. Keep last paragraph
4. Compress based on importance level

### Raw Context

1. Keep front portion (60%)
2. Keep back portion (40%)
3. Truncate middle with notice

## Metrics

All operations log to `~/.kolo/logs/context-optimizer.jsonl`:

```json
{
  "timestamp": "2024-03-11T01:30:00.000Z",
  "operation": "optimizeContext",
  "result": {
    "originalTokens": 85000,
    "optimizedTokens": 52000,
    "ratio": 0.61,
    "itemsRemoved": 3,
    "itemsPreserved": 47,
    "timeMs": 12,
    "actions": ["Compacted tool_result: 5000 → 500 tokens", ...]
  }
}
```

## Best Practices

1. **Run early, run often** - Check before each reasoning step
2. **Tune thresholds** - 70% is conservative; adjust based on your workload
3. **Preserve recent** - Recent context is usually most relevant
4. **Monitor metrics** - Watch for patterns in what gets compacted
5. **Don't over-compact** - Some verbosity aids reasoning

## License

MIT - Part of the Kurahi project.
