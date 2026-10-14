# KoLo

KoLo is a persistent, governed agent runtime that runs as a service on Linux, macOS and Windows; your terminal, the web UI, the CLI, messaging pipes and other agents are its clients.

[![CI](https://github.com/koda-tokyo/kolo/actions/workflows/ci.yml/badge.svg)](https://github.com/koda-tokyo/kolo/actions/workflows/ci.yml)
[![Release](https://github.com/koda-tokyo/kolo/actions/workflows/release.yml/badge.svg)](https://github.com/koda-tokyo/kolo/actions/workflows/release.yml)

Licence: open core, MIT / FSL-1.1-Apache-2.0 / proprietary, mapped in [LICENSING.md](LICENSING.md).

> NOTICE: this public tree was imported on 2026-10-14 from the KoLo 2.0 development line. History prior to 2.0 is not published; the pre-fork lineage is described in [ATTRIBUTION.md](ATTRIBUTION.md).

- Documentation: https://kodasoken.com/kolo
- Source and releases: https://github.com/koda-tokyo/kolo
- Issues: https://github.com/koda-tokyo/kolo/issues
- Support: support@kodasoken.com (attach the bundle from `kolo support`)
- Security reports: security@kodasoken.com (see [SECURITY.md](SECURITY.md))
- 日本語: [docs/README-ja.md](docs/README-ja.md)

## Why KoLo

- **Residents keep working between sessions.** One gateway process per identity runs under the OS service manager, owns the sessions and the workspace, and is restarted by the OS when it exits. Closing a terminal does not end the agent.
- **Governance is enforced in the runtime, not in the prompt.** Scoped pairing (`observe` < `attach` < `admin` < `owner`), device-bound credentials with rotating refresh tokens, a hash-chained audit log (`kolo audit verify`) and a boot integrity gate that refuses to start when a registered file has changed.
- **A described API with a generated client.** OpenAPI 3.1 at `GET /doc`, 65 operations, every one with its auth kind and minimum scope. `@kodasoken/kolo-client` is generated from that document and CI fails on drift.
- **Several clients on one session.** Any credential with `attach` scope can list live sessions and attach a terminal, a script or a messaging pipe to one; all attached clients receive the same event stream.
- **Code Mode and MCP.** The agent can run one script that calls many tools in a single round trip, and MCP servers you configure appear as tools named `mcp:<server>:<tool>`.
- **Agent controls.** Per-run step limits, a loop detector that stops identical or no-progress tool calls, permission globs over paths and commands, and a jobs registry with cancel.

## Install

The installer bundle ships its own Node.js runtime. Installing from npm instead needs Node.js 22.12 or newer.

Linux and macOS:

```bash
curl -fsSL https://kodasoken.com/kolo/install.sh | bash
```

Windows (PowerShell 7 or Windows PowerShell 5.1):

```powershell
iwr -useb https://kodasoken.com/kolo/install.ps1 | iex
```

The installer picks the release bundle for your OS and CPU from GitHub Releases, verifies its SHA-256 against the published `SHA256SUMS.txt` before unpacking, installs under `~/.local/share/kolo/<version>` (Windows: `%LOCALAPPDATA%\KoLo\app\<version>`), links the `kolo` command, runs `kolo init --non-interactive` and `kolo service install`, and prints a one-use pairing invitation. Nothing runs as root or administrator and nothing is downloaded from anywhere but github.com. Both scripts are in this repository under [`scripts/`](scripts/) and are served unchanged; flags are listed in [docs/install/index.md](docs/install/index.md).

npm (global, needs Node.js 22.12 or newer on PATH):

```bash
npm install -g @kodasoken/kolo
kolo --version
```

Bundle download with checksum (offline or air-gapped):

```bash
# on a connected machine: download kolo-<version>-<os>-<arch>.tar.gz (.zip on Windows)
# and SHA256SUMS.txt from https://github.com/koda-tokyo/kolo/releases/latest
sha256sum -c --ignore-missing SHA256SUMS.txt
bash install.sh --bundle kolo-<version>-linux-x64.tar.gz --sums SHA256SUMS.txt
```

From source:

```bash
git clone https://github.com/koda-tokyo/kolo.git
cd kolo
pnpm install --frozen-lockfile
pnpm build
node kolo.mjs --version
```

`pnpm build && node scripts/bundle.mjs` produces the same bundle the installer uses, for your OS and CPU, under `release/` ([docs/PACKAGING.md](docs/PACKAGING.md)).

## First run

`kolo init` is the only command a new user must know. It creates the state directory, the config and the gateway token, runs the doctor report and prints the next commands.

```bash
kolo init --name alice
```

```
state      /home/alice/.kolo
config     /home/alice/.kolo/kolo.json
token      /home/alice/.kolo/secrets/gateway.token (created, 0600)
workspace  /home/alice/.kolo/workspace
identity   alice
bind       loopback
port       18789
provider   not chosen (kolo onboard, or kolo secrets)
doctor     ok

next:
  kolo service install --id alice  run the gateway under the OS service manager
  kolo health                      one status line from the gateway
  kolo onboard                     choose a model provider
  kolo pair invite --scope attach  invitation for a second device or terminal
  kolo tui                         talk to the agent
```

Then:

```bash
kolo service install --id alice     # systemd (Linux), launchd (macOS) or Task Scheduler (Windows)
kolo health                         # one status line from the running gateway
kolo pair invite --scope attach     # prints a one-use code (kpi_...), stored only as a hash
kolo attach --list                  # sessions this credential may see
kolo tui                            # talk to the agent in this terminal
```

Without prompts: `kolo init --non-interactive --name alice --bind loopback --provider sakura` (token from `SAKURA_API_KEY`). Japanese messages: `kolo init --lang ja` or `KOLO_LANG=ja`. If the gateway is not running, `kolo health` says so and names the command to start it.

Exit codes are the same everywhere: `0` ok, `1` error, `2` usage, `3` gateway unreachable, `4` authentication.

## Concepts

| Term | Meaning |
|---|---|
| Identity | One named resident (`alice`, `ops-bot`). Each identity is its own service, state root and port. Ids are 1 to 32 characters of `a-z`, `0-9`, `-`, `_`. |
| `KOLO_HOME` | The one directory that holds everything an identity owns: `~/.kolo` (Windows `%LOCALAPPDATA%\KoLo`); a second identity uses `~/.kolo-<id>`. Nothing is written elsewhere except the program files. |
| Gateway | The resident process. Binds to loopback by default, serves HTTP and WebSocket, runs agents, owns sessions, writes the audit log. |
| Session | A conversation an agent is in (`agent:alice:main`). Sessions live in the gateway; terminals, pipes and other agents attach to them. |
| Invitation | A single-use pairing code (`kpi_...`) with a scope, a TTL (default 10 minutes) and optionally a session allowlist. Never grants more than its creator holds. |
| Device | A paired client with its own Ed25519 key and a credential file under `KOLO_HOME/secrets/devices/`: a short-lived access token (default 1 h) and a rotating refresh token (default 30 days). |
| Job | One agent run: queued, running, then terminal. Listed and cancelled through `/api/jobs`; cancels are audited. |
| Plugin | An in-process extension with a `KoLo.plugin.json` manifest and a JSON schema for its config. Channels, providers, tools and the bundled ops plugins are all plugins. |
| MCP server | An external tool server the gateway connects to (`kolo mcp add`). Its tools surface as `mcp:<server>:<tool>`; exec-like tools stay hidden unless allowed by name. |
| Code Mode | The `code_mode_run` tool: the model writes one script that calls many tools through `tools.*` and returns a value, one round trip instead of N, under a wall-clock limit (default 60 s). |

`KOLO_HOME` layout:

```
kolo.json                 configuration (secrets referenced by name, never stored here)
secrets/                  gateway.token (0600), devices/<fingerprint>.json, credentials.json (hashes)
agents/<id>/sessions/     transcripts; never uploaded
workspace/                the agent's working directory and instruction files
audit/                    hash-chained audit log, one file per month
logs/                     daily gateway logs, secrets redacted
run/                      gateway.lock, jobs.json
service/                  service definition and the last install's port
support/                  redacted bundles written by kolo support
```

Scope matrix (enforced on every HTTP route and WebSocket method):

| Scope | Can |
|---|---|
| `observe` | read: health, metrics, lists, histories, `/api/pair/me` |
| `attach` | observe, plus drive sessions: chat, agent turns, `/tools/invoke`, `/v1/*`, Code Mode |
| `admin` | attach, plus manage the gateway: config, cron, pairing, plugin reload |
| `owner` | the gateway token file (`KOLO_HOME/secrets/gateway.token`); never granted by pairing |

A credential below the minimum gets `403` on HTTP and `missing scope: <scope>` on WebSocket. Reuse of a retired refresh token revokes the whole credential family; devices paired longer than `gateway.pairing.reconsentDays` (default 90) must pair again. Details: [docs/cli/pair.md](docs/cli/pair.md), [docs/cli/attach.md](docs/cli/attach.md).

## Configuration

`kolo.json` lives at `KOLO_HOME/kolo.json`. `kolo init` writes the essentials; `kolo config get|set|unset` edits them; `kolo doctor` migrates and repairs.

```json5
{
  gateway: {
    bind: "loopback",                       // loopback (default) | lan | tailnet | custom | auto
    auth: { mode: "token" },
    pairing: { accessTtlMinutes: 60, refreshTtlDays: 30, inviteTtlMinutes: 10, reconsentDays: 90 },
    discovery: { mdns: { mode: "off" } },   // no LAN announcement
  },
  update: { checkOnStart: false },          // no registry contact on start
  agents: {
    defaults: {
      model: { primary: "sakura/<model>" }, // provider/model; providers are configuration
      limits: { maxSteps: 200, doomLoop: { maxIdenticalCalls: 4, noProgressSteps: 12 } },
      permissions: ["read:**", "write:/workspace/**", "exec:git *"],
    },
  },
}
```

**Providers are configuration.** `kolo init --provider` offers three profiles: `sakura` (a Japan-hosted service with a free tier, the first choice on a new installation; [docs/providers/sakura.md](docs/providers/sakura.md)), `openai-compatible` (`--provider-base-url <url ending in /v1> --provider-model <id>`) and `local` (a model server on this machine; nothing leaves the host). Keys come from `SAKURA_API_KEY` or `KOLO_PROVIDER_API_KEY`, or from the secrets store; `kolo models list` shows what is configured.

**Secrets store.** `kolo secrets set <name> --stdin` writes to the OS keyring (Linux Secret Service, macOS Keychain, Windows DPAPI) or to an encrypted file under `KOLO_HOME/secrets/`. Config refers to secrets by name (`$secret` references); `kolo secrets migrate` moves plaintext values out of `kolo.json`. No command prints a secret and none accepts one as a flag value.

**Bind policy.** The default is loopback. `kolo init --bind remote` opts in to a non-loopback bind; the config value `gateway.bind` selects `lan`, `tailnet` or `custom`. Every connection then needs a credential; the only open routes are `GET /health` and `GET /api/health` (status, version, uptime). Credential attempts are rate limited per source address.

**Permissions.** `agents.defaults.permissions` and `agents.list[].permissions` are `class:pattern` rules (`read`, `write`, `exec`) over file paths and whole command strings. Inert until one rule exists; then `write` and `exec` are deny-by-default and every denial is audited as `agent.permission_denied` ([docs/agents-permissions.md](docs/agents-permissions.md)).

## CLI reference

`kolo --help` lists every command; each subcommand has `--help` with examples and its exit codes. Global options: `--lang en|ja`, `--profile <name>`, `--dev`, `--no-color`.

First run and setup

| Command | What it does |
|---|---|
| `kolo init` | First run: state directory, config, gateway token, doctor report |
| `kolo setup` | Initialize `kolo.json` and the agent workspace |
| `kolo onboard` | Interactive wizard for the gateway, workspace and skills |
| `kolo configure` | Interactive prompt for credentials, devices and agent defaults |
| `kolo config` | `get`, `set`, `unset`; the wizard without a subcommand |
| `kolo doctor` | Health checks and quick fixes for the gateway and channels |
| `kolo reset` | Reset local config and state; the CLI stays |
| `kolo uninstall` | Remove the service and local data (`--all --yes --dry-run` to preview) |

Service and gateway

| Command | What it does |
|---|---|
| `kolo service` | `install`, `uninstall`, `start`, `stop`, `restart`, `status`, `logs` under systemd, launchd or Task Scheduler |
| `kolo gateway` | Gateway control (run in the foreground, status) |
| `kolo daemon` | Legacy alias of `kolo service` |
| `kolo health` | One status line from the running gateway |
| `kolo status` | Channel health and recent session recipients |
| `kolo logs` | Tail gateway file logs |
| `kolo support` | Version, OS, state dir, integrity and service state, plus a redacted diagnostics bundle |
| `kolo update` | Update the CLI; bundles are SHA-256 verified and replaced atomically |

Access and governance

| Command | What it does |
|---|---|
| `kolo pair` | `invite`, `list`, `devices`, `approve`, `revoke`, `redeem`: scoped device pairing |
| `kolo pairing` | Pairing helpers for channels |
| `kolo devices` | Device pairing and token management |
| `kolo secrets` | `set`, `list`, `delete`, `migrate`: the encrypted secrets store |
| `kolo integrity` | `init`, `update`, `status`, `verify`: the boot integrity registry |
| `kolo audit` | `verify`, `tail`: the hash-chained audit log |
| `kolo approvals` | Exec approvals |
| `kolo security` | Security helpers |
| `kolo sandbox` | Sandbox tools |

Sessions and agents

| Command | What it does |
|---|---|
| `kolo tui` | Terminal UI |
| `kolo attach` | Attach this terminal to a live session; `--list`, `--follow`, pipe on stdin |
| `kolo sessions` | List stored conversation sessions |
| `kolo agent` | Run an agent turn through the gateway (`--local` for embedded) |
| `kolo agents` | Manage isolated agents: workspaces, auth, routing |
| `kolo message` | Send messages and channel actions |
| `kolo memory` | Memory search tools |
| `kolo models` | Model configuration |
| `kolo system` | System events, heartbeat and presence |
| `kolo cron` | Cron scheduler |
| `kolo acp` | Agent Control Protocol tools |
| `kolo dashboard` | Open the Control UI with the current token |

API and extensions

| Command | What it does |
|---|---|
| `kolo api` | Call any OpenAPI operation or WebSocket method (`list`, `ws`, `discover`) |
| `kolo mcp` | `list`, `add`, `remove`, `test`: MCP servers the gateway connects to |
| `kolo plugins` | `list`, `reload`, `info`, `enable`, `disable`, `install`, `update`, `doctor` |
| `kolo channels` | Channel management |
| `kolo skills` | Skills management |
| `kolo hooks` | Hooks tooling |
| `kolo webhooks` | Webhook helpers |
| `kolo browser` | The dedicated browser instance |
| `kolo nodes`, `kolo node` | Node commands and node control |
| `kolo directory` | Directory commands |
| `kolo dns` | DNS helpers |
| `kolo docs` | Docs helpers |
| `kolo completion` | Shell completion script (bash, zsh, fish, PowerShell) |

Full reference: [docs/cli/index.md](docs/cli/index.md). Voice and flag conventions: [docs/CLI_STYLE.md](docs/CLI_STYLE.md).

## HTTP and WebSocket API

The gateway describes itself. `GET /doc` returns the OpenAPI 3.1 document (credential with `observe` scope); `GET /doc/` serves a viewer. The same document is committed at [openapi/kolo-gateway.openapi.json](openapi/kolo-gateway.openapi.json) (65 operations) and `pnpm openapi:check` fails CI when the code and the document drift.

Auth kinds, declared per operation in the document: `gatewayToken` (the owner token, `Authorization: Bearer`), `pairToken` (a pairing access token `kpa_...`, same header, plus a device-key proof on WebSocket connect), `adminSession` (the admin invite flow), `hookToken` (`X-KoLo-Token` on `/hooks/*`), `migrateKey` and `pluginSignature`. Each operation also carries `x-kolo-min-scope`.

Generated client ([packages/client](packages/client/README.md), MIT):

```ts
import { KoloClient } from "@kodasoken/kolo-client";

const client = await KoloClient.local();          // finds the gateway under KOLO_HOME: port, token or device credential
const health = await client.getHealth();          // GET /health
const sessions = await client.listSessions();     // GET /api/sessions (attach scope)

const sock = await client.ws();                   // WebSocket handshake with the same credential
const recent = await sock.call("sessions.list", { limit: 5 });
sock.close();
```

From the terminal:

```bash
kolo api list                                     # every operation with method, path and auth
kolo api health --raw                             # shorthand for getHealth
kolo api listAuditEvents -p limit=20 -p action=pair.invite
kolo api ws sessions.list '{"limit":5}'
```

The chat-completions style endpoints (`POST /v1/chat/completions`, `POST /v1/responses`) and `POST /tools/invoke` need the `attach` scope. `/hooks/wake`, `/hooks/agent` and mapped hooks take the hook token.

## Security

Read [docs/security/SECURITY_OVERVIEW.md](docs/security/SECURITY_OVERVIEW.md) for the questionnaire answers and [docs/security/privacy.md](docs/security/privacy.md) for the privacy statement. Report vulnerabilities to security@kodasoken.com; the process and targets are in [SECURITY.md](SECURITY.md).

What leaves the machine, and only after you configure it:

| Flow | Destination | Off switch |
|---|---|---|
| Model requests | the provider you configured | the `local` profile |
| Messaging channels | that channel's service | leave channels disabled |
| Update check (version metadata only) | the package registry, npm installs only | `update.checkOnStart: false` |
| Local network announcement | your LAN over mDNS | `gateway.discovery.mdns.mode: "off"` |
| Installer | github.com, at install time | offline install with `--bundle` |

There is no telemetry, no analytics, no crash reporting. The gateway does not contact its vendor at runtime. Support bundles are written locally and leave only if you attach them to a ticket.

Properties you can verify:

```bash
kolo audit verify            # re-walks the hash chain; exit 1 on the first break
kolo integrity status        # every registered file matches its digest; exit 3 otherwise
kolo pair devices            # who holds a credential, with scope and last seen
kolo secrets list            # names and backend only; values are never printed
```

Wipe:

```bash
kolo uninstall --all --yes --dry-run      # service, state directory, workspace: lists, removes nothing
kolo uninstall --all --yes
rm -rf ~/.local/share/kolo ~/.local/bin/kolo    # the program (Windows: %LOCALAPPDATA%\KoLo)
```

Nothing remains outside those paths. Credentials issued by the removed gateway become useless.

## Operations

| OS | Service manager | Definition |
|---|---|---|
| Linux | systemd `--user` | `~/.config/systemd/user/kolo-gateway@<id>.service` |
| macOS | launchd (LaunchAgent) | `~/Library/LaunchAgents/com.kodasoken.kolo.<id>.plist` |
| Windows | Task Scheduler and a runner | task `\KoLo\gateway-<id>`, action `<state root>\service\gateway.cmd` |

- `kolo service status --id <id>` asks the service manager for process state, pid and restart count, then probes `GET /health`. Exit 3 when the service is not installed.
- `kolo service logs --id <id>` reads the OS log (`journalctl --user` on Linux, the plist's log files on macOS, the runner's log on Windows), byte-capped. `kolo logs` tails the gateway's own file logs.
- `kolo update --check` reports current and latest; `kolo update` downloads the newest release for this OS and CPU, verifies it against `SHA256SUMS.txt`, swaps it in atomically and keeps the previous version under `.previous/` for rollback (Windows applies the swap on the next start). `kolo update --channel stable|nightly` chooses the channel. Details: [docs/PACKAGING.md](docs/PACKAGING.md).
- `kolo support` prints version, OS, state dir, integrity and service state and writes `KOLO_HOME/support/kolo-support-<timestamp>.tar.gz`: `summary.json`, `config.redacted.json` and the last 400 log lines with credential-looking values replaced.
- `kolo service uninstall --id <id>` removes the service and keeps the state; `kolo uninstall --all` removes everything ([docs/install/uninstall.md](docs/install/uninstall.md)).

Several identities on one host: each `kolo service install --id <id>` gets its own state root (`~/.kolo-<id>`) and port; nothing is shared between them ([docs/gateway/service.md](docs/gateway/service.md)).

## Plugins and extensions

Plugins load in-process and must ship a `KoLo.plugin.json` manifest with an inline JSON schema for their config ([docs/plugins/manifest.md](docs/plugins/manifest.md)). `kolo plugins list` shows what is discovered; `kolo plugins reload <id>` (or `POST /api/plugins/{id}/reload`, `admin` scope) reloads one plugin in the running gateway without a restart.

Bundled ops plugins (under [`extensions/`](extensions/)):

| Plugin | Default | What it does |
|---|---|---|
| `health-watchdog` | on | lease and listener liveness for this gateway, supervisor restart after N failures, escalation to a session ([doc](docs/plugins/health-watchdog.md)) |
| `self-check` | off | secrets permissions, config validity, integrity registry, open ports against the bind policy; reported through audit and `kolo doctor` ([doc](docs/plugins/self-check.md)) |
| `log-rotation` | off | size and age caps for the state-root logs, in process ([doc](docs/plugins/log-rotation.md)) |
| `circadian` | off | phase-of-day signal with behaviour flags for agents, plugins and schedules ([doc](docs/plugins/circadian.md)) |
| `proactive-triggers` | off | config-declared rules (interval, cron, condition) that send a system event to a session; dry-run by default ([doc](docs/plugins/proactive-triggers.md)) |
| `memory-boot-inject` | off | prepend configured files to the first agent turn after a gateway start ([doc](docs/plugins/memory-boot-inject.md)) |

Channel and provider extensions (LINE, WhatsApp, Telegram, Discord, Slack, Signal, iMessage, Matrix, Teams, Google Chat, Mattermost and others) live in the same directory as workspace packages.

Writing one: a plugin is a package with `KoLo.plugin.json` and an entry module that registers tools, channels, hooks or RPC methods through `@kodasoken/kolo/plugin-sdk`. Agent tools are JSON-schema functions and can be made opt-in through allowlists ([docs/plugins/agent-tools.md](docs/plugins/agent-tools.md)). Install with `kolo plugins install <path|archive|npm spec>` or `--link ./my-plugin` during development.

## Internationalisation

The product is English by default. Japanese is the first translation and covers the first-run path: `kolo init`, `kolo doctor`, `kolo health`, `kolo support`, the top-level `--help` and error texts. Select it with `--lang ja` or `KOLO_LANG=ja`; otherwise the OS locale decides. Japanese documentation: [docs/README-ja.md](docs/README-ja.md), [docs/ja/QUICKSTART.md](docs/ja/QUICKSTART.md), [docs/ja/security/SECURITY_OVERVIEW.md](docs/ja/security/SECURITY_OVERVIEW.md), [docs/ja/security/privacy.md](docs/ja/security/privacy.md), [docs/ja/providers/sakura.md](docs/ja/providers/sakura.md).

## Compatibility

| Target | Bundle (installer) | npm or source |
|---|---|---|
| Linux x64 | yes, pinned Node.js runtime included | Node.js 22.12 or newer |
| macOS arm64 | yes, pinned Node.js runtime included | Node.js 22.12 or newer |
| Windows x64 | yes, pinned Node.js runtime included | Node.js 22.12 or newer |
| Other OS and CPU combinations | no release bundle | Node.js 22.12 or newer; build your own bundle with `node scripts/bundle.mjs` |

Release bundles are built per OS on the release matrix and shipped with `SHA256SUMS.txt`, a CycloneDX SBOM and a build-provenance attestation (`gh attestation verify <file> -R koda-tokyo/kolo`). Bundles are not code-signed at this time: macOS needs `xattr -dr com.apple.quarantine <dir>` after a manual unpack and Windows shows SmartScreen once.

## Licensing and trademarks

KoLo is open core. The authoritative map is [LICENSING.md](LICENSING.md); the texts are in [`LICENSES/`](LICENSES/).

| Layer | Terms | What |
|---|---|---|
| Open | MIT | the wire protocol and schemas, the SDK and generated client, the plugin API and plugin SDK, the CLI |
| Source-available core | Functional Source License, FSL-1.1-Apache-2.0 | the gateway runtime, service supervisor, channels, sessions, memory store, tool policy, secrets store, integrity gate, audit log |
| Proprietary | KODA Proprietary License, under written agreement | identity and continuity engine, protected policy system, sovereign models and adapters, role packs, evaluation dashboard, cloud tier, enterprise features, support |

What you may do: use, modify and self-host the open and source-available layers freely, including commercially; build products on the MIT layers under MIT; not offer the FSL layer as a competing hosted service; each FSL release becomes Apache-2.0 two years after it is published. The proprietary layer is available under agreement only.

Third-party components keep their own licences ([NOTICE](NOTICE), [ATTRIBUTION.md](ATTRIBUTION.md)). "KoLo", "KODA" and the associated marks are trademarks and are not licensed by any of the above; you may say your software is built on or compatible with KoLo, but not name a fork or product with the marks ([TRADEMARKS.md](TRADEMARKS.md)).

Contributions require the [Contributor License Agreement](CLA.md): sign each commit with `git commit -s`.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the repository guidelines in [AGENTS.md](AGENTS.md) (also read by coding agents). In short:

```bash
pnpm install --frozen-lockfile     # Node.js 22.12+, pnpm 10
pnpm build
pnpm check                         # typecheck, lint, format, OpenAPI and client drift
pnpm test                          # unit tests
pnpm smoke                         # throwaway gateway on a free port: auth, API, pairing, sessions, integrity
```

Develop against an isolated state directory: `KOLO_HOME=/tmp/kolo-dev node kolo.mjs gateway --allow-unconfigured --port 18880`. Never point a development build at a state directory a live service uses. Pull requests are accepted for the MIT and FSL layers; one change per pull request, tests next to the code, user-facing text per [docs/CLI_STYLE.md](docs/CLI_STYLE.md).

Repository layout:

| Path | Contents |
|---|---|
| `src/` | gateway runtime, CLI, channels, agents, security layers |
| `packages/client` | generated `@kodasoken/kolo-client` |
| `extensions/` | channel, provider and ops plugins (workspace packages) |
| `ui/` | web control UI |
| `apps/` | macOS, iOS and Android companions |
| `docs/` | documentation source for https://kodasoken.com/kolo |
| `openapi/` | committed OpenAPI document (drift-checked) |
| `scripts/` | build, release, install and check scripts |

## Support and evaluation

- Questions and problems: https://github.com/koda-tokyo/kolo/issues. Design discussions: https://github.com/koda-tokyo/kolo/discussions.
- Attach the bundle from `kolo support` to a ticket; it is redacted before it is written.
- Organisations evaluating the proprietary layer run under the [evaluation licence](docs/EVALUATION_LICENSE.md) (Team tier, 90 days, no fee).
- Security and privacy questions: security@kodasoken.com.
