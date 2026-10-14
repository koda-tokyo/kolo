---
summary: "circadian plugin: phase-of-day signal (dawn … deep-night) with behaviour flags, for agents, other plugins and schedules"
read_when:
  - You want schedules, triggers or agents to behave differently by time of day without hard-coding hours
  - You are replacing a shell job that wrote a circadian phase file
title: "Circadian Plugin"
---

# Circadian (bundled plugin, off by default)

Publishes the phase of day in four places:

- the `circadian.phase` signal (read by other plugins, e.g. a proactive-triggers rule with
  `signalEquals: { name: "circadian.phase", path: "phase", value: "deep-night" }`);
- the agent tool `circadian_phase` (phase, local time, weekend flag and the behaviour flags);
- `<state>/signals/circadian.json` for anything outside the gateway (`writeFile: true`);
- a system event to `notifySessionKey` on every phase change (optional).

Each phase carries flags: `monitoring` (reduced / normal / heightened), `alertThreshold`
(critical-only / all), `cleanupAllowed`, `expectedActivity` (minimal / low / normal / high).
Phase changes are audited (`circadian.phase_changed`).

Default table (local time, wraps midnight):

| phase      | hours | monitoring | alerts        | cleanup | activity |
|------------|-------|------------|---------------|---------|----------|
| dawn       | 06-09 | normal     | all           | no      | low      |
| morning    | 09-12 | heightened | all           | no      | high     |
| midday     | 12-14 | normal     | all           | no      | normal   |
| afternoon  | 14-18 | heightened | all           | no      | high     |
| evening    | 18-21 | normal     | all           | no      | normal   |
| night      | 21-02 | reduced    | all           | yes     | low      |
| deep-night | 02-06 | reduced    | critical-only | yes     | minimal  |

## Config

```json5
{
  plugins: {
    entries: {
      circadian: {
        enabled: true,
        config: {
          intervalMs: 60000,
          timezone: "Asia/Tokyo",          // IANA; default: the process zone
          notifySessionKey: "agent:main:main",
          writeFile: true,
          phases: [                        // optional: replaces the default table
            { name: "work", from: 8, to: 18, monitoring: "heightened", expectedActivity: "high" },
            { name: "off", from: 18, to: 8, monitoring: "reduced", alertThreshold: "critical-only", cleanupAllowed: true, expectedActivity: "minimal" },
          ],
        },
      },
    },
  },
}
```

Audit source: `plugin:circadian`. Signal: `circadian.phase` = the full snapshot.
