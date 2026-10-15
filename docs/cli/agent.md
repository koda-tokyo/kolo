---
summary: "CLI reference for `Kurahi agent` (send one agent turn via the Gateway)"
read_when:
  - You want to run one agent turn from scripts (optionally deliver reply)
title: "agent"
---

# `Kurahi agent`

Run an agent turn via the Gateway (use `--local` for embedded).
Use `--agent <id>` to target a configured agent directly.

## Gateway routing and no silent fallback (M3b)

The command talks to the gateway under `KOLO_HOME` (alias `KOLO_STATE_DIR`): that state root's
`kolo.json` gives the port and its `secrets/gateway.token` the credential, and when the running
gateway's lease (`<KOLO_HOME>/run/gateway.lock`) names a port, that port wins. Point the env at a
sibling's home to address the sibling through its own gateway:

```bash
KOLO_HOME=~/.kolo-ops-bot kurahi agent --agent ops-bot --message "status?"
```

If no gateway answers, the command exits `3` with a line naming the state dir and port it
tried. It never runs the embedded agent on its own. `--local` is the explicit way to do that:
it prints one notice line, bypasses the gateway, and is recorded in the audit log as
`agent.local_run`.

Related:

- Agent send tool: [Agent send](/tools/agent-send)

## Examples

```bash
Kurahi agent --to +15555550123 --message "status update" --deliver
Kurahi agent --agent ops --message "Summarize logs"
Kurahi agent --session-id 1234 --message "Summarize inbox" --thinking medium
Kurahi agent --agent ops --message "Generate report" --deliver --reply-channel slack --reply-to "#reports"
```
