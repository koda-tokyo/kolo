---
summary: "self-check plugin: secrets permissions, config validity, integrity registry, open ports vs bind policy, optional secret scan; reported via audit and kurahi doctor"
read_when:
  - You want a periodic, local-only security self-check of the state root
  - You are replacing a shell guardian that checked permissions, listeners and leaked tokens
title: "Self-check Plugin"
---

# Self-check (bundled plugin, off by default)

On start (after 1 s) and every `intervalMs`, the plugin runs the generic checks a host guardian
would, inside the gateway, with no shell and nothing leaving the host:

| check         | what                                                                                                                                                                             | fix                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `permissions` | secrets dir 0700; secret files, the config file and the integrity key 0600 (group/other bits closed)                                                                             | `autoFix: true` runs `chmod` |
| `config`      | the config file parses and validates                                                                                                                                             | -                            |
| `integrity`   | the signed integrity registry verifies (skipped when none was initialised)                                                                                                       | -                            |
| `ports`       | listeners bound beyond loopback (`/proc/net/tcp*`): the gateway port is an error when `gateway.bind` is `loopback`; other ports are warnings unless listed in `allowPublicPorts` | -                            |
| `secrets`     | only when `scanSecrets.dirs` is set: token-shaped strings in text files (file and pattern are reported, never the value)                                                         | -                            |

Results go to three places:

- `<state>/self-check/latest.json` (read by `kurahi doctor` and `kurahi plugins doctor`);
- the audit log: one `self_check.run` per run (checks + count) and one `self_check.finding`
  per **new** warning/error (a finding is audited once until it disappears and comes back);
- the `self_check` signal (`{ ok, ranAt, checks }`).

## Config

```json5
{
  plugins: {
    entries: {
      "self-check": {
        enabled: true,
        config: {
          intervalMs: 600000, // >= 30000
          runOnStart: true,
          autoFix: false,
          allowPublicPorts: [22],
          scanSecrets: {
            dirs: ["~/notes"], // off unless set
            patterns: ["sk-[a-zA-Z0-9_-]{30,}"], // default: common token shapes
            maxFileBytes: 1048576,
          },
        },
      },
    },
  },
}
```

## Notes

- The ports check reads `/proc/net/tcp` and `/proc/net/tcp6`; on platforms without them it
  reports `skip`.
- `kurahi doctor` prints the last report under "Self-check (plugin)"; the gateway need not be
  running for that.
- Audit source: `plugin:self-check`.
