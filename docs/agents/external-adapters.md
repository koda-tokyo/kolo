---
summary: "What Kurahi enforces before and after an external agent CLI runs (claude-cli, codex-cli, custom)"
read_when:
  - You let an external coding agent (Claude Code, Codex) work under Kurahi
  - You need to know which restrictions are preventive and which are only detected
  - You are reviewing Kurahi for enterprise use
title: "External agent adapters"
---

# External agent adapters

Kurahi can hand a turn to an external agent CLI (`claude-cli`, `codex-cli`, or a custom backend
under `agents.defaults.cliBackends`). Such a CLI runs **its own** tools in its own process. Kurahi
governs it in two layers:

1. **Preventive.** Before the CLI starts, Kurahi passes the CLI's own restriction flags, derived
   from the backend's tool capability (`tools: "none" | "native" | "gateway"`). The CLI then cannot
   run a tool outside them.
2. **Detective.** After the CLI returns, any tool call it reports under `tools: "none"` is rejected
   and written to the audit log (`tool.call`, outcome `denied`). This catches a CLI that did not
   honour the flags. It cannot undo an action that already happened, which is why layer 1 exists.

## Compatibility contract

"Enforced before" means Kurahi passes a restriction the CLI applies before any tool runs.
"Detected after" means Kurahi only sees it in the CLI's output. "Not controlled" means Kurahi
neither restricts nor observes it, so the deployment has to.

| Adapter                         | Tools                                                                                                                                                                                                                                                                                                                             | Files                                                                                                             | Network                                                                                                                                                                                                                     | Credentials                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `claude-cli`, `tools: "none"`   | **Enforced before:** `--restricted` (the host's user, project and local Claude Code settings are ignored), `--strict-mcp-config` (no MCP servers), `--tools ""` (no built-in tools), `--permission-mode dontAsk`. Verified live: no file written, no command run. Detected after: any reported tool call is rejected and audited. | Enforced before: no file tools exist in the session.                                                              | Enforced before: no tool that can reach the network exists.                                                                                                                                                                 | `ANTHROPIC_API_KEY` is removed from its environment; the CLI uses its own login. Not controlled: the CLI's own stored login. |
| `claude-cli`, `tools: "native"` | **Enforced before:** `--restricted`, `--tools` limited to `allowedTools` (default `Read,Grep,Glob`, read-only), `--allowedTools`, `--disallowedTools`, `--permission-mode dontAsk`. Verified live with the default and with `allowedTools: ["Read"]`: no file written, no command run.                                            | Enforced before: only the listed tools exist; `--restricted` also confines file tools to the working directories. | Not controlled by Kurahi beyond the tool list (leave `WebFetch` and `Bash` out of `allowedTools`). MCP servers configured on the host stay loaded; under `dontAsk` their calls are denied unless `allowedTools` lists them. | As above.                                                                                                                    |
| `codex-cli`, `tools: "none"`    | **Enforced before:** `--sandbox read-only`, `--ignore-user-config`, `--ignore-rules` (host config and execpolicy rules not loaded). Verified live on Linux and Windows: no file written inside or outside the workspace.                                                                                                          | Enforced before: read-only.                                                                                       | Governed by Codex's sandbox; Kurahi adds no network control of its own.                                                                                                                                                     | Not controlled: the CLI's own stored login.                                                                                  |
| `codex-cli`, `tools: "native"`  | **Enforced before:** `--sandbox workspace-write` with `/tmp` and `$TMPDIR`/`%TEMP%` excluded, `--ignore-user-config`, `--ignore-rules`; on Windows `-c windows.sandbox=elevated`. Verified live on Linux and Windows: writes inside the workspace succeed, writes to temp folders and the home folder are denied.                 | Enforced before: writes limited to the workspace.                                                                 | Governed by Codex's sandbox; Kurahi adds no network control of its own. MCP servers and plugins configured for Codex still start.                                                                                           | As above.                                                                                                                    |
| Custom backend                  | Not enforced before: Kurahi does not know the CLI's flags. Known bypass flags are removed. Detected after under `tools: "none"`.                                                                                                                                                                                                  | Not controlled.                                                                                                   | Not controlled.                                                                                                                                                                                                             | Only `env` / `clearEnv` as configured.                                                                                       |

Where an adapter cannot be restricted before it runs (a custom backend), restrict **what it is used
for**: give it `tools: "none"`, use it only for agents that need no side effects, and run it on a
host whose own sandbox enforces files, network and credentials.

## Bypass is an audited opt-in

The built-in defaults contain no permission bypass. Bypass flags in configured `args` /
`resumeArgs` (`--dangerously-skip-permissions`, `--permission-mode bypassPermissions`,
`--dangerously-bypass-approvals-and-sandbox`, `--sandbox danger-full-access`) are **removed** and
an audit entry `cli.permissions` (outcome `denied`) records what was removed.

To run a CLI with its own checks bypassed — only on a host that is sandboxed externally — set:

```json5
{
  agents: {
    defaults: {
      cliBackends: {
        "claude-cli": { unsafeSkipPermissions: true },
      },
    },
  },
}
```

Every run with it set writes an audit entry `cli.permissions` with `mode: "unsafeSkipPermissions"`
and a warning in the gateway log.

## Allowing specific tools

```json5
{
  agents: {
    defaults: {
      cliBackends: {
        "claude-cli": {
          tools: "native",
          allowedTools: ["Read", "Grep", "Glob", "Edit"],
          disallowedTools: ["Bash", "WebFetch"],
        },
      },
    },
  },
}
```

## Codex: what the live test showed

Codex was tested live on 2026-10-17 (codex-cli 0.155.1 on Linux, 0.157.0 on Windows):

- `--sandbox read-only`: writes inside and outside the workspace failed (Linux: "Read-only file
  system"; Windows: "Access denied").
- `--sandbox workspace-write` **on its own** let a shell command create a file in `/tmp` (Linux)
  or `%TEMP%` (Windows) **outside the workspace**; only other locations, such as the home folder,
  were denied. Kurahi therefore adds `-c sandbox_workspace_write.exclude_tmpdir_env_var=true` and
  `-c sandbox_workspace_write.exclude_slash_tmp=true`. With them, a file inside the workspace was
  created and both outside locations were denied, on Linux and on Windows.
- Host configuration: a profile setting `sandbox_mode = "danger-full-access"` did not override
  `--sandbox read-only` on the command line (the write was denied). Kurahi also passes
  `--ignore-user-config` and `--ignore-rules`, so the host's `config.toml` and execpolicy rules are
  not loaded at all; authentication still comes from the Codex home folder.
- Windows: the sandbox implementation is itself a `config.toml` setting, so Kurahi passes
  `-c windows.sandbox=elevated`. The elevated sandbox must be set up on the host once with Codex;
  without a sandbox setting every command was rejected (the run fails closed).
- MCP servers and plugins configured for Codex still started during the runs; Kurahi does not
  control them.

## Why `--restricted` matters

A live test showed that `--permission-mode dontAsk` on its own is **not** enough. Claude Code reads
allow rules from the host's own settings (`~/.claude/settings.json` and project settings). On a host
whose settings pre-approve `Write` and `Bash`, a run with only `dontAsk` and `--allowedTools Read`
created a file and ran `touch`. Kurahi therefore always passes `--restricted`, which ignores those
settings files (and the hooks they define), and limits the built-in tools with `--tools`. With these
flags the same prompts wrote nothing and ran nothing. `--restricted` requires a Claude Code version
that supports it; an older CLI rejects the flag and the run fails instead of running unrestricted.

Flags were checked against the installed CLIs' `--help` (Claude Code 2.1.301, Codex `exec` 0.15x)
and the claude-cli and codex-cli rows were verified live on 2026-10-17.
If a CLI changes its flags, the preventive layer for that CLI must be re-checked before relying on
it; the detective layer keeps working regardless.
