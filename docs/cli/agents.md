---
summary: "CLI reference for `KoLo agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `KoLo agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
KoLo agents list
KoLo agents add work --workspace ~/.kolo/workspace-work
KoLo agents set-identity --workspace ~/.kolo/workspace --from-identity
KoLo agents set-identity --agent main --avatar avatars/KoLo.png
KoLo agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.kolo/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
KoLo agents set-identity --workspace ~/.kolo/workspace --from-identity
```

Override fields explicitly:

```bash
KoLo agents set-identity --agent main --name "KoLo" --emoji "🦞" --avatar avatars/KoLo.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "KoLo",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/KoLo.png",
        },
      },
    ],
  },
}
```
