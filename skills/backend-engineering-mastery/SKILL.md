---
name: backend-engineering-mastery
description: "Master-level backend, AI, IT, and data engineering knowledge — PhD depth from MIT CSAIL, Stanford, CMU ISR, UC Berkeley, Oxford/Cambridge. Covers distributed systems (Raft/Paxos/CRDTs), database internals (B-tree/LSM/MVCC), AI/ML infrastructure (GPU/HPC/MLOps), data engineering (Kafka/Flink/lakehouse), systems engineering (OS/networking/eBPF/containers), performance engineering (profiling/capacity/optimization), security engineering (crypto/zero-trust/threat-modeling), reliability engineering (SRE/chaos/fault-tolerance), and production hardening (multi-region/K8s/DR/compliance). For building enterprise-stable, hardened platforms with zero-failure tolerance. Triggers: backend engineering, distributed systems, database internals, AI infrastructure, MLOps, data engineering, systems programming, performance, security engineering, reliability, production hardening, enterprise platform, HPC, fault tolerance."
---

# Backend Engineering Mastery — The Deep Knowledge

The engineering counterpart to `design-mastery`. Where design-mastery is about *how things should be*, this is about *how things actually work* — the physics, mathematics, and engineering of systems that must not fail.

## Knowledge Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  BACKEND ENGINEERING MASTERY — Knowledge & Judgment           │
│  "How to build systems that cannot fail"                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ DISTRIBUTED        │ DATABASE          │ AI/ML       │    │
│  │ distributed        │ database          │ ai-ml       │    │
│  │ systems            │ internals         │ infra       │    │
│  │ Consensus, CRDTs   │ Storage engines   │ Training    │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ DATA               │ SYSTEMS           │ PERFORMANCE │    │
│  │ data               │ systems           │ performance │    │
│  │ engineering        │ engineering       │ engineering │    │
│  │ Streaming, lakehouse│ OS, net, eBPF     │ Profiling   │    │
│  └──────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ SECURITY           │ RELIABILITY       │ HARDENING   │    │
│  │ security           │ reliability       │ production  │    │
│  │ engineering        │ engineering       │ hardening   │    │
│  │ Crypto, zero trust │ Chaos, SLOs       │ Multi-region│    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  EXISTING SKILLS (consume this knowledge)                    │
│  system-design-mastery → platform-engineering                │
│  → systems-security → coding-agent                           │
└──────────────────────────────────────────────────────────────┘
```

## Reference Map — Load by Domain

| Domain | Reference | Key Knowledge | When to Load |
|--------|-----------|---------------|-------------|
| Distributed Systems | `references/distributed-systems.md` | Raft/Paxos, CRDTs, vector clocks, 2PC/3PC, gossip, consistent hashing, causal consistency | Designing any multi-node system, consensus, replication, sharding decisions |
| Database Internals | `references/database-internals.md` | B-tree/LSM, query optimization, MVCC, WAL, connection pooling, indexing strategies | Schema design, query performance, storage engine choice, scaling decisions |
| AI/ML Infrastructure | `references/ai-ml-infrastructure.md` | GPU scheduling, model serving (Triton/vLLM), training pipelines, MLOps, HPC architecture, inference optimization | Building AI platforms, HPC setup, model deployment, training infrastructure |
| Data Engineering | `references/data-engineering.md` | Kafka, Flink, Spark, lakehouse (Iceberg/Delta), ETL patterns, schema evolution, data quality | Data pipelines, stream processing, warehouse/lakehouse decisions |
| Systems Engineering | `references/systems-engineering.md` | OS internals, memory management, TCP/IP deep dive, eBPF, containers (cgroups/namespaces), I/O models | Performance debugging, container optimization, network troubleshooting |
| Performance Engineering | `references/performance-engineering.md` | Profiling (perf/flamegraphs), optimization methodology, load testing, capacity planning, bottleneck analysis | System is slow, capacity planning, performance regression |
| Security Engineering | `references/security-engineering.md` | Cryptography, PKI, threat modeling, OWASP, supply chain, secrets management, zero trust | Security review, hardening, compliance, crypto design |
| Reliability Engineering | `references/reliability-engineering.md` | Circuit breakers, bulkheads, retry/backoff, chaos engineering, SLO/SLI/SLA, error budgets | Designing for failure, incident prevention, resilience patterns |
| Production Hardening | `references/production-hardening.md` | Multi-region deployment, disaster recovery, backup/restore, enterprise patterns, compliance hardening | Production deployment, DR planning, enterprise requirements |

## Core Principles — The Engineering Mindset

### 1. Everything fails. Design for it.
Hardware fails. Networks partition. Disks corrupt. Memory flips bits. Software has bugs. Humans make mistakes. If your system assumes anything won't fail, it will fail. Design for the failure, not for the happy path.

### 2. Simplicity is a feature. Complexity is a bug.
The best system is the simplest one that meets requirements. Every additional technology, abstraction, or component is a new failure mode. Complexity must earn its place by solving a real problem that cannot be solved more simply.

### 3. Measure before optimizing.
Intuition about performance is wrong more often than right. Profile. Measure. Find the bottleneck. THEN optimize. Optimizing without measurement is superstition.

### 4. Automate or die.
Manual processes are unreliable processes. If a human must type a command to deploy, configure, or recover, it will eventually be typed wrong, at the wrong time, by the wrong person. Everything must be code. Everything must be automated. Everything must be reproducible.

### 5. Security is not a layer. It is a property.
Bolting security onto an insecure system produces a secure-looking system that is still insecure. Security must be designed in from the beginning — at the protocol level, the data model level, the deployment level.

### 6. Observability is not monitoring.
Monitoring tells you what's wrong (alerts on known failure modes). Observability lets you ask new questions about unknown failure modes. You need both. Logs, metrics, and traces are the three pillars. If you can't answer "what happened?" without deploying new code, you're not observable.

### 7. Backward compatibility is a contract.
Breaking changes to APIs, schemas, or protocols break trust. Every change must consider: what depends on this? Schema evolution, API versioning, and protocol negotiation are not optional — they are the minimum bar for professional engineering.

### 8. Recovery time > failure prevention.
You cannot prevent all failures. You CAN minimize recovery time. Mean Time To Recovery (MTTR) is more important than Mean Time Between Failures (MTBF). A system that fails once a month but recovers in 30 seconds is better than one that fails once a year but takes 4 hours to recover.

## Relationship to Existing Skills

```
backend-engineering-mastery (KNOWLEDGE) ← YOU ARE HERE
    │
    ├──→ system-design-mastery (ARCHITECTURE) — what to build
    │       │
    │       └──→ platform-engineering (OPERATIONS) — how to run it
    │
    ├──→ systems-security (SECURITY) — how to harden it
    │
    └──→ coding-agent (IMPLEMENTATION) — how to code it
```

**Rule:** This skill provides the *deep engineering knowledge*. The other skills are the *applied practices*. Use this to understand WHY, them to execute HOW.

## Anti-Patterns of Backend Engineering

- **Resume-driven development.** Choosing technologies because they're exciting, not because they solve a problem. Kubernetes because "everyone uses it" — when a single VM would suffice.
- **Premature optimization.** Optimizing before measuring. Building for "web scale" with 100 users. Adding cache layers before understanding the query pattern.
- **Distributed by default.** Distributing a system that could be monolithic. Distributed systems are harder to operate, debug, and reason about. Distribution must earn its place.
- **No failure testing.** Never testing what happens when a dependency dies, a disk fills, or a network partitions. If you haven't tested the failure mode, it's not handled — it's hoped for.
- **Alert fatigue.** Alerting on everything means nothing is urgent. Pages should wake someone up. If an alert doesn't require human action, it's a metric, not an alert.
- **Security through obscurity.** "Nobody will find this endpoint." "This port is only open internally." Assume the attacker knows everything about your system except the keys.
- **Manual recovery.** "I'll fix it by hand and document later." Later never comes. If recovery isn't automated, you haven't recovered — you've temporarily patched.
- **Silent failure.** Errors that are logged but never surfaced. Disk filling up → logged → nobody reads logs → system crashes. Failures must be noisy until they're handled.
