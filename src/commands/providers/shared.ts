// Shared pieces of `kolo providers` (KoLo 2.0, M9c).
//
// Keys never travel on argv or into kolo.json: they go to the auth profile store
// (`<id>:default`, file mode 0600 under the agent directory), which is where every other
// onboarding path puts provider keys and where the model registry reads them from.
import type { AuthProfileStore } from "../../agents/auth-profiles.js";
import type { KoLoConfig } from "../../config/config.js";
import type { ModelDefinitionConfig, ModelProviderConfig } from "../../config/types.models.js";
import {
  ensureAuthProfileStore,
  listProfilesForProvider,
  saveAuthProfileStore,
  upsertAuthProfile,
} from "../../agents/auth-profiles.js";
import { resolveEnvApiKey } from "../../agents/model-auth.js";
import { parseModelRef } from "../../agents/model-selection.js";
import {
  getProvider,
  listProviders,
  type ProviderRegistryEntry,
  registryApiToModelApi,
  registryBaseUrlForConfig,
} from "../../providers/registry.js";
import { DEFAULT_PROVIDER } from "../models/shared.js";

export const PROVIDERS_EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  unreachable: 3,
  auth: 4,
} as const;

export class ProvidersUsageError extends Error {
  readonly exitCode = PROVIDERS_EXIT.usage;
}

export class ProvidersCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = PROVIDERS_EXIT.error,
  ) {
    super(message);
  }
}

export const OLLAMA_LOCAL_PLACEHOLDER = "ollama-local";

export function resolveRegistryEntry(id: string): ProviderRegistryEntry {
  const entry = getProvider(id);
  if (!entry) {
    const known = listProviders()
      .map((p) => p.id)
      .join(", ");
    throw new ProvidersUsageError(`unknown provider id "${id}". Known ids: ${known}`);
  }
  return entry;
}

export type ProviderKeySource = "profile" | "env" | "config" | "none-needed";

/** Whether the provider can be used: a stored key, an environment variable, or no key needed. */
export function resolveProviderKey(params: {
  entry: ProviderRegistryEntry;
  cfg: KoLoConfig;
  store: AuthProfileStore;
  env?: NodeJS.ProcessEnv;
}): { configured: boolean; source?: ProviderKeySource; apiKey?: string } {
  const { entry, cfg, store } = params;
  const env = params.env ?? process.env;
  const profileIds = listProfilesForProvider(store, entry.id);
  for (const profileId of profileIds) {
    const cred = store.profiles[profileId];
    if (cred?.type === "api_key" && cred.key.trim()) {
      return { configured: true, source: "profile", apiKey: cred.key };
    }
    if (cred?.type === "token" && cred.token.trim()) {
      return { configured: true, source: "profile", apiKey: cred.token };
    }
  }
  const fromEnv = entry.envVar ? env[entry.envVar]?.trim() : undefined;
  if (fromEnv) {
    return { configured: true, source: "env", apiKey: fromEnv };
  }
  const resolvedEnv = resolveEnvApiKey(entry.id);
  if (resolvedEnv) {
    return { configured: true, source: "env", apiKey: resolvedEnv.apiKey };
  }
  const configured = cfg.models?.providers?.[entry.id];
  const inlineKey = configured?.apiKey?.trim();
  if (inlineKey && inlineKey !== OLLAMA_LOCAL_PLACEHOLDER) {
    // A `${ENV}` placeholder or a plaintext key left in kolo.json by an older setup.
    const envName = /^\$\{([A-Z0-9_]+)\}$/.exec(inlineKey)?.[1] ?? inlineKey;
    const value = env[envName]?.trim() ?? (envName === inlineKey ? inlineKey : undefined);
    if (value) {
      return { configured: true, source: "config", apiKey: value };
    }
  }
  if (entry.authHeader === "none") {
    return { configured: true, source: "none-needed" };
  }
  return { configured: false };
}

export function storeProviderKey(id: string, key: string, agentDir?: string): string {
  const profileId = `${id}:default`;
  upsertAuthProfile({
    profileId,
    credential: { type: "api_key", provider: id, key },
    agentDir,
  });
  return profileId;
}

/** Removes every stored credential for the provider; returns the profile ids removed. */
export function removeProviderKeys(id: string, agentDir?: string): string[] {
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const ids = listProfilesForProvider(store, id);
  if (ids.length === 0) {
    return [];
  }
  for (const profileId of ids) {
    delete store.profiles[profileId];
    if (store.lastGood?.[id]) {
      delete store.lastGood[id];
    }
  }
  if (store.order?.[id]) {
    delete store.order[id];
  }
  saveAuthProfileStore(store, agentDir);
  return ids;
}

export function buildModelDefinition(modelId: string): ModelDefinitionConfig {
  return {
    id: modelId,
    name: modelId,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

/** The `models.providers.<id>` entry `add` writes; existing models are kept. */
export function buildProviderConfig(params: {
  entry: ProviderRegistryEntry;
  baseUrl?: string;
  model?: string;
  existing?: ModelProviderConfig;
}): ModelProviderConfig {
  const { entry, existing } = params;
  const baseUrl = registryBaseUrlForConfig(entry, params.baseUrl);
  const modelId = params.model?.trim() || entry.defaultModel;
  const existingModels = Array.isArray(existing?.models) ? existing.models : [];
  const models =
    modelId && !existingModels.some((m) => m.id === modelId)
      ? [...existingModels, buildModelDefinition(modelId)]
      : existingModels;
  const { apiKey: _dropped, ...rest } = existing ?? ({} as ModelProviderConfig);
  const next: ModelProviderConfig = {
    ...rest,
    baseUrl,
    api: registryApiToModelApi(entry.apiStyle),
    models,
  };
  if (entry.apiStyle === "ollama") {
    next.apiKey = OLLAMA_LOCAL_PLACEHOLDER;
    next.authHeader = false;
  } else if (entry.authHeader === "none") {
    next.authHeader = false;
  }
  if (entry.apiStyle === "anthropic-messages") {
    next.headers = { ...next.headers, "anthropic-version": "2023-06-01" };
  }
  return next;
}

export function resolveBaseUrlForAdd(entry: ProviderRegistryEntry, raw?: string): string {
  const given = raw?.trim();
  if (given) {
    if (!/^https?:\/\//i.test(given)) {
      throw new ProvidersUsageError("--base-url must start with http:// or https://");
    }
    return given;
  }
  if (entry.requiresBaseUrl) {
    throw new ProvidersUsageError(
      `provider "${entry.id}" needs --base-url <url>${
        entry.baseUrl ? ` (template: ${entry.baseUrl})` : ""
      }`,
    );
  }
  return entry.baseUrl;
}

/** `provider/model` of the current primary model, when set. */
export function resolvePrimaryModelRef(
  cfg: KoLoConfig,
): { provider: string; model: string } | null {
  const primary = cfg.agents?.defaults?.model?.primary?.trim();
  if (!primary) {
    return null;
  }
  const parsed = parseModelRef(primary, DEFAULT_PROVIDER);
  return parsed ? { provider: parsed.provider, model: parsed.model } : null;
}

export async function readKeyFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export function validateKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new ProvidersUsageError("the key is empty");
  }
  if (/\s/.test(trimmed)) {
    throw new ProvidersUsageError("the key contains whitespace");
  }
  return trimmed;
}
