# Docs Sweep Loop

## Purpose
Keep all documentation aligned with the current codebase. Every documented behavior matches current implementation.

## Trigger
- Scheduled: Weekly (or nightly for fast-moving projects)
- Event-driven: After significant PR merge, API change, or feature ship
- On-demand: Before release, before investor demo

## Loop Body

```
1. IDENTIFY documentation surface:
   - API docs / OpenAPI specs
   - README / quickstart guides
   - Architecture docs / ADRs
   - User-facing docs / knowledge base
   - Inline code comments / docstrings
   - Changelog / release notes
2. For each doc surface:
   a. MAP documented claims to current code behavior
   b. FLAG any mismatch: claim ≠ implementation
   c. For each flag: determine if doc is stale OR code has regressed
3. FIX stale docs: update to match current implementation
4. VERIFY: re-check each fixed doc against code
5. OPEN PR with: what changed, why, before/after
```

## Verification
- Every documented API endpoint → tested against live/compiled code
- Every documented behavior → traceable to source
- Every code example → runs without error

## Stop Conditions
- ✅ No stale documentation found
- ✅ All mismatches resolved (doc updated OR code fix PR'd)
- ⚠️ After full sweep with no changes: stop, report "docs aligned"

## Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `doc_surfaces` | all | Which doc surfaces to sweep |
| `max_fixes_per_sweep` | 10 | Cap PR size |

## Output
- Staleness report: surfaces checked, mismatches found, fixed
- PR: all doc updates in one reviewable PR

## Example (KoLo House)
```
Trigger: Post-Svitla demo, docs need alignment check
Surfaces swept: KoLo-docs (46 files), kodasoken.com/research, READMEs
Findings:
  - C4 cold-restart claim: doc says "unverified frontier" ✅ aligned
  - Daemon V2 modules: doc says "13/13 pass" — actual: 13/13 ✅
  - Gateway port docs: 18793 referenced, actual swapped to 18789 ⚠️ STALE
Fixed: Gateway port reference updated. 1 PR.
Stop: All surfaces aligned. Report: 1 fix, rest current.
```
