# Systems Engineering — OS, Networking, Containers

## The MIT / UC Berkeley Lineage

6.828 (MIT's OS course) produced xv6 and generations of systems programmers. Berkeley's CS 162 and the work of David Patterson, Eric Brewer, and Ion Stoica defined modern systems thinking. The key insight: you cannot debug what you cannot see. Systems engineering is the craft of making the invisible visible.

---

## Operating System Fundamentals

### The Memory Hierarchy (Latency Numbers Every Engineer Must Know)
```
Operation                        Latency (approx)    Scale
L1 cache reference               0.5 ns              —
L2 cache reference               7 ns                14× L1
L3 cache reference               20 ns               3× L2
Main memory reference            100 ns              5× L3
NVMe SSD (sequential)            10 μs               100× memory
Network (same DC, round-trip)    500 μs              50× NVMe
Disk seek                        10 ms               20× network
Network (cross-continent)        150 ms              15× disk
```

**The numbers to memorize:** Memory is ~1,000× faster than NVMe. Same-DC network is ~1,000× faster than cross-continent. A cache miss costs 100ns; a page fault costs 10ms (100,000× slower).

### Virtual Memory
```
Virtual address → Page Table → Physical address
Page size: 4KB (standard), 2MB (huge pages), 1GB (gigantic pages)

TLB (Translation Lookaside Buffer): Hardware cache for page table entries.
TLB miss → walk page table in memory (4-5 memory accesses on x86-64, 4-level paging)
```

**Huge Pages:** 2MB pages → 512× fewer TLB entries needed for same memory. Critical for databases and memory-intensive workloads. PostgreSQL recommends `huge_pages = on`.

### CPU Scheduling (Linux CFS — Completely Fair Scheduler)
```
Each task has vruntime (virtual runtime).
vruntime accumulates as task runs, weighted by priority (nice value).
CFS always runs the task with the smallest vruntime.
→ Fair CPU distribution over time.
→ Nice -20: runs more (slower vruntime accumulation)
→ Nice +19: runs less (faster vruntime accumulation)
```

**For us:** CPU-intensive services (compression, encoding, ML inference) run at default nice. Latency-sensitive services (API server) may benefit from higher scheduling priority.

### I/O Models
```
Blocking:         read() blocks thread until data ready
Non-blocking:     read() returns EAGAIN if no data, try again later (polling)
I/O Multiplexing: select/poll/epoll — one thread monitors many FDs
Signal-driven:    SIGIO when ready (rarely used)
Async I/O:        aio_read() — kernel notifies when complete (io_uring on Linux)

io_uring (Linux 5.1+, Jens Axboe): Shared ring buffers between kernel and userspace.
No syscall for submission/completion. Up to 6M IOPS.
```

**For us:** API servers use epoll (via libuv in Node.js, Netty in Java, Tokio in Rust). Databases use io_uring for maximum I/O throughput.

---

## TCP/IP — The Protocols That Run Everything

### TCP State Machine (Critical States)
```
LISTEN → SYN_RCVD (received SYN, sent SYN+ACK) → ESTABLISHED
ESTABLISHED → FIN_WAIT_1 (sent FIN) → FIN_WAIT_2 → TIME_WAIT → CLOSED
                                        ↑
                                    CLOSE_WAIT
```

**TIME_WAIT:** 2×MSL (Maximum Segment Lifetime, typically 60s = 2 min). Prevents delayed segments from old connection being confused with new connection. Connections in TIME_WAIT consume a port. Too many → port exhaustion.

**CLOSE_WAIT (the leak):** Server received FIN, hasn't called close(). Application bug. Connections accumulate until file descriptor limit. Monitor: `ss -tan state close-wait`.

### TCP Congestion Control
```
Slow Start: cwnd starts small (10 segments), doubles every RTT
Congestion Avoidance: cwnd grows linearly after hitting ssthresh
Fast Retransmit: 3 duplicate ACKs → retransmit without waiting for timeout
Fast Recovery: Don't go back to slow start after fast retransmit
```

**Modern algorithms:** BBR (Google, 2016) — models the pipe (bottleneck bandwidth + RTT). CUBIC (Linux default) — cubic function for window growth. BBR generally better for high-bandwidth, high-latency paths.

### TCP Tuning for Services
```bash
# Increase buffer sizes for high-throughput services
net.core.rmem_max = 16777216   # 16MB max read buffer
net.core.wmem_max = 16777216   # 16MB max write buffer
net.ipv4.tcp_rmem = "4096 87380 16777216"  # min default max
net.ipv4.tcp_wmem = "4096 65536 16777216"

# Fast reuse of TIME_WAIT sockets (BEHIND a load balancer only)
net.ipv4.tcp_tw_reuse = 1

# TCP Fast Open (TFO) — eliminate one RTT on reconnect
net.ipv4.tcp_fastopen = 3  # client + server
```

### DNS Deep Cuts
```
TTL != refresh guarantee. Clients and intermediate resolvers may ignore TTL.
A record: IPv4. AAAA: IPv6.
CNAME: Alias to another domain (resolved by client).
SRV: Service record (host + port for a service).
```

**The 5-second DNS timeout:** If a DNS server is down, most resolvers wait 5s before trying the next. Cascading DNS failures are catastrophic. Always have redundant DNS providers on different infrastructure.

---

## eBPF — Programmable Kernel

eBPF (extended Berkeley Packet Filter) allows running sandboxed programs in the kernel without changing kernel source or loading modules.

**What eBPF enables:**
- Observability: trace any kernel or userspace function without code changes
- Networking: XDP (eXpress Data Path) — process packets at 10M+ pps per core
- Security: syscall filtering, process monitoring (Falco, Cilium)

**For us:**
- Trace slow database queries at the kernel level (which system calls are blocking?)
- Monitor all network connections (`bpftrace -e 'kprobe:tcp_connect { printf("%s\n", comm); }'`)
- Detect anomalies (process opening unexpected files/connections)

---

## Container Internals

### Containers Are Not VMs
Containers share the host kernel. They use kernel features, not hardware virtualization.

**Namespaces (What a container CAN see):**
```
PID namespace:    isolated process tree (PID 1 in container ≠ PID 1 on host)
Network namespace: isolated network stack (own interfaces, routes, iptables)
Mount namespace:  isolated filesystem
UTS namespace:    isolated hostname
IPC namespace:    isolated SysV IPC, POSIX message queues
User namespace:   isolated UID/GID (root in container != root on host)
```

**Cgroups (What a container CAN DO):**
```
cpu.max:       CPU usage limit (e.g., "200000 100000" = 2 CPUs)
memory.max:    Memory limit (exceeding → OOM kill)
memory.high:   Soft limit (throttle allocation, don't kill — prefer this)
blkio:         Block I/O limits
pids.max:      Maximum number of processes
```

**Cgroup v2 (unified hierarchy):**
```
/sys/fs/cgroup/system.slice/docker-<container-id>.scope/
  memory.current    → current memory usage
  memory.max        → hard limit
  memory.high       → soft limit (throttle, don't OOM)
  cpu.weight        → relative CPU weight (replaces cpu.shares)
  pids.current      → current process count
```

### Container Security Boundaries
**NEVER assume containers are security boundaries (unless using Kata Containers/Firecracker).** The shared kernel is the attack surface. Kernel exploits → container escape.

**Best practices:**
- Run as non-root (USER directive)
- Read-only rootfs when possible
- Drop all capabilities, add back only needed ones (`--cap-drop=ALL --cap-add=NET_BIND_SERVICE`)
- No privileged containers in production
- seccomp profiles to limit allowed syscalls
- AppArmor/SELinux profiles

---

## Filesystem Performance

### The Write Amplification Problem
```
Application: write 4KB
Filesystem journal: write 4KB (metadata journal)
Filesystem: write 4KB (actual data)
SSD FTL: write 4KB (flash translation layer → remaps to different physical block)
→ 3 writes for 1 logical write
```

### Filesystem Choices
```
ext4: Stable, reliable, universal. Default for most Linux.
XFS:  Better for large files, high concurrency (Red Hat default).
btrfs: Copy-on-write, snapshots, compression, data checksums. Good for containers (Docker driver).
ZFS:  Everything btrfs does, more mature, higher memory requirements. The gold standard for data integrity.
```

**For us (KoLo):** ZFS for data storage pools (compression, snapshots, checksums). ext4 for boot/OS. XFS for database storage on VMs.
