# Reliability Engineering — Fault Tolerance, SRE, Chaos

## The CMU / Google Lineage

CMU's Institute for Software Research (ISR) has been the academic home of reliability theory. Google's SRE book (Beyer, Jones, Petoff, Murphy, 2016) made reliability engineering an operational practice. The key insight: reliability is a feature you engineer, not a hope you hold.

---

## Failure Models

### The Failure Hierarchy
```
Fault → Error → Failure
  Fault: latent defect (bug, misconfiguration, weak component)
  Error: incorrect state caused by activated fault
  Failure: system deviates from specification (user-visible)

Not all faults become errors. Not all errors become failures.
Redundancy and fault tolerance PREVENT faults from propagating to failures.
```

### Failure Types
```
Crash Fault: Component stops. Simplest to handle.
Omission Fault: Component doesn't respond to some requests. Harder (timeout detection).
Timing Fault: Component responds too early or too late. Real-time systems.
Byzantine Fault: Component behaves arbitrarily (maliciously or due to bug). Hardest.
  → Byzantine fault tolerance requires 3f+1 replicas (vs 2f+1 for crash fault)
```

### The Byzantine Generals Problem (Lamport, Shostak, Pease, 1982)
```
N generals must agree on attack/retreat. f generals are traitors sending conflicting messages.
Solution requires N > 3f (with oral messages) or N > 2f (with signed messages).
This is why: blockchain needs majority honesty, critical systems need BFT.
```

---

## Resilience Patterns

### Circuit Breaker (Nygard, 2007 — *Release It!*)
```
States:
  CLOSED: Normal operation. Count failures.
  OPEN: Failures exceed threshold → immediately fail all requests (fast failure).
        After timeout → HALF_OPEN.
  HALF_OPEN: Allow one probe request.
        Success → CLOSED (resume normal operation).
        Failure → OPEN (reset timer).

Why: Failing fast is better than piling up slow failures.
     Prevents cascading failures. Protects the downstream service (gives it time to recover).
     Protects YOUR threads/pools (not blocked waiting for dead service).
```

### Bulkhead
Isolate failures to prevent them from sinking the whole ship.
```
Thread pool per dependency:
  Pool: database (20 threads), search-service (10 threads), email-service (5 threads)
  Search-service slow → only search pool blocks
  Database and email are unaffected
  → Failure contained
```

### Retry with Backoff
```
Attempt 1: immediate
Attempt 2: wait 100ms
Attempt 3: wait 200ms
Attempt 4: wait 400ms
Max attempts: 3-5 (configurable)
Max total wait: 30s

Add jitter: randomize wait time (±25%) to prevent thundering herd
  → After a transient failure, all retries don't hit simultaneously
```

### Timeout
Every network call MUST have a timeout. Default infinite timeout is a bug.
```
Connect timeout: How long to wait for TCP connection to establish? (500ms-2s)
Read timeout: How long to wait for response after connection? (1s-30s, depends on endpoint)
Total timeout: How long can the entire request take? (propagated via gRPC deadline)

Timeout propagation: Service A (5s) → Service B (4s) → Service C (3s)
  → C knows it has only 3s, won't waste work if deadline passed
  → gRPC: deadline header propagated automatically
```

### Deadlines vs. Timeouts
```
Timeout: Client-side decision. "I'm not waiting longer than this."
Deadline: Propagated end-to-end. "This request must complete by this time."
Deadline is strictly better because: downstream services can stop useless work.
Always use deadlines when they're available (gRPC, Temporal).
```

---

## SLOs, SLIs, and Error Budgets

### Definitions
```
SLI (Service Level Indicator): Measured metric.
  "GET /api/patients latency at p99, measured over 5-minute windows"

SLO (Service Level Objective): Target for SLI over a period.
  "p99 latency < 200ms, over trailing 30 days"

SLA (Service Level Agreement): Promise to customers, with consequences.
  "If p99 latency > 500ms for >5 minutes in a month → service credit"
  ⚠️ SLA should be LOOSER than SLO. SLO triggers internal action; SLA triggers customer compensation.
```

### Choosing SLOs
```
Don't aim for 100%. It's impossible and dishonest.
99.9% ("three nines") → 8.76 hours downtime/year → achievable by one person
99.95% → 4.38 hours/year → achievable with basic automation
99.99% ("four nines") → 52.6 minutes/year → requires serious investment
99.999% ("five nines") → 5.26 minutes/year → very expensive, often not worth it

For KODA KENKŌ:
  Clinical API availability: 99.95% (doctors must access patient data)
  Analytics dashboard: 99.9% (less critical, can be delayed)
  Model inference: 99.9% (with graceful degradation — fallback model if primary is down)
```

### Error Budgets
```
Error budget = 1 - SLO
Example: 99.9% availability → 0.1% error budget = 43.8 minutes downtime per month

When error budget is NOT exhausted:
  → Can take risks (deploy on Friday, try new architecture)

When error budget IS exhausted:
  → Freeze deployments. Fix reliability. No new features until budget recovers.

This is the operational contract between dev and ops.
```

### Multi-Window Burn Rate Alerts
```
Burn rate: how fast error budget is consumed relative to baseline

Alert thresholds:
  Short window (1 hour): burn rate > 14.4 → consumed 2% of 30-day budget
    → Something urgent is happening. Page.
  Long window (6 hours): burn rate > 6 → consumed 5% of 30-day budget
    → Something sustained. Alert.
```

---

## Graceful Degradation

### The Principle
**When a dependency fails, degrade the feature, not the system.**
```
If search is down → show recent results, not error page
If recommendation engine is down → show popular items, not error page
If payment gateway is slow → show "processing" and poll, not error page
If ML model is down → use rule-based fallback
```

### Static Fallback
Pre-built static content that serves when dynamic systems fail:
```
CDN hosts: static homepage, static search result pages for top queries
→ Origin down → CDN serves stale content → users still see something
```

---

## Chaos Engineering (Basiri et al., Netflix, 2012)

### The Principle
**Test failure modes in production.** Not "hope the system handles failure" — PROVE it.

### Chaos Experiment Protocol
```
1. Define steady state (what does "normal" look like?)
2. Hypothesize: "Even if we kill a database replica, the app still works."
3. Introduce variable: kill the replica
4. Observe: did the app handle it? What was the blast radius?
5. If hypothesis wrong → fix the system → repeat the experiment

Start in staging. Move to production only when proven in staging.
Start with smallest blast radius. Gradually expand.
```

### Chaos Toolkit
```
Chaos Mesh (Kubernetes): pod kill, network delay, CPU stress, disk fill
Chaos Monkey (Netflix/Spinnaker): terminate random instances
LitmusChaos: Kubernetes-native, declarative chaos experiments
```

### What to Chaos Test
```
1. Kill a random pod/database replica → does the system self-heal?
2. Network latency increase (200ms, 500ms, 1s) → do timeouts work?
3. Network partition (split-brain) → does consensus survive?
4. Disk fill (95% usage) → does the system alert and degrade gracefully?
5. DNS failure → do retries and cached resolutions work?
6. Certificate expiry → does renewal work before expiry?
```

---

## Backups and Disaster Recovery

### RPO and RTO
```
RPO (Recovery Point Objective): Maximum acceptable data loss (time).
  "We can lose at most 5 minutes of data."
  → Determines backup frequency (continuous WAL shipping, 5-min snapshots)

RTO (Recovery Time Objective): Maximum acceptable downtime (time).
  "We must recover within 1 hour."
  → Determines recovery architecture (hot standby, warm standby, cold backup)
```

### Backup Strategy (3-2-1 Rule)
```
3 copies of data
2 different media types
1 copy offsite (different region/provider)

Example:
  Primary: PostgreSQL with streaming replication to standby
  Backup 1: nightly pg_dump to S3 (same region)
  Backup 2: S3 cross-region replication to different region
  Backup 3: weekly tape (or offline) backup for ransomware protection
```

### Backup Validation
**Untested backups are not backups. They are hope.**
- Weekly: restore latest backup to staging, run integrity checks
- Monthly: full DR drill — restore entire system from backups, verify functionality
- Continuous: verify backup files exist and are not zero-length (automated)
