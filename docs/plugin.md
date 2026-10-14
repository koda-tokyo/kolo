---
summary: "Plugins (extensions): what they are, where they load from, how they are configured and kept safe"
read_when:
  - You want to add a channel, provider, tool or ops plugin
  - You are writing a plugin or debugging one that did not load
title: "Plugins"
---

# Plugins (extensions)

A plugin is a small code module the gateway loads in-process. Plugins add channels, model
providers, agent tools, gateway RPC methods, HTTP routes, CLI commands and background services.
Everything optional in the product is a plugin, and the bundled ones start disabled.

```bash
kolo plugins list              # what is discovered, from where, enabled or not
kolo plugins enable <id>       # turn one on
kolo plugins doctor            # why one did not load
```

The CLI reference is [`kolo plugins`](/cli/plugins); the manifest format is
[Plugin manifest](/plugins/manifest).

## Where plugins come from

In load order, later entries with the same id are ignored:

1. **Config paths**: `plugins.load.paths` (files or directories).
2. **Workspace**: `<workspace>/.kolo/extensions/`.
3. **Global**: `<KOLO_HOME>/extensions/`.
4. **Bundled**: the extensions shipped with the product.

A plugin is a file (`.ts` or `.js`) or a directory with a `package.json`. A package may list
several plugin entry files in its manifest metadata (see [Plugin manifest](/plugins/manifest)).

Each plugin ships a `KoLo.plugin.json` next to its entry:

```json
{
  "id": "example-plugin",
  "name": "Example",
  "description": "What it adds",
  "configSchema": { "type": "object", "additionalProperties": false, "properties": {} }
}
```

`configSchema` is required even when empty; the gateway validates `plugins.entries.<id>.config`
against it before loading. A missing or invalid manifest or schema prevents the load and shows in
`kolo plugins doctor`.

## Configuration

```json5
{
  plugins: {
    enabled: true,                 // master switch
    allow: ["line", "ops-health"], // optional allowlist by id
    deny: [],                      // optional denylist
    load: { paths: [] },           // extra plugin files or directories
    hotReload: { enabled: false }, // reload a plugin when its files change
    slots: {},                     // which plugin fills an exclusive slot (memory, ...)
    entries: {
      line: { enabled: true, config: { /* per the plugin's configSchema */ } }
    }
  }
}
```

`kolo plugins enable|disable <id>` edit `entries.<id>.enabled`. Bundled plugins are off until
enabled; a plugin installed with `kolo plugins install` is enabled on install.

## Installing

```bash
kolo plugins install ./my-plugin            # copy a local directory or file
kolo plugins install ./my-plugin --link     # link it instead (development)
kolo plugins install ./my-plugin.tgz        # archive (.zip, .tgz, .tar.gz)
kolo plugins install some-npm-package       # npm spec; `kolo plugins update` keeps it current
```

Installs are recorded under `plugins.installs` so `kolo plugins update` knows what to refresh.

## What a plugin can register

Through the plugin SDK (`@kodasoken/kolo/plugin-sdk`) a plugin registers, in its `register`
function: channels, providers, agent tools, gateway methods, HTTP routes, CLI commands, hooks,
services (long-running tasks with start and stop) and self-checks. The runtime hands it a logger,
its validated config, the state directory resolvers and the audit log; it never reads the machine's
home directory or the config file directly.

## Safety

- Every plugin runs in the gateway process with the gateway's permissions. Install only what you
  would run as that user.
- `plugins.allow` makes the loader ignore everything else, including bundled plugins.
- Agent tools, plugin tools included, cannot write registered protected policy files, the
  integrity registry or the audit log; the write-refusal hook is always on.
- Plugin HTTP routes and RPC methods go through the same authentication and scopes as the core.
- A plugin that throws during load is quarantined, not retried in a loop; `kolo plugins reload <id>`
  tries again after a fix.

## Writing one

Start from a bundled extension in the repository's `extensions/` directory; each is a complete
example with a manifest, a config schema and tests. Keep plugin-only dependencies in the plugin's
own `package.json`.
