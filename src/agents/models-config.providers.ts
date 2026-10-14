import type { KoLoConfig } from "../config/config.js";
import type { ModelDefinitionConfig } from "../config/types.models.js";
import {
  DEFAULT_COPILOT_API_BASE_URL,
  resolveCopilotApiToken,
} from "../providers/github-copilot-token.js";
import { ensureAuthProfileStore, listProfilesForProvider } from "./auth-profiles.js";
import { discoverBedrockModels } from "./bedrock-discovery.js";
import { resolveAwsSdkEnvVarName, resolveEnvApiKey } from "./model-auth.js";
import {
  buildSyntheticModelDefinition,
  SYNTHETIC_BASE_URL,
  SYNTHETIC_MODEL_CATALOG,
} from "./synthetic-models.js";
import { discoverVeniceModels, VENICE_BASE_URL } from "./venice-models.js";

type ModelsConfig = NonNullable<KoLoConfig["models"]>;
export type ProviderConfig = NonNullable<ModelsConfig["providers"]>[string];

const MINIMAX_API_BASE_URL = "https://api.minimax.chat/v1";
const MINIMAX_PORTAL_BASE_URL = "https://api.minimax.io/anthropic";
const MINIMAX_DEFAULT_MODEL_ID = "MiniMax-M2.1";
const MINIMAX_DEFAULT_VISION_MODEL_ID = "MiniMax-VL-01";
const MINIMAX_DEFAULT_CONTEXT_WINDOW = 200000;
const MINIMAX_DEFAULT_MAX_TOKENS = 8192;
const MINIMAX_OAUTH_PLACEHOLDER = "minimax-oauth";
// Pricing: MiniMax doesn't publish public rates. Override in models.json for accurate costs.
const MINIMAX_API_COST = {
  input: 15,
  output: 60,
  cacheRead: 2,
  cacheWrite: 10,
};

const XIAOMI_BASE_URL = "https://api.xiaomimimo.com/anthropic";
export const XIAOMI_DEFAULT_MODEL_ID = "mimo-v2-flash";
const XIAOMI_DEFAULT_CONTEXT_WINDOW = 262144;
const XIAOMI_DEFAULT_MAX_TOKENS = 8192;
const XIAOMI_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

// Sakura AI Engine (Japan-hosted, OpenAI-compatible). Models per the control panel; the free
// tier covers 3,000 chat requests a month on gpt-oss-120b.
const SAKURA_BASE_URL = "https://api.ai.sakura.ad.jp/v1";
const SAKURA_DEFAULT_CONTEXT_WINDOW = 128000;
const SAKURA_DEFAULT_MAX_TOKENS = 8192;
const SAKURA_DEFAULT_COST = { input: 0.1, output: 0.5, cacheRead: 0, cacheWrite: 0 };
const MOONSHOT_BASE_URL = "https://api.moonshot.ai/v1";
const MOONSHOT_DEFAULT_MODEL_ID = "kimi-k2.5";
const MOONSHOT_DEFAULT_CONTEXT_WINDOW = 256000;
const MOONSHOT_DEFAULT_MAX_TOKENS = 8192;
const MOONSHOT_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

// DeepSeek V4 Pro — discounted rates until 2026-05-31, then jump to regular pricing.
// TODO 2026-05-31: Update costs to regular rates:
//   input: 1.74, output: 3.48, cacheRead: 0.0145
// See: https://api-docs.deepseek.com/quick_start/pricing
const DEEPSEEK_V4_PRO_COST = {
  input: 0.435,
  output: 0.87,
  cacheRead: 0.003625,
  cacheWrite: 0, // DeepSeek caches automatically; no separate write price
};

// DeepSeek V4 Flash — listed = regular pricing (no discount window)
const DEEPSEEK_V4_FLASH_COST = {
  input: 0.14,
  output: 0.28,
  cacheRead: 0.0028,
  cacheWrite: 0, // DeepSeek caches automatically
};

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEEPSEEK_DEFAULT_CONTEXT_WINDOW = 128000;
const DEEPSEEK_DEFAULT_MAX_TOKENS = 8192;

const QWEN_PORTAL_BASE_URL = "https://portal.qwen.ai/v1";
const QWEN_PORTAL_OAUTH_PLACEHOLDER = "qwen-oauth";
const QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW = 128000;
const QWEN_PORTAL_DEFAULT_MAX_TOKENS = 8192;
const QWEN_PORTAL_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

const OLLAMA_BASE_URL = "http://localhost:11434/v1";
const OLLAMA_API_BASE_URL = "http://localhost:11434";
const OLLAMA_LOCAL_AUTH_PLACEHOLDER = "ollama-local";

// Ollama discovery is non-blocking and best-effort.
// If Ollama is slow/unavailable, the hardcoded defaults are used.
// Discovery only *updates* the model list — it never blocks agent calls.
const OLLAMA_HEALTH_TIMEOUT_MS = 3000; // Fast health ping
const OLLAMA_DISCOVERY_TIMEOUT_MS = 5000; // Full model list fetch
const OLLAMA_DISCOVERY_CACHE_TTL_MS = 10 * 60 * 1000; // Cache successes for 10 min
const OLLAMA_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000; // Cache failures for 5 min
const OLLAMA_DISCOVERY_WARN_TTL_MS = 60 * 60 * 1000; // Warn once per hour
const OLLAMA_DEFAULT_CONTEXT_WINDOW = 128000;
const OLLAMA_DEFAULT_MAX_TOKENS = 8192;
const OLLAMA_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    family?: string;
    parameter_size?: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

type OllamaDiscoveryCacheEntry = {
  baseUrl: string;
  models: ModelDefinitionConfig[];
  fetchedAt: number;
};

type OllamaFailureCacheEntry = {
  baseUrl: string;
  failedAt: number;
};

type OllamaDiscoveryWarnEntry = {
  baseUrl: string;
  message: string;
  loggedAt: number;
};

let ollamaDiscoveryCache: OllamaDiscoveryCacheEntry | null = null;
let ollamaFailureCache: OllamaFailureCacheEntry | null = null;
let ollamaDiscoveryWarn: OllamaDiscoveryWarnEntry | null = null;

function normalizeUrlBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function resolveOllamaApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OLLAMA_BASE_URL?.trim() || env.OLLAMA_HOST?.trim() || OLLAMA_API_BASE_URL;
  const normalized = normalizeUrlBase(raw);
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`;
}

function resolveOllamaTagsBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const apiBase = resolveOllamaApiBaseUrl(env);
  return apiBase.endsWith("/v1") ? apiBase.slice(0, -3) : apiBase;
}

function maybeWarnOllamaDiscovery(_baseUrl: string, _message: string): void {
  // Silently no-op. Ollama discovery failures are cached and non-blocking.
  // We don't warn because:
  // 1. console.warn goes to stderr → pnpm treats it as command failure
  // 2. The failure is already cached, so we won't retry for 5 minutes
  // 3. Hardcoded defaults are used, so the agent works regardless
  // If Ollama is needed, the operator will see "no models found" in logs.
}

async function discoverOllamaModels(): Promise<ModelDefinitionConfig[]> {
  // Skip Ollama discovery in test environments
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return [];
  }
  const apiBaseUrl = resolveOllamaApiBaseUrl();
  const tagsBaseUrl = resolveOllamaTagsBaseUrl();
  const now = Date.now();

  // Check success cache
  if (
    ollamaDiscoveryCache &&
    ollamaDiscoveryCache.baseUrl === apiBaseUrl &&
    now - ollamaDiscoveryCache.fetchedAt < OLLAMA_DISCOVERY_CACHE_TTL_MS
  ) {
    return ollamaDiscoveryCache.models;
  }

  // Check failure cache — if Ollama recently failed, skip immediately
  if (
    ollamaFailureCache &&
    ollamaFailureCache.baseUrl === apiBaseUrl &&
    now - ollamaFailureCache.failedAt < OLLAMA_FAILURE_CACHE_TTL_MS
  ) {
    return []; // Silent skip — we already warned recently
  }

  // ── Health check: fast ping to see if Ollama is alive ──────────────────
  // This prevents wasting 8s on a full discovery when Ollama is down.
  // The /api/version endpoint is lightweight and responds in <100ms when alive.
  try {
    const healthResp = await fetch(`${tagsBaseUrl}/api/version`, {
      signal: AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS),
    });
    if (!healthResp.ok) {
      // Ollama is up but returning errors — log once, cache failure
      maybeWarnOllamaDiscovery(apiBaseUrl, `Ollama health check failed: HTTP ${healthResp.status}`);
      ollamaFailureCache = { baseUrl: apiBaseUrl, failedAt: Date.now() };
      return [];
    }
  } catch (healthErr) {
    // Ollama is down — don't retry full discovery, cache the failure
    // Only warn once per OLLAMA_DISCOVERY_WARN_TTL_MS to avoid spam
    if (!ollamaFailureCache || ollamaFailureCache.baseUrl !== apiBaseUrl) {
      maybeWarnOllamaDiscovery(
        apiBaseUrl,
        `Ollama not reachable at ${tagsBaseUrl}: ${String(healthErr)}`,
      );
    }
    ollamaFailureCache = { baseUrl: apiBaseUrl, failedAt: Date.now() };
    return [];
  }

  // ── Full discovery: Ollama is alive, fetch model list ──────────────────
  try {
    const response = await fetch(`${tagsBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      maybeWarnOllamaDiscovery(apiBaseUrl, `Ollama /api/tags returned ${response.status}`);
      ollamaFailureCache = { baseUrl: apiBaseUrl, failedAt: Date.now() };
      return [];
    }
    const data = (await response.json()) as OllamaTagsResponse;
    if (!data.models || data.models.length === 0) {
      maybeWarnOllamaDiscovery(apiBaseUrl, "Ollama has no models downloaded");
      ollamaFailureCache = { baseUrl: apiBaseUrl, failedAt: Date.now() };
      return [];
    }
    const models: ModelDefinitionConfig[] = data.models.map((model) => {
      const modelId = model.name;
      const isReasoning =
        modelId.toLowerCase().includes("r1") || modelId.toLowerCase().includes("reasoning");
      return {
        id: modelId,
        name: modelId,
        reasoning: isReasoning,
        input: ["text"] as Array<"text" | "image">,
        cost: OLLAMA_DEFAULT_COST,
        contextWindow: OLLAMA_DEFAULT_CONTEXT_WINDOW,
        maxTokens: OLLAMA_DEFAULT_MAX_TOKENS,
      };
    });
    // Success — cache models, clear failure cache
    ollamaDiscoveryCache = {
      baseUrl: apiBaseUrl,
      models,
      fetchedAt: Date.now(),
    };
    ollamaFailureCache = null;
    return models;
  } catch (error) {
    maybeWarnOllamaDiscovery(apiBaseUrl, `Ollama discovery failed: ${String(error)}`);
    ollamaFailureCache = { baseUrl: apiBaseUrl, failedAt: Date.now() };
    return [];
  }
}

function normalizeApiKeyConfig(value: string): string {
  const trimmed = value.trim();
  const match = /^\$\{([A-Z0-9_]+)\}$/.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function resolveEnvApiKeyVarName(provider: string): string | undefined {
  const resolved = resolveEnvApiKey(provider);
  if (!resolved) {
    return undefined;
  }
  const match = /^(?:env: |shell env: )([A-Z0-9_]+)$/.exec(resolved.source);
  return match ? match[1] : undefined;
}

function resolveAwsSdkApiKeyVarName(): string {
  return resolveAwsSdkEnvVarName() ?? "AWS_PROFILE";
}

function resolveApiKeyFromProfiles(params: {
  provider: string;
  store: ReturnType<typeof ensureAuthProfileStore>;
}): string | undefined {
  const ids = listProfilesForProvider(params.store, params.provider);
  for (const id of ids) {
    const cred = params.store.profiles[id];
    if (!cred) {
      continue;
    }
    if (cred.type === "api_key") {
      return cred.key;
    }
    if (cred.type === "token") {
      return cred.token;
    }
  }
  return undefined;
}

export function normalizeGoogleModelId(id: string): string {
  if (id === "gemini-3-pro") {
    return "gemini-3-pro-preview";
  }
  if (id === "gemini-3-flash") {
    return "gemini-3-flash-preview";
  }
  return id;
}

function normalizeGoogleProvider(provider: ProviderConfig): ProviderConfig {
  let mutated = false;
  const models = provider.models.map((model) => {
    const nextId = normalizeGoogleModelId(model.id);
    if (nextId === model.id) {
      return model;
    }
    mutated = true;
    return { ...model, id: nextId };
  });
  return mutated ? { ...provider, models } : provider;
}

export function normalizeProviders(params: {
  providers: ModelsConfig["providers"];
  agentDir: string;
}): ModelsConfig["providers"] {
  const { providers } = params;
  if (!providers) {
    return providers;
  }
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  let mutated = false;
  const next: Record<string, ProviderConfig> = {};

  for (const [key, provider] of Object.entries(providers)) {
    const normalizedKey = key.trim();
    let normalizedProvider = provider;

    // Fix common misconfig: apiKey set to "${ENV_VAR}" instead of "ENV_VAR".
    if (
      normalizedProvider.apiKey &&
      normalizeApiKeyConfig(normalizedProvider.apiKey) !== normalizedProvider.apiKey
    ) {
      mutated = true;
      normalizedProvider = {
        ...normalizedProvider,
        apiKey: normalizeApiKeyConfig(normalizedProvider.apiKey),
      };
    }

    // If a provider defines models, pi's ModelRegistry requires apiKey to be set.
    // Fill it from the environment or auth profiles when possible.
    const hasModels =
      Array.isArray(normalizedProvider.models) && normalizedProvider.models.length > 0;
    if (hasModels && !normalizedProvider.apiKey?.trim()) {
      const authMode =
        normalizedProvider.auth ?? (normalizedKey === "amazon-bedrock" ? "aws-sdk" : undefined);
      if (authMode === "aws-sdk") {
        const apiKey = resolveAwsSdkApiKeyVarName();
        mutated = true;
        normalizedProvider = { ...normalizedProvider, apiKey };
      } else if (normalizedKey === "ollama") {
        mutated = true;
        normalizedProvider = {
          ...normalizedProvider,
          apiKey: OLLAMA_LOCAL_AUTH_PLACEHOLDER,
          authHeader: false,
        };
      } else {
        const fromEnv = resolveEnvApiKeyVarName(normalizedKey);
        const fromProfiles = resolveApiKeyFromProfiles({
          provider: normalizedKey,
          store: authStore,
        });
        const apiKey = fromEnv ?? fromProfiles;
        if (apiKey?.trim()) {
          mutated = true;
          normalizedProvider = { ...normalizedProvider, apiKey };
        }
      }
    }

    if (
      normalizedKey === "ollama" &&
      normalizedProvider.apiKey === OLLAMA_LOCAL_AUTH_PLACEHOLDER &&
      normalizedProvider.authHeader !== false
    ) {
      mutated = true;
      normalizedProvider = {
        ...normalizedProvider,
        authHeader: false,
      };
    }

    if (normalizedKey === "google") {
      const googleNormalized = normalizeGoogleProvider(normalizedProvider);
      if (googleNormalized !== normalizedProvider) {
        mutated = true;
      }
      normalizedProvider = googleNormalized;
    }

    next[key] = normalizedProvider;
  }

  return mutated ? next : providers;
}

function buildMinimaxProvider(): ProviderConfig {
  return {
    baseUrl: MINIMAX_API_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: MINIMAX_DEFAULT_MODEL_ID,
        name: "MiniMax M2.1",
        reasoning: false,
        input: ["text"],
        cost: MINIMAX_API_COST,
        contextWindow: MINIMAX_DEFAULT_CONTEXT_WINDOW,
        maxTokens: MINIMAX_DEFAULT_MAX_TOKENS,
      },
      {
        id: MINIMAX_DEFAULT_VISION_MODEL_ID,
        name: "MiniMax VL 01",
        reasoning: false,
        input: ["text", "image"],
        cost: MINIMAX_API_COST,
        contextWindow: MINIMAX_DEFAULT_CONTEXT_WINDOW,
        maxTokens: MINIMAX_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

function buildMinimaxPortalProvider(): ProviderConfig {
  return {
    baseUrl: MINIMAX_PORTAL_BASE_URL,
    api: "anthropic-messages",
    models: [
      {
        id: MINIMAX_DEFAULT_MODEL_ID,
        name: "MiniMax M2.1",
        reasoning: false,
        input: ["text"],
        cost: MINIMAX_API_COST,
        contextWindow: MINIMAX_DEFAULT_CONTEXT_WINDOW,
        maxTokens: MINIMAX_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

function buildSakuraProvider(): ProviderConfig {
  const model = (id: string, name: string, reasoning: boolean) => ({
    id,
    name,
    reasoning,
    input: ["text"] as ["text"],
    cost: SAKURA_DEFAULT_COST,
    contextWindow: SAKURA_DEFAULT_CONTEXT_WINDOW,
    maxTokens: SAKURA_DEFAULT_MAX_TOKENS,
  });
  return {
    baseUrl: SAKURA_BASE_URL,
    api: "openai-completions",
    models: [
      model("gpt-oss-120b", "gpt-oss-120b", true),
      model("llm-jp-3.1-8x13b-instruct", "LLM-jp 3.1 8x13B Instruct", false),
      model("Kimi-K2.6", "Kimi K2.6 (public preview)", false),
    ],
  };
}

function buildMoonshotProvider(): ProviderConfig {
  return {
    baseUrl: MOONSHOT_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: MOONSHOT_DEFAULT_MODEL_ID,
        name: "Kimi K2.5",
        reasoning: false,
        input: ["text"],
        cost: MOONSHOT_DEFAULT_COST,
        contextWindow: MOONSHOT_DEFAULT_CONTEXT_WINDOW,
        maxTokens: MOONSHOT_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

function buildDeepSeekProvider(): ProviderConfig {
  return {
    baseUrl: DEEPSEEK_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        reasoning: true,
        input: ["text"],
        cost: DEEPSEEK_V4_PRO_COST,
        contextWindow: DEEPSEEK_DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
      },
      {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        reasoning: false,
        input: ["text"],
        cost: DEEPSEEK_V4_FLASH_COST,
        contextWindow: DEEPSEEK_DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

function buildQwenPortalProvider(): ProviderConfig {
  return {
    baseUrl: QWEN_PORTAL_BASE_URL,
    api: "openai-completions",
    models: [
      {
        id: "qwen-max",
        name: "Qwen Max",
        reasoning: true,
        input: ["text"],
        cost: QWEN_PORTAL_DEFAULT_COST,
        contextWindow: 1000000,
        maxTokens: 32768,
      },
      {
        id: "qwen-plus",
        name: "Qwen Plus",
        reasoning: false,
        input: ["text"],
        cost: QWEN_PORTAL_DEFAULT_COST,
        contextWindow: QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW,
        maxTokens: QWEN_PORTAL_DEFAULT_MAX_TOKENS,
      },
      {
        id: "coder-model",
        name: "Qwen Coder",
        reasoning: false,
        input: ["text"],
        cost: QWEN_PORTAL_DEFAULT_COST,
        contextWindow: QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW,
        maxTokens: QWEN_PORTAL_DEFAULT_MAX_TOKENS,
      },
      {
        id: "vision-model",
        name: "Qwen Vision",
        reasoning: false,
        input: ["text", "image"],
        cost: QWEN_PORTAL_DEFAULT_COST,
        contextWindow: QWEN_PORTAL_DEFAULT_CONTEXT_WINDOW,
        maxTokens: QWEN_PORTAL_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

function buildSyntheticProvider(): ProviderConfig {
  return {
    baseUrl: SYNTHETIC_BASE_URL,
    api: "anthropic-messages",
    models: SYNTHETIC_MODEL_CATALOG.map(buildSyntheticModelDefinition),
  };
}

export function buildXiaomiProvider(): ProviderConfig {
  return {
    baseUrl: XIAOMI_BASE_URL,
    api: "anthropic-messages",
    models: [
      {
        id: XIAOMI_DEFAULT_MODEL_ID,
        name: "Xiaomi MiMo V2 Flash",
        reasoning: false,
        input: ["text"],
        cost: XIAOMI_DEFAULT_COST,
        contextWindow: XIAOMI_DEFAULT_CONTEXT_WINDOW,
        maxTokens: XIAOMI_DEFAULT_MAX_TOKENS,
      },
    ],
  };
}

async function buildVeniceProvider(): Promise<ProviderConfig> {
  const models = await discoverVeniceModels();
  return {
    baseUrl: VENICE_BASE_URL,
    api: "openai-completions",
    models,
  };
}

// Hardcoded Ollama defaults — used when discovery fails or hasn't run yet.
// These match the models present on this machine.
const OLLAMA_DEFAULT_MODELS: ModelDefinitionConfig[] = [
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    reasoning: false,
    input: ["text"],
    cost: OLLAMA_DEFAULT_COST,
    contextWindow: OLLAMA_DEFAULT_CONTEXT_WINDOW,
    maxTokens: OLLAMA_DEFAULT_MAX_TOKENS,
  },
  {
    id: "qwen2.5:1.5b",
    name: "Qwen 2.5 1.5B",
    reasoning: false,
    input: ["text"],
    cost: OLLAMA_DEFAULT_COST,
    contextWindow: OLLAMA_DEFAULT_CONTEXT_WINDOW,
    maxTokens: OLLAMA_DEFAULT_MAX_TOKENS,
  },
];

function buildOllamaProvider(): ProviderConfig {
  // Fire-and-forget discovery — updates cache for next time.
  // Never blocks the provider build.
  discoverOllamaModels().catch(() => {
    // Discovery failures are already logged and cached — ignore here
  });

  // Return hardcoded defaults immediately — never block on Ollama
  return {
    baseUrl: resolveOllamaApiBaseUrl(),
    api: "openai-completions",
    models: ollamaDiscoveryCache?.models ?? OLLAMA_DEFAULT_MODELS,
  };
}

export async function resolveImplicitProviders(params: {
  agentDir: string;
}): Promise<ModelsConfig["providers"]> {
  const providers: Record<string, ProviderConfig> = {};
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });

  const minimaxKey =
    resolveEnvApiKeyVarName("minimax") ??
    resolveApiKeyFromProfiles({ provider: "minimax", store: authStore });
  if (minimaxKey) {
    providers.minimax = { ...buildMinimaxProvider(), apiKey: minimaxKey };
  }

  const minimaxOauthProfile = listProfilesForProvider(authStore, "minimax-portal");
  if (minimaxOauthProfile.length > 0) {
    providers["minimax-portal"] = {
      ...buildMinimaxPortalProvider(),
      apiKey: MINIMAX_OAUTH_PLACEHOLDER,
    };
  }

  const sakuraKey =
    resolveEnvApiKeyVarName("sakura") ??
    resolveApiKeyFromProfiles({ provider: "sakura", store: authStore });
  if (sakuraKey) {
    providers.sakura = { ...buildSakuraProvider(), apiKey: sakuraKey };
  }

  const moonshotKey =
    resolveEnvApiKeyVarName("moonshot") ??
    resolveApiKeyFromProfiles({ provider: "moonshot", store: authStore });
  if (moonshotKey) {
    providers.moonshot = { ...buildMoonshotProvider(), apiKey: moonshotKey };
  }

  const syntheticKey =
    resolveEnvApiKeyVarName("synthetic") ??
    resolveApiKeyFromProfiles({ provider: "synthetic", store: authStore });
  if (syntheticKey) {
    providers.synthetic = { ...buildSyntheticProvider(), apiKey: syntheticKey };
  }

  const veniceKey =
    resolveEnvApiKeyVarName("venice") ??
    resolveApiKeyFromProfiles({ provider: "venice", store: authStore });
  if (veniceKey) {
    providers.venice = { ...(await buildVeniceProvider()), apiKey: veniceKey };
  }

  const qwenProfiles = listProfilesForProvider(authStore, "qwen-portal");
  if (qwenProfiles.length > 0) {
    providers["qwen-portal"] = {
      ...buildQwenPortalProvider(),
      apiKey: QWEN_PORTAL_OAUTH_PLACEHOLDER,
    };
  }

  const xiaomiKey =
    resolveEnvApiKeyVarName("xiaomi") ??
    resolveApiKeyFromProfiles({ provider: "xiaomi", store: authStore });
  if (xiaomiKey) {
    providers.xiaomi = { ...buildXiaomiProvider(), apiKey: xiaomiKey };
  }

  const deepseekKey =
    resolveEnvApiKeyVarName("deepseek") ??
    resolveApiKeyFromProfiles({ provider: "deepseek", store: authStore });
  if (deepseekKey) {
    providers.deepseek = { ...buildDeepSeekProvider(), apiKey: deepseekKey };
  }

  // Ollama provider - add when a local endpoint or auth is explicitly configured
  const ollamaKey =
    resolveEnvApiKeyVarName("ollama") ??
    resolveApiKeyFromProfiles({ provider: "ollama", store: authStore });
  const ollamaConfigured = Boolean(
    ollamaKey || process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_HOST?.trim(),
  );
  if (ollamaConfigured) {
    providers.ollama = {
      ...(await buildOllamaProvider()),
      apiKey: ollamaKey ?? OLLAMA_LOCAL_AUTH_PLACEHOLDER,
      authHeader: Boolean(ollamaKey),
    };
  }

  return providers;
}

export async function resolveImplicitCopilotProvider(params: {
  agentDir: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProviderConfig | null> {
  const env = params.env ?? process.env;
  const authStore = ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false });
  const hasProfile = listProfilesForProvider(authStore, "github-copilot").length > 0;
  const envToken = env.COPILOT_GITHUB_TOKEN ?? env.GH_TOKEN ?? env.GITHUB_TOKEN;
  const githubToken = (envToken ?? "").trim();

  if (!hasProfile && !githubToken) {
    return null;
  }

  let selectedGithubToken = githubToken;
  if (!selectedGithubToken && hasProfile) {
    // Use the first available profile as a default for discovery (it will be
    // re-resolved per-run by the embedded runner).
    const profileId = listProfilesForProvider(authStore, "github-copilot")[0];
    const profile = profileId ? authStore.profiles[profileId] : undefined;
    if (profile && profile.type === "token") {
      selectedGithubToken = profile.token;
    }
  }

  let baseUrl = DEFAULT_COPILOT_API_BASE_URL;
  if (selectedGithubToken) {
    try {
      const token = await resolveCopilotApiToken({
        githubToken: selectedGithubToken,
        env,
      });
      baseUrl = token.baseUrl;
    } catch {
      baseUrl = DEFAULT_COPILOT_API_BASE_URL;
    }
  }

  // pi-coding-agent's ModelRegistry marks a model "available" only if its
  // `AuthStorage` has auth configured for that provider (via auth.json/env/etc).
  // Our Copilot auth lives in KoLo's auth-profiles store instead, so we also
  // write a runtime-only auth.json entry for pi-coding-agent to pick up.
  //
  // This is safe because it's (1) within KoLo's agent dir, (2) contains the
  // GitHub token (not the exchanged Copilot token), and (3) matches existing
  // patterns for OAuth-like providers in pi-coding-agent.
  // Note: we deliberately do not write pi-coding-agent's `auth.json` here.
  // KoLo uses its own auth store and exchanges tokens at runtime.
  // `models list` uses KoLo's auth heuristics for availability.

  // We intentionally do NOT define custom models for Copilot in models.json.
  // pi-coding-agent treats providers with models as replacements requiring apiKey.
  // We only override baseUrl; the model list comes from pi-ai built-ins.
  return {
    baseUrl,
    models: [],
  } satisfies ProviderConfig;
}

export async function resolveImplicitBedrockProvider(params: {
  agentDir: string;
  config?: KoLoConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<ProviderConfig | null> {
  const env = params.env ?? process.env;
  const discoveryConfig = params.config?.models?.bedrockDiscovery;
  const enabled = discoveryConfig?.enabled;
  const hasAwsCreds = resolveAwsSdkEnvVarName(env) !== undefined;
  if (enabled === false) {
    return null;
  }
  if (enabled !== true && !hasAwsCreds) {
    return null;
  }

  const region = discoveryConfig?.region ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1";
  const models = await discoverBedrockModels({ region, config: discoveryConfig });
  if (models.length === 0) {
    return null;
  }

  return {
    baseUrl: `https://bedrock-runtime.${region}.amazonaws.com`,
    api: "bedrock-converse-stream",
    auth: "aws-sdk",
    models,
  } satisfies ProviderConfig;
}
