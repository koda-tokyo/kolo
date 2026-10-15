---
summary: "Map from cron/shell watchdog scripts (biology, autonomic, guardian, proactive comms, sentience watchdog) to the M7 ops plugins and their config"
read_when:
  - You run a gateway host with cron-driven shell watchdogs and want them inside the gateway
  - You are deciding which shell jobs to keep after enabling the ops plugins
title: "Migrating from shell watchdogs"
---

# Migrating from shell watchdogs to ops plugins (M7)

The ops plugins are generic: no machine names, no fixed paths, every threshold in config, off by
default except the health watchdog. They run inside the gateway process, use its audit chain
and never shell out. What a shell job did that was specific to one host (a named sibling, a
fixed port list, a Windows mount) is expressed as config, or stays a script by choice.

## Script-by-script map

### `kolo-biology.sh` (every 2 min, 14 "organ" functions)

| function                                                                                                                                                                         | plugin                    | config / note                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reflex_responses` — port dead → pm2 restart, lease file removed                                                                                                                 | **health-watchdog**       | `failureThreshold`, `restart: true`; the lease is never deleted, the supervisor restarts the process.                                                                               |
| `thermoregulate` — rotate logs > 50 MB, gzip in background                                                                                                                       | **log-rotation**          | `maxBytes: 52428800`, `keep`, `compress: true`, `dirs` for directories outside the state root.                                                                                      |
| `thermoregulate` — `/tmp` cleanup, stale inbox files                                                                                                                             | not ported                | host hygiene, not a gateway concern; keep as a cron line if wanted.                                                                                                                 |
| `circadian_rhythm` — phase + flags file                                                                                                                                          | **circadian**             | `timezone`, `phases`, `writeFile: true` (`<state>/signals/circadian.json`).                                                                                                         |
| `check_skeleton` — config validation                                                                                                                                             | **self-check** (`config`) | -                                                                                                                                                                                   |
| `check_pain` — 3-failure escalation                                                                                                                                              | **health-watchdog**       | `escalateAfter`, `escalation.sessionKey`.                                                                                                                                           |
| `check_senses` — internet / DNS / API probes                                                                                                                                     | not ported                | external reachability belongs to a network monitor, not the gateway.                                                                                                                |
| `heal_system`, `digest_data`, `regulate_hormones`, `track_metabolism`, `check_circulation`, `clean_lymphatic`, `check_reproductive`, `update_proprioception`, `write_bio_status` | not ported                | agent-state and narrative files specific to one deployment; if any is still wanted, express it as a **proactive-triggers** rule (file freshness → system event) or keep the script. |

### `kolo-autonomic.sh` (every 5 min)

| function                                                            | plugin                        | config / note                                                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run_perception` — inbox unread / workspace changes / last activity | **proactive-triggers**        | rules with `fileNewerThan` / `fileOlderThan` on the inbox and workspace files, `cooldown`, `hoursBetween`.                                             |
| `run_sibling_awareness` — other gateways' liveness                  | **health-watchdog** `targets` | one target per sibling: `{ id, port, leaseFile }`; audited and escalated, never restarted from here.                                                   |
| `run_decision_engine`, `run_memory_pulse`, `run_night_journal`      | **proactive-triggers**        | `cron` rules (e.g. `30 2 * * *` with `signalEquals circadian.phase = deep-night`) that send the agent the instruction instead of writing files for it. |
| `write_heartbeat_state`, `write_body_state`                         | not ported                    | replaced by `GET /api/plugins`, the `health.*` / `circadian.phase` / `self_check` signals and the audit log.                                           |

### `john-guardian.sh` (every 10 min)

| function                                                                                                      | plugin                                      | config / note                                                                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `check_secrets` — token patterns in memory dirs and `/tmp/*.log`                                              | **self-check** (`secrets`)                  | `scanSecrets.dirs`, `scanSecrets.patterns`; file + pattern reported, never the value.                         |
| `check_permissions` — chmod on sensitive files                                                                | **self-check** (`permissions`)              | `autoFix: true` to repair; default only reports.                                                              |
| `check_network` — listeners on 0.0.0.0 / `*` / `[::]` vs allowlist                                            | **self-check** (`ports`)                    | `allowPublicPorts: [22]`; the gateway port is checked against `gateway.bind`.                                 |
| `check_soul_integrity` — SHA256 of soul files                                                                 | **self-check** (`integrity`)                | uses the signed integrity registry (`kurahi integrity init` / `kurahi integrity update`).                     |
| `check_gateway_auth`                                                                                          | **self-check** (`config`) + `kurahi doctor` | -                                                                                                             |
| `check_processes`, `check_daemons`, `check_disk`, `check_ram`, `check_circuit_breakers`, `check_threat_intel` | not ported                                  | process trees, RAM/disk and external feeds are host monitoring; keep the script or a system monitor for them. |

### `kolo-proactive-comms.sh` (every 3 min, 10 impulses)

| mechanism                                       | plugin                                                                                    | config / note                                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `cooldown_ok` / `set_cooldown` JSON             | **proactive-triggers**                                                                    | per-rule `cooldown`; state in `<state>/proactive/state.json`.                                                                               |
| `fire_impulse` live feed + `deliver` inbox file | **proactive-triggers**                                                                    | the message goes to the session as a system event (`proactive.fired` audited); keep `dryRun: true` first and read `proactive.dry_run` rows. |
| time-of-day gates                               | **proactive-triggers** `hoursBetween`, `weekdays`, or `signalEquals` on `circadian.phase` | -                                                                                                                                           |

### `sentience-watchdog.sh` (per daemon, flock liveness, systemd-or-launch)

| mechanism                                            | plugin                                                                                                       | config / note                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| runner liveness via its own flock, launch when free  | **health-watchdog** `targets` for the gateway side; the daemon itself stays under systemd (`Restart=always`) | the plugin audits/escalates when a target's lease or port is dead; it does not launch foreign processes, by design ("one supervisor per daemon"). |
| never `pgrep -f` a pattern that matches the launcher | n/a                                                                                                          | the plugin reads lease files and probes ports; no process-name matching anywhere.                                                                 |

## Enabling (per gateway, staged)

1. `kurahi plugins list` — the six plugins are bundled; `health-watchdog` is already `loaded`.
2. Add config (see each plugin page) with `dryRun: true` for proactive-triggers,
   `restart: false` for health-watchdog and `autoFix: false` for self-check.
3. `kurahi plugins enable <id>` — a running gateway with `plugins.hotReload` on applies it in
   place; otherwise it loads on the next start. `kurahi plugins list` shows `loaded` /
   `quarantined (error)` live.
4. Watch `kurahi audit tail` for `health.*`, `log.*`, `circadian.*`, `self_check.*`,
   `proactive.*` for a day.
5. Flip `dryRun: false` / `restart: true` / `autoFix: true` where wanted.
6. Only then remove the matching cron lines. On the family machine this step waits for
   "restart now" per gateway.

## What the plugins do not replace

- Host-level resource monitoring (RAM, disk, process trees, external reachability).
- Supervision of other processes (daemons, siblings): they stay under systemd / launchd;
  the plugins observe and escalate, they do not launch.
- Anything narrative or deployment-specific (hormone files, diaries): send the agent a
  system event with a proactive-triggers rule and let the agent write.
