# Architecture Satisfaction Loop

## Purpose
Refactor architecture in small, tested, independently reviewed checkpoints until it satisfies defined quality criteria — without ever being in a broken state.

## Trigger
- Architecture review identifies target state
- Tech debt reaches defined threshold
- New patterns emerge that make current architecture feel wrong

## Loop Body

```
1. DEFINE the target architecture state (specific, measurable):
   - What changes: module boundaries, data flow, interface contracts
   - What stays: behavior, API surface, test expectations
   - Success criteria: "I'll know it's done when..."
2. CREATE a tracking file: /tmp/refactor-{project}.md
   - Current state → target state → checkpoint log
3. WHILE current ≠ target:
   a. IDENTIFY smallest meaningful step toward target
   b. IMPLEMENT the step (one module, one boundary, one contract)
   c. LIVE-TEST: verify behavior unchanged
   d. RUN autoreview: lint, typecheck, test suite
   e. COMMIT with: what moved, why, behavioral confirmation
   f. UPDATE tracking file with checkpoint
4. When target reached: final review, squash if appropriate
```

## Verification
- Every checkpoint: behavior unchanged (tests pass identically)
- Final state: architecture matches target definition
- No regressions in performance, coverage, or readability

## Stop Conditions
- ✅ Architecture satisfies defined quality criteria ("I'm happy with this")
- ✅ All checkpoints committed and reviewed
- ⚠️ If a step reveals the target is wrong: stop, redefine target, restart
- ⚠️ If a step breaks behavior: rollback to last checkpoint, investigate

## Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `checkpoint_size` | ~1 module | Max change per checkpoint |
| `tracking_file` | /tmp/refactor-{project}.md | Progress log |

## Checklist Per Checkpoint
- [ ] One module/boundary/contract changed
- [ ] Behavior unchanged (tests pass)
- [ ] Lint/typecheck clean
- [ ] Committed with clear message
- [ ] Tracking file updated

## Output
- Tracking file: complete refactor log
- Commit series: one per checkpoint
- Final review: architecture now matches target

## When NOT to Use
- Emergency hotfixes (use Ticket-to-Fix instead)
- Greenfield builds (no architecture to satisfy yet)
- When target isn't clear enough to define criteria ("make it better" is not a target)

## Example (KoLo House)
```
Project: Marianas memory module refactor
Target: Split monolithic memory.py → memory/stm.py + memory/mtm.py + memory/ltm.py
Tracking: /tmp/refactor-memory.md

Checkpoint 1: Extract STM module, tests pass ✅
Checkpoint 2: Extract MTM module, tests pass ✅
Checkpoint 3: Extract LTM module, one test failure — rollback, investigate
             Root cause: circular import. Fix: add interface layer.
Checkpoint 3 (retry): Extract LTM with interface layer, tests pass ✅
Checkpoint 4: Clean up imports, typecheck clean ✅

Stop: Target achieved. 4 checkpoints, 1 rollback. Architecture satisfied.
```
