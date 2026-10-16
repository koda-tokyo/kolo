---
summary: "Run the Gateway under the OS service manager with kurahi service (systemd, launchd, Task Scheduler)"
read_when:
  - Running the Gateway in the background or at login
  - Running several gateway identities on one host
  - Migrating off PM2
title: "Gateway service"
---

# Gateway service

`kurahi service` is the one supported way to run a Gateway in the background. It hands the
process to the operating system's service manager, which starts it at login (or boot),
restarts it when it exits and reports its real state:

| OS      | Manager                 | Definition                                                             |
| ------- | ----------------------- | ---------------------------------------------------------------------- |
| Linux   | systemd `--user`        | `~/.config/systemd/user/kolo-gateway@<id>.service`                     |
| macOS   | launchd (LaunchAgent)   | `~/Library/LaunchAgents/com.kodasoken.kolo.<id>.plist`                 |
| Windows | Task Scheduler + runner | task `\KoLo\gateway-<id>`, action `<state root>\service\gateway.cmd` |

The Gateway exits on fatal errors on purpose. The service manager brings it back
(systemd `Restart=always`, `RestartSec=3`; launchd `KeepAlive`; the Windows runner restarts
after 3 s).

## Commands

```bash
kurahi service install   [--id <identity>] [--port <port>] [--home <dir>] [--no-start]
kurahi service start     [--id <identity>]
kurahi service stop      [--id <identity>]
kurahi service restart   [--id <identity>]
kurahi service status    [--id <identity>] [--no-probe] [--json]
kurahi service logs      [--id <identity>] [-n <lines>] [--max-bytes <n>]
kurahi service uninstall [--id <identity>]
```

- `install` writes the definition, enables it and starts it (unless `--no-start`). It is
  safe to run again: it rewrites the definition and restarts the service.
- `status` asks the service manager (`systemctl --user show`, `launchctl print`,
  `schtasks /Query`) for the process state, pid and restart count, then probes
  `GET /health` on the identity's port. It exits with code 3 when the service is not installed.
- `logs` reads the OS log: `journalctl --user -u kolo-gateway@<id>.service` on Linux, the
  `logs/gateway.out.log` and `logs/gateway.err.log` files named in the plist on macOS, and
  the runner's `logs/gateway.log` on Windows. Output is capped (64 KB by default).
- `uninstall` stops and removes the definition. The state root is kept.

## Identities, state roots and ports

Each identity is its own service with its own state root and port, so several gateways can
run side by side without sharing locks, sessions or credentials.

| Identity         | State root (`KOLO_HOME`)                                                              |
| ---------------- | ------------------------------------------------------------------------------------- |
| `default`        | `$KOLO_HOME` if set, otherwise `~/.kolo` (Windows: `%LOCALAPPDATA%\KoLo`)           |
| any other `<id>` | the default root plus `-<id>`: `~/.kolo-<id>` (Windows: `%LOCALAPPDATA%\KoLo-<id>`) |
| `--home <dir>`   | `<dir>` (overrides both)                                                              |

Ids are 1 to 32 characters of `a-z`, `0-9`, `-` and `_`.

The port comes from `--port`, then from the last install (`<state root>/service/service.json`),
then from `gateway.port` in `<state root>/kolo.json`, then `18789`.

Pick any free port per identity; nothing in Kurahi reserves a fixed set. Check that a port is
unused before installing.

Example: two identities on one host (`<port-a>` and `<port-b>` are ports you choose).

```bash
kurahi service install --id alpha --port <port-a>
kurahi service install --id beta  --port <port-b>
kurahi service status  --id beta
```

## Secrets: the env file

Secrets never go into the unit, plist, task, `kolo.json` or command line. Put them in
`<state root>/env` (created by `install` with mode `0600` if missing):

```bash
# <state root>/env
KOLO_GATEWAY_TOKEN=...
```

systemd reads it with `EnvironmentFile=`; on macOS and Windows the runner
(`dist/daemon/supervisor/runner.js`) loads it before it starts the Gateway. Restart the
service after editing it.

## Platform notes

### Linux

- Needs a systemd user session. On WSL2 enable systemd in `/etc/wsl.conf`
  (`[boot]` `systemd=true`).
- Without lingering the Gateway stops when you log out. `install` tells you when lingering
  is off; enable it with `loginctl enable-linger`.
- `KillMode=mixed`: `stop` sends `SIGTERM` to the Gateway and `SIGKILL` to anything left in
  its cgroup after 15 s.

### macOS

- The job runs in the `gui/<uid>` domain. `stop` uses `launchctl bootout` (a plain kill would be
  undone by `KeepAlive`); `start` bootstraps it again.

### Windows (native)

- The task triggers at logon and runs as the current user without a stored password
  (`/RU <user> /IT`). If Task Scheduler denies the create, run the install once from an
  elevated PowerShell.
- `stop` ends the runner and the Gateway using the pids the runner records in
  `<state root>\run\gateway.pid`, then ends the task. No process name matching is involved.

## Freeing a busy port (`--force`)

`kurahi gateway run --force` no longer needs `lsof` or `fuser`. It probes the port with Node's
`net` module and only signals the pid named in the identity's gateway lock
(`<state root>/run/gateway.lock`, or the legacy lock in the temp dir). On Linux it also checks
`/proc` that the pid owns the listening socket. A port held by any other process is reported
and left alone.

## PM2 (deprecated)

A PM2 `ecosystem.config.cjs` may still exist on older hosts, but PM2 is no longer the supported
supervisor. `kurahi service install`, `start`, `restart` and `status` print a notice when they
see PM2 managing a gateway (they read PM2's pid files under `$PM2_HOME/pids`; they never run
or signal PM2).

Migrating one identity:

1. Note its state root and port from the PM2 app definition.
2. Copy any secret environment variables into `<state root>/env`.
3. Stop the PM2 app (`pm2 stop <app>` and `pm2 delete <app>`, then `pm2 save`).
4. `kurahi service install --id <id> --home <state root> --port <port>`.
5. `kurahi service status --id <id>` shows `running` and `health: ok`.

## Legacy commands

`kurahi gateway install|start|stop|restart|status` and `kurahi daemon ...` still manage the older
single-profile service (`kolo-gateway.service`, `ai.kolo.gateway`, task "KoLo Gateway"). They print
a pointer to `kurahi service`. Do not run both for the same state root and port.

## Smoke test

From a source checkout, after `pnpm build`:

```bash
pnpm smoke
```

It creates a fresh `~/.kolo-test`, starts the Gateway from `dist/` on the first free port in
18860 to 18899 (or `--port` / `KOLO_SMOKE_PORT`), waits for `/health`, checks `readiness`, runs
the WebSocket `connect` handshake, stops the Gateway with `SIGTERM` (then `SIGKILL` after 10 s)
and prints one `SMOKE PASS` or `SMOKE FAIL` line.
