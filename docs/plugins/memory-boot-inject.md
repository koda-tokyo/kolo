---
summary: "memory-boot-inject plugin: prepend configured files (diary, inbox, handoff) to the first agent turn after a gateway start"
read_when:
  - You want an agent to start every gateway life with its diary / handoff / inbox already in context
  - You are replacing a boot script that injected memory files into the agent's prompt
title: "Memory Boot Inject Plugin"
---

# Memory Boot Inject (bundled plugin, off by default)

On the first agent turn of each session after a gateway start, the configured files are read
and prepended to the prompt through the `before_agent_start` hook (`prependContext`). The agent
sees them as a block headed `Boot context (injected by memory-boot-inject):`, one section per
file, with a trailing line naming files that were missing or over budget.

- `once: true` (default): one injection per session per gateway life; a `gateway_start` hook
  resets the bookkeeping so a restarted gateway injects again. `once: false` injects on every
  turn (use small files).
- Each file is capped at `maxBytesPerFile` keeping its **tail** (the newest diary entries), the
  whole block at `maxTotalBytes`.
- Paths accept `~`; relative paths resolve against the state root.
- `agents` restricts injection to those agent ids.

Every injection is audited (`memory.boot_injected`, with the files and whether each was read).

## Config

```json5
{
  plugins: {
    entries: {
      "memory-boot-inject": {
        enabled: true,
        config: {
          files: ["~/notes/diary.md", "agents/main/inbox/latest.md", "~/notes/HANDOFF.md"],
          maxBytesPerFile: 16384,
          maxTotalBytes: 65536,
          agents: ["main"],
          once: true,
          header: "Boot context:",
        },
      },
    },
  },
}
```

## Notes

- The plugin never writes the files; it only reads them at injection time, so an updated handoff
  is picked up on the next gateway start (or next turn with `once: false`).
- Reloading the plugin (`kurahi plugins reload memory-boot-inject`) resets the per-session
  bookkeeping: the next turn injects again.
- Audit source: `plugin:memory-boot-inject`.
