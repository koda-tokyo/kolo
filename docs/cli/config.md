---
summary: "CLI reference for `Kurahi config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `Kurahi config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `Kurahi configure`).

## Examples

```bash
Kurahi config get browser.executablePath
Kurahi config set browser.executablePath "/usr/bin/google-chrome"
Kurahi config set agents.defaults.heartbeat.every "2h"
Kurahi config set agents.list[0].tools.exec.node "node-id-or-name"
Kurahi config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
Kurahi config get agents.defaults.workspace
Kurahi config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
Kurahi config get agents.list
Kurahi config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
Kurahi config set agents.defaults.heartbeat.every "0m"
Kurahi config set gateway.port 19001 --json
Kurahi config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
