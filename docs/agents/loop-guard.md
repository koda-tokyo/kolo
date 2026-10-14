---
summary: "Loop guard: step cap and doom-loop detection for agent runs"
read_when:
  - A run keeps calling the same tool
  - You want to bound how much a single run can do
title: "Loop guard"
---

# Loop guard

Every embedded agent run is watched by a step limiter and a doom-loop detector. When a rule fires
the run is aborted, its state is summarised for the log, and an audit entry is written with action
`agent.loop_stopped`. The job's status becomes `loop_stopped`.

## Rules

| Rule | Default | Fires when |
|---|---|---|
| `maxSteps` | 200 | the run has made this many tool steps |
| `doomLoop.maxIdenticalCalls` | 4 | the same tool is called this many times in a row with the same arguments (arguments are canonicalised, so key order does not matter) |
| `doomLoop.noProgressSteps` | 12 | this many steps pass with no successful write-class tool call (`write`, `edit`, `apply_patch`, `multi_edit`) and no changed result for a repeated call; errors never count as progress |

## Configuration

Per agent under `agents.list[].limits`, falling back to `agents.defaults.limits`, then the built-in
defaults:

```json5
{
  agents: {
    defaults: {
      limits: {
        maxSteps: 200,
        doomLoop: { maxIdenticalCalls: 4, noProgressSteps: 12 }
      }
    },
    list: [
      { id: "ops-bot", limits: { maxSteps: 50 } }
    ]
  }
}
```

`maxSteps` accepts 1 to 10000.

## What you see

- The gateway log: `embedded run loop stop: runId=... reason=<max_steps|identical_calls|no_progress> steps=N: <summary>`.
- The audit log: `agent.loop_stopped` with the reason, the summary, the step count, the limits in
  force, the run id and the session id (`kolo api listAuditEvents -p action=agent.loop_stopped`).
- The job: `kolo api getJob -p id=<job id>` shows `status: loop_stopped`.

The detector is pure logic over the tool start and end events of one run; it holds no state across
runs and never reads tool contents beyond a bounded digest of the arguments.
