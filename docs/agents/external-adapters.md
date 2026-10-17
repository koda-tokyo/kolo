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

| Adapter | Tools | Files | Network | Credentials |
| --- | --- | --- | --- | --- |
| `claude-cli`, `tools: "none"` | **Enforced before:** `--tools ""` (no built-in tools) and `--permission-mode dontAsk`. Detected after: any reported tool call is rejected and audited. | Enforced before: no file tools exist in the session. | Enforced before for built-in tools (none available). | `ANTHROPIC_API_KEY` is removed from its environment; the CLI uses its own login. Not controlled: the CLI's own stored login. |
| `claude-cli`, `tools: "native"` | **Enforced before:** `--permission-mode dontAsk` — every tool that would need permission is denied unless listed in `allowedTools`; `disallowedTools` is always denied. | Enforced before through the tool rules above. Path scoping beyond them is the CLI's own. | Not controlled by Kurahi beyond the tool rules (e.g. leave `WebFetch` and `Bash` out of `allowedTools`). | As above. |
| `codex-cli`, `tools: "none"` | **Enforced before:** `--sandbox read-only`. | Enforced before: read-only. | Governed by Codex's sandbox; Kurahi adds no network control of its own. | Not controlled: the CLI's own stored login. |
| `codex-cli`, `tools: "native"` | **Enforced before:** `--sandbox workspace-write`. | Enforced before: writes limited to the workspace by Codex's sandbox. | Governed by Codex's sandbox; Kurahi adds no network control of its own. | As above. |
| Custom backend | Not enforced before: Kurahi does not know the CLI's flags. Known bypass flags are removed. Detected after under `tools: "none"`. | Not controlled. | Not controlled. | Only `env` / `clearEnv` as configured. |

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

Flags were checked against the installed CLIs' `--help` (Claude Code 2.1.x, Codex `exec` 0.15x).
If a CLI changes its flags, the preventive layer for that CLI must be re-checked before relying on
it; the detective layer keeps working regardless.
