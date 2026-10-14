#!/usr/bin/env python3
"""System Design Mastery — Capacity Planning Calculator."""
import sys

# Reference numbers
LATENCY_REF = {
    "L1 cache": "0.5 ns",
    "L2 cache": "7 ns",
    "Main memory": "100 ns",
    "SSD random read": "16 µs",
    "1KB over 10Gbps": "1 µs",
    "1MB sequential SSD": "50 µs",
    "Same-DC round trip": "250 µs",
    "1MB sequential HDD": "2 ms",
    "CA→NL→CA": "150 ms",
}
THROUGHPUT_REF = {
    "Single Redis": "100K-200K ops/s",
    "Single PostgreSQL": "2K-10K txn/s",
    "Nginx static": "50K+ req/s",
    "Single Node.js": "5K-15K req/s",
    "Single Go": "50K+ req/s",
    "Kafka broker": "100K+ msg/s",
}

def ask(prompt, default=None):
    val = input(f"{prompt}: ").strip()
    if not val and default is not None:
        return default
    return val

def main():
    print("=" * 60)
    print("  CAPACITY PLANNING CALCULATOR")
    print("=" * 60)
    print()

    try:
        dau = float(ask("Daily active users", "1000000"))
        rpu = float(ask("Requests per user per day", "20"))
        req_kb = float(ask("Average request size (KB)", "5"))
        retention_months = float(ask("Data retention (months)", "36"))
    except (ValueError, EOFError):
        print("Invalid input.")
        sys.exit(1)

    daily_requests = dau * rpu
    req_per_sec = daily_requests / 86400
    peak_rps = req_per_sec * 3  # peak multiplier
    bandwidth_mbps = (peak_rps * req_kb * 8) / 1000
    daily_data_gb = (daily_requests * req_kb) / (1024 * 1024)
    storage_tb = (daily_data_gb * 30 * retention_months) / 1000
    cache_gb = (dau * req_kb * 0.2) / (1024 * 1024)  # 20% hot data
    db_connections = max(10, int(peak_rps / 10))

    print()
    print("=" * 60)
    print("  RESULTS")
    print("=" * 60)
    print(f"{'Metric':<35s} {'Value':>20s}")
    print("-" * 55)
    print(f"{'Daily requests':<35s} {daily_requests:>20,.0f}")
    print(f"{'Avg requests/sec':<35s} {req_per_sec:>20,.1f}")
    print(f"{'Peak requests/sec (3x)':<35s} {peak_rps:>20,.1f}")
    print(f"{'Bandwidth at peak (Mbps)':<35s} {bandwidth_mbps:>20,.1f}")
    print(f"{'Daily data volume (GB)':<35s} {daily_data_gb:>20,.2f}")
    print(f"{'Storage needed (TB)':<35s} {storage_tb:>20,.1f}")
    print(f"{'Cache hot set (GB)':<35s} {cache_gb:>20,.1f}")
    print(f"{'DB connections (approx)':<35s} {db_connections:>20,d}")

    print()
    print("=" * 60)
    print("  REFERENCE: Latency Numbers Everyone Should Know")
    print("=" * 60)
    for k, v in LATENCY_REF.items():
        print(f"  {k:<30s} {v:>20s}")

    print()
    print("=" * 60)
    print("  REFERENCE: Approximate Throughput Per Component")
    print("=" * 60)
    for k, v in THROUGHPUT_REF.items():
        print(f"  {k:<30s} {v:>20s}")

if __name__ == "__main__":
    main()
