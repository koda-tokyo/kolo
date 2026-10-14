---
summary: "CLI reference for `KoLo models` (status/list/set/scan, aliases, fallbacks, auth)"
read_when:
  - You want to change default models or view provider auth status
  - You want to scan available models/providers and debug auth profiles
title: "models"
---

# `KoLo models`

Model discovery, scanning, and configuration (default model, fallbacks, auth profiles).

Related:

- Providers + models: [Models](/providers/models)
- Provider auth setup: [Getting started](/start/getting-started)

## Common commands

```bash
KoLo models status
KoLo models list
KoLo models set <model-or-alias>
KoLo models scan
```

`KoLo models status` shows the resolved default/fallbacks plus an auth overview.
When provider usage snapshots are available, the OAuth/token status section includes
provider usage headers.
Add `--probe` to run live auth probes against each configured provider profile.
Probes are real requests (may consume tokens and trigger rate limits).
Use `--agent <id>` to inspect a configured agent’s model/auth state. When omitted,
the command uses `KOLO_AGENT_DIR`/`PI_CODING_AGENT_DIR` if set, otherwise the
configured default agent.

Notes:

- `models set <model-or-alias>` accepts `provider/model` or an alias.
- Model refs are parsed by splitting on the **first** `/`. If the model ID includes `/` (OpenRouter-style), include the provider prefix (example: `openrouter/moonshotai/kimi-k2`).
- If you omit the provider, KoLo treats the input as an alias or a model for the **default provider** (only works when there is no `/` in the model ID).

### `models status`

Options:

- `--json`
- `--plain`
- `--check` (exit 1=expired/missing, 2=expiring)
- `--probe` (live probe of configured auth profiles)
- `--probe-provider <name>` (probe one provider)
- `--probe-profile <id>` (repeat or comma-separated profile ids)
- `--probe-timeout <ms>`
- `--probe-concurrency <n>`
- `--probe-max-tokens <n>`
- `--agent <id>` (configured agent id; overrides `KOLO_AGENT_DIR`/`PI_CODING_AGENT_DIR`)

## Bench and the KODA tested catalogue

```bash
kolo models tested [--residency jp] [--min-score 70] [--tested-only] [--json]
kolo models bench --model <provider/model> [--quick-model <provider/model>] [--only <ids>] [--max-tokens <n>]
kolo models bench-merge <bench-report.json...> --out <dir> [--update-catalogue <file>]
```

`models tested` prints the shipped catalogue: scores per axis, residency, cost per resident-hour and
the date of the last benchmark. `models bench` runs the resident task suite under a token cap and
writes a signed report with evidence bundles. See [KODA tested models](/providers/koda-tested).

## Aliases + fallbacks

```bash
KoLo models aliases list
KoLo models fallbacks list
```

## Auth profiles

```bash
KoLo models auth add
KoLo models auth login --provider <id>
KoLo models auth setup-token
KoLo models auth paste-token
```

`models auth login` runs a provider plugin’s auth flow (OAuth/API key). Use
`kolo plugins list` to see which providers are installed.

Notes:

- `setup-token` prompts for a setup-token value (generate it with `claude setup-token` on any machine).
- `paste-token` accepts a token string generated elsewhere or from automation.
