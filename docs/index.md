---
summary: "What KoLo is, how it is put together, and where to start"
read_when:
  - Introducing KoLo to newcomers
title: "KoLo"
---

# KoLo

KoLo is a resident agent runtime. One background service per identity runs under your operating system's service manager; your terminal, the web UI, messaging channels and paired devices are clients of that service. State lives in one directory, the service binds to loopback unless you opt in to remote access, and everything a client does is written to a hash-chained audit log.

## Start here

- **Install:** [Install](/install) (installer script, npm, from source)
- **First run:** [Getting started](/start/getting-started) (`kolo init`, `kolo service install`, `kolo tui`)
- **Pair a device or a second terminal:** [Pairing](/start/pairing) (`kolo pair invite`)
- **Attach to a live session:** [Attach](/cli/attach)
- **Run as a service:** [Gateway service](/gateway/service)
- **Security guide:** [Security](/gateway/security)

## How it is put together

```
terminal (kolo tui, kolo attach)   web UI   paired devices   messaging channels
            │                        │           │                 │
            └────────────────────────┴───────────┴─────────────────┘
                                     │  authenticated clients
                                     ▼
                         ┌───────────────────────┐
                         │        gateway        │  one process per identity
                         │  sessions · agents    │  loopback by default
                         │  tool policy · audit  │  OS service (systemd / launchd /
                         │  secrets · integrity  │  Task Scheduler)
                         └───────────┬───────────┘
                                     │
                       model providers · local model servers
```

The gateway is the only long-running process. It owns the channel connections, the session store, the agent runtime and the control plane. Every other surface talks to it over an authenticated WebSocket or the HTTP API.

## What the runtime guarantees

- **One state root.** `KOLO_HOME` (`~/.kolo` on Linux and macOS, `%LOCALAPPDATA%\KoLo` on Windows) holds config, secrets, sessions, logs and the audit chain. Nothing is written elsewhere.
- **Loopback by default.** Remote access requires an explicit bind policy and a token; see [Remote access](/gateway/remote).
- **Every route authenticated.** The only open endpoints are `/health` and `/api/health`, which answer with status, version and uptime; detail requires a credential.
- **Scoped pairing.** Invitations carry a scope (`observe` < `attach` < `admin` < `owner`), are redeemed with a device key over a server nonce, and issue short-lived access tokens with rotating refresh; reuse of a retired refresh token revokes the family.
- **Audit and integrity.** `kolo audit verify` checks the chain; the boot integrity gate refuses to start when a registered file changed.
- **Described API.** OpenAPI 3.1 at `/doc`; `kolo api <operation>` calls anything the gateway can do; the generated client is `@kodasoken/kolo-client`.

## Surfaces

| Surface | How |
|---|---|
| Terminal | `kolo tui`, `kolo attach <session>`, `kolo agent --message` |
| Web UI | served by the gateway at its HTTP port; `kolo dashboard` opens it with your token |
| Messaging | channel extensions (LINE, WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Matrix, Teams, Google Chat, Mattermost and more); see [Channels](/channels) |
| Devices | iOS, Android and macOS companions pair as nodes |
| Automation | [Cron](/cron-jobs), [Hooks](/hooks), [Webhooks](/cli/webhooks) |

## Command surface

`kolo --help` lists every command. The ones you will use first:

| Command | Purpose |
|---|---|
| `kolo init` | create the state directory, config and gateway token; run doctor |
| `kolo service install \| status \| logs` | run the gateway under the OS service manager |
| `kolo health`, `kolo status`, `kolo doctor` | one-line health, detailed status, checks and repairs |
| `kolo pair invite \| list \| revoke` | device and terminal pairing |
| `kolo attach`, `kolo sessions` | live sessions |
| `kolo secrets set \| list` | provider keys and other secrets |
| `kolo audit verify \| tail` | the audit chain |
| `kolo update`, `kolo uninstall` | lifecycle |

Exit codes are the same everywhere: 0 ok, 1 error, 2 usage, 3 gateway unreachable, 4 authentication.

## Licensing

KoLo is open core: MIT for the protocol, SDK, plugin API and CLI; Functional Source License for the gateway runtime and its subsystems; a proprietary licence for the identity engine and enterprise features. The map is in the repository's `LICENSING.md`.
