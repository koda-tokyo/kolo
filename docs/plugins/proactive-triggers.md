---
summary: "proactive-triggers plugin: config-declared impulse rules (interval / cron / condition) that send a system event to a session; dry-run by default"
read_when:
  - You want the gateway to nudge an agent on a schedule or when a file / signal condition holds
  - You are replacing a shell job that wrote reminder files into an inbox
title: "Proactive Triggers Plugin"
---

# Proactive Triggers (bundled plugin, off by default; dry-run by default when on)

Rules live in config. Each rule has a schedule (`every` interval or a 5-field `cron`), an
optional `condition`, a `cooldown`, a `message` and a `sessionKey`. When a rule is due and its
condition holds, the gateway enqueues one system event for that session: the next agent turn
sees the message. With `dryRun: true` (the default) nothing is sent; the rule is evaluated and
`proactive.dry_run` is audited, so a new rule set can be watched for a day before it talks to
anyone.

Conditions (all must hold):

| key              | meaning |
|------------------|---------|
| `fileExists` / `fileMissing` | path (`~` ok, relative = state root) |
| `fileOlderThan` / `fileNewerThan` | `{ path, minutes }` against the file's mtime |
| `hoursBetween`   | `[from, to)` local hours, wraps midnight |
| `weekdays`       | 1 = Monday … 7 = Sunday |
| `signalEquals`   | `{ name, path?, value }` compared (JSON) against a plugin signal, e.g. the circadian phase |

Last-fired times persist in `<state>/proactive/state.json`, so a gateway restart or a plugin
reload never re-fires everything; a cron rule fires at most once per matching minute.

## Config

```json5
{
  plugins: {
    entries: {
      "proactive-triggers": {
        enabled: true,
        config: {
          dryRun: true,                 // set false to deliver
          tickMs: 30000,
          rules: [
            {
              id: "inbox-nudge",
              every: "15m",
              cooldown: "1h",
              condition: { fileNewerThan: { path: "agents/main/inbox/latest.md", minutes: 15 }, hoursBetween: [8, 22] },
              message: "New inbox item since your last turn; read agents/main/inbox/latest.md.",
              sessionKey: "agent:main:main",
            },
            {
              id: "morning-brief",
              cron: "0 9 * * 1-5",
              message: "Morning: review the overnight audit summary and plan the day.",
              sessionKey: "agent:main:main",
            },
            {
              id: "night-journal",
              cron: "30 2 * * *",
              condition: { signalEquals: { name: "circadian.phase", path: "phase", value: "deep-night" } },
              message: "Quiet hours: write the night journal entry.",
              sessionKey: "agent:main:main",
            },
          ],
        },
      },
    },
  },
}
```

Invalid rules are skipped with a warning in the gateway log (duplicate id, bad duration, cron
without 5 fields, missing message or session key).

Audit: `proactive.dry_run`, `proactive.fired` (source `plugin:proactive-triggers`, scope = the
session key). Signal: `proactive.lastFired`.
