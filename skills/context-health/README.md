# Context Health Monitor

Real-time context health monitoring for KoLo agents. Detects issues before they impact reasoning quality.

## Features

### 🎯 Token Budget Tracking
- Real-time usage monitoring
- Warning levels (70%, 85%, 95%)
- Turn-ahead projections
- Budget exhaustion alerts

### 🔍 Lost-in-Middle Detection
LLMs struggle with information buried in the middle of long contexts. This monitor:
- Identifies important info in the "danger zone" (30-70% position)
- Flags critical information that's buried
- Recommends repositioning strategies

### ⏰ Context Freshness
- Tracks age of information
- Different thresholds for volatile vs stable data
- Identifies stale tool results
- Recommends refresh actions

### 📉 Degradation Warnings
- Repetition detection
- Confusion indicator analysis
- Overall quality scoring
- Proactive cleanup recommendations

## Installation

```bash
cd skills/context-health
# No dependencies - pure TypeScript
```

## Usage

### As a Module

```typescript
import { ContextHealthMonitor, ContextBlock } from './context-health';

const monitor = new ContextHealthMonitor({
  maxTokens: 100000,
  warningThresholds: [0.7, 0.85, 0.95],
  middleThreshold: 0.6,
  staleHoursVolatile: 24,
  staleDaysStable: 7,
});

// Your context blocks
const blocks: ContextBlock[] = [
  {
    id: 'sys-1',
    type: 'system',
    content: 'You are a helpful assistant...',
    importance: 'critical',
  },
  {
    id: 'user-1',
    type: 'user',
    content: 'Help me debug this...',
    timestamp: Date.now() - 1000 * 60 * 30, // 30 min ago
  },
  // ... more blocks
];

// Full health report
const report = monitor.generateReport(blocks);
console.log(monitor.formatReport(report));

// Quick check (for frequent polling)
const quick = monitor.quickCheck(blocks);
if (quick.status !== 'ok') {
  console.warn('Context issues:', quick.issues);
}
```

### As CLI

```bash
# Analyze a context dump
npx ts-node context-health.ts context.json
```

Input format:
```json
[
  {
    "id": "block-1",
    "type": "system",
    "content": "System prompt here...",
    "timestamp": 1710123456789,
    "importance": "critical"
  }
]
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTokens` | number | 100000 | Context limit |
| `warningThresholds` | number[] | [0.7, 0.85, 0.95] | Warning levels |
| `middleThreshold` | number | 0.6 | Middle zone boundary |
| `staleHoursVolatile` | number | 24 | Hours before volatile data is stale |
| `staleDaysStable` | number | 7 | Days before stable data is stale |

## Block Types

```typescript
interface ContextBlock {
  id: string;                                           // Unique identifier
  type: 'system' | 'user' | 'assistant' | 'tool_result' | 'memory' | 'file';
  content: string;                                      // The actual content
  timestamp?: number;                                   // When it was added (ms)
  importance?: 'critical' | 'high' | 'medium' | 'low'; // Priority level
  source?: string;                                      // Origin (e.g., file path)
  tokens?: number;                                      // Pre-computed token count
}
```

## Health Report

```typescript
interface HealthReport {
  timestamp: string;
  overall: 'healthy' | 'warning' | 'degraded' | 'critical';
  tokenBudget: {
    used: number;
    max: number;
    percentage: number;
    remaining: number;
    warningLevel: 'ok' | 'warning' | 'critical' | 'exceeded';
    projection?: {
      turnsRemaining: number;
      tokensPerTurn: number;
    };
  };
  middleAnalysis: {
    blocksInMiddle: Array<{id, type, importance, position, preview}>;
    criticalBuried: boolean;
    highBuried: boolean;
    recommendation?: string;
  };
  freshness: {
    staleBlocks: Array<{id, type, ageHours, source, recommendation}>;
    averageAgeHours: number;
    oldestBlock?: {id, ageHours};
  };
  degradation: {
    repetitionScore: number;     // 0-1
    confusionIndicators: string[];
    qualityScore: number;        // 0-100
    warnings: string[];
  };
  recommendations: string[];
}
```

## Integration Patterns

### Per-Turn Check
```typescript
// After each turn
const quick = monitor.quickCheck(blocks);
if (quick.status === 'critical') {
  // Immediate action needed
  await compactContext();
}
```

### Pre-Reasoning Check
```typescript
// Before complex reasoning
const report = monitor.generateReport(blocks);
if (report.middleAnalysis.criticalBuried) {
  // Restructure context first
  blocks = moveImportantToEnds(blocks);
}
```

### Periodic Health Log
```typescript
// Every N turns or minutes
const report = monitor.generateReport(blocks);
fs.appendFileSync(
  '~/.kolo/logs/context-health.jsonl',
  JSON.stringify(report) + '\n'
);
```

## Example Output

```
# Context Health Report
Generated: 2024-03-11T01:30:00.000Z
Overall Status: **WARNING**

## Token Budget
- Used: 72,500 / 100,000 (73%)
- Status: warning
- Projection: ~12 turns remaining at 2,100 tokens/turn

## Lost-in-Middle Analysis
- Critical buried: No
- High-importance buried: Yes
- Blocks in middle: 3

## Freshness
- Stale blocks: 2
- Average age: 4.2h
- Oldest: tool-result-5 (18.5h)

## Quality Metrics
- Quality Score: 78/100
- Repetition: 8%
- Confusion indicators: 1

## Recommendations
- Monitor token usage - consider proactive compaction
- Consider restructuring: important information buried in middle
- 2 blocks contain stale information - refresh or remove
```

## Best Practices

1. **Run quick checks often** - Every turn is not too frequent
2. **Full reports before complex tasks** - Worth the overhead
3. **Act on criticals immediately** - Don't delay
4. **Log reports** - Useful for debugging session issues
5. **Tune thresholds** - Adjust based on your model/workload

## License

MIT - Part of the KoLo project.
