---
name: quality-assurance
description: "Quality assurance operating system for KodaSōken/KoLo/KODA KENKŌ. Testing methodology (pyramid, TDD/BDD, risk-based), test automation (CI integration, flaky management, contract testing), performance testing (k6, profiling, budgets), accessibility testing (WCAG 2.2 AA, Japanese specifics), and security testing (SAST/DAST, PHI leak detection, MHLW compliance). Use when planning, executing, or reviewing any QA activity — from unit tests to production smoke tests. Triggers: testing, QA, test strategy, test automation, performance testing, accessibility, security testing, test coverage."
---

# Quality Assurance — Testing OS for KoLo

## Overview

This skill is the quality assurance operating system for KodaSōken, KoLo, and KODA KENKŌ. We treat testing as a first-class engineering discipline — not a checkbox, not an afterthought. From unit tests to production smoke tests, everything has a pattern, a standard, and a budget.

### Our Testing Philosophy

1. **Risk-proportional testing effort.** PHI-handling code gets 100% coverage. UI sparkle gets happy-path + edge cases. Not all code is equal — our testing effort reflects that.
2. **Automation is default, manual is deliberate.** If it repeats, automate. If it's exploratory, schedule it. No ad-hoc "let me click around."
3. **Fast feedback loops.** Tests must pass before merge, smoke tests complete in under 2 minutes, performance budgets are enforced in CI.
4. **Flaky is broken.** A flaky test is a broken test. Quarantine and fix, don't ignore and scroll past.
5. **Accessibility is a quality requirement, not a nice-to-have.** WCAG 2.2 AA is the floor. Japanese healthcare users are real people — test with their tools.
6. **Security testing is continuous, not annual.** SAST in CI, DAST on staging, PHI leak detection on every deploy.

## Decision Tree — Which QA Activity Do I Need?

```
QUESTION:                                  → ANSWER / REFERENCE TO LOAD
────────────────────────────────────────────────────────────────────────
"How do I build a test strategy?"          → testing-methodology.md
"What testing pyramid do we use?"           → testing-methodology.md
"When should I TDD?"                        → testing-methodology.md
"How do we handle regression testing?"      → testing-methodology.md
"I need to set up CI test automation"       → test-automation.md
"How do I handle flaky tests?"              → test-automation.md
"How do I do API contract testing?"         → test-automation.md
"What coverage numbers should I target?"    → test-automation.md
"I need to run performance tests"           → performance-testing.md
"What are our performance budgets?"         → performance-testing.md
"How do I profile a React component?"       → performance-testing.md
"How do I test for accessibility?"          → accessibility-testing.md
"What WCAG level do we target?"             → accessibility-testing.md
"How do I test with Japanese screen readers?" → accessibility-testing.md
"How do I run a security test?"             → security-testing-qa.md
"How do I check for PHI leaks?"             → security-testing-qa.md
"What security scanning tools do we use?"   → security-testing-qa.md
"I need test strategy/bug report templates" → assets/qa-toolkit.json
"What criteria for QA sign-off?"            → assets/qa-toolkit.json
"How much accessibility testing checklist?" → assets/qa-toolkit.json
```

For a full QA planning session (new product or major release), load in this order:
1. First, define your test strategy → `testing-methodology.md`
2. Second, set up automation parameters → `test-automation.md`
3. Third, define performance thresholds → `performance-testing.md`
4. Fourth, plan accessibility verification → `accessibility-testing.md`
5. Fifth, plan security verification → `security-testing-qa.md`
6. Finally, grab templates → `assets/qa-toolkit.json`

## Testing Tiers by Product

| Tier | KoLo (Agent OS) | KODA KENKŌ (Healthcare) | KodaSōken (Research) |
|------|-----------------|-------------------------|----------------------|
| **Unit** | Jest/Vitest, 80%+ coverage | Jest/Vitest, 100% on PHI paths | Python/pytest, 70%+ |
| **Integration** | API contract tests (Pact) | HL7 FHIR validation, MHLW workflows | Data pipeline validation |
| **E2E** | Playwright for CLI/web UI | Playwright + manual for medical devices | N/A (research output) |
| **Performance** | k6 for API, inference latency budget | k6 for patient portal, DB query profiling | Benchmark suites |
| **Accessibility** | axe-core on web UI | axe-core + manual screen reader (JA) | N/A |
| **Security** | SAST + DAST + dependency scan | SAST + DAST + PHI leak + MHLW audit | SAST + dependency scan |

## Reference Modules

| Module | File | When to Load | Weight |
|--------|------|-------------|--------|
| Testing Methodology | `references/testing-methodology.md` | When defining test strategy, deciding TDD/BDD approach, planning regression/smoke/exploratory tests | Heavy |
| Test Automation | `references/test-automation.md` | When configuring CI, managing flaky tests, setting coverage targets, visual regression | Heavy |
| Performance Testing | `references/performance-testing.md` | When setting performance budgets, running load/stress/soak tests, profiling | Heavy |
| Accessibility Testing | `references/accessibility-testing.md` | When testing for WCAG AA compliance, screen reader testing, Japanese a11y specifics | Heavy |
| Security Testing (QA) | `references/security-testing-qa.md` | When running SAST/DAST, PHI leak detection, MHLW security verification | Heavy |
| QA Toolkit | `assets/qa-toolkit.json` | Templates, checklists, and sign-off criteria — load alongside any reference | Light |

## Quick QA Sign-Off Checklist

Before any release:
- [ ] All unit tests pass (CI green)
- [ ] Integration tests pass (contracts verified)
- [ ] E2E smoke tests pass (<2 min)
- [ ] Performance budgets met (page load, API p95)
- [ ] Accessibility audit clean (axe-core zero violations)
- [ ] Security scan clean (SAST + dependency criticals)
- [ ] PHI leak scan clean (for KODA KENKŌ)
- [ ] Flaky test rate <2%
- [ ] Bug report template completed for any known issues
- [ ] QA sign-off criteria met per release type (see toolkit)
