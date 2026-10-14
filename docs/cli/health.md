---
summary: "CLI reference for `KoLo health` (gateway health endpoint via RPC)"
read_when:
  - You want to quickly check the running Gateway’s health
title: "health"
---

# `KoLo health`

Fetch health from the running Gateway.

```bash
KoLo health
KoLo health --json
KoLo health --verbose
```

Notes:

- `--verbose` runs live probes and prints per-account timings when multiple accounts are configured.
- Output includes per-agent session stores when multiple agents are configured.
