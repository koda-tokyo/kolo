# Distributed Systems Engineering

## The Fundamental Theorems

### CAP Theorem (Brewer, 2000; Gilbert & Lynch, 2002)

**During a network partition, choose between Consistency and Availability.**

- **Consistency:** All nodes see the same data at the same time (linearizability)
- **Availability:** Every request receives a non-error response (no guarantee it's the latest data)
- **Partition Tolerance:** System continues operating despite network partitions

**The subtlety everyone misses:** CAP is about PARTITIONS. Without a partition, you can have both C and A. It's only DURING a partition that you must choose. Also, "consistency" in CAP means linearizability specifically — not the C in ACID.

**Practical:**

- Banking ledgers → CP (consistency over availability during partition)
- Social media feeds → AP (availability over consistency)
- Most systems → CP for writes, AP for reads

### PACELC (Abadi, 2012) — CAP's extension

**If Partition (P), choose A or C. Else (E), choose L (Latency) or C (Consistency).**

This acknowledges that even without partitions, you trade off consistency vs. latency. Synchronous replication = high consistency, high latency. Asynchronous = low consistency, low latency.

### FLP Impossibility (Fischer, Lynch, Paterson, 1985)

**In an asynchronous system, no deterministic consensus algorithm can guarantee termination with even one faulty process.**

This is why consensus algorithms use:

- Randomization (cannot guarantee deterministic termination)
- Failure detectors (assume crashed processes can eventually be detected — partially synchronous model)
- Leadership (elect a leader and hope it stays alive long enough)

**For us:** Raft and Paxos work because they assume partial synchrony (messages eventually arrive, failures eventually detected). Pure asynchrony would make them impossible. The FLP result defines the boundary between what's theoretically impossible and what's practically achievable.

---

## Consensus Algorithms

### Raft (Ongaro & Ousterhout, 2014) — The Understandable Consensus

Designed specifically to be understandable, unlike Paxos.

**Three roles:**

1. **Leader:** Handles all client requests, replicates to followers
2. **Follower:** Passive, responds to leader
3. **Candidate:** Transitional — seeking election

**Leader election:**

- Randomized election timeout (150-300ms) prevents split votes
- Candidate requests votes → needs majority
- Term numbers increase monotonically — prevent stale leaders

**Log replication:**

```
Client → Leader → Append to local log → Send AppendEntries to followers
→ Majority ack → Commit → Apply to state machine → Respond to client
```

**Safety guarantees:**

- Election safety: at most one leader per term
- Log matching: if two logs have same index+term, all previous entries identical
- Leader completeness: committed entries survive leader changes
- State machine safety: no two servers apply different entries at same index

**Configuration changes (joint consensus):**

```
Cold,new ← transition phase: decisions require majority of BOTH old and new config
→ Once Cold,new committed → Cnew only
```

### Paxos (Lamport, 1998) — The Original

The consensus algorithm Raft simplified. Single-decree Paxos agrees on one value. Multi-Paxos extends to a log.

**Roles:** Proposer, Acceptor, Learner (can co-locate)
**Two phases:**

1. Prepare/Promise: Proposer sends prepare(n). Acceptors promise not to accept proposals < n. Return any previously accepted value.
2. Accept/Accepted: Proposer sends accept(n, v) with highest-numbered value from Phase 1 or own value. Acceptors accept if n is highest seen. Majority → chosen.

**Why Raft over Paxos for us:** Raft is designed for implementation correctness. Paxos is notoriously hard to implement correctly — most "Paxos" implementations have subtle bugs.

---

## Replication Strategies

### Leader-Based (Single-Master)

```
Master ← writes → replicas (read from any)
```

**When:** Most workloads. Simple, consistent.
**Cost:** Write bottleneck at master. Failover delay.
**For us:** Default for OLTP databases (PostgreSQL with streaming replication, MySQL with group replication).

### Multi-Leader

```
Master A ↔ Master B (both accept writes)
```

**When:** Multi-datacenter, offline-first, collaborative editing.
**Cost:** Conflict resolution. Last-write-wins is a lie — it silently loses data.
**For us:** CouchDB, Cassandra (multi-DC), CRDTs.

### Leaderless (Quorum)

```
Write to W nodes → success after W acks
Read from R nodes → success after R acks
W + R > N → linearizable
```

**When:** High availability requirements, multi-DC.
**Cost:** Read repair. Hinted handoff. Eventual consistency by default.
**For us:** Cassandra, DynamoDB, Riak.

---

## CRDTs — Conflict-Free Replicated Data Types (Shapiro, 2011)

Data structures that achieve strong eventual consistency without conflict resolution — merge is commutative, associative, and idempotent.

### State-Based (CvRDTs) — merge operation is LUB in semilattice

```
Counter: G-Counter (increment-only, merge = element-wise max)
Set: G-Set (add-only, merge = union), 2P-Set (add+remove with tombstone)
Map: LWW-Register (last-writer-wins with timestamps)
```

### Operation-Based (CmRDTs) — broadcast operations, apply in any order

```
Counter: PN-Counter (increment + decrement = vector of per-replica counts)
List: RGA (Replicated Growable Array — unique IDs for insertion between elements)
Text: WOOT, Logoot (for collaborative editing — Google Docs uses OT, not CRDT)
```

**For us (KODA KENKŌ):** Collaborative clinical notes could use CRDTs for offline editing with eventual sync. Multiple doctors editing the same patient record simultaneously.

---

## Distributed Transactions

### 2PC (Two-Phase Commit) — Atomicity across participants

```
Phase 1 (Prepare): Coordinator → "Can you commit?" → Participants: YES/NO, lock resources
Phase 2 (Commit): Coordinator → "Commit" or "Abort" → Participants: ack
```

**The problem:** Coordinator failure blocks participants (locks held indefinitely). 2PC sacrifices availability for consistency.

### 3PC (Three-Phase Commit) — Non-blocking extension

```
Phase 1 (CanCommit): Like 2PC Prepare but no locks held yet
Phase 2 (PreCommit): All voted YES → "Prepare to commit"
Phase 3 (DoCommit): Coordinator → "Commit"
```

**Advantage:** Non-blocking if coordinator fails (timeout → abort). But: requires no network partitions. Less used in practice because partial failures break it.

### Sagas (Garcia-Molina & Salem, 1987) — Long-lived transactions

```
Transaction T split into sub-transactions T1, T2, ..., Tn
Each Ti has compensating transaction Ci
If any Ti fails, execute Ci, Ci-1, ..., C1 in reverse order
```

**When:** Microservices, long-running workflows, cross-service operations.
**Patterns:** Choreography (each service listens for events and acts) vs. Orchestration (central coordinator).

---

## Consistency Models (Strongest → Weakest)

1. **Linearizability:** All operations appear to execute atomically at some point between invocation and response. Global real-time ordering. Impossible with network latency.
2. **Sequential:** All operations appear in some total order (not necessarily real-time). Per-process order preserved.
3. **Causal:** Causally related operations appear in order. Concurrent operations can appear in any order. (Vector clocks implement this.)
4. **Read-Your-Writes:** A user always sees their own writes. Session-level guarantee.
5. **Monotonic Reads:** A user never sees older data than previously seen. Time doesn't go backward.
6. **Eventual:** If no new writes, eventually all reads return the last written value.

**For us:**

- Patient vitals dashboard → read-your-writes (doctor enters vitals, must see them immediately)
- Lab results list → eventual (acceptable latency for aggregate results)
- Medication orders → linearizable (must not double-dose)

---

## Gossip Protocols

Nodes periodically exchange state with random peers. Eventually, all nodes converge to the same state.

**Properties:**

- O(log N) rounds to propagate to all nodes
- Highly resilient to node failures
- Bandwidth: each node sends to ~3 peers per round
- Used for: membership (Serf, Consul), failure detection, data dissemination (Cassandra)

**SWIM (Scalable Weakly-Consistent Infection-style Membership):**

- Each node pings a random peer → ack = alive
- No ack → ask k other nodes to ping the suspect → any ack = alive
- None ack → declare dead, gossip to others

**For us:** Service discovery in a cluster of Kurahi gateway nodes. Dynamic membership without central registry.

---

## Partitioning (Sharding) Strategies

### Range Partitioning

```
Keys: A-C → Shard 1, D-F → Shard 2, G-I → Shard 3
```

**Pro:** Range scans efficient. Easy to understand.
**Con:** Hot spots (sequential keys all go to one shard).

### Hash Partitioning

```
hash(key) % N → Shard
```

**Pro:** Even distribution. No hot spots.
**Con:** Range scans require scatter-gather. Resharding moves most data (consistent hashing fixes this).

### Consistent Hashing (Karger et al., 1997)

```
Nodes placed on a ring at hash points.
Key assigned to first node clockwise.
Adding/removing node only moves ~1/N of keys.
```

**Used by:** DynamoDB, Cassandra, Riak, CDN caching.

### Directory-Based

Central lookup maps keys → shards. Most flexible but adds a hop.
**Used by:** MongoDB (config servers), HDFS (namenode), Ceph (MON).

---

## Vector Clocks

Track causal relationships between events without physical clocks.

```
Clock: [A:3, B:1, C:5] → Node A is at event 3, B at 1, C at 5

Compare: [A:3, B:1] vs [A:2, B:4]
→ Neither dominates → CONCURRENT (conflict!)

Compare: [A:3, B:1] vs [A:2, B:1]
→ First dominates second → HAPPENED-AFTER
```

**When:** Detecting concurrent modifications. CRDTs use vector clocks internally. DynamoDB uses them for conflict detection.

**Limitations:** Clock size = number of nodes. Practical for small clusters, unwieldy for large ones. Bounded by pruning (remove nodes that haven't been active recently).
