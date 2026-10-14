---
summary: "CLI reference for `kolo support` (summary of the installation and a redacted diagnostics bundle)"
read_when:
  - You are opening a support ticket
  - You need to share what is installed without sharing secrets
title: "support"
---

# `kolo support`

Prints the version, OS, state directory, integrity and service state, and writes a redacted
diagnostics bundle to attach to a ticket.

```bash
kolo support
kolo support --no-bundle
kolo support --json
kolo support --id ops-bot --out ./ops-bot-support.tar.gz
```

## What the bundle contains

`<KOLO_HOME>/support/kolo-support-<timestamp>.tar.gz` holds:

- `summary.json`: version, OS, state directory, integrity gate result, service state and health.
- `config.redacted.json`: the config with every credential-looking value replaced.
- `gateway-log.tail.txt`: the last 400 gateway log lines, with credential-looking values replaced.

Secrets never enter the bundle. The bundle is written locally and leaves the machine only when you
attach it to a ticket.

## Options

- `--json`: print the summary as JSON.
- `--out <file>`: bundle path (default shown above).
- `--id <id>`: service identity to report on. Without it the identity comes from the state root:
  `KOLO_SERVICE_ID` when set by the service environment, else the id recorded by
  `kolo service install` in `<KOLO_HOME>/service/service.json`, else the default agent written
  by `kolo init`, else `default`.
- `--no-bundle`: print the summary only; write nothing.
- `--lang <code>`: message language, `en` or `ja`.

## Where to send it

- Support: support@kodasoken.com
- Issues: https://github.com/koda-tokyo/kolo/issues
- Vulnerabilities: security@kodasoken.com, never a public issue.

## Exit codes

- 0: summary printed (and bundle written unless `--no-bundle`).
- 1: the bundle could not be written.
