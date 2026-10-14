# Quality Streak Loop

## Purpose
Fix product failures until a defined streak of realistic tests passes consecutively.

## Trigger
- Scheduled: Pre-release quality gate
- Event-driven: Any test failure in CI
- Threshold: Failure rate exceeds acceptable level

## Loop Body

```
1. SELECT a realistic test scenario that failed (or create one if missing)
2. DOCUMENT the failure: what failed, expected vs actual, evidence
3. ADD regression coverage: a test that would have caught this
4. FIX the root cause (smallest credible fix)
5. RERUN the failing scenario — confirm it passes
6. RERUN the full regression suite — confirm no new failures
7. RESET streak counter to 0 if any failure; increment if clean
8. REPEAT until streak = N (default: 5)
```

## Verification
- Each fix is validated by the failing scenario + regression suite
- Evidence recorded for every pass/fail (logs, screenshots, timestamps)

## Stop Conditions
- ✅ N consecutive full-suite passes achieved
- ✅ Remaining failures are documented as known/acceptable trade-offs
- ⚠️ After 3 iterations without progress: escalate to human, document blockers

## Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `N` | 5 | Required consecutive passes |
| `max_iterations` | 20 | Hard stop to prevent infinite loops |
| `scenario_count` | varies | Number of realistic scenarios to cover |
| `timeout_per_iteration` | 30 min | Max time per fix cycle |

## Output
- Streak report: N passed, total iterations, failures fixed, failures deferred
- Evidence package: per-scenario results with timestamps
- Regression coverage delta: tests added

## Example (KoLo House)
```
Trigger: Gateway health check fails
Scenario: "Gateway responds to health probe within 2s"
Failure: :18790 returned 502, 3.2s response
Fix: PM2 restart threshold tuned, memory limit raised
Regression: Added /health latency test with 2s timeout
Rerun: 1.1s — PASS
Streak: 1/5... 2/5... 3/5... 4/5... 5/5 ✓
Stop: Quality streak complete. 1 fix, 1 regression test added.
```
