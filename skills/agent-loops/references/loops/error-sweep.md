# Production Error Sweep Loop

## Purpose
Find, classify, fix, and verify actionable errors in production — autonomously.

## Trigger
- Scheduled: Daily (low-traffic window)
- Event-driven: Error rate spike alert
- On-demand: Post-deployment verification

## Loop Body

```
1. SCAN production logs for errors (last 24h, or since last sweep)
2. CLASSIFY each error:
   - ACTIONABLE: has clear root cause, can fix
   - KNOWN: previously documented, fix in progress
   - NOISE: false alarm, transient, or self-resolved (debounce: 3+ occurrences)
   - NON-ACTIONABLE: systemic but beyond scope (escalate)
3. For each ACTIONABLE error:
   a. TRACE to root cause (logs, stack traces, reproduction steps)
   b. FIX with smallest credible change
   c. VERIFY fix (repro environment, then staging)
   d. OPEN PR with: cause, fix, before/after evidence, risks
4. For NOISE: update noise filter / alert threshold
5. For KNOWN: update tracking, note if fix landed
6. For NON-ACTIONABLE: escalate with evidence package
```

## Verification
- Fixed errors: no longer appear in logs under same conditions
- Fix verified in staging before PR merge
- PR includes reproduction evidence

## Stop Conditions
- ✅ No actionable errors remain
- ✅ All remaining errors classified (known/noise/non-actionable)
- ⚠️ After classifying all errors twice with no new actionable: stop and report

## Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `lookback_hours` | 24 | Hours of logs to scan |
| `noise_threshold` | 3 | Occurrences before classifying as noise |
| `max_fixes_per_sweep` | 5 | Prevent overwhelming PR volume |
| `timeout_per_fix` | 60 min | Max time per individual fix |

## Output
- Sweep report: errors found → classified → fixed → escalated
- PR list: one per actionable error fixed
- Noise pattern update: alerts that should be debounced

## Anti-Patterns
- Fixing noise (wastes time, creates churn)
- Fixing symptoms without root cause (error will return)
- Over-fixing: changing more than needed for the error
- Skipping classification: not all errors need fixing

## Example (KoLo House)
```
Trigger: Daily sweep, 03:00 JST
Scanned: 847 log lines, 32 error-class lines
Classified:
  - ACTIONABLE (2): OAuth token refresh race condition, memory leak in session cache
  - KNOWN (4): Bridge token mismatch (low priority, queued)
  - NOISE (24): codex-auth pulse every 30min (debounced)
  - NON-ACTIONABLE (2): DNS transient failures (ISP-level)
Fixed: OAuth retry logic, cache TTL added. 2 PRs opened.
Stop: No actionable errors remain. Report: 2 fixed, 4 known, 26 noise/escalated.
```
