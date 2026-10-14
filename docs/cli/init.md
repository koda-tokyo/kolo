---
summary: "CLI reference for `kolo init` (first run: state directory, config, gateway token, doctor report)"
read_when:
  - You are installing for the first time
  - You are scripting a non-interactive install
  - You need to decide who may reach the gateway (bind policy)
title: "init"
---

# `kolo init`

The one command a new user must know. It creates the state directory, the config and the gateway
token, runs the doctor report and prints the next three commands. Everything it writes is
idempotent and merge-safe: an existing `kolo.json` is merged into, not replaced, unless `--force`.

```bash
kolo init
kolo init --non-interactive --name alice --bind loopback
kolo init --non-interactive --state-dir /srv/kolo/ops-bot --name ops-bot --bind tailnet
kolo init --non-interactive --provider openai-compatible --provider-base-url https://llm.example.com/v1 --provider-model my-model
```

## What it writes

| Item | Location |
|---|---|
| state directory | `KOLO_HOME` (or `--state-dir`) |
| config | `<KOLO_HOME>/kolo.json` |
| gateway token | `<KOLO_HOME>/secrets/gateway.token` (mode 0600) |
| workspace | `<KOLO_HOME>/workspace` with the bootstrap files |

The identity name (`--name`) is also the service id used by `kolo service install --id <name>`.

## Options

- `--non-interactive`: no prompts; values come from flags and defaults.
- `--name <id>`: identity name, 1-32 lowercase letters, digits, `-` or `_` (default `default`).
- `--state-dir <dir>`: state directory for this run; printed as an `export KOLO_HOME=` hint.
- `--bind <policy>`: who may reach the gateway (see below; default `loopback`).
- `--provider <profile>`: `sakura`, `openai-compatible` or `local`; omitted means decide later.
  Keys are read from `SAKURA_API_KEY` or `KOLO_PROVIDER_API_KEY`, never from a flag.
- `--provider-base-url <url>`, `--provider-model <id>`: for `openai-compatible` and `local`.
- `--phone <channel>`: last step, connect your phone: `whatsapp`, `telegram`, `line`, `web` or
  `skip` (default: ask when interactive, skip otherwise). Runs the same flow as
  [`kolo connect`](/cli/connect) and never fails init; `--json` adds a `phone` object.
- `--force`: rewrite an existing config instead of merging into it.
- `--json`: print the result as JSON (`koloHome`, `configPath`, `tokenFile`, `bind`,
  `gatewayBind`, `remoteEnabled`, `port`, `provider`, `doctor`).
- `--lang <code>`: message language, `en` or `ja`.

## Bind policy

`--bind` uses one vocabulary for the question "who may reach the gateway":

| Policy | `gateway.bind` | `gateway.remote.enabled` | Meaning |
|---|---|---|---|
| `loopback` | `loopback` | unchanged | this machine only (default) |
| `lan` | `lan` | `true` | every interface on this host |
| `tailnet` | `tailnet` | `true` | the host's tailnet address only |
| `custom` | `custom` | `true` | the address in `gateway.customBindHost` |
| `remote` | `lan` | `true` | plain-language alias of `lan` |

Every policy other than `loopback` sets `gateway.remote.enabled: true`, because the gateway refuses
a non-loopback bind at startup until that flag is set. Token auth is always on
(`gateway.auth.mode: token`); non-loopback binds require the token on every connection.

The interactive prompt offers `loopback` and `remote`; use the flag for `lan`, `tailnet` or
`custom`. The same modes are accepted by `kolo gateway --bind` for a one-off run.

## Exit codes

- 0: config written (or merged) and the token exists.
- 1: cancelled, or the doctor report could not be produced.
- 2: an invalid `--name`, `--bind` or `--provider` value.
