# Database Internals — Storage, Query, and Scaling

## The UC Berkeley / MIT Lineage

Michael Stonebraker (UC Berkeley, MIT) has been instrumental in: Ingres (1970s), Postgres (1980s), C-Store (2000s → Vertica), H-Store (2000s → VoltDB), SciDB, Tamr. His career traces the evolution of database theory into production systems. The key insight: different workloads require fundamentally different database architectures.

---

## Storage Engines — The Foundation

### B-Tree (Bayer & McCreight, 1971; Comer, 1979)
The workhorse of OLTP databases (PostgreSQL, MySQL/InnoDB, SQLite).

**Structure:**
```
        [Root: keys ≤ K1 | K1 < keys ≤ K2 | keys > K2]
        /                    |                    \
[Internal node]         [Internal node]       [Internal node]
    /   |   \             /   |   \             /   |   \
[Leaf: pages with keys, values, sibling pointers for range scan]
```

**Properties:**
- Balanced: O(log n) for all operations, even in worst case
- Node size: typically match disk page size (4KB-16KB)
- Fill factor: internal nodes ~50-70%, leaf nodes ~60-80%
- Fanout: hundreds of keys per node (shallow tree — 3-4 levels for billions of rows)

**Insertion:** Find leaf → insert → if overflow → split node → promote median to parent → may cascade to root. Split is rare (1/fanout probability).

**Deletion:** Find leaf → delete → if underflow → merge with sibling or rebalance. PostgreSQL uses VACUUM (lazy deletion — marks as dead tuple, reaps later).

**Concurrency:** Blink-tree (Lehman & Yao, 1981) — B-tree with sibling links for lock-free traversal. InnoDB uses gap locks to prevent phantom reads.

### LSM-Tree (O'Neil, Cheng, Gawlick, O'Neil, 1996)
The engine behind RocksDB, LevelDB, Cassandra, ScyllaDB, ClickHouse (MergeTree).

**Architecture:**
```
Write → MemTable (in-memory, sorted) → WAL (durable, sequential)
When MemTable full → flush to SSTable (Sorted String Table) on disk
SSTables merged in background (compaction) — merges sort, removes tombstones

Read: check MemTable → check SSTables (newest first)
     → Bloom filter to skip SSTables that can't contain key
```

**Write amplification:** Each write is written multiple times through compaction levels. Worst case: write amplification factor = number of levels × level size ratio.

**Read amplification:** Must check multiple SSTables unless bloom filter eliminates. Tunable: more memory for bloom filters = fewer disk reads.

**Space amplification:** Obsolete versions and tombstones consume space until compacted.

**The LSM trilemma:** Write amplification ↔ Read amplification ↔ Space amplification. You can optimize any two at the expense of the third. Default RocksDB configuration optimizes for write and space at some read cost.

### Bε-Tree (Brodal & Fagerberg, 2003; Betree in TokuDB, now PerconaFT)
B-tree with buffers in internal nodes. Inserts accumulate in buffers, flush down in batches.
**Advantage:** Inserts are amortized nearly free. Write-optimized.
**Disadvantage:** Point reads must search all buffers on the path. Slightly higher read cost.

---

## Query Optimization (The Selinger Optimizer — IBM, 1979)

The cost-based optimizer (CBO) architecture used by PostgreSQL, MySQL, Oracle, SQL Server.

### The Process
1. **Parse:** SQL → parse tree
2. **Rewrite:** View expansion, constant folding, subquery unnesting
3. **Optimize:** Generate plan alternatives → estimate cost for each → pick cheapest
4. **Execute:** Run the plan

### Join Order Optimization
For N tables: N! join orders. Even with dynamic programming (Selinger), this is expensive.

**Dynamic programming approach (System R):**
```
For each subset of tables, compute best join plan.
Start with single-table plans.
Build up: best plan for {A,B} = min(best({A}) ⋈ B, best({B}) ⋈ A)
Bottom-up: optimal for each subset size.
Time: O(3^N) in theory, but N is typically ≤ 12-15 (above which genetic algorithm is used).
```

### Join Algorithms
**Nested Loop:** For each row in outer, scan inner. O(N×M). Worst but works for any join condition.
**Hash Join:** Build hash table on inner, probe with outer. O(N+M). Best for equijoin, no indexes.
**Merge Join:** Both sides sorted on join key, merge. O(N+M) but requires sort or index scan.
**Index Nested Loop:** For each outer row, index lookup on inner. O(N × log M). Good when outer is small, inner has index.

### Statistics and Cardinality Estimation
The optimizer estimates row counts using table statistics (ANALYZE):
- n_distinct: number of distinct values
- most_common_vals / most_common_freqs: histogram of common values
- histogram_bounds: equi-depth histogram

**Cardinality estimation errors cascade.** One bad estimate → wrong join order → catastrophic plan. This is why `ANALYZE` matters and why statistics must be up to date.

**PostgreSQL specific:** Extended statistics (CREATE STATISTICS) for correlated columns. Without it, the optimizer assumes column independence — which is almost always wrong.

---

## Transaction Isolation (ANSI SQL Standard)

### Read Phenomena
| Phenomenon | Description |
|-----------|-------------|
| Dirty Read | Transaction reads uncommitted data from another transaction |
| Non-Repeatable Read | Same query returns different row data (row was UPDATE/DELETE'd) |
| Phantom Read | Same query returns different rows (new rows INSERTed matching predicate) |
| Serialization Anomaly | Result not equivalent to any serial execution |

### Isolation Levels (SQL Standard)
| Level | Dirty Read | Non-Repeatable | Phantom | Serialization |
|-------|-----------|---------------|---------|---------------|
| Read Uncommitted | Possible | Possible | Possible | Possible |
| Read Committed | No | Possible | Possible | Possible |
| Repeatable Read | No | No | Possible | Possible |
| Serializable | No | No | No | No |

**The gap:** The SQL standard definition of Serializable is insufficient. True serializability requires preventing serialization anomalies that the standard doesn't capture (write skew, read-only transaction anomalies).

### MVCC (Multi-Version Concurrency Control)
Every transaction sees a consistent snapshot of the database at a point in time.

**PostgreSQL implementation:**
- Every tuple has xmin (creating transaction) and xmax (deleting transaction)
- Transaction sees: tuples where xmin is committed before snapshot AND xmax is not committed before snapshot OR xmax is the current transaction
- Old versions accumulate. VACUUM reclaims them.

**MySQL/InnoDB implementation:**
- Undo log: stores old versions
- Read view: transaction's snapshot → which transactions were active at start
- Purge thread removes old versions no longer visible to any active transaction

**MVCC cost:** Version bloat. Long-running transactions prevent cleanup (PostgreSQL VACUUM can't remove tuples visible to any active transaction). This is why we monitor max transaction age.

---

## Indexing Strategies Beyond B-Tree

### Partial Index
```sql
CREATE INDEX ON orders (created_at) WHERE status = 'active';
```
Index only contains rows matching WHERE. Smaller = faster scans, less write overhead.

### Covering Index (Index-Only Scan)
```sql
CREATE INDEX ON users (last_name) INCLUDE (first_name, email);
```
If query only needs columns in the index, no need to read the table. PostgreSQL: must VACUUM for visibility map to support index-only scans.

### BRIN (Block Range Index) — PostgreSQL
Index physical page ranges, not individual rows. Tiny index for huge tables where data is physically correlated with the indexed column (time-series, append-only logs).

### GIN (Generalized Inverted Index) — PostgreSQL
For composite values: arrays, JSONB, full-text search. Maps each element value to all rows containing it.

### GiST (Generalized Search Tree) — PostgreSQL
Framework for building custom indexes: geometric data (PostGIS), full-text search, trigram similarity.

---

## Sharding and Distributed SQL

### Application-Level Sharding
```
shard = hash(user_id) % num_shards
```
Application routes to correct database. No coordination between shards.
**Problems:** Resharding is painful. Cross-shard queries are application-level scatter-gather. No cross-shard transactions. This is why distributed SQL databases exist.

### Distributed SQL (CockroachDB, Spanner, YugabyteDB)
**Architecture:**
- Raft for replication within shard
- 2PC for cross-shard transactions
- GPS/atomic clocks for global ordering (Spanner: TrueTime API)
- SQL layer on top of distributed KV store

**Spanner's TrueTime (Google):**
```
TT.now() returns [earliest, latest] — an interval guaranteed to contain absolute time
Commit wait: delay until TT.now().earliest > transaction timestamp
→ External consistency (linearizability) for read-write transactions
```

**CockroachDB's approach:** Hybrid Logical Clocks (HLC). Combination of physical clock + logical counter. No atomic clocks required. Trades some Spanner-grade guarantees for deployability.

---

## Connection Pooling

### The Problem
PostgreSQL forks a process per connection. Memory: ~10MB per idle connection. Too many connections → OOM or context switching thrashing.

### PgBouncer (Transaction Pooling)
```
Mode: transaction pooling
Connections are assigned to clients only for duration of a transaction.
Between transactions, connection returns to pool.

Max 500 application connections → 50 database connections
```

### Server-Side Pooling (HikariCP, pgpool)
**HikariCP rules:**
- Pool size = ((core_count × 2) + effective_spindle_count)
- For SSDs: effective_spindle_count = 1
- Typical: 10-20 connections for PostgreSQL on modern hardware
- More connections ≠ more throughput (diminishing returns after optimal)

**For us (KoLo):** Use PgBouncer between our services and PostgreSQL. Pool size tuned per service based on workload profile.
