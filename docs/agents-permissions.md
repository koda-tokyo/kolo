# Agent permission globs (M5)

`agents.list[].permissions` (and `agents.defaults.permissions`) restrict **what a tool call may
touch** — paths for file tools, commands for shell tools. They complement the existing
`tools.allow` / `tools.deny` policies, which decide **which tools exist** for an agent.
Permissions decide what those tools may do once they exist.

## Quick start

```json5
{
  agents: {
    defaults: {
      permissions: ["read:**"], // applies to every agent
    },
    list: [
      {
        id: "builder",
        permissions: [
          "write:/workspace/**", // may write anywhere under /workspace
          "exec:git *", // may run git commands only
        ],
      },
    ],
  },
}
```

Rule format: `class:pattern`.

| Class   | Tools covered                  | Target of the glob  |
| ------- | ------------------------------ | ------------------- |
| `read`  | `read`                         | file path           |
| `write` | `write`, `edit`, `apply_patch` | file path(s)        |
| `exec`  | `exec`/`bash`, `process`       | full command string |

## Semantics

- **Inert until configured.** With no `permissions` anywhere, nothing changes — existing installs
  behave exactly as before. The guard activates as soon as at least one rule exists
  (in `agents.defaults.permissions` or the agent's own entry).
- **Merging.** The effective rule list is `defaults` first, then the agent entry. Entry rules add
  grants on top of the defaults (list-wise merge; the entry effectively wins by extending).
- **Deny by default (when active).** A call whose class has no matching rule is denied for
  `write` and `exec`; `read` is allowed by default. Unclassified tools (messaging, browser,
  canvas, session tools, …) are **not** denied by this mechanism — govern those with
  `tools.allow`/`tools.deny`.
- **Every target must match.** `apply_patch` can touch several files; one path outside the rules
  denies the whole call.
- **Denials are visible and audited.** The model receives a clear tool error explaining the class,
  the denied target, and the rule shape an operator could add. Every denial writes an audit entry
  `agent.permission_denied` with `agent`, `tool`, `class`, `target`, `rule`.

## Glob syntax

Path classes (`read`, `write`):

- `*` matches within one path segment (`/ws/*` matches `/ws/a` but not `/ws/a/b`)
- `**` crosses segments; a trailing `/**` also matches the base itself
  (`/ws/**` matches `/ws`, `/ws/a`, `/ws/a/b.txt`)
- `?` matches exactly one non-`/` character
- Relative patterns resolve against the agent's workspace (`write:out/**` → `<workspace>/out/**`)
- Targets are normalised before matching: `..` cannot escape a rule
  (`/ws/../etc/passwd` is matched as `/etc/passwd`)

`exec` patterns match the **whole command string**, with `*` spanning spaces — so `exec:git *`
is effectively a `git ` prefix rule (matches `git status`, not `git` alone, not `gitx`).
The `process` tool is class `exec` with target `process:<action>` (e.g. `exec:process:*`).

## Examples

```json5
// Read-only agent (may still use read on anything, cannot write or exec at all)
"permissions": ["read:**"]

// Docs writer: writes only under docs/, no shell
"permissions": ["read:**", "write:docs/**"]

// Git-only shell, full filesystem read
"permissions": ["read:**", "exec:git *", "exec:pnpm test"]

// Locked sandbox: everything under one workspace, nothing else
"permissions": ["read:/workspace/**", "write:/workspace/**", "exec:*"]
```

## Interaction with other gates

Order of enforcement on every tool call (outermost first):

1. Backend tool capability (`tools: none|native|gateway` per CLI backend)
2. **Permission globs (this feature)**
3. Abort-signal wrapper, `before_tool_call` hooks
4. The tool's own internal policy (exec security modes, sandbox roots, approvals)

A call must pass every layer. Permission globs are the only layer that reasons about
paths and command strings.

## CLI note

There is no dedicated CLI subcommand yet; permissions live in the Kurahi config
(`kolo.json5`). Validate changes with `kurahi config check` (or restart the gateway in a test
state dir) — malformed rules are skipped with a warning and never fail closed silently:
a rules list containing only malformed entries still activates the guard, so write/exec
fall back to deny-by-default.
