---
title: "Performance Testing"
type: reference
product: all
last_reviewed: 2026-05-20
review_cycle_days: 180
owner: qa-team
status: published
---

# Performance Testing

## Load Testing

### Tooling

- **Primary:** k6 (JavaScript-based, scriptable, CI-friendly)
- **Alternative:** Artillery (YAML-based, simpler for HTTP-only tests)

### When to Run

- Before every major release
- After infrastructure changes (scaling config, DB migration, CDN change)
- Weekly on staging (scheduled CI job, results trended in dashboard)

### Realistic Traffic Patterns

Don't test with uniform traffic. Model real user behavior:

- **Ramp-up period:** Start at 0 VUs, ramp to target over 2 minutes
- **Steady state:** Hold target load for 10 minutes
- **Ramp-down:** Gradual decrease over 1 minute
- **Traffic mix:** 70% reads, 20% writes, 10% complex queries (based on production analytics)

```javascript
// k6 load test — realistic traffic pattern
import { sleep } from "k6";
import { SharedArray } from "k6/data";

const patientIds = new SharedArray("patients", () =>
  Array.from({ length: 1000 }, (_, i) => `TEST-P-${i}`),
);

export const options = {
  stages: [
    { duration: "2m", target: 50 }, // Ramp up
    { duration: "10m", target: 50 }, // Steady state
    { duration: "1m", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<200", "p(99)<1000"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const patientId = patientIds[Math.floor(Math.random() * patientIds.length)];
  // Mix of read and write operations
  // 70% GET /api/v1/patients/:id
  // 20% POST /api/v1/patients/:id/observations
  // 10% GET /api/v1/patients/:id/medications?expand=all
}
```

### Test Environment

Test in a production-like environment. Same instance size, same database configuration, same network topology. Staging must mirror production for performance tests to be meaningful.

## Stress Testing

### Purpose

Find the breaking point. Not "does it handle normal load" but "at what load does it break, and how?"

### Methodology

1. Start at expected peak load
2. Increase load in 20% increments every 2 minutes
3. Observe:
   - **What fails first?** Database connection pool? CPU? Memory? API gateway timeout?
   - **How does it degrade?** Slow responses → timeouts → errors? Or immediate crash?
   - **Does it recover?** When load drops back to normal, does the system self-heal?

### Documentation

Every stress test produces a report:

- Breaking point (requests/second at failure)
- First component to fail
- Failure mode (graceful degradation vs. hard crash)
- Recovery time after load removal
- Recommendations

## Endurance / Soak Testing

### Purpose

Find problems that emerge over time: memory leaks, connection pool exhaustion, GC pauses, log file growth, database transaction log bloat.

### Protocol

- Run at 70% of expected peak load
- Duration: 8-24 hours
- Monitor: memory (heap, RSS), connection counts, GC frequency/duration, disk usage, DB connection pool, thread count

### What to Watch

| Metric            | Danger Sign                          |
| ----------------- | ------------------------------------ |
| Heap memory       | Steady upward trend without plateau  |
| Connection count  | Monotonic increase (connection leak) |
| GC pause time     | P99 >100ms, increasing over time     |
| DB connections    | Approaching pool max                 |
| Open file handles | Steady increase                      |
| Event loop lag    | p99 >50ms in Node.js                 |

## API Benchmarking

### Response Time Budgets

| Service              | p50    | p95    | p99    | Max Acceptable |
| -------------------- | ------ | ------ | ------ | -------------- |
| API Gateway (Kurahi) | <50ms  | <200ms | <1s    | Never >5s      |
| Patient Record API   | <100ms | <300ms | <2s    | Never >10s     |
| Medication Lookup    | <50ms  | <150ms | <500ms | Never >2s      |
| Auth Service         | <30ms  | <100ms | <300ms | Never >1s      |
| Search API           | <200ms | <500ms | <2s    | Never >5s      |
| File Upload (10MB)   | <2s    | <5s    | <10s   | Never >30s     |

### Measurement

- Measure at the API level (not middleware, not proxy — actual application response time).
- Measure under realistic concurrent load (not single-request benchmarks).
- Exclude cold starts from p50/p95 (measure steady-state performance).

## Database Query Performance

### Every Slow Query Is Investigated

1. **Enable slow query log:** MySQL `slow_query_log`, PostgreSQL `log_min_duration_statement = 100ms`.
2. **EXPLAIN ANALYZE every query over 100ms:** Understand the execution plan.
3. **Index optimization checklist:**
   - Missing index on WHERE/JOIN columns?
   - Index not covering (fetching rows after index scan)?
   - Sequential scan on large table (>10k rows)?
   - N+1 query pattern (ORM-generated)?
4. **Query rewrite:** Sometimes the query is the problem, not the index.
5. **Caching:** For read-heavy queries with tolerance for staleness.

### ORM Safety

ORMs (Prisma, TypeORM, Sequelize) can generate catastrophic queries. Every PR that adds a database query must include the generated SQL in a comment or the PR description. Reviewer verifies it's not an N+1 or cartesian product.

## Performance Budgets

### Web Application

| Metric                    | Budget         | Tool                     |
| ------------------------- | -------------- | ------------------------ |
| Page Load (full)          | <3s            | Lighthouse / WebPageTest |
| First Contentful Paint    | <1.5s          | Lighthouse               |
| Largest Contentful Paint  | <2.5s          | Lighthouse               |
| Time to Interactive       | <3s            | Lighthouse               |
| Total Blocking Time       | <300ms         | Lighthouse               |
| Cumulative Layout Shift   | <0.1           | Lighthouse               |
| JavaScript bundle (route) | <200KB gzipped | Webpack/Vite analyzer    |
| Total JavaScript (page)   | <500KB gzipped | Bundle analyzer          |

### API / Backend

Enforced in CI via k6 thresholds:

```
http_req_duration: p(95)<200ms
http_req_duration: p(99)<1000ms
http_req_failed: rate<0.01
```

## Profiling

### React Applications

- **React DevTools Profiler:** Record interaction, identify slow renders, find unnecessary re-renders.
- **React.memo / useMemo / useCallback audit:** Every memoized component must justify its existence with a measurable improvement.

### Browser

- **Chrome Performance tab:** Record page load or user interaction. Analyze flame chart. Look for long tasks (>50ms blocking main thread).
- **Coverage tab:** Identify unused CSS/JS shipped to the client.

### Node.js

- **Built-in inspector:** `node --inspect`, connect Chrome DevTools. CPU profiling, heap snapshots.
- **Clinic.js:** Doctor (health check), Bubbleprof (async operations), Flame (CPU).
- **0x:** Single-command flamegraph generation for Node.js.

## Agent-Specific Performance (Kurahi)

### Inference Latency Budget

| Operation                  | Budget     | Notes                                            |
| -------------------------- | ---------- | ------------------------------------------------ |
| LLM inference (primary)    | <5s p95    | Model-dependent; larger models get higher budget |
| LLM inference (fallback)   | <2s p95    | Simpler model, simpler task                      |
| Tool execution roundtrip   | <500ms p95 | Agent invokes tool, gets result                  |
| STM read                   | <50ms      | File read from workspace                         |
| STM write                  | <50ms      | File write to workspace                          |
| Memory retrieval (vector)  | <200ms p95 | Embedding + similarity search                    |
| Memory retrieval (keyword) | <100ms p95 | Full-text search over daily notes                |
| Gateway health check       | <10ms      | Minimal roundtrip                                |

### Agent Tick Performance

The sentience daemon fires every ~10 minutes. Each tick must:

- Complete within 30 seconds (hard timeout in daemon)
- Not block the next tick (daemon skips if previous still running)
- Memory usage must not grow unbounded across ticks (leak detection)

### Monitoring

- Log every tick's duration
- Alert if any tick exceeds 25 seconds (5s before hard timeout)
- Alert if memory RSS grows >20% over 24 hours of ticks
