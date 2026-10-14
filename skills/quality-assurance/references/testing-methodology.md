---
title: "Testing Methodology"
type: reference
product: all
last_reviewed: 2026-05-20
review_cycle_days: 180
owner: qa-team
status: published
---

# Testing Methodology

## The Testing Pyramid at KodaSōken

Our testing pyramid is a risk-weighted interpretation of the classic model. We don't test everything equally — we allocate testing effort proportional to the cost of failure.

```
        ┌──────────────┐
        │   E2E Tests   │  Playwright/Cypress
        │   (critical   │  Key user journeys only
        │    paths)      │  Slow, expensive, flaky-prone
        ├──────────────┤
        │  Integration  │  React Testing Library
        │  Tests        │  API contract tests (Pact)
        │  (contracts,  │  Component integration
        │   workflows)  │
        ├──────────────┤
        │  Unit Tests   │  Jest (Node) / Vitest (Vite)
        │  (everywhere) │  Fast, reliable, numerous
        │               │  Coverage targets by risk tier
        └──────────────┘
```

## Test Strategy by Risk Tier

### Tier 0 — Critical (100% Coverage Required)
Code that handles PHI (Protected Health Information), authentication, authorization, encryption, medical data integrity, payment processing. Every branch, every condition, every edge case.

- **PHI-handling code:** Full branch + mutation coverage. No uncovered lines, no uncovered conditions.
- **Auth/AuthZ:** 100% line and branch coverage. Test token flows, scope checks, session expiry, privilege escalation attempts.
- **Encryption/decryption:** 100% coverage with known-answer tests (KATs) for cryptographic primitives.

### Tier 1 — High Risk (≥90% Coverage Required)
API contracts, database access, state management, medical calculation logic, data export/import pipelines.

### Tier 2 — Medium Risk (≥80% Coverage Required)
UI components (core), service abstractions, form validation, routing logic, notification delivery.

### Tier 3 — Low Risk (happy paths + edge cases)
UI sparkle/animation, internal configuration, cosmetic components, documentation site, developer tooling.

### Coverage Floor, Not Ceiling
80% is the organizational coverage floor. Never drop below 80% overall. Specific packages/modules may have higher targets per their risk tier. Coverage that exists only to hit a number (assertions without behavioral verification) is rejected in code review.

## TDD and BDD: When They Help, When They Slow

### Use TDD/BDD When
- **Complex business logic:** Write the test, watch it fail, make it pass. The test captures the requirement.
- **API contracts:** Consumer-Driven Contract (CDC) testing with Pact. Define the contract first, then implement.
- **Data transformations:** Input → expected output. TDD shines for pure functions.
- **Bug fixes:** Reproduce the bug as a failing test, fix it, the test stays as a regression guard.
- **Security-critical code:** TDD with security test cases first (OWASP top 10 scenarios).

### Don't TDD When
- **UI exploration/prototyping:** The shape of the component is unknown. Writing tests first constrains design prematurely.
- **Spike/research work:** You're learning the library, not shipping production code. Tests come after the spike when you rewrite properly.
- **Throwaway scripts:** Migration scripts, one-off data cleanup, internal tools used once.

### BDD Specifically
BDD (Given-When-Then) is used for cross-team specifications. Product, engineering, and QA should all understand the scenario. Use Gherkin syntax for user-facing behaviors, not for implementation details.

```gherkin
# Good BDD — describes observable behavior
Given a Japanese patient with an active prescription
When they view their medication schedule
Then they see dosage times in JST with 服用 labels

# Bad BDD — describes implementation
Given the Redux store contains a medication object
When the component dispatches setMedication
Then the reducer returns a new state with medication
```

## Regression Testing

### Automated Regression Suite
Every PR triggers the full regression suite. Parallelized by test type (unit → integration → e2e). Results reported in the PR as a status check. Green = mergeable. Red = fix before merge.

### Visual Regression
- **Percy/Chromatic:** Capture UI screenshots on PR. Compare against the baseline (main branch).
- **Review process:** Visual diffs appear in the PR. Reviewer marks intentional changes ("approved, this is the new design") or flags unintentional ("regression, fix before merge").
- **Baseline management:** main branch is always baseline. When a visual change is approved and merged, the snaps become the new baseline for future PRs.
- **Ignore dynamic content:** Use Percy's CSS selector ignore rules for timestamps, randomized content, third-party widgets.

## Smoke Tests

### Post-Deploy Smoke Suite
Runs automatically after every deploy (staging + production). Must complete in under 2 minutes. Tests key user journeys only:
1. Login flow (credentials + MFA if applicable)
2. Primary dashboard loads (no errors)
3. Core CRUD operation (create → read → update → delete a primary entity)
4. API health endpoint returns 200
5. (KODA KENKŌ) Patient record access

### Smoke Test Failure = Rollback
If smoke tests fail in production, the deploy is automatically rolled back. No human decision required — the deploy pipeline reverses. This is configured in CI/CD, not in this document.

## Exploratory Testing

### Scheduled, Not Ad-Hoc
Exploratory testing is deliberate. Schedule sessions (2-4 hours) with specific charters:

**Session Charter Template:**
- **Feature/Area:** [e.g., New medication schedule view]
- **Focus:** [3-5 specific areas to explore]
- **Time box:** [2 hours]
- **Tester:** [name]
- **Output:** Bug reports + test ideas for automation

### When to Schedule Exploratory Testing
- 48 hours before a major release (focused on new features)
- After a significant refactor (focused on impacted areas)
- During sprint, at feature completion (focused on the completed feature)
- Quarterly risk-area review (focused on historically buggy areas)

### What NOT to Exploratory Test
- Anything that can be automated. If it's repetitive and stable, automate it now.
- High-PHI paths without a structured test plan. Exploratory testing on PHI code requires a specific security scope and data masking plan.

## When to Automate vs. Manual Test

### Automate When
- Repetitive across releases (regression, smoke)
- High-value (catches real bugs in the past)
- Stable UI (selectors not changing every sprint)
- Required by compliance (MHLW requires automated verification of certain paths)
- API contracts (automated contract verification)

### Test Manually When
- One-off (migration script validation, data fix verification)
- Exploratory (new feature discovery, usability assessment)
- Rapidly changing (UI being redesigned, selectors unstable)
- Human judgment required (accessibility — screen reader experience, visual design review)
- Physical device testing (medical device firmware, barcode scanner integration)

## Context: MHLW Testing Requirements (KODA KENKŌ)

MHLW (厚生労働省) requires for medical software:
- **Test records maintained for 5 years:** All test results, including pass/fail, timestamp, tester identity.
- **Traceability matrix:** Requirements → Tests → Results. Every regulatory requirement must have a corresponding test.
- **Risk-based testing:** Testing effort must be documented as proportional to risk (ISO 14971 alignment).
- **Regression testing after every change:** No exceptions for medical software.
- **Independent verification:** QA team separate from development team for final sign-off.

These requirements apply to KODA KENKŌ and any KoLo components that handle patient data in a healthcare context.
