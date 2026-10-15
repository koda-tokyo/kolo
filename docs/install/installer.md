---
summary: "How install.sh and install.ps1 work, their flags, the bundle layout, and how to automate them"
read_when:
  - You want to understand what the installer does before running it
  - You want to automate installs (CI, headless, air-gapped)
title: "Installer internals"
---

# Installer internals

Two installer scripts live in the repository under `scripts/` and are served unchanged from the
docs host:

- `https://kodasoken.com/kurahi/install.sh` for Linux and macOS (bash)
- `https://kodasoken.com/kurahi/install.ps1` for Windows (PowerShell 7 or Windows PowerShell 5.1)

```bash
curl -fsSL https://kodasoken.com/kurahi/install.sh | bash -s -- --help
```

```powershell
& ([scriptblock]::Create((iwr -useb https://kodasoken.com/kurahi/install.ps1))) -?
```

## What the scripts do

1. **Resolve the release.** `--version` pins one; otherwise the latest release tag is read from
   the GitHub Releases API. The asset is `kolo-<version>-<os>-<arch>.tar.gz` (`.zip` on Windows).
2. **Verify before unpacking.** `SHA256SUMS.txt` is downloaded first; the archive is hashed while
   it downloads and a mismatch deletes it. A release without `SHA256SUMS.txt`, or without an
   entry for the asset, is refused.
3. **Unpack and verify again.** The bundle must contain `bundle-manifest.json` and pass its own
   `SHA256SUMS`; the manifest's OS, architecture and version must match what was requested.
4. **Install.** The bundle goes under the install prefix in its own version directory and the
   `kolo` launcher is linked into the bin directory. Previous versions stay for rollback.
5. **First run.** `kurahi init --non-interactive --name <id> --bind loopback` creates the state
   directory, config and gateway token and runs doctor. `kurahi service install --id <id>` registers
   the gateway with the OS service manager. `kurahi pair invite --scope attach` prints a one-use
   invitation. Each step has a flag to skip it.

## Bundle layout

```
bin/kolo                 POSIX launcher (shell builtins only; works with an empty PATH)
bin/kolo.cmd             Windows launcher (applies a staged update first)
node/bin/node            pinned Node.js runtime, checksum-verified against the upstream SHASUMS
node/node.exe            (Windows)
lib/package.json         the version truth for `kurahi --version`
lib/kolo.mjs             entry; lib/dist/ is the built product
lib/node_modules/        production dependencies, flat, pruned
lib/extensions/          bundled extensions
lib/skills/ lib/assets/ lib/docs/
bundle-manifest.json     os, arch, version, Node.js version, pruned list
SHA256SUMS               one line per file; `kurahi update` refuses a bundle that fails it
```

The launcher exports `KOLO_BUNDLE_ROOT` and runs `node/bin/node lib/kolo.mjs`. Nothing in the
bundle reads the machine's `PATH`, Node.js or npm.

## Flags

`install.sh`:

| Flag                                       | Meaning                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `--version <v>`                            | install this release instead of the latest                                                       |
| `--prefix <dir>`                           | install directory (default `~/.local/share/kolo`; `KOLO_INSTALL_DIR`)                            |
| `--bin-dir <dir>`                          | where `kolo` is linked (default `~/.local/bin`; `KOLO_BIN_DIR`)                                  |
| `--bundle <file>`                          | install from a local bundle instead of downloading                                               |
| `--sums <file>`                            | checksum file for a local bundle (default: `SHA256SUMS.txt` or the `.sha256` sibling next to it) |
| `--name <id>`                              | identity for the first run (default `default`; `KOLO_IDENTITY`)                                  |
| `--no-init`, `--no-service`, `--no-invite` | skip that first-run step                                                                         |
| `--dry-run`                                | resolve the asset and print what would happen; download nothing                                  |

`install.ps1` takes the same options as parameters: `-Version`, `-Prefix` (default
`%LOCALAPPDATA%\Kurahi\app`), `-BinDir` (default `%LOCALAPPDATA%\Kurahi\bin`), `-Bundle`, `-Sums`,
`-Name`, `-NoInit`, `-NoService`, `-NoInvite`, `-DryRun`.

`KOLO_HOME` sets the state directory for the first run.

## Automation

Headless install with no first-run steps, then your own configuration:

```bash
curl -fsSL https://kodasoken.com/kurahi/install.sh | bash -s -- --no-init --no-service --no-invite
KOLO_HOME=/srv/kolo/ops-bot kurahi init --non-interactive --name ops-bot --bind loopback --provider openai-compatible --provider-base-url https://llm.example.com/v1 --provider-model my-model
KOLO_HOME=/srv/kolo/ops-bot kurahi service install --id ops-bot
```

Air-gapped: download the archive and `SHA256SUMS.txt` on a connected machine, copy both, and run
the installer with `--bundle` and `--sums`. The scripts never contact anything but the release
host, and nothing at all with `--bundle`.

## Verifying a download by hand

```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
tar -xzf kolo-<version>-linux-x64.tar.gz && kolo-<version>-linux-x64/bin/kolo --version
```

Release provenance is attested on the GitHub Release; see [Packaging](/PACKAGING).
