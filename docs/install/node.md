---
title: "Node.js and PATH"
summary: "When you need Node.js, which version, and why `kolo` can be installed but not found"
read_when:
  - You installed from npm and `kolo` is "command not found"
  - You are deciding between the installer and a package install
---

# Node.js and PATH

The installer bundle ships its own Node.js runtime; nothing on the machine is required and nothing
on `PATH` is read. This page is for package installs (`npm`/`pnpm`) and source checkouts.

## Version

Node.js 22.12 or newer. `pnpm` 10 for source checkouts.

```bash
node -v
npm -v
```

## `kolo: command not found` after `npm install -g`

The directory where npm puts global binaries is not on your shell's `PATH`.

```bash
npm prefix -g
echo "$PATH"
```

If `$(npm prefix -g)/bin` (Linux, macOS) or `$(npm prefix -g)` (Windows) is not in `PATH`, add it
to your shell profile and open a new shell:

```bash
export PATH="$(npm prefix -g)/bin:$PATH"
```

Or avoid the problem: install with the bundle, which links `kolo` into a bin directory of your
choice (`--bin-dir`, default `~/.local/bin`).

## Version managers

When the gateway runs as a service, the service unit records the absolute path of the runtime it was
installed with. A version manager that swaps the active Node.js later does not affect the service;
re-run `kolo service install --id <id>` after changing the runtime you want it to use.
`kolo doctor` warns when the service runs on a version-managed Node.js path.
