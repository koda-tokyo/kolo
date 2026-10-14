---
summary: "kolo evidence: list, show, export, verify, replay and prune evidence bundles"
read_when:
  - You want the command reference for evidence bundles
title: "evidence"
---

# evidence

Evidence bundles are described on the [evidence page](/evidence); this page is the command reference.
Nothing here needs a running gateway: the store and the signing key live under `KOLO_HOME`, and a
bundle verifies from its own files.

```bash
kolo evidence list [--json]
kolo evidence show <jobId> [--json]
kolo evidence export <jobId> [--out <dir|file.zip>] [--json]
kolo evidence verify <bundle> [--json]
kolo evidence replay <bundle|jobId> [--step <n>] [--json]
kolo evidence prune [--days <n>] [--dry-run] [--json]
```

| Command | Does |
|---|---|
| `list` | every job with evidence under `KOLO_HOME/evidence`, newest first (`ls` is an alias) |
| `show` | counts, files changed, tools run, policy decisions, audit links and the signing key of one job (`info` is an alias) |
| `export` | writes a signed bundle; a directory by default, a zip when `--out` ends in `.zip` (default `evidence-out/<jobId>`) |
| `verify` | recomputes the chain, every file digest and both signatures; prints `verdict PASS` or `FAIL` with the reasons (`check` is an alias) |
| `replay` | the stepper: `--step n` prints one state; on a terminal `n`, `p`, `j <step>` and `q` move through it; without a terminal every step is printed |
| `prune` | removes evidence older than `--days` (default `evidence.retentionDays`); `--dry-run` only lists |

Exit codes: 0 ok, 1 a check failed or the job has no evidence, 2 usage.
