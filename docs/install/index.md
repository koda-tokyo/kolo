---
summary: "Install Kurahi with the installer script, from a release bundle, or from source"
read_when:
  - Installing Kurahi
  - You want to install from GitHub
title: "Install"
---

# Install

Requirements: Linux, macOS, or Windows 10/11. The installer bundle ships its own Node.js runtime; installing from npm instead needs Node.js 22.12 or newer on PATH.

## Installer script (recommended)

Linux and macOS:

```bash
curl -fsSL https://kodasoken.com/kurahi/install.sh | bash
```

Windows (PowerShell 7 or Windows PowerShell 5.1):

```powershell
iwr -useb https://kodasoken.com/kurahi/install.ps1 | iex
```

The installer:

1. picks the release bundle for your OS and CPU from GitHub Releases (`kolo-<version>-<os>-<arch>.tar.gz`, `.zip` on Windows);
2. verifies its SHA-256 against the `SHA256SUMS.txt` published with the release before unpacking;
3. installs under `~/.local/share/kolo/<version>` (Windows: `%LOCALAPPDATA%\KoLo\app\<version>`) and links the `kolo` command into `~/.local/bin` (Windows: `%LOCALAPPDATA%\KoLo\bin`, added to your user PATH);
4. runs `kurahi init --non-interactive` and `kurahi service install`;
5. prints a one-use pairing invitation for a second device or terminal.

Nothing is downloaded from anywhere but github.com, and nothing runs as root or administrator.

Flags (`install.sh --help`, `install.ps1 -?`):

| Flag                                                                              | Effect                                               |
| --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `--version <v>` / `-Version`                                                      | install a specific release                           |
| `--prefix <dir>` / `-Prefix`                                                      | install directory                                    |
| `--bin-dir <dir>` / `-BinDir`                                                     | where the `kolo` command is linked                   |
| `--name <id>` / `-Name`                                                           | identity name for the first run (default `default`)  |
| `--no-init`, `--no-service`, `--no-invite` / `-NoInit`, `-NoService`, `-NoInvite` | skip a step                                          |
| `--bundle <file> --sums <file>` / `-Bundle -Sums`                                 | install from a local bundle (offline, air-gapped)    |
| `--dry-run` / `-DryRun`                                                           | print the resolved asset and paths; download nothing |

Both scripts are in the repository under [`scripts/`](https://github.com/koda-tokyo/kurahi/tree/main/scripts) and are served unchanged. Read them before piping them into a shell if your policy requires it.

## Offline or air-gapped

Download the bundle and `SHA256SUMS.txt` from the [releases page](https://github.com/koda-tokyo/kurahi/releases) on a connected machine, copy both files over, then:

```bash
bash install.sh --bundle kolo-<version>-linux-x64.tar.gz --sums SHA256SUMS
```

## From source

```bash
git clone https://github.com/koda-tokyo/kurahi.git
cd kurahi
pnpm install --frozen-lockfile
pnpm build
node kolo.mjs --version
```

`pnpm build && node scripts/bundle.mjs` produces the same bundle the installer uses, for your OS and CPU, under `release/`.

## After installing

```bash
kurahi init               # if you skipped it: state directory, config, gateway token, doctor
kurahi service install    # gateway under systemd / launchd / Task Scheduler
kurahi health             # one status line
kurahi tui                # talk to the agent
```

See [Getting started](/start/getting-started), [Gateway service](/gateway/service) and [Pairing](/start/pairing).

## Updating and removing

- `kurahi update` checks for and installs a newer release; `kurahi update status` shows the current channel and version. See [Updating](/install/updating).
- `kurahi uninstall --all` removes the service, the state directory and the workspace; delete the install directory and the `kolo` link to remove the program. See [Uninstall](/install/uninstall).

## Troubleshooting

- `kolo: command not found` after install: open a new terminal, or add the bin directory printed by the installer to PATH.
- `Node.js ... is required`: install Node 22.12 or newer from https://nodejs.org and re-run the installer.
- `SHA-256 mismatch`: the download is corrupt or altered. Do not install it; re-run the installer, and report persistent mismatches to security@kodasoken.com.
- Windows SmartScreen or an endpoint agent blocks the script: save it, review it, and run it with `pwsh -ExecutionPolicy Bypass -File install.ps1`.
