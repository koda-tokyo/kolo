# Data Engineering — Pipelines, Streaming, and Warehousing

## The Stanford / UC Berkeley Lineage

AMPLab (UC Berkeley, 2011-2016) produced Apache Spark, Mesos, and Alluxio. RISELab (2017-2022) produced Ray, MLflow, and Clipper. Stanford's DAWN project (Matei Zaharia, Christopher Ré, Peter Bailis) produced production ML infrastructure. The key insight: the hard problems in data engineering are not computation — they are state, ordering, schema evolution, and exactly-once semantics.

---

## The Modern Data Stack

### The Convergence: Lake + Warehouse = Lakehouse
```
2010-2018:
  Data Lake (S3/HDFS) — schema-on-read, cheap storage, all raw data
  Data Warehouse (Redshift/BigQuery) — schema-on-write, fast queries, subset of data

2020-present:
  Lakehouse (Databricks, Iceberg, Delta Lake)
  = Lake's flexibility + Warehouse's ACID + performance
```

### Table Formats (The Lakehouse Foundation)

**Apache Iceberg (Netflix, 2017):**
```
Table metadata → Manifest list → Manifest files → Data files
Each data file tracked with: partition values, column stats (min/max/null count)
→ Partition evolution (change partitioning without rewriting data)
→ Hidden partitioning (query doesn't need to know partition scheme)
→ Time travel (query as of timestamp/snapshot-ID)
→ Schema evolution (add, drop, rename, reorder columns — no rewrite)
```

**Delta Lake (Databricks, 2019):**
```
Transaction log (_delta_log/) → ordered sequence of JSON/Parquet checkpoint files
Optimistic concurrency: check for conflicts, apply changes atomically
→ ACID transactions on a data lake
→ Z-ordering (multi-dimensional clustering — like sort keys for multiple columns)
→ Liquid clustering (Delta 3.0) — simpler alternative to partitioning + Z-ordering
→ CDF (Change Data Feed) — stream of changes for incremental processing
```

**Apache Hudi (Uber, 2017):**
Optimized for streaming upserts and incremental processing.
- **Copy-on-Write:** Every update rewrites the entire file. Simple, read-optimized.
- **Merge-on-Read:** Updates stored in delta log files alongside base files. Compacted later. Write-optimized.

**For us:** Iceberg for analytical workloads (interoperable across query engines). Delta Lake if using Databricks/Spark ecosystem heavily.

---

## Stream Processing

### The Two Paradigms

**Stateless (each event processed independently):**
```
Filter, map, transform, enrich (lookup in external system), route
→ Simple, scalable, exactly-once with idempotent sinks
```

**Stateful (processing depends on prior events):**
```
Aggregate (windowed sum/count/avg), join (stream-stream, stream-table), pattern detection
→ State must be fault-tolerant, checkpointed, recoverable
```

### Kafka — The Streaming Backbone

**Topic Partition Architecture:**
```
Topic "patient-events" (6 partitions, replication factor 3)
Partition 0: [msg-0, msg-6, msg-12, ...] — ordered, immutable log
Partition 1: [msg-1, msg-7, msg-13, ...]
...

Consumer Group "clinical-processor" (3 consumers):
Consumer-0 → partitions 0,1
Consumer-1 → partitions 2,3
Consumer-2 → partitions 4,5

⚠️ Consumer count > partition count → idle consumers
```

**Exactly-Once Semantics (EOS):**
Kafka (since 0.11) supports exactly-once for: consume → process → produce. Uses:
1. Idempotent producer: each message has sequence number. Broker deduplicates by (producerId, sequence).
2. Transactional API: atomic writes across multiple partitions. Consumer reads only committed messages (isolation level: read_committed).

**EOS boundary: Kafka → Kafka IS exactly-once. Kafka → external system is at-most-once or at-least-once UNLESS the external system supports idempotency and the write is included in the transaction.**

### Apache Flink — True Streaming (Event-by-Event)

Unlike Spark Streaming (micro-batch), Flink processes each event as it arrives. True streaming with sub-millisecond latency.

**State Backend:**
- **HashMapStateBackend:** State in JVM heap. Fastest. Not persistent (restore from checkpoint on failure).
- **RocksDBStateBackend:** State in RocksDB (local SSD + memory cache). Supports state larger than memory. Incremental checkpointing.

**Checkpointing (Chandy-Lamport distributed snapshots):**
```
Insert checkpoint barriers into the stream.
Each operator checkpoints state when barrier arrives.
All operators complete → distributed snapshot.
→ Exactly-once guarantee within Flink even on failure.
```

**Watermarks:** Track event-time progress. "No events with timestamp < T will arrive."
```
Window close: watermark passes window end
Late events: events with timestamp before current watermark
Policy: drop, emit to side output, or update previous window result
```

### Kafka Streams — Embedded Streaming
Stream processing embedded in your application (JVM library, not a cluster). Good for: smaller scale, simpler operations, no separate infrastructure.

---

## Batch Processing

### Apache Spark — The De Facto Batch Engine

**Execution Model:**
```
Driver → DAG Scheduler → Task Scheduler → Executors

Job: Action (count, save, collect) triggers computation
Stage: Set of tasks that don't require shuffle
Task: Unit of work on a partition
```

**Shuffle:** Data must be redistributed across partitions (groupBy, join, repartition). Most expensive operation. All-to-all data transfer. Spills to disk.

**Tungsten:** Spark's execution engine. Off-heap memory management, code generation (whole-stage codegen). Avoids JVM object overhead and GC pressure.

**Adaptive Query Execution (AQE, Spark 3.0+):**
```
Optimize query plan DURING execution based on runtime statistics:
- Coalesce shuffle partitions (actual data size, not static count)
- Switch join strategy (broadcast if actual size < threshold)
- Optimize skew join (split skewed partition)
```

### DataFusion (Apache Arrow, Rust)
The next-generation query engine. Columnar, vectorized, Rust-based. Used as embedded query engine in InfluxDB IOx, GraphQL databases, and custom data platforms.

**For us (KoLo):** If we build a custom analytics engine, DataFusion is the foundation — embeddable, fast, no JVM, Arrow-native.

---

## Schema Evolution

Data schemas change over time. The question is not IF, but HOW.

### Backward Compatibility (most important)
**Old data read by new code must work.**
```
Adding a nullable field: ✅ safe (old records have NULL)
Adding a required field: ❌ unsafe (old records missing field)
Renaming a field: ❌ unsafe (old records have old name)
```

### Forward Compatibility
**New data read by old code must work.**
```
Removing a field: ⚠️ old code may reference it (use default)
Changing field type: ❌ unsafe (parse error)
```

### Schema Registry (Confluent, Apicurio)
Central registry for schema versions. Enforce compatibility rules. Used with Kafka/Avro.
```
Topic "patient-events" → Schema "patient-v1", "patient-v2"
Compatibility: BACKWARD (default, safest), FORWARD, FULL, NONE
```

### Protobuf / gRPC Schema Evolution
```
Field numbering is the contract:
message Patient {
  int32 patient_id = 1;  // NEVER reuse number 1
  string name = 2;
  string new_field = 3;  // Safe: new field, new number
  reserved 4;             // Explicitly prevent reuse
}
```

---

## Data Quality

### The Six Dimensions of Data Quality
1. **Completeness:** Are all required fields present?
2. **Accuracy:** Do values reflect reality?
3. **Consistency:** Are values consistent across systems?
4. **Timeliness:** Is data available when needed?
5. **Uniqueness:** Are there duplicates?
6. **Validity:** Do values conform to expected format/range?

### Great Expectations — Data Quality as Code
```python
# Define expectations as code
expect(column("patient_age")).to_be_between(0, 130)
expect(column("patient_id")).to_be_unique()
expect(column("lab_result_value")).to_not_be_null()

# Run validation on data
# → Data Docs: HTML report of validation results
# → Alerts when validation fails
```

### Data SLAs
```
Freshness: data available within N minutes of event
Completeness: < 0.1% missing values in critical fields
Accuracy:    < 0.01% anomaly rate
```

---

## ETL Patterns

### Modern: ELT > ETL
```
Extract → Load (raw data into warehouse/lake) → Transform (SQL in warehouse)
```
Why: Compute is cheaper than engineering time. Transform in place. Keep raw data.

### Incremental vs. Full Refresh
```
Full refresh: truncate + reload everything. Simple. Works for small data.
Incremental: process only new/changed data. Required for scale.
  → Requires: change detection (timestamp, version, CDC)
  → Late-arriving data must be handled (backfill, upsert)
```

### CDC (Change Data Capture)
```
PostgreSQL → logical replication slot → Debezium → Kafka → consumer
Each change: row before + after, operation (INSERT, UPDATE, DELETE), LSN
```

### Data Mesh (Dehghani, 2019)
Decentralized data ownership: each domain owns its data products.
```
Domain teams own: schema, quality, SLAs, access control
Platform team provides: infrastructure, catalog, governance
```
Not right for small teams (overhead). Right for scaling organizations with many data-producing teams.
