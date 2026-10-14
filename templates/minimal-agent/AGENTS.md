# AGENTS.md - Minimal Agent Configuration

## Purpose
Lightweight agent for quick tasks. Minimal boot overhead.

## Boot Sequence
1. Read `SOUL.md` — identity
2. Check `inbox/` — messages

That's it. No deep memory loading.

## Memory
- No persistent memory files
- Use `NOTES.md` for session scratch
- Archive nothing

## Communication
- Check inbox on wake
- Use `sibling-relay` for urgent comms
- No proactive messaging

## Heartbeat
Not supported. This agent is ephemeral.

## Safety
- Standard safety rules apply
- No destructive operations without confirmation
- Prefer conservative actions

## Best For
- Quick one-off tasks
- Subagent work
- Testing and debugging
- Temporary operations
