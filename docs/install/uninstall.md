---
summary: "Uninstall Kurahi: service, state, workspace, the CLI itself"
read_when:
  - You want to remove Kurahi from a machine
  - The gateway service is still running after the CLI is gone
title: "Uninstall"
---

# Uninstall

Two paths: the CLI is still installed, or only the service is left.

## With the CLI installed

```bash
kurahi uninstall --all --yes --non-interactive
```

`kurahi uninstall` removes what you select and keeps the CLI:

- `--service`: the gateway service (every identity registered with `kurahi service install`).
- `--state`: `KOLO_HOME` (config, token, secrets, logs, sessions).
- `--workspace`: the agent workspace directories.
- `--app`: the macOS companion app.
- `--all`: all of the above. `--dry-run` prints the actions without removing anything.

Then remove the CLI:

| Install         | Command                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prebuilt bundle | delete the install prefix (default `~/.local/share/kolo`, Windows `%LOCALAPPDATA%\KoLo`) and the `kolo` launcher in the bin dir (default `~/.local/bin/kolo`, Windows `%LOCALAPPDATA%\KoLo\bin\kolo.cmd`) |
| Package install | `npm uninstall -g kurahi` or `pnpm remove -g kurahi`                                                                                                                                                          |
| Source checkout | delete the checkout                                                                                                                                                                                           |

## Only the service is left

Remove the unit for each identity you installed. The names below are what `kurahi service install
--id <id>` creates.

Linux (systemd user unit `kolo-gateway@<id>.service`):

```bash
systemctl --user disable --now kolo-gateway@default.service
rm -f ~/.config/systemd/user/kolo-gateway@default.service
systemctl --user daemon-reload
```

macOS (launchd label `com.kodasoken.kolo.<id>`):

```bash
launchctl bootout gui/$UID/com.kodasoken.kolo.default
rm -f ~/Library/LaunchAgents/com.kodasoken.kolo.default.plist
```

Windows (Task Scheduler task `\\KoLo\gateway-<id>`), in PowerShell:

```powershell
schtasks /Delete /F /TN "\KoLo\gateway-default"
```

Then delete the state directory you used (`KOLO_HOME`; default `~/.kolo`, or `~/.kolo-<id>` for a
named identity) and the install prefix as in the table above.

## Checks

```bash
kurahi service status --id default    # exit 3 when nothing is installed
```

A port still answering after that belongs to another process: find it by PID and stop it by PID.
