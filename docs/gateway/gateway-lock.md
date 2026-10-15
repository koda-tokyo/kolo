---
summary: "Gateway singleton guard: the state-root lease plus the WebSocket listener bind"
read_when:
  - Running or debugging the gateway process
  - Investigating single-instance enforcement
title: "Gateway Lock"
---

# Gateway lock

Last updated: 2026-10-13

## Why

- Ensure only one gateway instance runs per base port on the same host; additional gateways must use isolated profiles and unique ports.
- Survive crashes/SIGKILL without leaving stale lock files.
- Fail fast with a clear error when the control port is already occupied.

## Mechanism

- **Lease (one gateway per state root).** On start the gateway creates `<KOLO_HOME>/run/gateway.lock` with an exclusive create, recording its pid, host, port and lease id. It refreshes the lease every 15 s and removes it on exit. A lock whose pid is dead, or that has not been refreshed for 60 s, is reclaimed atomically. While a live gateway holds the lease, a second gateway on the same state root refuses to start with `GatewayLockError("gateway lease held by PID=…")`. `/health` readiness reports whether the lease is held. There is no lock under the OS temp directory any more.
- **Port bind.** The gateway binds the WebSocket listener (default `ws://127.0.0.1:18789`) immediately on startup using an exclusive TCP listener.
- If the bind fails with `EADDRINUSE`, startup throws `GatewayLockError("another gateway instance is already listening on ws://127.0.0.1:<port>")`.
- The OS releases the listener automatically on any process exit, including crashes and SIGKILL; a lease left behind by a killed process is reclaimed by the next start (dead pid or stale heartbeat).
- On shutdown the gateway closes the WebSocket server and underlying HTTP server to free the port promptly.

## Error surface

- If another process holds the port, startup throws `GatewayLockError("another gateway instance is already listening on ws://127.0.0.1:<port>")`.
- Other bind failures surface as `GatewayLockError("failed to bind gateway socket on ws://127.0.0.1:<port>: …")`.

## Operational notes

- If the port is occupied by _another_ process, the error is the same; free the port or choose another with `Kurahi gateway --port <port>`.
- `kurahi gateway --force` only stops the pid named in this state root's lease (verified against `/proc` on Linux); it never matches processes by name.
- `kurahi gateway status` / `kurahi doctor` name the holder from the lease; anything else holding the port is reported as an unknown holder (no `lsof`).
