---
summary: "Provider registry and the kurahi providers command: list, add, test, remove, default"
read_when:
  - You are wiring a model provider for the first time
  - You want to check that a provider answers and how fast
  - You want to point an installation at a custom OpenAI-compatible endpoint
title: "Providers"
---

# Providers

Kurahi talks to model providers through configuration, never through code changes. A built-in registry (`src/providers/registry.json`) describes each provider Kurahi knows how to wire: a configuration identifier, the API style, the base URL, how the key is sent, whether the provider can list its models, and where it is hosted. `kurahi providers` reads that registry; `kurahi models list --live` uses it to ask providers for their current model list.

Provider names appear in the table below as data. The product's own sentences say "provider".

The registry has two parts. The curated entries below are hand-maintained and come first, in this order. After them come entries generated from a public catalogue of providers ([models.dev](https://models.dev)): every provider there with an `https://` API base URL and an adapter Kurahi speaks (OpenAI-compatible, Anthropic Messages, Gemini) becomes an entry with `source: "catalogue"`, a `/models` endpoint, the key's environment variable and a link to the provider's documentation. The region note of a generated entry says that the catalogue does not state one. `kurahi providers list` shows the curated entries plus anything configured; `--all` shows the whole catalogue and `--search <text>` filters it.

## Curated entries

| id                  | API style          | Region note                                        | Models endpoint | Key from env           |
| ------------------- | ------------------ | -------------------------------------------------- | --------------- | ---------------------- |
| `sakura`            | openai-compatible  | Hosted in Japan (recommended default)              | `/models`       | `SAKURA_API_KEY`       |
| `openai-compatible` | openai-compatible  | Wherever the endpoint you give is hosted           | `/models`       | -                      |
| `ollama`            | ollama             | Local machine                                      | `/api/tags`     | - (no key)             |
| `openai`            | openai-compatible  | Global; US-hosted by default                       | `/models`       | `OPENAI_API_KEY`       |
| `anthropic`         | anthropic-messages | Global; US-hosted by default                       | `/models`       | `ANTHROPIC_API_KEY`    |
| `google`            | gemini             | Global                                             | `/models`       | `GEMINI_API_KEY`       |
| `mistral`           | openai-compatible  | Hosted in the European Union                       | `/models`       | `MISTRAL_API_KEY`      |
| `deepseek`          | openai-compatible  | Hosted in China                                    | `/models`       | `DEEPSEEK_API_KEY`     |
| `groq`              | openai-compatible  | Global; US-hosted by default                       | `/models`       | `GROQ_API_KEY`         |
| `openrouter`        | openai-compatible  | Router; upstream region depends on the model       | `/models`       | `OPENROUTER_API_KEY`   |
| `together`          | openai-compatible  | Global; US-hosted by default                       | `/models`       | `TOGETHER_API_KEY`     |
| `fireworks`         | openai-compatible  | Global; US-hosted by default                       | `/models`       | `FIREWORKS_API_KEY`    |
| `xai`               | openai-compatible  | Global; US-hosted by default                       | `/models`       | `XAI_API_KEY`          |
| `moonshot`          | openai-compatible  | Hosted in China; international endpoint            | `/models`       | `MOONSHOT_API_KEY`     |
| `zai`               | openai-compatible  | Hosted in China; international endpoint            | none            | `ZAI_API_KEY`          |
| `minimax`           | openai-compatible  | Hosted in Singapore; international endpoint        | none            | `MINIMAX_API_KEY`      |
| `azure-openai`      | openai-compatible  | Region chosen per resource (`--base-url` required) | `/models`       | `AZURE_OPENAI_API_KEY` |

API styles map to Kurahi adapters: `openai-compatible` and `ollama` use `openai-completions`, `anthropic-messages` uses `anthropic-messages`, `gemini` uses `google-generative-ai`. Entries without a models endpoint are probed with a one-token chat request against their default model (or `--model`).

Not in the registry: providers authenticated through a cloud SDK credential chain (for example a managed inference service that takes `AWS_PROFILE`), OAuth-only flows, and the vendor-specific presets that `kurahi onboard` still handles directly. Those keep their own pages under this directory.

## Commands

```
kurahi providers list [--json] [--all] [--search <text>]
kurahi providers add <id> [--base-url <url>] [--api-key-stdin | --api-key-file <path>] [--model <id>]
kurahi providers test <id> [--model <id>] [--timeout <ms>] [--json]
kurahi providers remove <id> [--yes]
kurahi providers default <id> [--model <id>]
kurahi models list --live [--provider <id>]
```

Exit codes: 0 ok, 1 the command ran and failed, 2 usage, 3 the provider did not answer (connection refused, timeout), 4 the key was rejected (HTTP 401/403) or no key is stored.

### list

```
$ kurahi providers list
┌───────────────────┬────────────────────────────┬────────────────────┬──────────────────────────────┬───────────────────┬─────────┐
│ ID                │ NAME                       │ API                │ REGION                       │ CONFIGURED        │ DEFAULT │
├───────────────────┼────────────────────────────┼────────────────────┼──────────────────────────────┼───────────────────┼─────────┤
│ sakura            │ Sakura AI Engine           │ openai-compatible  │ Hosted in Japan              │ yes (profile)     │ *       │
│ openai-compatible │ OpenAI-compatible endpoint │ openai-compatible  │ Wherever the endpoint you …  │ no                │         │
│ ollama            │ Ollama                     │ ollama             │ Local machine                │ yes (none-needed) │         │
│ …                 │                            │                    │                              │                   │         │
└───────────────────┴────────────────────────────┴────────────────────┴──────────────────────────────┴───────────────────┴─────────┘
```

`CONFIGURED` says where the key comes from: `profile` (stored by `add` or `onboard`), `env` (the environment variable in the table), `config` (a value left in `kolo.json` by an older setup), `none-needed` (local runtimes). `DEFAULT` marks the provider of `agents.defaults.model.primary`.

### add

```bash
# key on stdin (recommended in scripts and CI)
printf '%s' "$KEY" | kurahi providers add sakura --api-key-stdin

# key from a file with mode 0600
kurahi providers add openai-compatible --base-url https://llm.example/v1 --api-key-file ./key.txt --model llama-3.3-70b

# interactive: prompts for the key with masked input
kurahi providers add mistral
```

`add` writes `models.providers.<id>` (base URL, adapter, the model you named or the registry default) into `kolo.json` and stores the key in the auth profile store under `<id>:default` (file mode 0600 under the agent directory). The key never goes on the command line, never into `kolo.json`, and is never printed. Without a flag and without a terminal, `add` falls back to the environment variable named in the table and fails with exit 2 if it is unset.

Generic and per-resource entries (`openai-compatible`, `azure-openai`) need `--base-url`. For `ollama` no key is needed; the base URL defaults to the local daemon.

### test

```
$ kurahi providers test sakura
ok  sakura  412 ms  3 models
```

One request: `GET <models endpoint>` when the provider has one, otherwise a one-token chat completion. `--json` adds the model ids seen. A rejected key exits 4; an unreachable host exits 3.

### remove

```bash
kurahi providers remove openai-compatible --yes
```

Deletes the config entry, the `auth.profiles` reference and every stored credential for the provider. Without `--yes` the command asks on a terminal and refuses otherwise (exit 2).

### default

```bash
kurahi providers default sakura                 # sakura/gpt-oss-120b
kurahi providers default openai-compatible --model llama-3.3-70b
```

Sets `agents.defaults.model.primary`. Providers without a registry default need `--model` (or a model already configured by `add`).

### models list --live

```bash
kurahi models list --live
kurahi models list --live --provider sakura --json
```

For every provider that is wired (a config entry or a stored key) and has a models endpoint, fetches the current list and adds models the offline registry does not know, tagged `live`. Providers that fail are reported on stderr, one line each; the offline rows still print.

## Keeping the catalogue current

- `pnpm providers:sync` fetches the public catalogue, trims it to provider-level fields in `src/providers/upstream.json`, and regenerates `registry.json` from `registry.curated.json` plus the catalogue. Commit all three.
- `pnpm providers:sync --offline` regenerates from the committed `upstream.json` without network access.
- `pnpm providers:check` regenerates offline and fails when `registry.json` differs, so a hand edit of the generated file is caught.

A provider that needs a hand-written entry (a per-resource host, a different auth header, a region note) goes into `registry.curated.json`; a curated id always wins over the catalogue.

## Custom OpenAI-compatible endpoints

Any server that speaks the Chat Completions API (a local inference server, a gateway in your own VPC, a reseller) can be added through the generic entry:

```bash
printf '%s' "$KEY" | kurahi providers add openai-compatible --base-url https://llm.example/v1 --api-key-stdin --model my-model
kurahi providers test openai-compatible
kurahi providers default openai-compatible
```

To register a second endpoint of the same kind, add it by hand under `models.providers.<your-id>` in `kolo.json` with `api: "openai-completions"`, store its key with `kurahi models auth add`, and refer to it as `<your-id>/<model>`.

## Where secrets live

Provider keys are stored by the auth profile store (`agents/<agent>/agent/auth-profiles.json`, mode 0600) or come from the environment. `kolo.json` holds only the profile reference (`auth.profiles.<id>:default = { provider, mode: "api_key" }`). `kurahi secrets` holds other secrets referenced from config as `{"$secret": "<name>"}`; `kurahi providers` does not write there.

## Per-provider pages

- [Sakura AI Engine](/providers/sakura) (Japan-hosted default)
- [Ollama](/providers/ollama)
- [Models and fallbacks](/providers/models)
- [Index of provider pages](/providers/index)
