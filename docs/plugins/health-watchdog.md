---
summary: "health-watchdog plugin: lease + listener liveness for this gateway, supervisor restart after N failures, escalation to a session"
read_when:
  - You want the gateway to notice its own dead listener or lost lease and recover
  - You are replacing a shell watchdog that restarted the gateway with pm2/systemd
title: "Health Watchdog Plugin"
---

# Health Watchdog (bundled plugin, on by default)

Checks, every `intervalMs`, that this gateway still holds its lease (`<state>/run/gateway.lock`,
fresh heartbeat, our own pid) and that its port accepts a TCP connection. Consecutive failures
drive two actions:

- `failureThreshold` (default 3): ask the supervisor to restart the gateway, at most once per
  `restartCooldownMs`. The supervisor path is `systemctl --user restart` / `launchctl kickstart`
  and, when no external supervisor answers, the gateway's own in-process restart.
- `escalateAfter` (default 6): write `health.escalated` to the audit log and, when
  `escalation.sessionKey` is set, enqueue a system event for that session so the agent sees it
  on its next turn.

Every transition is audited (`health.check` on each failed check, `health.restart`,
`health.escalated`, `health.recovered`); a healthy tick writes nothing. The current state is
published as the `health.gateway` signal for other plugins.

Extra `targets` (another port and/or lease file on this host) are checked the same way, audited
and escalated, never restarted: a gateway only restarts itself.

## Config

```json5
{
  plugins: {
    entries: {
      "health-watchdog": {
        enabled: true, // default: on (bundled, enabled by default)
        config: {
          intervalMs: 60000, // >= 5000
          failureThreshold: 3,
          escalateAfter: 6,
          restart: true, // false: audit + escalate only
          restartCooldownMs: 300000,
          leaseStaleMs: 60000, // heartbeat older than this = stale
          port: 18789, // default: gateway.port, else the lease's port
          probeTimeoutMs: 2000,
          escalation: { sessionKey: "agent:main:main", message: "custom text" },
          targets: [{ id: "sibling", port: 18791, leaseFile: "~/.kolo-sibling/run/gateway.lock" }],
        },
      },
    },
  },
}
```

Disable with `kurahi plugins disable health-watchdog` (applied live; no restart).

## Notes

- The watchdog runs inside the gateway it watches: it catches a dead listener, a lease taken
  by another process and a stalled heartbeat, not a hung event loop. Pair it with the
  supervisor's own liveness (systemd `WatchdogSec`, launchd `KeepAlive`) for that case.
- The first check runs one interval after start, so a slow boot is never counted as a failure.
- Audit source: `plugin:health-watchdog`. Signal: `health.<target>` =
  `{ ok, failures, problems, at }`.
