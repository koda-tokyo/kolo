# 05 — Big Data: Streams, Batches & Message Queues

## Table of Contents
1. [MapReduce Fundamentals](#mapreduce)
2. [Apache Kafka](#kafka)
3. [Stream Processing](#stream-processing)
4. [Batch Processing](#batch-processing)
5. [Data Warehouse Patterns](#data-warehouse)
6. [Message Queue Patterns](#message-queue)
7. [Distributed Task Queues](#task-queues)

---

## MapReduce Fundamentals {#mapreduce}

### Core Idea
MapReduce is a programming model for processing large datasets in parallel across a cluster. It decomposes work into two phases:

```
┌─────────────────────────────────────────────────────┐
│                    MAP PHASE                         │
│  Input split → map(k1,v1) → list(k2,v2)             │
│                                                     │
│  "Divide and conquer": partition work into          │
│  independent chunks processed in parallel           │
├─────────────────────────────────────────────────────┤
│                SHUFFLE & SORT                        │
│  Group all values with the same intermediate key    │
│  (The magic that makes MapReduce powerful —         │
│   but also the bottleneck)                          │
├─────────────────────────────────────────────────────┤
│                   REDUCE PHASE                       │
│  reduce(k2, list(v2)) → list(k3,v3)                 │
│                                                     │
│  Aggregate/transform grouped results                │
└─────────────────────────────────────────────────────┘
```

### Classic Word Count Example

```python
# Map phase
def map(document_id, text):
    for word in text.split():
        emit(word, 1)

# Shuffle & Sort (framework handles this)
# Groups: {"hello": [1,1,1], "world": [1,1], ...}

# Reduce phase
def reduce(word, counts):
    emit(word, sum(counts))
```

### Real-World MapReduce Patterns

| Pattern | Map Output | Reduce Operation | Example |
|---|---|---|---|
| Counting | `(key, 1)` | `sum(values)` | Page views, word count |
| Filtering | `(key, record)` if condition | Identity | Logs with error level |
| Grouping | `(group_key, record)` | `list(values)` | Users by country |
| Join (map-side) | Pre-partition both sides | Merge | Small table + large table |
| Join (reduce-side) | `(join_key, tagged_record)` | Combine tagged records | Large + large tables |
| Sorting | `(sort_key, record)` | Identity (framework sorts) | Top-N, ranking |
| Sessionization | `(session_id, event)` | Sort by timestamp, compute session | Clickstream analysis |

### Why MapReduce Declined (and What Replaced It)

| Limitation | Replacement |
|---|---|
| Disk-heavy; all intermediate results written to disk | **Spark** (in-memory) |
| Rigid map→reduce pipeline | **Spark** (DAG, any topology) |
| Complex job chaining | **Spark/Hive** (SQL or API) |
| High latency (batch-only) | **Flink/Kafka Streams** (stream-first) |
| No iteration support | **Spark** (cached RDDs/DataFrames) |

### Modern Relevance
MapReduce is rarely used directly today, BUT:
- Its **conceptual model** (partition → process → aggregate) underpins all distributed data systems
- Hadoop HDFS lives on as the data lake foundation
- YARN still manages resources in many clusters
- **Interview contexts**: Design a distributed grep, log analyzer, or ETL pipeline — knowing MapReduce patterns helps

---

## Apache Kafka {#kafka}

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    KAFKA CLUSTER                          │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Broker 1    │  │  Broker 2    │  │  Broker 3    │   │
│  │              │  │              │  │              │   │
│  │ Topic-A,P0,L │  │ Topic-A,P1,L │  │ Topic-A,P2,L │   │
│  │ Topic-B,P1,F │  │ Topic-B,P0,L │  │ Topic-B,P2,F │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                           │
│  L = Leader partition    F = Follower partition           │
└──────────────────────────────────────────────────────────┘
        ▲                        ▲
        │ write                  │ read
   ┌────┴────┐              ┌────┴────────────┐
   │Producer │              │  Consumer Group  │
   │         │              │  ┌──┐ ┌──┐ ┌──┐ │
   │ acks=all│              │  │C1│ │C2│ │C3│ │
   └─────────┘              │  └──┘ └──┘ └──┘ │
                            └─────────────────┘
```

### Core Concepts

**Topics & Partitions**
- A **topic** is a logical channel; each topic is split into **partitions**
- Partitions are the unit of **parallelism** (more partitions = more throughput)
- Each partition is an **ordered, immutable sequence** of records
- Messages are identified by **offset** within a partition

```python
# Kafka producer (Python, confluent-kafka)
from confluent_kafka import Producer

producer = Producer({'bootstrap.servers': 'localhost:9092'})

def delivery_callback(err, msg):
    if err:
        print(f'Delivery failed: {err}')
    else:
        print(f'Delivered to {msg.topic()} [{msg.partition()}] @ offset {msg.offset()}')

# Async produce with callback
producer.produce(
    topic='orders',
    key=str(order_id),          # Partitioning key
    value=json.dumps(order),    # Message body
    callback=delivery_callback
)
producer.flush()  # Block until all messages delivered
```

**Consumer Groups**
- Consumers in the same group divide partitions among themselves
- Each partition is consumed by exactly ONE consumer in a group
- When a consumer joins/leaves, **rebalancing** occurs
- Different consumer groups get their own copy of the data (pub/sub semantics)

```python
from confluent_kafka import Consumer

consumer = Consumer({
    'bootstrap.servers': 'localhost:9092',
    'group.id': 'order-processor-v2',
    'auto.offset.reset': 'earliest',  # Start from beginning if no offset
    'enable.auto.commit': False,      # Manual commit for exactly-once
})

consumer.subscribe(['orders'])

while True:
    msg = consumer.poll(1.0)  # Timeout in seconds
    if msg is None:
        continue
    if msg.error():
        print(f'Error: {msg.error()}')
        continue

    try:
        process_order(msg.value())
        # Commit offset ONLY after successful processing
        consumer.commit(message=msg)
    except Exception as e:
        # Don't commit — message will be retried
        print(f'Processing failed: {e}')
```

### Delivery Semantics

| Semantic | How | Trade-off |
|---|---|---|
| **At-most-once** | Auto-commit on receive; ignore failures | Data loss possible; fastest |
| **At-least-once** (default) | Process, then commit; retry on failure | Duplicate processing; idempotent consumers needed |
| **Exactly-once** | Transactions + idempotent producer + read→process→write→commit atomically | Highest overhead; requires idempotent downstream |

**Exactly-Once with Transactions (Kafka 0.11+)**

```python
producer = Producer({
    'bootstrap.servers': 'localhost:9092',
    'transactional.id': 'txn-orders-1',  # Stable across restarts
    'enable.idempotence': True,
})

producer.init_transactions()

# Consume-Transform-Produce loop
consumer = Consumer({
    'group.id': 'etl-group',
    'enable.auto.commit': False,
    'isolation.level': 'read_committed',  # Only read committed messages
})

try:
    producer.begin_transaction()
    
    # Consume messages, transform, produce to output topic
    for msg in batched_messages:
        result = transform(msg)
        producer.produce('output-topic', key=msg.key(), value=result)
    
    # Atomically: send consumer offsets to transaction
    producer.send_offsets_to_transaction(
        positions=[(TopicPartition('input-topic', 0), offset)],
        consumer_group_metadata=consumer.consumer_group_metadata()
    )
    
    producer.commit_transaction()
except Exception:
    producer.abort_transaction()
```

### Log Compaction
Log compaction retains the **latest value for each key**, deleting older entries with the same key. This turns Kafka into a **source of truth** (not just a transient pipe).

```
BEFORE COMPACTION:             AFTER COMPACTION:
Offset: 0  key=A, value=v1     Offset: 2  key=A, value=v3
Offset: 1  key=B, value=v2     Offset: 3  key=B, value=v2
Offset: 2  key=A, value=v3     Offset: 4  key=B, value=v4
Offset: 3  key=B, value=v2     Offset: 5  key=C, value=v5  (tombstone kept)
Offset: 4  key=B, value=v4
Offset: 5  key=C, value=v5
Offset: 6  key=C, null (tombstone)
```

**Use cases for log compaction:**
- Database CDC (Change Data Capture) — recover full state by replaying
- Event sourcing — rebuild aggregates from keyed event log
- Configuration distribution — latest config for each service

### Partition Sizing
- **Recommended**: 3-10 MB messages per partition
- **Rule of thumb**: throughput / partition: ~10-50 MB/s for typical hardware
- **Max partitions per broker**: ~4000 (ZooKeeper) / unlimited (KRaft)
- **Partition count formula**: `max(throughput / p_throughput, desired_consumer_parallelism, retention / p_capacity)`

### Kafka Interview Cheat Sheet
1. **Why Kafka over RabbitMQ/SQS?** Throughput (1M+ msg/s), durability (disk-backed retention), replayability (consumer-driven offset)
2. **Partition key selection**: High cardinality, uniform distribution = no hotspots
3. **Out-of-order messages**: Kafka guarantees order ONLY within a partition
4. **Rebalancing**: Consumers join/leave → stop-the-world rebalance; use Cooperative Rebalance (KIP-429) for incremental
5. **Exactly-once**: Requires idempotent producer + transactions + idempotent consumers

---

## Stream Processing {#stream-processing}

### Stream vs. Batch

| | Stream Processing | Batch Processing |
|---|---|---|
| **Data model** | Unbounded, infinite flow | Bounded, finite dataset |
| **Latency** | Milliseconds to seconds | Minutes to hours |
| **State** | Incremental, long-lived | Full re-computation |
| **Use cases** | Fraud detection, real-time dashboards | Daily reports, ETL, ML training |
| **Examples** | Kafka Streams, Flink, Spark Streaming | Spark, Hive, MapReduce |

### Kafka Streams

```python
# Conceptual: Kafka Streams topology (Java is canonical, but logic is portable)
# 
# Stream: input-topic
#   → filter: only high-value orders ($500+)
#   → groupBy: order type
#   → windowed aggregation: 5-min tumbling window count
#   → to: high-value-orders-counts

# Key concepts:
# - KStream: record stream (insert-only, each event)
# - KTable: changelog stream (upsert, latest value per key)
# - GlobalKTable: fully replicated on every instance (small, static data)
```

**Stateless operations:**
```python
# filter, map, flatMap, groupBy, branch, merge
orders = kafka_stream.from_topic('orders')
high_value = orders.filter(lambda o: o['amount'] >= 500)
enriched = high_value.map(lambda o: enrich_with_user(o))
```

**Stateful operations:**
```python
# join, aggregate, reduce, window
user_clicks = kstream.from_topic('clicks')
user_orders = kstream.from_topic('orders')

# Session window: group clicks into sessions (gap > 30 min = new session)
sessions = user_clicks.group_by_key() \
    .windowed_by(SessionWindows.with_inactivity_gap(30 * 60 * 1000)) \
    .count()

# Join clicks with orders (enrich user behavior)
enriched = user_orders.join(user_clicks, 
    joiner=lambda order, click: {**order, 'click_data': click},
    join_window=JoinWindows.of_time_difference_with_no_grace(60_000))
```

### Apache Flink
Flink is the gold standard for stateful stream processing with exactly-once guarantees.

**Key differentiators from Kafka Streams:**
- True exactly-once state (asynchronous distributed snapshots / Chandy-Lamport algorithm)
- Event-time processing with watermarks
- Savepoints (stop → upgrade Flink version → resume from exact point)
- Rich windowing: tumbling, sliding, session, global windows

**Watermarking:**
```
Event time:    12:00  12:01  12:02 12:05   12:03(wait)
                           ↓
Processing time: ─────────────────────────────→
                           ↑
                   watermark(12:02): no more events < 12:02 expected
                   → 12:00-12:02 window can be computed
```

### Spark Streaming (Structured Streaming)
- **Micro-batch model**: Processes data in small batches (100ms–few seconds)
- **Not true streaming** like Flink/Kafka Streams, but good enough for many use cases
- **Unified API**: Same code for batch and streaming (DataFrame API)
- **When to use**: Already in Spark ecosystem, latency tolerance ≥ 1 second

```python
# Spark Structured Streaming
df = spark.readStream \
    .format("kafka") \
    .option("kafka.bootstrap.servers", "localhost:9092") \
    .option("subscribe", "orders") \
    .load()

# Parse JSON, aggregate, write
parsed = df.select(from_json(df.value, schema).alias("data"))
metrics = parsed.groupBy(window("data.timestamp", "5 minutes"), "data.category") \
    .agg(count("*").alias("count"), avg("data.amount").alias("avg_amount"))

query = metrics.writeStream \
    .outputMode("append") \
    .format("console") \
    .trigger(processingTime="30 seconds") \
    .start()
```

### Stream Processing Decision Matrix

| Requirement | Best Choice |
|---|---|
| Lightweight, Kafka-native | Kafka Streams |
| True streaming, complex event time, stateful | Apache Flink |
| Spark ecosystem, unified batch+stream | Spark Structured Streaming |
| Simple log routing, minimal logic | Kafka Connect |
| SQL on streams, low learning curve | ksqlDB (built on Kafka Streams) |

---

## Batch Processing {#batch-processing}

### Apache Spark

**RDD → DataFrame → Dataset** (evolution of APIs):
- **RDD** (Resilient Distributed Dataset): Low-level, type-safe, JVM objects
- **DataFrame**: SQL-like, columnar, Catalyst optimizer
- **Dataset**: Type-safe + optimized (Scala/Java only)

```python
from pyspark.sql import SparkSession

spark = SparkSession.builder \
    .appName("DailyReport") \
    .config("spark.sql.adaptive.enabled", "true") \
    .getOrCreate()

# Lazy evaluation: nothing runs until an action
df = spark.read.parquet("s3://datalake/events/year=2026/month=5/")

# Transformations (lazy)
filtered = df.filter(df.event_type == "purchase")
aggregated = filtered.groupBy("user_id", "product_category") \
    .agg(F.sum("amount").alias("total_spent"),
         F.count("*").alias("purchase_count"))

# Action (triggers computation)
aggregated.write.mode("overwrite").parquet("s3://reports/daily_purchases/2026-05-19/")
```

**Spark Joins:**
| Join Type | Mechanism | When |
|---|---|---|
| Broadcast Hash Join | Small table sent to every executor | Table < 10MB (default broadcast threshold) |
| Sort Merge Join | Both tables shuffled by join key, sorted, merged | Large + large tables |
| Shuffle Hash Join | Shuffle by join key, hash join per partition | Large + medium (not default) |
| Broadcast Nested Loop | Cartesian product via broadcast | Cross join with small table |

### Apache Hive
SQL interface over Hadoop/HDFS data. Translates SQL to MapReduce/Tez/Spark jobs.

```sql
-- Hive table pointing to S3 data lake
CREATE EXTERNAL TABLE events (
    event_id STRING,
    user_id STRING,
    event_type STRING,
    payload STRING,
    ts TIMESTAMP
)
PARTITIONED BY (year INT, month INT, day INT)
STORED AS PARQUET
LOCATION 's3://datalake/events/';

-- Partition pruning: only scans relevant directories
SELECT event_type, COUNT(*)
FROM events
WHERE year = 2026 AND month = 5 AND day = 19
GROUP BY event_type;
```

**Hive Table Formats:**
| Format | Compression | Schema Evolution | Best For |
|---|---|---|---|
| Parquet | Columnar, excellent | Limited | Analytics, SQL queries |
| ORC | Columnar, best compression | Limited | Hive-optimized workloads |
| Avro | Row-based | Excellent | Streaming writes, schema registry |

---

## Data Warehouse Patterns {#data-warehouse}

### Star Schema
```
         ┌─────────────┐
         │  dim_date   │
         │ ─────────── │          FACT TABLE
         │ date_sk (PK)│       ┌─────────────────────┐
         │ full_date   │──────→│ fact_sales           │
         │ year        │       │ ─────────────────── │
         │ quarter     │       │ date_sk       (FK)  │
         │ month       │       │ product_sk    (FK)  │
         └─────────────┘       │ customer_sk   (FK)  │
                               │ store_sk      (FK)  │
         ┌─────────────┐       │ quantity             │
         │ dim_product │       │ revenue              │
         │ ─────────── │──────→│ cost                 │
         │ product_sk  │       │ margin               │
         │ name        │       └─────────────────────┘
         │ category    │                ↑
         │ brand       │      ┌─────────┴───────┐
         └─────────────┘      │ dim_customer/kg  │
                              │ dim_store/sg     │
                              └──────────────────┘
```

- **Facts**: Numeric measures (revenue, quantity) — optimized for aggregation
- **Dimensions**: Descriptive attributes (date, product, customer) — optimized for filtering/browsing
- **Join pattern**: `SELECT ... FROM fact JOIN dim ON fact.fk = dim.pk`

### Snowflake Schema
- Dimensions are **normalized** into hierarchies (e.g., product → category → brand = 3 tables)
- Less redundancy, more complex queries
- **When**: Storage is expensive; dimensions are very large; frequent dimension updates

### Data Lake vs. Lakehouse

| | Data Lake | Data Warehouse | Lakehouse |
|---|---|---|---|
| **Storage** | Object store (S3/HDFS) | Proprietary | Object store (S3/ADLS) |
| **Data format** | Raw: CSV, JSON, Parquet | Structured tables | Parquet, Delta, Iceberg |
| **ACID** | No | Yes | Yes (via table format) |
| **Schema** | Schema-on-read | Schema-on-write | Schema-on-read/write |
| **BI queries** | Slow | Fast | Fast (with optimizations) |
| **ML/AI** | Good | Limited | Good |
| **Example** | HDFS + Hive | Snowflake, Redshift, BigQuery | Databricks + Delta Lake |

**Modern Lakehouse Formats:**
```
Delta Lake (Databricks) → ACID, time travel, schema evolution, CDC
Apache Iceberg          → Partition evolution, hidden partitioning, Snap
Apache Hudi             → Upserts, incremental queries, record-level indexing
```

### Data Warehouse Interview Talking Points
1. **Star vs. Snowflake**: Star for query speed; Snowflake for storage efficiency
2. **Slowly Changing Dimensions (SCD)**:
   - Type 1: Overwrite (lose history)
   - Type 2: New row with effective dates (preserve history)
   - Type 3: Add previous-value column (limited history)
3. **ETL vs. ELT**: ETL transforms before loading (traditional), ELT loads raw then transforms (modern lake approach)
4. **Materialized views**: Pre-compute common aggregations — trade storage for query speed

---

## Message Queue Patterns {#message-queue}

### Persistence & Delivery Guarantees

```
                    Producer Message Lifecycle
                    ─────────────────────────
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌──────────┐
│ Produce  │───→│  Queue   │───→│   Consume    │───→│   ACK    │
│ (persist)│    │ (durable)│    │ (process)     │    │ (remove) │
└──────────┘    └──────────┘    └──────────────┘    └──────────┘
     │               │               │                    │
     │  At-least-once:               │ retry on NACK/     │
     │  producer retries on failure  │ timeout ───────────┘
     │                               │
     │  At-most-once:                │ no retry → message
     │  fire-and-forget              │ dropped silently
```

### Dead Letter Queue (DLQ)
Messages that repeatedly fail processing go to a DLQ — not back to the main queue.

```python
import json
from redis import Redis

def consume_with_dlq(message, max_retries=3):
    retry_count = message.get('x-retry-count', 0)
    
    try:
        process_message(message)
        # Success — acknowledge and remove
        acknowledge(message)
        
    except TransientError:
        # Retryable error — increment retry count
        if retry_count < max_retries:
            message['x-retry-count'] = retry_count + 1
            message['x-next-retry-at'] = time.time() + (2 ** retry_count) * 10  # Exponential backoff
            re_enqueue_with_delay(message)
        else:
            move_to_dlq(message, reason="max_retries_exceeded")
            
    except FatalError:
        # Non-retryable — straight to DLQ
        move_to_dlq(message, reason="fatal_error")

def move_to_dlq(message, reason):
    dlq_message = {
        'original': message,
        'reason': reason,
        'moved_at': time.time(),
    }
    redis.lpush('dlq:orders', json.dumps(dlq_message))
    
    # Alert / monitor
    increment_counter('dlq.orders', tags={'reason': reason})
```

### Idempotency Keys
Design consumers to handle duplicate messages safely.

```python
def process_order(order):
    idempotency_key = f"processed:order:{order['id']}"
    
    # Atomically check and set — only process once
    if redis.set(idempotency_key, '1', nx=True, ex=86400):
        # First time seeing this order
        create_order_in_db(order)
        send_confirmation_email(order)
    else:
        # Duplicate — skip processing
        logger.info(f'Duplicate order {order["id"]} skipped (idempotent)')
```

**Idempotency approaches:**
1. **Natural key**: Use order_id, transaction_id, event_id as deduplication key
2. **Version numbers**: Only apply update if `version = current_version + 1`
3. **Idempotent writes**: `UPSERT` (INSERT ... ON CONFLICT DO NOTHING)
4. **Idempotency key + downstream**: Pass a unique key and check downstream systems too

### Message Queue Comparison

| | Kafka | RabbitMQ | AWS SQS | GCP Pub/Sub |
|---|---|---|---|---|
| **Model** | Distributed log | Smart broker, dumb consumer | Fully managed queue | Fully managed |
| **Throughput** | 1M+ msg/s | ~20K msg/s | Unlimited (auto-scale) | Unlimited (auto-scale) |
| **Message order** | Per partition | Per queue (FIFO mode) | Standard: best-effort; FIFO: ordered | Per key ordering |
| **Replay** | Yes (seek offset) | No | No | No (pub/sub model; use Snapshot+Seek) |
| **Max message size** | 1 MB (default) | 128 MB (theoretical) | 256 KB | 10 MB |
| **DLQ** | Manual | Built-in | Built-in (redrive policy) | Built-in |
| **Best for** | Event streaming, CDC, high throughput | RPC-style messaging, complex routing | Simplicity, serverless | GCP ecosystem |

---

## Distributed Task Queues {#task-queues}

### Redis Sorted Sets for Delayed Tasks

```python
import time
from redis import Redis

class DelayedTaskQueue:
    """Distributed task queue with delayed execution using Redis sorted sets."""
    
    def __init__(self, redis_client: Redis, queue_name: str = 'tasks'):
        self.redis = redis_client
        self.delayed_key = f'{queue_name}:delayed'  # Sorted set: score = execute_at
        self.ready_key = f'{queue_name}:ready'        # List: tasks ready to process
        self.processing_key = f'{queue_name}:processing'
    
    def enqueue(self, task_data: dict, delay_seconds: int = 0):
        """Add a task, optionally with a delay."""
        task_id = task_data.get('id') or str(uuid.uuid4())
        task_data['id'] = task_id
        task_data['enqueued_at'] = time.time()
        
        execute_at = time.time() + delay_seconds
        
        if delay_seconds > 0:
            # Add to sorted set with execute_at as score
            self.redis.zadd(self.delayed_key, {json.dumps(task_data): execute_at})
        else:
            # No delay — push directly to ready list
            self.redis.lpush(self.ready_key, json.dumps(task_data))
        
        return task_id
    
    def poll_and_move(self):
        """Move tasks whose delay has expired from delayed → ready."""
        now = time.time()
        # ZRANGEBYSCORE: get all tasks with score <= now
        ready_tasks = self.redis.zrangebyscore(self.delayed_key, 0, now)
        
        if ready_tasks:
            # Atomically remove from delayed and add to ready
            pipeline = self.redis.pipeline()
            for task_json in ready_tasks:
                pipeline.lpush(self.ready_key, task_json)
                pipeline.zrem(self.delayed_key, task_json)
            pipeline.execute()
        
        return len(ready_tasks)
    
    def dequeue(self, worker_id: str, timeout: int = 5):
        """Worker: pop a task from the ready queue."""
        # BRPOPLPUSH (or LMOVE 6.2.0+): atomic pop + move to processing
        task_json = self.redis.brpoplpush(
            self.ready_key,
            f'{self.processing_key}:{worker_id}',
            timeout=timeout
        )
        if task_json:
            return json.loads(task_json)
        return None
    
    def acknowledge(self, worker_id: str, task_id: str):
        """Worker: confirm task completion."""
        # Remove from worker's processing list
        self.redis.lrem(f'{self.processing_key}:{worker_id}', 1, task_id)
    
    def requeue_stale(self, stale_timeout: int = 300):
        """Recover tasks from dead workers (stale > stale_timeout seconds)."""
        now = time.time()
        for worker_key in self.redis.keys(f'{self.processing_key}:*'):
            # Check worker heartbeat
            heartbeat = self.redis.get(f'worker_heartbeat:{worker_key}')
            if not heartbeat or (now - float(heartbeat)) > stale_timeout:
                # Worker is dead — requeue its tasks
                tasks = self.redis.lrange(worker_key, 0, -1)
                if tasks:
                    pipeline = self.redis.pipeline()
                    for task_json in tasks:
                        pipeline.lpush(self.ready_key, task_json)
                    pipeline.delete(worker_key)
                    pipeline.execute()
```

### Worker Implementation

```python
import threading

class TaskWorker:
    def __init__(self, queue: DelayedTaskQueue, worker_id: str):
        self.queue = queue
        self.worker_id = worker_id
        self.running = False
    
    def heartbeat_loop(self):
        """Send periodic heartbeat so other workers know we're alive."""
        while self.running:
            self.queue.redis.setex(
                f'worker_heartbeat:{self.queue.processing_key}:{self.worker_id}',
                30,  # TTL: 30 seconds
                time.time()
            )
            time.sleep(10)
    
    def start(self):
        self.running = True
        threading.Thread(target=self.heartbeat_loop, daemon=True).start()
        
        while self.running:
            task = self.queue.dequeue(self.worker_id)
            if task:
                try:
                    self.process(task)
                    self.queue.acknowledge(self.worker_id, task['id'])
                except Exception as e:
                    logger.error(f'Task {task["id"]} failed: {e}')
                    # Re-enqueue with backoff
                    retries = task.get('retries', 0)
                    if retries < 3:
                        task['retries'] = retries + 1
                        self.queue.enqueue(task, delay_seconds=2 ** retries * 5)
                    else:
                        # Move to DLQ
                        self.queue.move_to_dlq(task, str(e))
    
    def process(self, task: dict):
        """Override this method with actual task logic."""
        raise NotImplementedError
```

### Task Scheduling Patterns

| Pattern | Redis Structure | Use Case |
|---|---|---|
| **FIFO queue** | `LPUSH` + `BRPOP` | Simple job processing |
| **Priority queue** | Multiple sorted sets or `BZPOPMAX` | High/low priority tasks |
| **Delayed queue** | Sorted set (score = execute_at) | Retry with backoff, scheduled jobs |
| **Recurring jobs** | Cron-style: compute next fire time, ZADD | Periodic cleanup, reports |
| **Rate-limited queue** | Token bucket or leaky bucket via sorted sets | API call throttling |

### Production Considerations
- **Visibility timeout**: At-least-once delivery; if worker dies mid-task, task re-enters queue after timeout
- **Idempotency**: All consumers must handle duplicates (see [Message Queue Patterns](#message-queue))
- **Monitoring**: Queue depth, processing latency, DLQ size, worker count
- **Backpressure**: If `ready_key` grows too fast → slow down producers or scale workers
