# 04 — Caching: Strategies, Redis Production & CDN Architecture

## Table of Contents
1. [Cache Hierarchies](#hierarchies)
2. [Five Caching Strategies](#strategies)
3. [Cache Invalidation Patterns](#invalidation)
4. [Redis Production Configuration](#redis-production)
5. [CDN Architecture](#cdn)

---

## Cache Hierarchies {#hierarchies}

```
┌──────────────────────────────────────────────┐
│              BROWSER CACHE                    │
│  Cache-Control, ETag, Service Worker          │
│  Latency: 0ms (instant)                       │
├──────────────────────────────────────────────┤
│              CDN EDGE CACHE                   │
│  Cloudflare, Fastly, Akamai                   │
│  Latency: 10-50ms (regional PoP)              │
├──────────────────────────────────────────────┤
│           APPLICATION CACHE                   │
│  Redis, Memcached, in-memory hash map         │
│  Latency: <1ms (same DC)                      │
├──────────────────────────────────────────────┤
│            DATABASE CACHE                     │
│  PostgreSQL shared buffers, MySQL buffer pool │
│  Latency: <1ms (memory), 1-10ms (SSD)         │
├──────────────────────────────────────────────┤
│               DISK / S3                       │
│  Latency: 10ms (SSD), 100ms+ (HDD)            │
└──────────────────────────────────────────────┘
```

### Cache Hit Ratio Math
```
Latency_effective = HitRatio × Latency_cache + (1 - HitRatio) × Latency_origin

Example: 95% hit ratio, 1ms cache, 100ms DB:
  = 0.95 × 1ms + 0.05 × 100ms
  = 0.95 + 5 = 5.95ms (vs 100ms uncached = 16.8x improvement)
```

---

## Five Caching Strategies {#strategies}

### 1. Cache-Aside (Lazy Loading) — Most Common

```
App checks cache → MISS → App loads from DB → App stores in cache → Returns
App checks cache → HIT  → Returns immediately
```

```python
def get_user(user_id):
    # 1. Check cache
    cached = redis.get(f'user:{user_id}')
    if cached:
        return json.loads(cached)
    
    # 2. Cache miss — load from DB
    user = db.users.find_by_id(user_id)
    if user:
        # 3. Populate cache
        redis.setex(f'user:{user_id}', 3600, json.dumps(user))
    return user
```

**Pros**: Easy; only cache what's requested; cache failure doesn't break reads
**Cons**: Cache stampede on cold start; stale data possible; three trips on cache miss

### 2. Write-Through

```
App writes to cache → Cache synchronously writes to DB → Returns
App reads  from cache → Returns (cache always has latest)
```

```python
def update_user(user):
    # Write to cache first, cache writes to DB
    redis.setex(f'user:{user.id}', 3600, json.dumps(user))
    db.users.update(user)
```

**Pros**: Cache always consistent; no stale reads
**Cons**: Every write hits cache even if never read; write latency = cache + DB latency

### 3. Write-Behind (Write-Back)

```
App writes to cache → Returns immediately
                    → Cache asynchronously writes to DB (delayed)
```

```python
def update_user(user):
    redis.setex(f'user:{user.id}', 3600, json.dumps(user))
    # Enqueue to async writer
    write_queue.enqueue('update_user_db', user, delay_seconds=5)
```

**Pros**: Lowest write latency; can batch DB writes
**Cons**: Data loss risk if cache crashes before flush; consistency challenges

### 4. Read-Through

```
App reads from cache → MISS → Cache loads from DB → Stores → Returns
                     → HIT  → Returns immediately
```

The difference from cache-aside: **the cache library handles DB loading**, not the app.

```python
# Using read-through cache (e.g., RedisGears, custom provider)
cache = ReadThroughCache(redis_client, db_loader=load_user_from_db)

def get_user(user_id):
    return cache.get(f'user:{user_id}')  # Cache handles miss internally
```

**Pros**: Simpler app code; cache logic centralized
**Cons**: More complex cache setup; cache is "smart"

### 5. Refresh-Ahead

```
App reads from cache → HIT, but near expiry → Cache refreshes in background
```

```python
def get_user(user_id):
    key = f'user:{user_id}'
    ttl = redis.ttl(key)
    
    if ttl > 0 and ttl < 60:  # Less than 60 seconds until expiry
        # Trigger background refresh (don't block this request)
        thread_pool.submit(refresh_user_cache, user_id)
    
    cached = redis.get(key)
    if cached:
        return json.loads(cached)
    
    # Only blocking-load on complete miss or error
    return load_from_db_and_cache(user_id)
```

**Pros**: Prevents cache misses for hot keys; always low latency
**Cons**: More complex; wasted refreshes if key stops being read

### Strategy Selection Guide

| Strategy | Best For | Avoid For |
|---|---|---|
| Cache-Aside | General purpose; read-heavy | Write-heavy with strict consistency |
| Write-Through | Consistency-critical reads | Write-heavy; rarely-read data |
| Write-Behind | Write-heavy; can tolerate data loss | Financial/transactional data |
| Read-Through | Simplifying app code | When cache library complexity isn't justified |
| Refresh-Ahead | Hot keys that must never expire | Infrequently accessed keys |

---

## Cache Invalidation Patterns {#invalidation}

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

### 1. TTL (Time-to-Live) — Simplest
```python
redis.setex(f'user:{user_id}', ttl=3600, value=data)
```
**When**: All cached data, always. Set TTL even on write-through!

### 2. Event-Driven Invalidation
```python
# On user update event
def handle_user_updated(event):
    redis.delete(f'user:{event.user_id}')
    # Also invalidate derived caches
    redis.delete(f'user_profile:{event.user_id}')
```
**When**: When a write happens, immediately invalidate affected cache keys.

### 3. CAS (Check-and-Set) / Optimistic Locking
```python
# Redis with WATCH (optimistic locking)
def atomic_update_user(user_id, new_data):
    key = f'user:{user_id}'
    pipe = redis.pipeline()
    while True:
        try:
            pipe.watch(key)
            current = pipe.get(key)
            version = json.loads(current)['version']
            new_data['version'] = version + 1
            pipe.multi()
            pipe.set(key, json.dumps(new_data))
            pipe.execute()
            break
        except WatchError:
            continue  # Retry on conflict
```
**When**: Concurrent updates to the same cache key.

### 4. Cache Stampede Protection
```python
import threading

def get_with_lock(key, loader_fn, ttl=3600):
    cached = redis.get(key)
    if cached:
        return json.loads(cached)
    
    lock_key = f'{key}:lock'
    # Try to acquire lock (SET NX = set if not exists)
    if redis.set(lock_key, '1', nx=True, ex=10):
        try:
            # Only ONE thread loads from DB
            data = loader_fn()
            redis.setex(key, ttl, json.dumps(data))
            return data
        finally:
            redis.delete(lock_key)
    else:
        # Other threads: wait briefly, then retry cache
        time.sleep(0.1)
        return get_with_lock(key, loader_fn, ttl)
```

### 6. Negative Caching — Prevent Cache Penetration

**The attack (or accident):**
```
Attacker queries for 1,000,000 non-existent user IDs:
  GET /user/999999 → cache miss → DB query → null → cache miss
  GET /user/999998 → cache miss → DB query → null → cache miss
  ...1,000,000 queries...
→ Every single one hits the database
→ Database dies under load
```

**The fix: cache "doesn't exist":**
```python
def get_user(user_id):
    cache_key = f"user:{user_id}"
    cached = redis.get(cache_key)

    if cached == "NULL":      # Negative cache hit
        return None
    if cached:
        return deserialize(cached)

    user = db.query("SELECT * FROM users WHERE id = ?", user_id)

    if user:
        redis.setex(cache_key, 3600, serialize(user))   # 1 hour TTL
    else:
        redis.setex(cache_key, 60, "NULL")               # 1 minute TTL for nulls

    return user
```

**Why short TTL for negatives?**
- If the user IS created 10 seconds later, a 1-hour negative cache means they're invisible for 1 hour
- 30-60s: long enough to absorb an attack, short enough for real data to appear quickly

**Bloom filter alternative (for infinite key spaces):**
```python
from pybloom_live import BloomFilter

# Initialize: 10M keys, 0.1% false positive rate
bloom = BloomFilter(capacity=10000000, error_rate=0.001)

def user_exists_fast(user_id):
    """Check bloom filter first. If it says 'no', it's definitely no."""
    if user_id not in bloom:
        return False  # Definitely doesn't exist — skip DB entirely
    # Might exist — check cache, then DB
    return check_cache_then_db(user_id)
```

**When to use negative caching vs bloom filter:**
| Scenario | Use |
|----------|-----|
| Small, bounded key space (user IDs 1-10M) | ✅ Negative caching (simple) |
| Huge, unbounded key space (UUIDs, random IDs) | ✅ Bloom filter + rate limiting |
| DDoS protection for public endpoints | ✅ Rate limiting first, then negative caching |
| Internal service-to-service | ✅ Negative caching (trust the caller) |

### 5. Probabilistic Early Expiration (XFetch)
```python
def probabilistic_early_expire(ttl, delta=0.2):
    """With delta=0.2, randomly expires between 0.8*TTL and 1.0*TTL"""
    return ttl * (1 - delta * random.random())
```

---

## Redis Production Configuration {#redis-production}

### Memory Management
```conf
# redis.conf
maxmemory 4gb
maxmemory-policy allkeys-lru   # Evict any key by LRU when full

# Eviction policies:
# noeviction          — Error on writes (default; dangerous for caching!)
# allkeys-lru         — LRU across all keys (recommended for caching)
# allkeys-lfu         — LFU across all keys (4.0+)
# volatile-lru        — LRU on keys with TTL
# volatile-ttl        — Evict closest to expiry
# allkeys-random      — Random eviction
```

### Persistence: RDB vs AOF

| Feature | RDB (Snapshot) | AOF (Append-Only File) |
|---|---|---|
| How | Periodic full dump | Logs every write |
| Recovery speed | Fast | Slower (replay log) |
| Data loss | Last snapshot window | Minimal (fsync policy driven) |
| File size | Compact | Can grow large (use rewrite) |
| **Recommendation** | Both! Use AOF for durability, RDB for fast restarts | |

### Redis Cluster
```
┌──────────────────────────────────┐
│      Redis Cluster (3+ nodes)    │
│  ┌─────────┐ ┌─────────┐ ┌──────┐│
│  │Master A │ │Master B │ │Master││
│  │Slots    │ │Slots    │ │Slots ││
│  │0-5460   │ │5461-10922│ │10923-│ │
│  └────┬────┘ └────┬────┘ └──┬─────┘│
│  ┌────┴────┐ ┌────┴────┐ ┌──┴─────┐│
│  │Slave 1A │ │Slave 1B │ │Slave 1C││
│  └─────────┘ └─────────┘ └────────┘│
└──────────────────────────────────┘
```
- **16384 hash slots**, distributed across masters
- **Automatic failover**: Slave promoted when master fails
- **Client must be cluster-aware**: redirects on MOVED errors
- **Limitations**: No multi-key operations across slots (use hash tags: `{user:42}:profile`)

### Redis Sentinel (High Availability)
```conf
# sentinel.conf
sentinel monitor mymaster 192.168.1.100 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
sentinel parallel-syncs mymaster 1
```
- **Quorum-based failover**: `sentinel monitor` with quorum count
- **Auto-discovery**: Clients connect to Sentinel to discover current master
- **Use Sentinel when**: You need HA without sharding (smaller scale than Cluster)

### Production Checklist
- ✅ Set `maxmemory` + eviction policy
- ✅ Set `requirepass` or use `renamed-commands` for dangerous commands
- ✅ Disable `CONFIG`, `FLUSHALL`, `FLUSHDB`, `KEYS` in production
- ✅ Use TLS (`tls-port`) if Redis is exposed
- ✅ Monitor with `INFO` command: `used_memory`, `evicted_keys`, `hit_rate`
- ✅ Set `tcp-keepalive`, `timeout` for connection management
- ✅ Use connection pooling in clients

---

## CDN Architecture {#cdn}

### Request Flow
```
User (Tokyo)              CDN Edge (Tokyo)              Origin (US-East)
    │                           │                           │
    │── GET /image.jpg ────────→│                           │
    │                           │── Cache HIT?              │
    │                           │── YES → Serve from cache  │
    │←─ 200 OK (10ms) ─────────│                           │
                                  OR
    │                           │── Cache MISS              │
    │                           │                           │── GET /image.jpg ──→│
    │                           │                           │←── 200 (100ms) ─────│
    │                           │── Store in cache          │
    │←─ 200 OK (~110ms) ────────│                           │
```

### Cache-Control Headers for CDN
```http
# Static assets (long cache, immutable)
Cache-Control: public, max-age=31536000, immutable

# Dynamic API responses (short cache, revalidate)
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600

# Never cache (auth-required pages)
Cache-Control: private, no-cache, no-store, must-revalidate
```

### Surrogate Keys (Tag-Based Purging)
```http
# Origin response
Surrogate-Key: product-42 category-shoes homepage

# Purge: remove all cached objects tagged with "product-42"
# Fastly/Cloudflare: PURGE with Surrogate-Key header
```

### DDoS Protection at CDN
- **Rate limiting**: Per-IP, per-path, per-JS-challenge
- **Bot detection**: JS challenge, CAPTCHA
- **Layer 3/4**: SYN flood protection, IP blocking
- **Layer 7**: WAF rules, SQL injection, XSS filtering
- **Anycast**: Distribute attack across global network

### Edge Authentication
```
┌─────────────────────────────────────────┐
│            CDN Edge                     │
│  ┌──────────────────────────────────┐  │
│  │ @edge_auth (Fastly C@E/VCL)      │  │
│  │ 1. Validate JWT/signed URL       │  │
│  │ 2. Redirect to login if invalid  │  │
│  │ 3. Attach user context headers   │  │
│  └──────────────────────────────────┘  │
│  ┌──────────────────────────────────┐  │
│  │ @edge_compute (Cloudflare Workers)│  │
│  │ A/B testing, geo-redirect,       │  │
│  │ header modification, auth check  │  │
│  └──────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### CDN Provider Comparison

| Feature | Cloudflare | Fastly | AWS CloudFront | Akamai |
|---|---|---|---|---|
| Edge compute | Workers (JS) | Compute@Edge (WASM) | Lambda@Edge, CloudFront Functions | EdgeWorkers |
| Instant purge | ✓ (global ~5s) | ✓ (instant) | ✓ (takes minutes) | ✓ (seconds) |
| WAF | Included (all plans) | Add-on | AWS WAF integration | Enterprise |
| Surrogate keys | Via Cache-Tag | Surrogate-Key | ❌ (need custom invalidation)| Via EdgeTags |
| Free tier | Generous | $50 credit | 1 TB/month | Enterprise only |
| **Best for** | Zero-cost start, WAF | Instant purge, VCL power | AWS ecosystem | Enterprise global scale |
