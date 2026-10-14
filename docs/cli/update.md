---
summary: "CLI reference for `kolo update` (prebuilt bundle updates, verified and atomic)"
read_when:
  - You want to move an installation to the newest release
  - You want to check for a newer release without changing anything
title: "update"
---

# `kolo update`

Update the installation to the newest release. What happens depends on how the CLI was installed:

| Install | What `kolo update` does |
|---|---|
| Prebuilt bundle (the installer) | Fetches the newest release for this OS and architecture, verifies its SHA-256 against the published `SHA256SUMS.txt`, unpacks it next to the current version and switches atomically. On Windows the new version is applied on the next start. |
| Package install (`npm`/`pnpm`) | Re-installs the package through the detected package manager. |
| Source checkout | Fetches, rebases, installs dependencies, builds and runs `kolo doctor`. Skipped when the working tree has uncommitted changes. |

After a successful update the gateway service is restarted unless `--no-restart` is given.

```bash
kolo update                 # update
kolo update --check         # bundles: report the newest release, change nothing
kolo update --no-restart    # update without restarting the service
kolo update --json          # machine-readable result
kolo update --yes           # non-interactive; accepts a downgrade prompt
kolo update status          # current version, install kind and newest release
kolo --update               # shorthand for kolo update
```

## Options

- `--check`: bundles only; compare with the newest release and exit without downloading.
- `--no-restart`: do not restart the gateway service afterwards.
- `--channel <stable|nightly>`: bundles; which release stream to compare against for this run
  (`KOLO_UPDATE_CHANNEL` sets the same). Source checkouts and package installs keep a persisted
  channel in the config; that path is for contributors, not the supported install.
- `--tag <dist-tag|version>`: package installs; a one-off version for this update.
- `--timeout <seconds>`: timeout for each step (default 1200).
- `--yes`: skip confirmation prompts (downgrades require one).
- `--json`: print the result as JSON.

## Subcommands

- `kolo update status [--json] [--timeout <seconds>]`: version, install kind, newest release; for
  source checkouts also the git tag, branch and commit.
- `kolo update wizard`: interactive form of the same.

## Rollback

Bundle installs keep each version in its own directory under the install prefix. Re-run the
installer with `--version <v>` to switch back; see [Updating](/install/updating).

## Exit codes

- 0: updated, or already current (`--check`: newest release reported).
- 1: the update failed; the previous version stays in place.
