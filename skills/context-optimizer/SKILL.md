---
name: Context Optimizer
description: Pre-reasoning hook that optimizes context before LLM processing — token estimation, tool result compaction, memory compaction. Triggers: context optimize, token compact, compress context.
---

# Context Optimizer Skill

## Description

Pre-reasoning hook that optimizes context before LLM processing. Reduces token usage, compacts tool results, and ensures the most relevant information is prioritized.

## Triggers

- Before reasoning on large contexts (>50k tokens estimated)
- When tool results exceed 10KB
- On memory file loads
- Manual invocation via `kurahi context optimize`

## Capabilities

- **Token Estimation**: Fast approximation of token counts (4 chars ≈ 1 token)
- **Tool Result Compaction**: Summarize verbose outputs, keep actionable data
- **Memory Compaction**: Merge redundant memories, archive stale ones
- **Threshold-Based Triggers**: Automatic optimization when limits approach

## Usage

```typescript
import { ContextOptimizer } from "./context-optimizer";

const optimizer = new ContextOptimizer({
  maxTokens: 100000,
  compactionThreshold: 0.7, // Trigger at 70% capacity
  preserveRecent: 5, // Always keep last 5 tool results
});

const optimizedContext = await optimizer.optimize(context);
```

## Metrics

All operations log to `~/.kolo/logs/context-optimizer.jsonl`:

- Input/output token counts
- Compaction ratio achieved
- Time taken
- Items removed/preserved

## Dependencies

- Node.js 18+
- No external packages (pure TypeScript)
