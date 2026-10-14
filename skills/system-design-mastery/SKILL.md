---
name: system-design-mastery
description: "Comprehensive system design reference covering foundations, API design, databases, caching, big data, production infrastructure, networking, and consensus/coordination. Includes interactive quiz, capacity planning calculator, and learning progress tracker. Use for system design study, interview preparation, architecture decisions, capacity planning, or when designing distributed systems. Triggers: system design, distributed systems, API design, database architecture, caching strategy, CDN, load balancing, Kubernetes, Docker, CI/CD, observability, capacity planning, big data, Kafka, stream processing, networking, TCP, DNS, consensus, Raft, leader election."
---

# System Design Mastery

Production-ready system design knowledge covering the full stack from API to infrastructure to distributed coordination. 8 reference modules, 3 interactive tools, 36+ quiz questions.

## Quick Start — What Are You Designing?

```
"What am I building?"
├── An API?              → 02-api-design.md
├── A database schema?   → 03-databases.md
├── A cache layer?       → 04-caching.md
├── A data pipeline?     → 05-big-data.md
├── Production infra?    → 06-production-infra.md
├── Network architecture?→ 07-networking.md
├── Distributed lock?    → 08-consensus.md
└── Starting from zero?  → 01-foundations.md (read first)
```

## Reference Modules

| # | Module | When to load |
|---|--------|-------------|
| 01 | [Foundations](references/01-foundations.md) | Starting system design study. CAP theorem, latency numbers, scaling patterns, design process. |
| 02 | [API Design](references/02-api-design.md) | Designing REST, GraphQL, gRPC, or WebSocket APIs. Pagination, rate limiting, versioning, auth, gRPC deadline propagation. |
| 03 | [Databases](references/03-databases.md) | Choosing SQL vs NoSQL, indexing strategy, sharding, replication, connection pool exhaustion prevention. |
| 04 | [Caching](references/04-caching.md) | Cache strategies (cache-aside, write-through, write-behind), invalidation, stampede protection, negative caching, Redis. |
| 05 | [Big Data](references/05-big-data.md) | MapReduce, Kafka, stream processing, batch processing, data warehouses, message queues. |
| 06 | [Production Infra](references/06-production-infra.md) | Docker, Kubernetes, CI/CD, zero-downtime deploy, observability, secrets, DR, capacity planning, Gateway API. |
| 07 | [Networking](references/07-networking.md) | TCP fundamentals, connection pooling, keepalives, DNS, network timeouts, load balancer health checks. |
| 08 | [Consensus](references/08-consensus.md) | Raft, Paxos, leader election, fencing tokens, distributed locking (Redlock), etcd, ZooKeeper, CAP/PACELC. |

## Scripts

| Script | Purpose | Command |
|--------|---------|---------|
| `quiz.py` | Interactive quiz with per-module scoring | `python3 scripts/quiz.py [module]` |
| `capacity-calc.py` | Capacity planning calculator with latency references | `python3 scripts/capacity-calc.py` |
| `progress-tracker.py` | Learning progress tracker | `python3 scripts/progress-tracker.py status` |

## Learning Paths

### Interview Preparation (4 weeks)
1. 01-foundations.md — latency numbers, CAP theorem, scaling vocabulary
2. 02-api-design.md — REST vs gRPC, pagination, rate limiting
3. 03-databases.md — indexing, sharding, replication, pool exhaustion
4. 04-caching.md — strategies, invalidation, Redis
5. 07-networking.md — TCP, DNS, timeouts, connection pooling
6. 08-consensus.md — Raft, leader election, distributed locking
7. Test with `quiz.py`

### Production Architecture Decision
1. Identify the component → use Quick Start tree above
2. Load that reference module
3. Run `capacity-calc.py` with your numbers
4. Cross-reference adjacent modules (e.g., DB + caching + networking for a new data service)
5. Track with `progress-tracker.py`

### Full System Design
1. 01-foundations.md — design process and vocabulary
2. 07-networking.md — what does the network look like?
3. 03-databases.md — where does data live?
4. 04-caching.md — what's cached and how?
5. 02-api-design.md — how do services talk?
6. 05-big-data.md — pipelines and streaming
7. 06-production-infra.md — deploy, observe, scale
8. 08-consensus.md — coordination and locking
