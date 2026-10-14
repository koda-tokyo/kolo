# Performance Engineering — Profiling, Optimization, Capacity

## The Methodology (Gregg, 2013 — Netflix)

Performance is not magic. It is measurement. The utilization-saturation-errors (USE) method:

```
For every resource (CPU, memory, disk, network):
- Utilization: How busy is it? (average over time, but also peaks)
- Saturation: How much work is waiting? (queue depth)
- Errors: How many operations failed?
```

**The golden rule:** Don't guess. Measure. The bottleneck is never where you think it is.

---

## Linux Performance Observability

### The 60-Second Checklist (Brendan Gregg)
```
uptime                           # Load averages (1, 5, 15 min)
dmesg -T | tail                  # Recent kernel errors (OOM, disk errors)
vmstat -SM 1                     # run queue, memory, swap, I/O
mpstat -P ALL 1                  # Per-CPU usage
pidstat 1                        # Per-process usage
iostat -sxz 1                    # Disk utilization, queue, await
free -m                          # Memory overview
sar -n DEV 1                     # Network throughput, errors
sar -n TCP,ETCP 1                # TCP stats (active/passive, retrans)
top / htop                       # Process overview + interactive
```

### Flame Graphs
```
Profile (perf record, sampling at 99Hz for 30s) →
Stack traces aggregated →
Flame graph: x-axis = proportion of samples, y-axis = stack depth
Wide bar = hot function. Look for the widest bars at the top.
```

**For us:** Deploy `perf` and flame graph tooling in production. When something is slow, capture 30s profile. The answer is in the flame graph.

### perf — The Universal Profiler
```bash
perf record -F 99 -ag -- sleep 30    # sample CPU at 99Hz for 30s
perf report --stdio                  # top functions
perf script | stackcollapse-perf | flamegraph > flame.svg  # generate flame graph

perf stat -e cache-misses,cache-references,instructions,cycles ./my-program
perf top                             # live profiling (like htop but for profiling)
```

### CPU Performance Counters
```
cycles:            CPU cycles
instructions:      Instructions retired
IPC:               Instructions per cycle (>1 = good, <0.5 = memory-bound)
cache-misses:      Last-level cache misses
branch-misses:     Mispredicted branches
```

**IPC < 0.5:** CPU is starving for data (memory-bound). Optimize data layout, cache locality.
**IPC > 2.0:** CPU is executing efficiently. Look for algorithmic improvements.

---

## Common Bottlenecks by Symptom

### CPU-Bound
```
Symptom: high CPU utilization, high load average, low I/O wait
Causes:  computation, serialization/deserialization, JIT compilation,
         regex on large inputs, tight loops
Tools:   perf top, flame graphs, strace -c
Fixes:   algorithm improvement, caching, precomputation, parallelism
```

### Memory-Bound
```
Symptom: high memory usage, swap activity, OOM kills
Causes:  memory leaks, large allocations, cache bloat, unbounded collections
Tools:   valgrind --tool=memcheck, heaptrack, /proc/PID/smaps, pmap
Fixes:   fix leaks, limit caches, pagination, streaming instead of loading
```

### I/O-Bound (Disk)
```
Symptom: high iowait, high await in iostat, low CPU utilization
Causes:  random I/O, fsync-heavy workloads, small writes, fragmentation
Tools:   iostat -sxz 1, iotop, blktrace (block-level tracing), lsof
Fixes:   SSDs (NVMe), batch writes, WAL (sequential writes), RAID for read parallelism
```

### I/O-Bound (Network)
```
Symptom: high latency, low throughput, connection timeouts
Causes:  chatty protocols, missing connection pooling, serial processing
Tools:   ss -tpin, tcpdump, tcptrace, wrk (HTTP benchmark), iperf3
Fixes:   connection pooling, batching requests, HTTP/2 multiplexing,
         gRPC streaming, gzip/brotli compression
```

---

## Database Performance

### Query Tuning Methodology
```
1. Enable slow query log (log queries > threshold, e.g., 100ms)
2. EXPLAIN ANALYZE the slow query
3. Look for:
   - Seq Scan on large tables → need index
   - Nested Loop on large relations → need hash/merge join or index
   - High rows estimated vs actual → statistics outdated (ANALYZE)
   - Sort spilling to disk → increase work_mem
4. Add index, update statistics, or rewrite query
5. Verify with EXPLAIN ANALYZE again
```

### Index Selection
```
Query: SELECT * FROM patients WHERE clinic_id = 5 AND created_at > '2026-01-01'

Option A: CREATE INDEX ON patients (clinic_id, created_at);
  → Good: both conditions filter by index
  → Better: if clinic_id is the dominant filter

Option B: CREATE INDEX ON patients (created_at, clinic_id);
  → Good for 'created_at >' filter first, then filter clinic_id
  → Better: if created_at is the more selective filter (fewer rows match)

Rule: Equality columns first, range columns last.
```

### work_mem Tuning (PostgreSQL)
```
work_mem = memory per operation (sort, hash table), not per query.
One query can use work_mem multiple times → effective usage = work_mem × operations

Formula: work_mem = (available_memory - shared_buffers) / (max_connections × 4)
Example: 16GB available, 128MB shared_buffers, 50 connections
→ (16GB - 0.125GB) / (50 × 4) ≈ 81MB per work_mem
→ Round down to 64MB
```

---

## Capacity Planning

### Queuing Theory Basics
```
M/M/1 queue (Markovian arrivals, Markovian service, 1 server):
Utilization ρ = arrival_rate × service_time
Mean queue length = ρ / (1 - ρ)
Mean response time = service_time / (1 - ρ)
```

**The critical insight:**
```
ρ = 0.5 → mean queue = 1       (manageable)
ρ = 0.8 → mean queue = 4       (getting slow)
ρ = 0.9 → mean queue = 9       (degraded)
ρ = 0.95 → mean queue = 19      (users notice)
ρ = 0.99 → mean queue = 99      (effectively down)
```
**Never run above 80% utilization for latency-sensitive services.** The queue explodes non-linearly.

### Little's Law
```
L = λ × W
L: Average number of requests in system
λ: Average arrival rate
W: Average time in system

Example: 100 req/s, average latency 50ms
→ L = 100 × 0.05 = 5 requests in-flight on average
→ Need at least 5 concurrent handlers
```

### Capacity Headroom
```
Sustain: can handle peak-hour traffic
N+1: can handle 1 node failure without degradation
N+2: can handle 1 node failure + maintenance simultaneously
Black Friday: can handle 3× normal peak (for consumer products)
```

### Back-of-Envelope Calculations
```
1 day  = 86,400 seconds (~10^5)
1 request/s × 1 day  = ~100K requests/day
1 request/s × 1 month = ~2.5M requests/month
1 request/s × 1 year = ~31.5M requests/year

1 Gbps → ~125MB/s (accounting for overhead)
100MB file over 1Gbps → ~0.8s (theoretical), ~1s (practical)

1 CPU core at 100% = can process ~10K-100K simple requests/s
Database transaction = ~1-10ms on SSD (100-1000 TPS per connection)
```

---

## Load Testing

### Methodology
```
1. Establish baseline (current performance)
2. Load test at 50% expected peak → no issues?
3. Load test at 100% expected peak → no issues?
4. Load test at 150% expected peak → where's the bottleneck?
5. Soak test (100% peak for 24h) → memory leak? GC pause? connection leak?
6. Spike test (0% → 200% instantly) → how does autoscaling respond?
```

### Tools
```
wrk2: HTTP benchmarking with constant throughput (not just "as fast as possible")
  wrk2 -t4 -c100 -d60s -R1000 --latency https://example.com/api
  
k6 (Grafana): Scriptable load testing (JavaScript), CI-friendly
  export default function() { http.get('https://example.com/api'); }
  k6 run --vus 100 --duration 60s test.js

vegeta: HTTP load testing tool (Go), constant-rate attack
  echo "GET https://example.com" | vegeta attack -rate=1000 -duration=60s | vegeta report
```

---

## Optimization Patterns

### Caching Strategy
```
Cache-Aside (most common):
  1. Check cache → miss?
  2. Load from database → write to cache
  3. Return value
  ⚠️ Stale cache unless TTL or invalidation
  ✓ Cache is not critical path (can survive cache failure)

Write-Through:
  1. Write to cache AND database simultaneously
  ✓ Cache is always up to date
  ⚠️ Every write pays cache write penalty

Write-Behind:
  1. Write to cache → acknowledge
  2. Async flush to database
  ✓ Lowest write latency
  ⚠️ Data loss if cache dies before flush
```

### Batching
```
Instead of: for item in items { INSERT item; }
Do:         INSERT INTO table SELECT * FROM unnest($1::items[]);
→ 100-1000× reduction in round-trips
```

### Lazy Loading / Deferral
```
Don't compute on write what you can compute on read.
Don't compute on read what you can never compute at all.
→ Move expensive work to async jobs when possible
→ Show stale data with refresh button rather than blocking
```
