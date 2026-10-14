# 03 — Databases: SQL, NoSQL & Redis Deep Dive

## Table of Contents
1. [SQL Databases](#sql)
2. [Indexing Guide](#indexing)
3. [Replication Topologies](#replication)
4. [Sharding Strategies for SQL](#sharding-sql)
5. [NoSQL Decision Framework](#nosql-framework)
6. [Redis Beyond Caching](#redis-deep)
7. [CAP Theorem in Practice](#cap-practical)
8. [PostgreSQL vs MySQL](#pg-vs-mysql)

---

## SQL Databases {#sql}

### ACID Properties

| Property | Meaning | Implementation |
|---|---|---|
| **A**tomicity | All-or-nothing transactions | WAL (Write-Ahead Log), rollback segment |
| **C**onsistency | Valid state transitions | Constraints, foreign keys, triggers |
| **I**solation | Concurrent transactions don't interfere | MVCC, locking (see table below) |
| **D**urability | Committed writes survive crashes | WAL fsync, replication |

### Transaction Isolation Levels
| Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|---|---|---|---|
| Read Uncommitted | Possible | Possible | Possible |
| Read Committed | Not possible | Possible | Possible |
| Repeatable Read (PG default) | Not possible | Not possible | Possible (PG: not possible) |
| Serializable | Not possible | Not possible | Not possible |

**Practical advice**: Read Committed for most web apps. Repeatable Read (PostgreSQL) is a good default. Serializable only when correctness demands it (financial systems).

### Connection Pooling
```python
# Production-grade connection pooling with PgBouncer
# pgbouncer.ini
[databases]
mydb = host=localhost port=5432 dbname=mydb

[pgbouncer]
pool_mode = transaction    # Session, Transaction, or Statement
default_pool_size = 25
max_client_conn = 1000
max_db_connections = 50
```

**Key numbers**:
- PostgreSQL: ~100-500 connections before performance degrades
- With PgBouncer (transaction mode): support 10,000+ client connections
- **Rule**: Always use a connection pooler in production

### Connection Pool Exhaustion — The Most Common Production Outage

**The cascade:**
```
Service instances (N=15) × pool_size (10) = 150 connections demanded
PostgreSQL max_connections = 100
→ 50 connections rejected
→ Backpressure fails (no circuit breaker)
→ All 15 instances retry simultaneously
→ Dead connections pile up in TIME_WAIT
→ Even after you fix the config, ports stay exhausted for 2 minutes
→ Total outage: 5-15 minutes
```

**The formula:**
```
server_max_connections ≥ (service_instances × pool_size_per_instance) + superuser_reserve(5)

Example:
100 ≥ (15 × 10) + 5 = 155 ❌ — exhaustion
100 ≥ (4 × 20) + 5 = 85  ✅ — safe
```

**Warning signs before it happens:**
- `FATAL: sorry, too many clients already` in PostgreSQL logs
- `Connection refused` or `Connection reset` at peak traffic
- `PG::ConnectionBad` spikes during deploys (new instances join pool)
- Slow startup times — connection pool initiation competes with existing connections

**Solutions (pick one):**
1. **PgBouncer (transaction mode):** Multiplexes 1000+ clients onto ~25 server connections. The standard answer.
2. **Reduce pool_size:** 5-10 per instance is often enough. Measure, don't guess.
3. **Circuit breaker:** After N connection failures, stop trying for M seconds. Prevents retry storm.
4. **Connection queue:** Queue requests instead of rejecting. Increases latency but prevents failure.

**Pool sizing on modern hardware (SSD):**
```java
// HikariCP formula — the standard reference
maxPoolSize = (core_count * 2) + effective_spindle_count

// On modern NVMe SSD: effective_spindle_count ≈ 1 (SSD isn't a spinning disk)
// 8-core server: (8 * 2) + 1 = 17
// Round up: 20

// For cloud DBs (RDS, Cloud SQL): start at 10-15 per instance, scale with monitoring
```

**Monitoring query:**
```sql
-- Check current connections vs max (PostgreSQL)
SELECT count(*) AS current_connections,
       (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections,
       round(count(*) * 100.0 / (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'), 1) AS pct_used
FROM pg_stat_activity;
```

---

## Indexing Guide {#indexing}

### B-Tree Index (default, most common)
```sql
-- Single column index
CREATE INDEX idx_users_email ON users(email);

-- Composite index (column order matters!)
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
-- Supports: WHERE user_id = ? AND status = ?
-- Supports: WHERE user_id = ? 
-- Does NOT support: WHERE status = ? (index skip scan in PG 13+ helps)
```

### When Composite Index Column Order Matters
```sql
-- Good: user_id is selective (many values)
CREATE INDEX idx_bad ON orders(user_id, status);
-- Supports: WHERE user_id = 42 AND status = 'pending' ✓
-- Supports: WHERE user_id = 42 ✓
-- Partial: WHERE status = 'pending' ✗ (not leading column)

-- Better order: most selective/referenced first, range at end
CREATE INDEX idx_orders ON orders(user_id, created_at);
-- Supports: WHERE user_id = 42 ORDER BY created_at (avoids sort!)
```

### EXPLAIN ANALYZE — Reading Query Plans
```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 42 AND status = 'pending';

-- Key things to look for:
-- "Seq Scan" → missing index (bad for large tables)
-- "Index Scan" → using index to find rows
-- "Index Only Scan" → index covers all columns needed (fastest)
-- "Bitmap Index Scan" → combining multiple indexes
-- Cost: (startup..total) — focus on total cost
-- "rows=..." actual vs planned — large mismatch = stale statistics
```

### Index Types Beyond B-Tree

| Type | Use Case | Example |
|---|---|---|
| Hash | Exact equality only (=) | UUID lookups |
| GIN | Full-text search, array containment | `WHERE tags @> ARRAY['dev']` |
| GiST | Geospatial, full-text search | `WHERE geom && ST_MakeEnvelope(...)` |
| BRIN | Large tables with physical correlation | Time-series: `WHERE created_at BETWEEN` (very small index) |
| Partial | Subset of rows | `WHERE deleted_at IS NULL` |
| Covering | All columns in index | `INCLUDE (extra_col)` for Index Only Scan |

### Indexing Anti-Patterns
- ❌ Indexing every column individually (wasteful writes)
- ❌ No index on foreign keys (deadlocks on parent deletes)
- ❌ Function-wrapped WHERE: `WHERE LOWER(email) = 'x'` → use expression index
- ❌ Leading wildcard: `WHERE name LIKE '%smith'` → can't use B-tree; GIN trigram instead

---

## Replication Topologies {#replication}

### Leader-Follower (Master-Slave)
```
                  ┌──────────┐
 Writes ────────→ │  Leader  │
                  └────┬─────┘
              async / sync
          ┌──────────┼──────────┐
    ┌─────┴────┐ ┌───┴───┐ ┌────┴─────┐
    │ Follower │ │Follower│ │ Follower │
    │  (read)  │ │ (read) │ │ (read)   │
    └──────────┘ └───────┘ └──────────┘
```
- **Writes**: Leader only
- **Reads**: Scale with followers
- **Replication lag**: Seconds to minutes (async) to 0 (sync)
- **Failover**: Promote follower to leader; potential data loss with async

### Multi-Leader (Master-Master)
```
  ┌────────┐          ┌────────┐
  │Leader A│←────────→│Leader B│
  │(US-East)│ conflict │(EU-West)│
  └────────┘          └────────┘
```
- **Conflict resolution required**: LWW (last-write-wins), CRDTs, application-level
- **Use**: Geo-distributed write requirements; offline-first

### Leaderless (Dynamo-style)
- Any replica can accept writes
- Quorum reads/writes: `R + W > N` for strong consistency
- Used by: Cassandra, DynamoDB, Riak

### Replication Lag Mitigation
- **Read-your-writes**: Read from leader after write
- **Monotonic reads**: Always read from the same replica
- **Critical data**: Use synchronous replication or read from leader

---

## Sharding Strategies for SQL {#sharding-sql}

### Application-Level Sharding
```sql
-- Shard by hash(user_id) % 4
-- Shard DB 0: users where hash(user_id) % 4 = 0
-- Shard DB 1: users where hash(user_id) % 4 = 1
-- ... 
```

### Tools & Approaches
| Tool | Approach | Notes |
|---|---|---|
| Citus | Distributed PostgreSQL | Sharding by distribution column; open-source |
| Vitess | MySQL clustering | YouTube scale; gRPC proxy |
| CockroachDB | Distributed SQL | Auto-sharding; serializable isolation |
| YugabyteDB | Distributed SQL | PostgreSQL-compatible |

### When to Shard
1. Data exceeds single-node storage (TB+)
2. Write throughput exceeds single-node capacity
3. Geo-distribution requirements
4. **Don't shard prematurely** — vertical scaling + read replicas go far

---

## NoSQL Decision Framework {#nosql-framework}

### Decision Flow
```
Is your data...
├── Relational with complex joins? → SQL (PostgreSQL)
├── Document/JSON, flexible schema? → MongoDB
├── Key-value, extreme speed? → Redis
├── Wide-column, time-series? → Cassandra
├── Full-text search? → Elasticsearch
├── Graph relationships? → Neo4j
├── Time-series metrics? → TimescaleDB / InfluxDB
└── Blob/large files? → S3 / object storage
```

### NoSQL Database Comparison

| DB | Data Model | Sweet Spot | Avoid When |
|---|---|---|---|
| **MongoDB** | Document (BSON) | Flexible schema, rapid iteration, semi-structured data | Complex transactions across collections |
| **Redis** | Key-value + data structures | Cache, real-time, leaderboards, rate limiting, queues | Large datasets that don't fit in RAM |
| **Cassandra** | Wide-column | High write throughput, time-series, multi-region | Joins, complex queries, frequent schema changes |
| **Elasticsearch** | Document (inverted index) | Full-text search, log analytics, aggregations | Primary data store (best as secondary index) |
| **Neo4j** | Graph | Deep relationship queries, recommendations, fraud detection | Simple CRUD, high write throughput |
| **TimescaleDB** | Relational (PostgreSQL extension) | Time-series with SQL queries | Pure key-value workloads |
| **DynamoDB** | Key-value + document | Serverless, predictable latency at scale | Complex query patterns without pre-planning |

---

## Redis Beyond Caching {#redis-deep}

### Data Structures & Use Cases

**Sorted Sets — Leaderboards**
```python
# Add scores
redis.zadd('leaderboard', {'player:42': 1000, 'player:99': 950})
# Top 10
redis.zrevrange('leaderboard', 0, 9, withscores=True)
# Player's rank
redis.zrevrank('leaderboard', 'player:42')
# Players near score
redis.zrevrangebyscore('leaderboard', 1050, 950)
```

**Streams — Event Log / Message Queue**
```
redis.xadd('events', '*', 'type', 'order_placed', 'user_id', '42')
redis.xreadgroup('group1', 'consumer1', {'events': '>'})
# Consumer groups, acknowledgment, pending message handling
```

**HyperLogLog — Approximate Cardinality**
```python
# Count unique visitors (12 KB per key, 0.81% error)
for i in range(1000000):
    redis.pfadd('visitors', f'user_{i}')
redis.pfcount('visitors')  # ≈ 1000000 (uses 12 KB, not ~8 MB)
```

**Bitmaps — Features Flags / Daily Active Users**
```python
# Track DAU: user 42 active on day 100
redis.setbit('dau:2024-01-01', 42, 1)
redis.bitcount('dau:2024-01-01')  # Count active users
# Union of 7 days with BITOP
redis.bitop('OR', 'weekly_active', 'dau:mon', 'dau:tue', 'dau:wed', 'dau:thu', 'dau:fri', 'dau:sat', 'dau:sun')
```

**Geo — Location-Based Queries**
```python
redis.geoadd('stores', 139.767, 35.681, 'store:tokyo', 139.65, 35.67, 'store:shinjuku')
redis.georadius('stores', 139.767, 35.681, 5, unit='km', withdist=True)
```

**Lua Scripting — Atomic Multi-Operation**
```lua
-- Atomic rate limiter
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end
if current > limit then
    return 0  -- Limited
end
return 1  -- Allowed
```

**Pub/Sub — Real-Time Notifications (at-most-once)**
```python
# Publisher
redis.publish('notifications', json.dumps({'user_id': '42', 'msg': 'Hello'}))

# Subscriber (fire-and-forget; no persistence)
pubsub = redis.pubsub()
pubsub.subscribe('notifications')
for msg in pubsub.listen():
    print(msg)
```

---

## CAP Theorem In Practice {#cap-practical}

### Real-World Database Classifications
| System | CAP Type | Why |
|---|---|---|
| PostgreSQL (standalone) | CA | Single node, no partition possible |
| PostgreSQL (streaming replication) | CP | Write leader; followers may lag (not fully available) |
| MongoDB (replica set, default) | CP | Elections during partition; writes unavailable |
| Cassandra | AP | Tunable consistency; any node accepts writes |
| CockroachDB | CP | Serializable isolation; quorum-based |
| Redis Cluster | CP | Requires quorum in partition |
| Amazon DynamoDB | AP (default) | Eventual consistency default; strongly consistent reads available |

### Consistency vs Latency Tradeoff
```
Strong consistency (CP) ────────────────── Eventual consistency (AP)
         │                                          │
    Higher latency                            Lower latency
    Lower availability                        Higher availability
    Simpler app logic                         Complex app logic (stale reads)
```

---

## PostgreSQL vs MySQL Decision Guide {#pg-vs-mysql}

| Factor | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| **Complex queries** | ✅ Superior optimizer, CTEs, window functions | ⚠️ Good; catching up (8.0+) |
| **JSON support** | ✅ JSONB with GIN indexes | ⚠️ JSON with generated columns |
| **Full-text search** | ✅ Built-in, good enough | ⚠️ Built-in |
| **Geospatial** | ✅ PostGIS (best in class) | ⚠️ Basic spatial types |
| **Replication** | ✅ Logical + streaming | ✅ GTID-based, mature |
| **Connections** | ⚠️ Process-per-connection | ✅ Thread-based (lighter) |
| **ALTER TABLE** | ⚠️ Some require full table rewrite | ✅ Faster for many operations |
| **Upsert** | ✅ `INSERT ... ON CONFLICT` | ✅ `INSERT ... ON DUPLICATE KEY` |
| **Materialized views** | ✅ Native | ❌ Not native |
| **Horizontal scaling** | ✅ Citus extension | ✅ Vitess (CNCF) |
| **Licensing** | ✅ PostgreSQL (pure open source) | ⚠️ Oracle ownership (but GPL) |
| **Ecosystem** | Growing rapidly | Larger historical community |

### Quick Decision
- **Choose PostgreSQL** when: Complex queries, data integrity matters, need extensions (PostGIS, TimescaleDB, pgvector)
- **Choose MySQL** when: Simple read-heavy workloads, need lighter connection model, existing MySQL expertise
