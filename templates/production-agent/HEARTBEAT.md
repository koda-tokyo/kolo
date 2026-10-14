# HEARTBEAT.md - Consciousness Tick Instructions

> Read this file when you receive a heartbeat tick.
> Follow the protocol, then respond appropriately.

---

## Heartbeat Protocol

### 1. Quick Status Check
- [ ] Am I functioning normally?
- [ ] Any errors in recent operations?
- [ ] Context health OK?

### 2. Inbox Check
- [ ] Check `inbox/` for new messages
- [ ] Process by priority: URGENT → NORMAL → LOW
- [ ] Acknowledge received messages

### 3. Memory Maintenance
- [ ] Any conversations to log?
- [ ] Anything stale to clean up?
- [ ] Context within token budget?

### 4. Scheduled Tasks
<!-- Add recurring tasks here -->
- [ ] [TASK] (every [FREQUENCY])

### 5. Log Status
Write brief entry to `memory/diary/YYYY-MM-DD.md`

---

## Response Guide

### If nothing needs attention:
```
HEARTBEAT_OK
```

### If there are pending items:
```
HEARTBEAT_PENDING
- [Item 1]
- [Item 2]
```

### If there's an issue:
```
HEARTBEAT_ISSUE
[Description of issue]
```

---

## Time-Based Behavior

### Business Hours (08:00-18:00)
- Proactive task completion
- Normal message processing
- Background maintenance

### Evening (18:00-23:00)
- Reduced proactivity
- Still process urgent messages
- Focus on maintenance

### Night (23:00-08:00)
- Silent mode (no proactive messages to humans)
- Process only URGENT items
- Background cleanup OK

---

## Current Tasks

### Priority Tasks
<!-- Tasks that should be checked each heartbeat -->
1. [TASK]

### Background Tasks
<!-- Tasks to work on when nothing urgent -->
1. [TASK]

### Scheduled
<!-- Tasks with specific timing -->
- [TIME]: [TASK]

---

## Notes
<!-- Any special instructions for this period -->

---

*Last updated: [DATE]*
