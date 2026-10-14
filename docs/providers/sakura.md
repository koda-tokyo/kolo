---
summary: "Sakura AI Engine: Japan-hosted, OpenAI-compatible models with a free tier; the default profile for evaluations"
read_when:
  - Setting up the default model provider on a new installation
  - You need a provider whose data stays in Japan
title: "Sakura AI Engine"
---

# Sakura AI Engine

Sakura AI Engine (さくらのAI Engine) is an inference service operated by Sakura Internet and hosted in Japan. It exposes an OpenAI-compatible Chat Completions API, so KoLo talks to it with the standard `openai-completions` adapter. It is the first profile `kolo init` offers and the default for evaluations: no card details are needed to start, and prompts do not leave Japan.

Japanese version: [さくらのAI Engine](/ja/providers/sakura).

## Facts (verified 2026-10-13 against the official pages)

| Item | Value |
|---|---|
| Base URL | `https://api.ai.sakura.ad.jp/v1` |
| Chat endpoint | `POST https://api.ai.sakura.ad.jp/v1/chat/completions` |
| Authentication | `Authorization: Bearer <API token>` (token issued in the control panel) |
| Default model in KoLo | `sakura/gpt-oss-120b` |
| Other models in the preset | `llm-jp-3.1-8x13b-instruct`; `Kimi-K2.6` (public preview) |
| Free tier | 3,000 chat requests per month on `gpt-oss-120b`; resets monthly; beyond that the free plan is rate limited and does not switch to paid billing by itself |
| Pay-as-you-go (gpt-oss-120b) | JPY 0.15 per 10k input tokens, JPY 0.75 per 10k output tokens (tax included) |
| Official pages | https://ai.sakura.ad.jp/sakura-ai/ai-engine/ · API reference https://manual.sakura.ad.jp/api/cloud/portal/ai-engine-inference-api/index.html |

The model list in the control panel is authoritative; the preset in KoLo carries the models above and you can add others under `models.providers.sakura.models` in `kolo.json`.

## Register and get a token

1. Create a Sakura Internet member ID (phone verification required).
2. Create a Sakura Cloud project (a card is registered to the account; the free tier itself is not charged).
3. Open the AI Engine control panel at https://secure.sakura.ad.jp/ai/ and issue an API token.

## Configure KoLo

Interactive, on first run:

```bash
kolo init          # choose "Sakura AI Engine", paste the token
```

Without prompts:

```bash
SAKURA_API_KEY=<token> kolo init --non-interactive --provider sakura
```

Existing installation:

```bash
kolo onboard --auth-choice sakura-api-key
# or
kolo secrets set SAKURA_API_KEY --stdin
kolo config set agents.defaults.model.primary sakura/gpt-oss-120b
```

The token is stored in the auth profile `sakura:default` under `KOLO_HOME` (file mode 0600), never in `kolo.json`. The environment variable `SAKURA_API_KEY` is honoured as an alternative.

Verify:

```bash
kolo models list         # sakura/gpt-oss-120b listed as available
kolo tui --message "Say hello in one line"
```

## Notes for evaluators

- Requests count against the free tier per request, not per token; a long conversation is still one request per turn.
- The service is in Japan (Sakura Internet data centres); check the provider's terms for the current data-handling statement before sending regulated data.
- To fall back to another provider when the monthly quota is used up, set `agents.defaults.model.fallbacks` (see [Models](/providers/models)).
