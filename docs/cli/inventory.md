---
summary: "kurahi inventory: print, export and verify the AI inventory of this runtime"
read_when:
  - You want the command reference for the AI inventory
title: "inventory"
---

# inventory

The AI inventory is described on the [inventory page](/inventory); this page is the command
reference. Nothing here needs a running gateway: the configuration, the policy, the evidence store
and the signing key all live under `KOLO_HOME`.

```bash
kurahi inventory [--json | --csv] [--host]
kurahi inventory export [-o <file|->] [--csv] [--no-sign] [--host]
kurahi inventory verify <file> [--json]
```

| Command            | What it does                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `kurahi inventory` | Prints a table: totals, policy state, then each agent, MCP server and channel.                    |
| `--json`           | Prints the inventory as JSON with its digest (unsigned).                                          |
| `--csv`            | Prints one row per agent.                                                                         |
| `--host`           | Adds this machine's host name (left out by default).                                              |
| `export`           | Writes signed JSON to `kolo-inventory-<date>.json`, or CSV with `--csv`. `-o -` writes to stdout. |
| `export --no-sign` | Writes the JSON without a signature.                                                              |
| `verify <file>`    | Recomputes the digest and checks the signature.                                                   |

Exit codes: `0` ok, `1` verification failed, `2` usage error or unreadable file.
