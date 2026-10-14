# Networking — The Missing Layer

> **Why this section exists:** A platform engineering review flagged networking as the single biggest gap in system-design-mastery. You can't design distributed systems without understanding the network they run on.

## TCP Fundamentals

### Three-Way Handshake

```
Client                    Server
  | ---- SYN (seq=x) ------> |
  | <-- SYN-ACK (seq=y, ack=x+1) -- |
  | ---- ACK (ack=y+1) ----> |
  |         CONNECTED         |
```

Every TCP connection costs one round-trip. In a same-datacenter deployment, that's ~250 μs. Cross-region, maybe 50-150 ms. This overhead is why connection pooling exists.

### TIME_WAIT — The Silent Killer

After closing a connection, the active closer enters TIME_WAIT for **2 × MSL** (Maximum Segment Lifetime, typically 60s → 2 minutes). During TIME_WAIT, that port tuple (src_ip, src_port, dst_ip, dst_port) cannot be reused.

**Why this matters:** If you're making 50,000 short-lived connections from a single IP to a single destination, you need 50,000 unique source ports. There are only ~28,000 usable ephemeral ports. In 2 minutes, you exhaust them.

**Solution:** Connection pooling. Reuse connections. Don't open new ones per request.

```bash
# Linux: check TIME_WAIT count
ss -tan state time-wait | wc -l

# Tune ephemeral port range
sysctl net.ipv4.ip_local_port_range="1024 65535"

# Enable reuse (careful: can cause issues with NAT)
sysctl net.ipv4.tcp_tw_reuse=1
```

### SYN Queue and Backlog

```
Incoming SYNs → SYN Queue (size: net.core.somaxconn)
                  ↓
              Backlog per socket (listen(fd, backlog))
                  ↓
              Accept Queue
```

**When SYN queue overflows:** new SYNs are dropped. Clients see connection timeouts. `ss -s` shows `SYN-RECV` count.

```bash
# Check current SYN backlog drops
netstat -s | grep -i listen

# Tune
sysctl net.core.somaxconn=4096
sysctl net.ipv4.tcp_max_syn_backlog=8192
```

## Connection Pooling

### Why Pool?

| Without pooling | With pooling |
|----------------|-------------|
| New handshake per request | Reuse existing connections |
| TIME_WAIT accumulation | Steady-state connections |
| ~250 μs + TLS overhead per request | ~0 μs connection overhead |
| Port exhaustion under load | Bounded port usage |

### Pool Configuration — The Six Knobs

```
max_connections:    max pool size
min_connections:    idle floor (keep warm)
idle_timeout:       close after N seconds idle
max_lifetime:       close after N seconds regardless (rotates connections)
connection_timeout: how long to wait for a connection from pool
health_check:       validate before lending
```

**Rule of thumb:**
- `idle_timeout` = 600s (10 min) — typical LB idle timeout is 300-600s
- `max_lifetime` = 3600s (1 hr) — rotates before server-side issues accumulate
- `idle_timeout` < load balancer idle timeout — prevents "connection reset by peer"
- `max_lifetime` < server `wait_timeout` — MySQL defaults to 8 hours

### Keepalives at Every Layer

```
Layer              Mechanism
TCP                SO_KEEPALIVE, tcp_keepalive_time (default 7200s!)
HTTP/1.1           Keep-Alive header, persistent connections
HTTP/2             Built-in multiplexing (one connection, many streams)
gRPC               HTTP/2 keepalive (GRPC_ARG_KEEPALIVE_TIME_MS)
Database           Connection pool validation query (SELECT 1)
Load Balancer      Health checks (TCP or HTTP)
```

**Critical:** Default Linux TCP keepalive is **2 hours**. Always tune:
```bash
# Reduce to 5 minutes
sysctl net.ipv4.tcp_keepalive_time=300
sysctl net.ipv4.tcp_keepalive_intvl=60
sysctl net.ipv4.tcp_keepalive_probes=5
```

## DNS

### Resolution Chain

```
App → OS stub resolver → DNS cache (systemd-resolved/nscd) → Recursive resolver → Root → TLD → Authoritative
```

Every uncached DNS lookup is ~20-50 ms. Cached: ~0 ms.

### Common Failure Modes

| Failure | Cause | Mitigation |
|---------|-------|-----------|
| Timeout (5s+) | Nameserver unreachable | Multiple nameservers, caching |
| SERVFAIL | Authoritative server error | Retry with backoff |
| NXDOMAIN | Domain doesn't exist | Negative caching |
| Stale cache | High TTL during migration | Lower TTL before migration, dual-run |

### DNS in Production

- **Always set more than one nameserver.** `/etc/resolv.conf` with `nameserver` entries + `options timeout:1 attempts:2 rotate`
- **Use short TTLs for dynamic endpoints** (30-60s for load balancer DNS)
- **Negative caching:** systemd-resolved caches NXDOMAIN for `negative-ttl` seconds
- **A vs AAAA:** If your app tries IPv6 and your network doesn't support it, you get 2-second Happy Eyeballs fallback. Prefer dual-stack or explicitly disable AAAA lookups if IPv6 is unsupported.

```bash
# Check DNS resolution time
dig google.com +stats | grep "Query time"

# Flush DNS cache
systemd-resolve --flush-caches
```

## Network Timeouts

**The Golden Rule:** Always set all three. Never use infinity.

```
connect_timeout:  how long to wait for TCP handshake (typically 3-10s)
read_timeout:     how long to wait for data after connected (typically 30-60s)
write_timeout:    how long to wait while writing (typically 30-60s)
```

**Hierarchy:** `connect_timeout` < `read_timeout`. A connection that takes 30s to establish is broken. A response that takes 30s might just be slow.

### Per-Layer Timeout Values

| Layer | Connect | Read | Notes |
|-------|---------|------|-------|
| HTTP client | 3-5s | 30s | Total request = connect + read |
| gRPC | 5s | Deadline-driven | Set deadline, not read timeout |
| Database pool | 3s | 30s | `connect_timeout` in pool config |
| Redis | 2-3s | 5s | Redis is fast, short timeouts okay |
| Between services | 3s | 30s | Tune per endpoint latency |

### The Timeout Budget

For a request that fans out to 3 downstream services:

```
Total client timeout: 3s
  Service A: 2s timeout
  Service B: 2.5s timeout
  Service C: 1s timeout

Any service exceeding its budget → fail fast, return partial or error.
```

**The rule:** sum of all downstream timeouts < client timeout. Otherwise you time out the client while services are still working — wasted compute.

## Load Balancer Health Checks

```
LB → /health endpoint → 200 OK (or TCP SYN → SYN-ACK)
```

| Type | What it checks | When to use |
|------|---------------|-------------|
| TCP | Port is open | Simple services |
| HTTP GET /health | App is responding | Most web services |
| HTTP GET /health/deep | App + DB + cache alive | Critical paths |

**Configuration:**
- Interval: 5-10s
- Timeout: 2-5s
- Unhealthy threshold: 2-3 consecutive failures
- Healthy threshold: 2-3 consecutive successes

**Too-aggressive health checks** cause thundering herd on recovery. **Too-lax** means serving traffic to dead instances.

---

## Quick Debugging Commands

```bash
# What's listening?
ss -tlnp

# Connection count per state
ss -tan | awk '{print $1}' | sort | uniq -c

# DNS resolution time
time getent hosts google.com

# Trace DNS resolution
dig +trace example.com

# Check TCP retransmissions
netstat -s | grep retrans

# Network latency to destination
ping -c 10 target.host
mtr target.host  # combines ping + traceroute

# Bandwidth between hosts
iperf3 -c target.host
```
