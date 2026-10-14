---
title: "Test Automation"
type: reference
product: all
last_reviewed: 2026-05-20
review_cycle_days: 180
owner: qa-team
status: published
---

# Test Automation — CI Integration & Management

## CI Integration

### Gates: What Must Pass Before Merge

Every PR must pass these CI gates before it is mergeable:

| Gate | Runtime Budget | Blocks Merge? |
|------|---------------|---------------|
| Lint + Type Check | <30s | Yes |
| Unit Tests (fast) | <2 min | Yes |
| Unit Tests (full) | <5 min | Yes |
| Integration Tests | <5 min | Yes |
| SAST (Semgrep) | <2 min | Yes |
| Dependency Scan (npm audit) | <1 min | Yes |
| Visual Regression (Percy) | <3 min | No (advisory) |
| E2E Smoke (critical paths) | <5 min | Yes |

### Parallel Execution
Tests run in parallel grouped by type. Unit tests use Jest's `--maxWorkers` (CPU count - 1). Playwright uses sharding across workers. Dedicated CI runners for E2E (GPU-accelerated browsers where available).

### Test Results in PR
Every PR gets a CI comment with:
- Total test count, pass count, fail count
- Coverage delta (+/- from main)
- Flaky test quarantine status (if any flaky tests detected)
- Visual regression diff link (Percy URL)

## Flaky Test Management

### Definition of Flaky
A test is flaky if it passes and fails intermittently without a code change. The CI system tracks per-test pass rate over the last 20 runs.

### Quarantine Protocol
1. **Detection:** CI detects a test has <98% pass rate over 20 runs (passing and failing without code changes).
2. **Quarantine:** Test is automatically moved to `quarantine/` directory. CI comment in the next PR notifies the team.
3. **Fix window:** 5 business days to fix a quarantined test. After 5 days, the test is deleted (not left in quarantine indefinitely — quarantined tests that stay forever become noise).
4. **Fix process:** Developer reproduces the flake, identifies the root cause (timing, shared state, network dependency, async race), applies the fix, verifies 50 consecutive green runs.
5. **Return:** Fixed test moves back to the main suite with a commit message explaining what was flaky and how it was fixed.

### Max Flaky Rate: 2%
At any time, ≤2% of the full test suite may be in quarantine. If the rate exceeds 2%, the team must halt feature work and invest in stabilization. This is non-negotiable — a test suite above 2% flaky is not trustworthy.

### Common Flaky Causes (and Fixes)
| Cause | Fix |
|-------|-----|
| `setTimeout`/arbitrary waits | `waitFor` with assertions (React Testing Library) |
| Shared mutable state | beforeEach cleanup, no module-level state |
| Network calls | Mock at the network layer (MSW), not per-test |
| Timezone-dependent tests | Set TZ=Asia/Tokyo explicitly |
| Date.now() in assertions | Use `jest.useFakeTimers()` or date injection |
| Random data | Seed random generators, use deterministic test data factories |
| Test ordering dependency | `--runInBand` to detect, fix the coupling |

## Snapshot Testing

### When to Use Snapshots
- **Stable UI components:** Small components with predictable rendering. Not pages, not large trees.
- **Serialized output:** API response shapes, error messages, configuration objects — where the exact structure matters.
- **Error/output messages:** User-facing strings where a typo would be bad.

### When NOT to Use Snapshots
- Large component trees (>50 lines of snapshot). The snapshot is unreadable and nobody will review it.
- Frequently changing UI. If every PR changes the snapshot, the snapshot provides no signal.
- ICU/i18n message catalogs. These are data, not code. Test the interpolation logic, not the message list.
- Generated IDs / timestamps / random content that changes every render.

### Snapshot Review Process
Snapshots are reviewed in PR diffs, same as code. A snapshot change is a deliberate change to what the component renders — the reviewer must understand and approve it.

```typescript
// ✅ Good snapshot test — small, stable, meaningful
it('renders the medication status badge correctly', () => {
  const { container } = render(<StatusBadge status="active" />);
  expect(container.firstChild).toMatchSnapshot();
});

// ❌ Bad — snapshot is a whole page
it('renders the patient dashboard', () => {
  const { container } = render(<PatientDashboard />);
  expect(container).toMatchSnapshot();
  // Nobody will read a 500-line snapshot diff
});
```

## Visual Regression

### Tooling: Percy / Chromatic
- **Percy:** Snapshot visual state, compare pixel-by-pixel against baseline.
- **Chromatic:** Integrated with Storybook. Snapshot each story, compare visually.

### Baseline Management
- `main` branch = baseline.
- PR snapshots compare against `main`.
- When a PR with intentional visual changes is merged, its snapshots become the new baseline.
- Cherry-picked commits to release branches carry their own baseline.

### Intentional vs. Unintentional Changes
- **Intentional:** "We redesigned the button color from blue to green." Approved in Percy.
- **Unintentional:** "Why did the font change in this unrelated component?" Investigate and fix.
- **Environment variance:** Anti-aliasing differences across OS/browser are handled by Percy's diff tolerance settings.

## API Contract Testing

### Pact for Consumer-Driven Contracts

```yaml
# Pact flow:
# 1. Consumer defines expectations
# 2. Pact file generated
# 3. Provider verifies against pact
# 4. Both sides must match for deploy

Consumer (Web App) ──expects──→ Pact Broker ──verifies──→ Provider (API)
```

### Contract Testing Rules
- **Every consumer must have a Pact test.** If your component calls an API endpoint, you define the contract.
- **Pact broker is the source of truth for API compatibility.**
- **Provider verification runs in CI on every PR.** If a provider change breaks a consumer contract, the PR is blocked.
- **Contract versioning:** Contracts are versioned alongside the API. Breaking changes require a new contract version and a migration path documented in the changelog.

```typescript
// Consumer-side Pact test (web app)
describe('Medication API consumer', () => {
  it('can fetch active medications for a patient', async () => {
    await provider.addInteraction({
      state: 'patient has 2 active medications',
      uponReceiving: 'a request for active medications',
      withRequest: {
        method: 'GET',
        path: '/api/v1/patients/123/medications',
        query: { status: 'active' },
      },
      willRespondWith: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          medications: eachLike({
            id: like('med-001'),
            name: like('アムロジピン'),
            dosage: like('5mg'),
          }),
        },
      },
    });
    // ... test the consumer function
  });
});
```

## Test Coverage

### Measurement
- **Tool:** Istanbul / V8 coverage via Jest/Vitest.
- **Metrics tracked:** Lines, branches, functions, statements.
- **Per-file thresholds:** Individual files inherit their package's risk tier threshold.

### Reporting
- Coverage report generated in CI on every PR.
- Coverage delta vs. `main` is displayed in the PR comment.
- Coverage degradation >1% requires justification in the PR description.

### Enforcement
- **Critical paths (Tier 0):** 100% coverage. Failing coverage = blocked merge.
- **High risk (Tier 1):** ≥90%. Failing coverage = blocked merge.
- **Medium risk (Tier 2):** ≥80%. Failing coverage = warning, not block (unless overall dips below 80%).
- **Overall:** ≥80%. Failing = blocked merge.

### Coverage That Counts
Coverage metrics are gamed easily. Code review must verify that tests assert meaningful behavior, not just execute code paths. A test that calls a function but doesn't assert its return value is not coverage — it's dead weight. Flag in review.

## Test Data Management

### Factory Functions, Not Fixtures
Never use static JSON fixtures for test data. Use factory functions that generate realistic, parameterized test data.

```typescript
// ❌ Static fixture — fragile, opaque, distant from test
import patient from '../fixtures/patient.json';

// ✅ Factory function — explicit, customizable, colocated intent
const patient = createPatient({
  age: 72,
  insuranceType: '国民健康保険',
  medications: [createMedication({ name: 'アムロジピン', dosage: '5mg' })],
});
```

### Realistic Data, Not "test123"
- Names: Use realistic Japanese names (山田太郎, 佐藤花子), not "John Doe" or "test user".
- Addresses: Use realistic Japanese addresses (東京都新宿区...), not "123 Main St".
- Phone numbers: Use realistic Japanese format (090-1234-5678), not "123-456-7890".
- Dates: Use actual Japanese calendar era names (令和6年) where the UI renders them.

### PHI-Safe Test Data
Never use real patient data in test data. Never. Not even "de-identified" real data — there is no such thing as perfectly de-identified in test databases.

- **Synthetic data generators:** Use faker libraries with Japanese locale.
- **PHI patterns to never include:** Real MRNs, real insurance numbers, real My Number (個人番号), real names associated with real people.
- **Mock PHI patterns:** Use clearly fake identifiers (e.g., MRNs prefixed with "TEST-", insurance numbers starting with "0000").

```typescript
// PHI-safe factory
export function createPatient(overrides = {}): Patient {
  return {
    id: `TEST-P-${nanoid(8)}`,
    name: fakerJA.person.fullName(),  // Synthetic Japanese name
    myNumber: '0000-0000-0000-0000',  // Never a real pattern
    insuranceId: `TEST-INS-${nanoid(10)}`,
    dateOfBirth: faker.date.birthdate({ min: 0, max: 100, mode: 'age' }),
    ...overrides,
  };
}
```
