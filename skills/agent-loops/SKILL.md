---
name: agent-loops
description: "Autonomous agent operational loops — reusable, self-terminating workflows for AI agents. Covers error sweeps, quality streaks, docs alignment, architecture refinement, release management, and evaluation cadences. Use when designing autonomous agent behaviors, setting up operational loops, building quality gates, creating self-healing systems, or formalizing repeatable agent workflows. Triggers: agent loop, operational loop, quality streak, error sweep, docs sweep, autonomous workflow, self-terminating task, agent cadence, repeatable agent process."
---

# Agent Loops

Autonomous, self-terminating operational loops for AI agents. Each loop has a trigger condition, action, verification step, and explicit stopping criteria — an agent can run them unsupervised.

## The Meta-Pattern

Every loop follows the same structure:

```
TRIGGER → ACTION → VERIFY → STOP (or repeat)
```

1. **Trigger** — What activates the loop (event, cron, threshold breach)
2. **Action** — What the loop does (find, fix, build, clean)
3. **Verify** — How to confirm the action worked (test, measure, compare)
4. **Stop** — When the loop terminates (condition met, N iterations, nothing to fix)

A loop that never stops is a bug, not a feature. Every loop must define what "done" looks like.

## Loop Catalog

### Quality & Reliability

**Quality Streak Loop** — Fix failures until N consecutive passes.
- Trigger: Test failure or quality threshold breach
- Action: Identify failure → document it → add regression coverage → fix root cause → rerun
- Verify: Full suite passes with the fix
- Stop: N consecutive successful runs (default: 5)
- Reference: `references/loops/quality-streak.md`

**Production Error Sweep** — Find, fix, and verify actionable production errors.
- Trigger: Scheduled (daily) or incident-driven
- Action: Scan production logs → classify errors → trace to root cause → fix → verify → PR
- Verify: Error no longer appears in logs under same conditions
- Stop: No actionable errors remain, OR 2+ non-actionable passes
- Reference: `references/loops/error-sweep.md`

**Full Product Evaluation Loop** — Test every major capability.
- Trigger: Pre-release, weekly, or quality-gate
- Action: Create N realistic scenarios → define success criteria → run all → record evidence
- Verify: Every scenario meets quality bar
- Stop: All scenarios pass, OR documented trade-offs accepted
- Reference: `references/loops/product-eval.md`

### Documentation & Knowledge

**Docs Sweep** — Keep documentation aligned with codebase.
- Trigger: After significant code changes, or scheduled (weekly)
- Action: Review codebase in full → compare against docs → update stale docs → verify → PR
- Verify: Every documented API/behavior matches current implementation
- Stop: No stale documentation found, OR PR opened with all fixes
- Reference: `references/loops/docs-sweep.md`

**Nightly Changelog Loop** — Keep changelog current.
- Trigger: Daily (nightly cron)
- Action: Review changes from previous day → identify user-visible changes → update changelog
- Verify: Changelog reflects every meaningful change
- Stop: Changelog updated, OR no user-visible changes to report

### Architecture & Code Quality

**Architecture Satisfaction Loop** — Refactor until happy, checkpointed.
- Trigger: Architecture review, tech-debt threshold
- Action: Identify target state → refactor in small steps → live-test each step → autoreview → commit
- Verify: Architecture matches target state, tests pass
- Stop: Architecture satisfies defined quality criteria
- Reference: `references/loops/architecture-satisfaction.md`

**Test Coverage Loop** — Add tests until target coverage met.
- Trigger: Below coverage threshold
- Action: Identify uncovered paths → add meaningful tests → measure coverage
- Verify: Coverage at or above target
- Stop: Target coverage achieved (never add meaningless tests just for the number)

**Test Suite Speed Loop** — Optimize tests without weakening them.
- Trigger: Suite exceeds time budget
- Action: Profile slow tests → optimize bottlenecks → verify coverage unchanged
- Verify: Same coverage, faster execution
- Stop: Suite within time budget, OR no safe optimizations remain

**Repository Cleanup Loop** — Recover valuable work, clean stale state.
- Trigger: Scheduled (monthly) or on-demand
- Action: Inspect branches/PRs/commits → recover valuable work → clean everything stale
- Verify: Repository is current and organized
- Stop: No stale branches/PRs remain, all valuable work recovered

### Release & Operations

**Stale-Safe Batch Release Loop** — Batch valid changes, release clean artifacts.
- Trigger: Release window opens
- Action: Review pending changes/PRs → exclude stale/unfinished → combine valid → release together
- Verify: Released artifacts built from latest integrated main
- Stop: All valid changes released, stale work documented for follow-up

**Post-Release Baseline Loop** — Benchmark each completed release.
- Trigger: After each release
- Action: Run standard benchmarks → record results → compare to previous baseline
- Verify: Baselines recorded and comparable
- Stop: New baseline documented, regressions flagged

**Production Data Cleanup Loop** — Remove disallowed data, prevent recurrence.
- Trigger: Scheduled audit or incident-driven
- Action: Review production records → remove disallowed data → improve classification logic → verify
- Verify: Remaining data meets allowed definition; classification prevents same error
- Stop: All production data compliant, classification logic hardened

### Performance & Optimization

**Performance Optimization Loop** — Hit a specific performance target.
- Trigger: Performance metric below target (e.g., page load > 50ms)
- Action: Profile → identify bottleneck → optimize → measure under repeatable conditions
- Verify: Metric meets target across all measured surfaces
- Stop: Target consistently achieved across all pages/paths

**Logging Coverage Loop** — Add useful logs to every important path.
- Trigger: Incident post-mortem (gap discovered), or scheduled review
- Action: Review system paths → identify logging gaps → add tested logs → verify
- Verify: Every important path produces useful, tested logs
- Stop: No critical paths uncovered by logging

### Customer & Quality of Life

**Ticket-to-Fix Loop** — Complaint → repro → root cause → fix → PR.
- Trigger: Bug report, ticket, or customer complaint
- Action: Reproduce failure in minimal environment → prove root cause → minimal fix → rerun repro + regression
- Verify: Original issue resolved, no regressions
- Stop: Fix PR'd with cause, changed files, before/after proof, risks
- If unreproducible after 2 serious attempts: document and stop

**Customer AI Deployment Loop** — Move one AI priority through validation to production.
- Trigger: Customer AI request, failure report, or ops review
- Action: Choose priority → define owner/inputs/approvals/metrics → dry-run on realistic data → fix smallest problem → staged release → monitor
- Verify: Production metrics match success criteria
- Stop: Outcome documented, evidence gathered, lessons saved, next review scheduled

## Loop Composition

Loops compose. Common compositions:

- **Release Train:** Docs Sweep → Full Product Evaluation → Quality Streak → Stale-Safe Batch Release → Post-Release Baseline
- **Incident Response:** Production Error Sweep → Logging Coverage → Ticket-to-Fix
- **Sprint Health:** Repository Cleanup → Test Coverage → Test Suite Speed
- **Production Hygiene:** Production Error Sweep + Production Data Cleanup + Logging Coverage (run in parallel)

## Loop Design Rules

When designing a new loop:
1. **Trigger must be unambiguous.** If a human has to decide "should I run this?", the trigger isn't clear enough.
2. **Stop condition is mandatory.** A loop without a stop condition is an infinite process.
3. **Verification is not optional.** "Looks good" is not verification. Define measurable criteria.
4. **Side effects must be reversible or safe.** Loops run autonomously — they shouldn't brick anything.
5. **Small steps, checkpointed.** One big change per iteration = one big rollback. Many small verified steps.
6. **Idempotent where possible.** Running the loop twice should not cause harm.

## Integration with Daemon Systems

These loops are designed to plug into daemon cycles (cron, PM2, sentience ticks):

| Integration Point | Best-Fit Loops |
|-------------------|---------------|
| **Heartbeat tick** | Production Error Sweep, Logging Coverage |
| **Daily cron** | Nightly Changelog, Docs Sweep |
| **Weekly cron** | Full Product Evaluation, Repository Cleanup |
| **Release gate** | Quality Streak, Stale-Safe Batch Release, Post-Release Baseline |
| **Incident trigger** | Ticket-to-Fix, Production Error Sweep |
| **Threshold alert** | Test Coverage, Performance Optimization, Test Suite Speed |

## Anti-Patterns

- **Loops without stopping criteria** → infinite work generation
- **Verification by assertion** → "I checked it" without evidence
- **Over-looping** → automating things that need human judgment
- **Under-looping** → doing manually what a loop could do reliably
- **Loop dependency chains** → A waits for B waits for C... simplify or parallelize
- **Loop that only reports** → a loop that finds problems but never fixes them is just a nag
