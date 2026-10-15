---
name: Context Health Monitor
description: Monitors agent context health — token budget tracking, lost-in-middle detection, context freshness, degradation warnings. Triggers: context health, token budget, lost in middle, context monitor.
---

# Context Health Monitor Skill

## Description

Monitors the health of an agent's context, detecting issues like token budget exhaustion, lost-in-middle syndrome, and stale information.

## Capabilities

### Token Budget Tracking

- Real-time token usage estimation
- Warning thresholds (70%, 85%, 95%)
- Budget projections based on conversation trend

### Lost-in-Middle Detection

- Detects important information buried in context
- Flags when critical data is > 60% into the context
- Suggests repositioning strategies

### Context Freshness

- Tracks age of information in context
- Identifies stale data (>24h for volatile, >7d for stable)
- Recommends refresh actions

### Degradation Warnings

- Monitors for repetition patterns
- Detects confusion indicators
- Tracks reasoning quality metrics

## Triggers

- Periodic check (every N turns)
- Before complex reasoning tasks
- When token budget approaches limit
- Manual via `kurahi context health`

## Output

JSON health report with actionable recommendations.
