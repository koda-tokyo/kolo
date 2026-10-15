---
summary: "CLI reference for `kurahi mcp` (MCP servers the gateway connects to)"
read_when:
  - You want the agent to use tools from an MCP server
  - You want to test an MCP server before adding it
title: "mcp"
---

# `kurahi mcp`

MCP servers this gateway connects to. Their tools surface to agents as `mcp:<server>:<tool>` and go
through the same tool policy, capability checks and audit as core tools.

```bash
kurahi mcp list [--json]
kurahi mcp add <id> --stdio <command> [-- args...] [--env KEY=VALUE] [--cwd <dir>]
kurahi mcp add <id> --url <endpoint> [--header KEY=VALUE]
kurahi mcp remove <id> [--json]
kurahi mcp test <id> [--json]
```

## Commands

- `list`: configured servers, with live state (connected, tool count, last error) when a gateway
  is running.
- `add <id>`: add or replace a server in the config. One transport per server:
  - `--stdio <command>`: spawn an executable; arguments after `--` go to it. `--env` and `--cwd`
    set its environment and working directory.
  - `--url <url>`: a streamable-HTTP endpoint. `--header KEY=VALUE` adds request headers;
    `KEY=$secret:<name>` reads the value from the secrets store so the secret never enters the
    config.
  - `--allow <globs>`: tool allowlist (comma-separated, repeatable), for example `read_*,search`.
  - `--timeout <ms>`: per-request timeout.
  - `--disabled`: store it disabled.
- `remove <id>`: delete the server from the config.
- `test <id>`: connect once without a gateway and list the server's tools, resources and prompts.

## Examples

```bash
kurahi mcp add docs --stdio npx -- -y some-docs-server --root ./docs
kurahi mcp add tracker --url https://tracker.example.com/mcp --header "Authorization=$secret:tracker-token"
kurahi mcp test tracker
kurahi mcp list
```

Servers live under `mcp.servers.<id>` in the config. Restrict which agents may call them with the
agent tool policy (`mcp:<server>:*` patterns), and narrow a single Code Mode run further with its
`allowTools` argument.

## Exit codes

- 0: success.
- 1: the server could not be reached, or the config could not be written.
- 2: usage (no transport, both transports, unknown id).
