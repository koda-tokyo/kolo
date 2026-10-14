---
summary: "Monitor OAuth expiry for model providers"
read_when:
  - Setting up auth expiry monitoring or alerts
  - Automating OAuth refresh checks
title: "Auth Monitoring"
---

# Auth monitoring

KoLo exposes OAuth expiry health via `kolo models status`. Use that for
automation and alerting.

## Preferred: CLI check (portable)

```bash
kolo models status --check
```

Exit codes:

- `0`: OK
- `1`: expired or missing credentials
- `2`: expiring soon (within 24h)

This works in cron and systemd and requires no extra scripts.

## Timers and alerts

Run the check from a cron entry or a systemd user timer and alert on a non-zero exit code.
Scripts that read another program's credential store do not belong to the product; keep such
tooling in your own deployment.
