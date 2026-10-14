---
summary: "CLI reference for `kolo logs` (tail gateway logs over RPC)"
read_when:
  - You need to tail gateway logs without a shell on the gateway host
  - You want JSON log lines for tooling
title: "logs"
---

# `kolo logs`

Tail the gateway's file log over its RPC connection. Works against a remote gateway when
`gateway.remote.url` is configured.

Related:

- Logging overview: [Logging](/logging)
- The OS service log (what the supervisor captured): `kolo service logs`

## Examples

```bash
kolo logs
kolo logs --follow
kolo logs --json
kolo logs --limit 500
kolo logs --url wss://gateway.example.com:18789
```

## Options

- `--limit <n>`: lines to return (default 200).
- `--max-bytes <n>`: byte cap on each read (default 250000).
- `--follow`: keep polling for new lines.
- `--interval <ms>`: polling interval in follow mode (default 1000).
- `--json`: one JSON object per line.
- `--plain`: plain text, no styling. `--no-color` disables colors only.
- `--url <url>`: gateway WebSocket URL (default: `gateway.remote.url`, else the local gateway).
- `--timeout <ms>`: connection timeout (default 10000).

## Authentication

There is no `--token` flag. The credential is discovered from `KOLO_HOME` the same way
`kolo attach` and `kolo api` discover it: the owner token file, the secrets store, or
`gateway.remote.token` when a remote gateway is configured. Secrets never go on the command line.

## Exit codes

- 0: lines were returned (or the tail ended cleanly).
- 1: the gateway was not reachable or the log could not be read.
