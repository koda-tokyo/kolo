# Consensus & Distributed Coordination

## Raft — The Workhorse

Raft is the dominant consensus algorithm for production systems. Used by etcd, Consul, TiKV, CockroachDB, and NATS.

### Core Concepts

**Leader election:** One node is Leader. It handles all writes, replicates to Followers. If the Leader disappears (heartbeat timeout), a Follower becomes Candidate, requests votes, becomes new Leader.

**Log replication:** All writes go through Leader → appended to Leader's log → replicated to Followers → committed when majority acks.

```go
// Simplified Raft state machine
type Role int
const (
    Follower  Role = iota  // passive, responds to Leader
    Candidate              // requesting votes
    Leader                 // handling writes
)
```

### Safety Rules

1. **Election safety:** At most one Leader per term
2. **Log matching:** If two logs contain the same index+term, all prior entries match
3. **Leader completeness:** Leader has all committed entries
4. **State machine safety:** All servers apply same log entries in same order

### Membership Changes

Adding/removing nodes uses **joint consensus** — a transitional config that requires majorities from both old and new sets. This prevents split-brain during reconfiguration.

### Quorum = (N/2) + 1

| Cluster size | Quorum | Tolerates failures |
|-------------|--------|-------------------|
| 3 | 2 | 1 |
| 5 | 3 | 2 |
| 7 | 4 | 3 |

**Always use odd numbers.** A 4-node cluster has quorum 3 — same fault tolerance as 3-node, but worse availability (both 3 and 4 tolerate 1 failure, but 4 costs more).

## Paxos — The Original

Paxos is harder to understand and implement than Raft. For new systems, use Raft. Understand Paxos only if maintaining a Paxos-based system (Chubby, older ZooKeeper versions).

**Basic Paxos:** single-value consensus. Proposer → Acceptor quorum → Learner.
**Multi-Paxos:** extends to a log, like Raft. Most production systems use Multi-Paxos.

**Why Raft over Paxos:**
- Raft was explicitly designed for understandability
- Paxos has edge cases in membership changes
- Raft has better teaching and debugging tooling

## Leader Election

### The Split-Brain Problem

```
        [Node A thinks it's Leader]
        [Node B thinks it's Leader]
                ↓
        Both write to shared state
                ↓
        CORRUPTION
```

**Prevention:**
- Require quorum (majority) for election
- Fencing tokens: incrementing epoch number. Reject writes with stale epoch.
- Lease-based: Leader holds a time-limited lease. Must renew. If lease expires, step down.

### Fencing Tokens (Practical Pattern)

```
1. Storage system grants fencing token on leader election: token = 7
2. Leader includes token in every write
3. If old leader (token=6) tries writing → rejected
4. If network partition heals → old leader discovers it's been replaced → steps down
```

```go
// Fencing in practice
type WriteRequest struct {
    Data         []byte
    FencingToken int64   // rejected if < current
}
```

## Distributed Locking

### Redlock (Redis)

The Redlock algorithm uses N independent Redis instances. To acquire a lock:

1. Get current time (T1)
2. Try to SET NX with TTL on all N instances sequentially
3. Get current time (T2)
4. Lock acquired if: acquired on majority AND (T2 - T1) < TTL

```
Client → Redis-1: SET lock:myresource random-value NX PX 10000
Client → Redis-2: SET lock:myresource random-value NX PX 10000
Client → Redis-3: SET lock:myresource random-value NX PX 10000
Client → Redis-4: SET lock:myresource random-value NX PX 10000
Client → Redis-5: SET lock:myresource random-value NX PX 10000

Acquired if ≥ 3 respond OK and elapsed < 10s
```

**Redlock criticism (Martin Kleppmann):**
- Clock skew: if a Redis instance's clock jumps forward, TTL expires early
- GC pause: JVM/Go GC can pause the client longer than TTL → lock expired but client thinks it holds it
- **Mitigation:** always use fencing tokens with Redlock

### Fencing Token Always

```
Acquire lock → get token 42 → write to DB with token=42
DB rejects writes with token < max_seen_token
Even if GC pause causes lock expiry, the fencing token prevents corruption
```

**When to use distributed locking:**
- ✅ Leader election (highest throughput writer)
- ✅ Idempotent work queue processing (guarantee exactly-once with at-least-once delivery)
- ✅ Scheduled task coordination (only one instance runs the cron)
- ❌ Correctness guarantee for data mutation (use fencing tokens + DB transactions)
- ❌ Low-latency mutual exclusion (use local locks or single-node Redis)

## Coordination Services

### etcd (Raft-based)

```bash
# Watch a key for changes
etcdctl watch /services/my-service

# Leader election via etcd
etcdctl elect my-election candidate-1

# Distributed lock (with lease)
etcdctl lock my-lock ./critical-script.sh
```

### ZooKeeper (ZAB protocol, Paxos-like)

```java
// Ephemeral node: deleted when session ends
zk.create("/leaders/leader-", data, EPHEMERAL|SEQUENTIAL);

// Watch for changes
zk.exists("/config", watcher);
```

### When to Use Which

| Need | Tool |
|------|------|
| Service discovery | Consul, etcd, DNS |
| Configuration storage | etcd, Consul KV |
| Leader election | etcd (elect), Consul (session) |
| Distributed locks | etcd (lock), Consul, Redlock (with fencing) |
| Pub/sub coordination | NATS, Kafka, RabbitMQ |
| Distributed counters | Redis INCR, etcd transactions |
| Barriers (wait for N nodes) | ZooKeeper (sequential ephemeral znodes), etcd |

## CAP Theorem — Practical Application

```
            Consistency
              /\
             /  \
            /    \
           /      \
          /________\
Partition Tolerance--Availability
```

**During a network partition, you choose:**

| Choose | System type | Example | Behavior during partition |
|--------|------------|---------|--------------------------|
| CP (Consistency + Partition) | Banking, inventory | etcd, ZooKeeper, HBase | Reject writes, preserve correctness |
| AP (Availability + Partition) | Social media, CDNs | Cassandra, DynamoDB, DNS | Accept writes, resolve conflicts later |

**PACELC extension:** "In case of Partition, choose Availability or Consistency. Else, choose Latency or Consistency."

- PA/EL: DynamoDB, Cassandra — always available, low latency
- PC/EC: BigTable, HBase — always consistent, higher latency

### Key Insight

**CAP is about a partition happening.** No partition → you can have both C and A. During a partition → you MUST choose. Most of the time, there's no partition, and the real tradeoff is **latency vs consistency** (PACELC).

---

## Practical Consensus Use Cases

### Service Discovery

```
Service A starts → registers in etcd: /services/service-a/instance-1 {"host":"10.0.1.5","port":8080}
Service B starts → watches /services/ → sees Service A's address
Service A crashes → etcd removes ephemeral key → Service B gets watch notification → updates routing
```

### Distributed Configuration

```
Operator updates config → writes to etcd: /config/feature-flags {"new-checkout":"on"}
All service instances watch /config/ → receive notification → hot-reload config
No deploy needed. Atomic across all instances.
```

### Leader Election for Scheduled Tasks

```
Cron job fires on 10 instances simultaneously
All 10 attempt: etcdctl elect cron-daily instance-X
Only 1 succeeds → that instance runs the job
Others → no-op (backup if winner crashes)
```

---

*References: Diego Ongaro's Raft paper, Martin Kleppmann's Designing Data-Intensive Applications, etcd documentation, Redis Redlock specification*
