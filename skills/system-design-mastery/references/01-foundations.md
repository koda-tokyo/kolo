# 01 — Foundations: Latency, Throughput & Distributed Systems

## Table of Contents
1. [Latency Numbers Every Programmer Should Know](#latency-numbers)
2. [Throughput Envelope Numbers](#throughput-envelope)
3. [Memory Envelope](#memory-envelope)
4. [Back-of-Envelope Estimation](#back-of-envelope)
5. [CAP Theorem](#cap-theorem)
6. [PACELC Extension](#pacelc)
7. [Consistency Models](#consistency-models)
8. [Availability Patterns](#availability-patterns)
9. [Partitioning & Sharding](#partitioning-sharding)

---

## Latency Numbers Every Programmer Should Know {#latency-numbers}

All numbers are approximate and meant for back-of-envelope estimation. Multiply by time since 2010.

| Operation | Time | Relative |
|---|---|---|
| L1 cache reference | 0.5 ns | - |
| L2 cache reference | 7 ns | 14x L1 |
| Main memory reference | 100 ns | 14x L2 |
| Zippy (Snappy) compression of 1 KB | 3 µs | 30x memory |
| SSD random read | 100 µs | 33x compress |
| Read 1 MB sequentially from memory | 250 µs | 2.5x SSD |
| Round trip in same datacenter | 500 µs | 2x mem read |
| Disk seek | 10 ms | 20x DC RTT |
| Read 1 MB sequentially from network (1 Gbps) | 10 ms | 1x disk seek |
| Read 1 MB sequentially from SSD | 1 ms | 10x faster than disk |
| Packet roundtrip CA→Netherlands→CA | 150 ms | 15x disk seek |

### Practical Takeaways
- **Local operations**: cache hits are nanosecond-scale; memory is ~100ns
- **I/O dominates**: a disk seek costs ~10ms — equivalent to reading 10 MB sequentially from SSD
- **Network is expensive**: cross-continent RTT (~150ms) dwarfs everything else
- **SSD vs HDD**: SSDs are ~100x faster for random reads

### Design Implications
- Batch network requests; avoid chatty protocols
- Amortize I/O: sequential reads are vastly cheaper than random
- CDN edge caching turns cross-continent latency (150ms) into local latency (<10ms)
- Compression is almost always worth it (3µs to save bandwidth)

---

## Throughput Envelope Numbers {#throughput-envelope}

| Component | Typical Throughput |
|---|---|
| Single CPU core (compute-bound) | ~5M ops/s (simple integer) |
| L1 cache bandwidth | ~1 TB/s |
| Main memory bandwidth | ~100 GB/s |
| SSD (NVMe) sequential read | 3-7 GB/s |
| SSD (SATA) sequential read | 500 MB/s |
| HDD sequential read | 150 MB/s |
| Network: 1 Gbps | 125 MB/s |
| Network: 10 Gbps | 1.25 GB/s |
| Network: 100 Gbps | 12.5 GB/s |
| Redis (single instance) | 100K-200K ops/s |
| PostgreSQL (single instance) | 10K-50K TPS (reads) |
| Kafka (single broker) | ~1M msgs/s |
| Nginx (simple proxy) | 100K req/s |

### Throughput Math
- **Little's Law**: `Concurrency = Arrival Rate × Service Time`
- Throughput is bounded by the slowest component in the chain
- For a service with 10ms latency: 100 req/s per thread; 100 threads → 10K req/s

---

## Memory Envelope {#memory-envelope}

| Level | Typical Size | Access Pattern |
|---|---|---|
| L1 Cache (per core) | 32-64 KB | Data + Instructions |
| L2 Cache (per core) | 256-512 KB | Unified |
| L3 Cache (shared) | 8-64 MB | LLC |
| RAM (server) | 64 GB - 2 TB | DDR4/DDR5 |
| NVMe SSD | 2-32 TB | Block |
| SATA SSD | 4-16 TB | Block |
| HDD | 8-22 TB | Block |

### Memory Cost Rules of Thumb
- RAM: ~$3-5/GB
- NVMe SSD: ~$0.08-0.15/GB
- SATA SSD: ~$0.05-0.10/GB
- HDD: ~$0.015-0.03/GB

---

## Back-of-Envelope Estimation {#back-of-envelope}

### The Method
1. **Identify the bottleneck** — what resource constrains your system?
2. **Start with known numbers** — use the latency/throughput tables above
3. **Calculate from first principles** — requests/s × data/request = bandwidth
4. **Validate with orders of magnitude** — is this reasonable?

### Estimation Cheat Sheet
```
1 day   = 86,400 seconds ≈ 10^5 seconds
1 month ≈ 2.6 × 10^6 seconds
1 year  ≈ 3.15 × 10^7 seconds ≈ π × 10^7 (handy shortcut!)

1 KB = 10^3 bytes, 1 MB = 10^6 bytes, 1 GB = 10^9 bytes, 1 TB = 10^12 bytes, 1 PB = 10^15 bytes
```

### Example: Design Twitter Feed
- **300M MAU → 10M DAU** (rough 3% daily active)
- Assume 10M DAU, avg 5 feed refreshes/day = **50M feed reads/day**
- 50M / 86,400 ≈ **~600 queries/s** (but peak ~3x average = 1800 q/s)
- Each feed: ~20 tweets, avg 1 KB per tweet JSON = 20 KB per read
- Bandwidth: 1800 q/s × 20 KB = **36 MB/s** — easily handled by a few app servers
- Storage: if 500M tweets/day, 1 KB each → 500 GB/day → ~15 TB/month

---

## CAP Theorem {#cap-theorem}

**Statement**: A distributed system can provide only two of three guarantees simultaneously:
- **C**onsistency — every read receives the most recent write
- **A**vailability — every request receives a (non-error) response
- **P**artition tolerance — the system continues to operate despite network partitions

### The Crucial Subtlety
CAP doesn't mean "pick two." **Partition tolerance is non-negotiable** in distributed systems — networks will partition. The real choice is: during a partition, do you choose **CP** (consistency over availability) or **AP** (availability over consistency)?

### Practical CAP
| System | Type | Behavior During Partition |
|---|---|---|
| PostgreSQL (single) | CA (no partition) | Not distributed; consistency + availability |
| PostgreSQL (leader-follower) | CP | Follower may lag; write leader is single point |
| MongoDB (default) | CP | Primary election; unavailable during election |
| Cassandra | AP | Eventual consistency; always writable |
| Zookeeper / etcd | CP | Quorum required; may reject writes |
| Redis Cluster | CP | Can lose writes if partition is large enough |
| DynamoDB | AP | Configurable; default eventually consistent |

### Interview Answer Template
1. "In a distributed system, network partitions are inevitable..."
2. "During a partition, the system must choose between consistency (CP) and availability (AP)..."
3. "In normal operation (no partition), we can have both C and A..."
4. Explain your specific choice with business justification

---

## PACELC Extension {#pacelc}

PACELC extends CAP by distinguishing behavior during partitions vs. normal operation:

> **P**artition: **A**vailability or **C**onsistency → **E**lse: **L**atency or **C**onsistency

| System | Partition (PA/PC) | Else (EL/EC) |
|---|---|---|
| Cassandra | PA (available) | EL (low latency) |
| MongoDB | PC (consistent) | EC (consistent) |
| DynamoDB | PA (available) | EL (low latency, default) |
| Bigtable/HBase | PC (consistent) | EC (consistent) |
| Couchbase | PA (available) | EL (low latency) |

### Why PACELC Matters
Most of the time, there's NO partition. PACELC captures that normal-case design tradeoff: do you optimize for low latency (eventual consistency) or strong consistency (higher latency)?

---

## Consistency Models {#consistency-models}

### Strong Consistency
- Every read sees the most recent write (linearizability)
- **Cost**: Higher latency, lower availability
- **Implementations**: Paxos, Raft, synchronous replication
- **Use cases**: Financial transactions, inventory systems

### Eventual Consistency
- If no new writes, eventually all replicas converge
- **Cost**: Stale reads possible
- **Implementations**: Async replication, gossip protocols
- **Use cases**: Social media feeds, DNS, CDN

### Causal Consistency
- Causally related operations are seen in order
- Weaker than strong, stronger than eventual
- **Examples**: Vector clocks in DynamoDB; happens-before relationship
- **Use case**: Comments and replies (must see comment before replies)

### Read-Your-Writes Consistency
- A user always sees their own updates
- **Implementation**: Route reads to write master for the user; use session affinity
- **Use case**: User profile edits; password changes

### Monotonic Reads
- Once you've read a value, you won't see an older version on subsequent reads
- **Implementation**: Always read from the same replica

### Consistent Prefix
- Reads observe a prefix of the update sequence
- No "causal inversion"

---

## Availability Patterns {#availability-patterns}

### Nines Chart
| Availability | Downtime/Year |
|---|---|
| 99% (two nines) | 3.65 days |
| 99.9% (three nines) | 8.76 hours |
| 99.99% (four nines) | 52.6 minutes |
| 99.999% (five nines) | 5.26 minutes |
| 99.9999% (six nines) | 31.5 seconds |

### Patterns
1. **Redundancy**: N+1, N+2 servers; multi-AZ, multi-region
2. **Failover**: Active-passive, active-active
3. **Circuit Breaker**: Prevent cascading failures
4. **Bulkhead**: Isolate failures to a partition
5. **Graceful Degradation**: Serve degraded functionality instead of failing
6. **Health Checks**: Liveness, readiness, dependency probes
7. **Retry with Backoff**: Exponential + jitter to avoid thundering herd

---

## Partitioning & Sharding Fundamentals {#partitioning-sharding}

### Sharding Strategies

**1. Range-Based Sharding**
- Partition by key range (e.g., user_id 1-1M on shard A)
- **Pros**: Easy range scans; predictable
- **Cons**: Hotspots if key distribution is skewed

**2. Hash-Based Sharding**
- Partition by `hash(key) % N` or consistent hash ring
- **Pros**: Uniform distribution
- **Cons**: Range queries expensive; resharding complex

**3. Directory-Based Sharding**
- A lookup service maps keys to shards
- **Pros**: Flexible; dynamic resharding
- **Cons**: Single point of lookup

**4. Geo-Partitioning**
- Partition by geographic region
- **Pros**: Data locality; regulatory compliance
- **Cons**: Cross-region queries complex

### Consistent Hashing
- Keys and nodes hash to a ring
- Adding a node affects only K/N keys (vs. all keys with modulo)
- Used by: Cassandra, DynamoDB, Redis Cluster, CDNs

### Resharding Challenges
1. **Data migration**: Moving data between shards while serving traffic
2. **Dual writes**: Write to both old and new shard during migration
3. **Increment vs. decrement**: Adding shards is easier than removing

### Cross-Shard Operations
- **Scatter-gather**: Send to all shards, aggregate results (expensive)
- **Avoid joins across shards**: Denormalize or use lookup tables
- **Distributed transactions**: Two-phase commit (2PC) — slow, blocking
