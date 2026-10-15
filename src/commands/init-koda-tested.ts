// `kurahi init --provider koda-tested`: choose the best model from the KODA tested catalogue that
// this machine can run — a provider key is stored or set in the provider's environment variable,
// or the model is pulled on the local model server — optionally limited to a residency. Keys
// found in the environment are copied to the auth profile store, never into kolo.json.
import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { KoLoConfig } from "../config/config.js";
import { type Catalogue, pickBestModel, type Residency } from "../model-bench/catalogue.js";
import { getProvider, registryModelsUrl } from "../providers/registry.js";
import { applyAuthProfileConfig } from "./onboard-auth.config-core.js";
import { buildProviderConfig, resolveProviderKey, storeProviderKey } from "./providers/shared.js";

export type KodaTestedDeps = {
  store: AuthProfileStore;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  catalogue?: Catalogue;
  /** Persist a key found in the environment (default: the auth profile store). */
  storeKey?: (providerId: string, key: string) => string;
};

/** Model ids pulled on the local model server, or [] when it does not answer within 1.5 s. */
export async function listLocalModels(
  baseUrl: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  const entry = getProvider("ollama");
  const url = entry ? registryModelsUrl(entry, baseUrl?.replace(/\/v1\/?$/, "")) : null;
  if (!url) {
    return [];
  }
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as { models?: Array<{ name?: unknown; model?: unknown }> };
    return (body.models ?? [])
      .map((m) =>
        typeof m.name === "string" ? m.name : typeof m.model === "string" ? m.model : "",
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function applyKodaTestedProfile(
  cfg: KoLoConfig,
  opts: { residency?: Residency },
  deps: KodaTestedDeps,
): Promise<{ config: KoLoConfig; summary: string; ref?: string }> {
  const env = deps.env ?? process.env;
  const local = await listLocalModels(cfg.models?.providers?.ollama?.baseUrl, deps.fetchFn);
  const keys = new Map<string, ReturnType<typeof resolveProviderKey>>();
  const available = (providerId: string, modelId: string): boolean => {
    const entry = getProvider(providerId);
    if (!entry) {
      return false;
    }
    if (entry.apiStyle === "ollama") {
      return local.includes(modelId);
    }
    if (!keys.has(providerId)) {
      keys.set(providerId, resolveProviderKey({ entry, cfg, store: deps.store, env }));
    }
    return keys.get(providerId)?.configured === true;
  };
  const pick = pickBestModel({
    catalogue: deps.catalogue,
    available,
    residency: opts.residency,
  });
  if (!pick) {
    return {
      config: cfg,
      summary: `koda-tested: no tested model matches the keys on this machine${
        opts.residency ? ` and residency ${opts.residency}` : ""
      }; see kurahi models tested`,
    };
  }
  const { provider, model } = pick.entry;
  const entry = getProvider(provider);
  if (!entry) {
    return { config: cfg, summary: `koda-tested: provider ${provider} is not in the registry` };
  }
  const providers = { ...cfg.models?.providers };
  providers[provider] = buildProviderConfig({ entry, model, existing: providers[provider] });
  const ref = `${provider}/${model}`;
  let next: KoLoConfig = {
    ...cfg,
    models: { mode: cfg.models?.mode ?? "merge", providers },
    agents: { ...cfg.agents, defaults: { ...cfg.agents?.defaults, model: { primary: ref } } },
  };
  const key = keys.get(provider);
  if (key?.source === "env" && key.apiKey) {
    const profileId = (deps.storeKey ?? storeProviderKey)(provider, key.apiKey);
    next = applyAuthProfileConfig(next, { profileId, provider, mode: "api_key" });
  }
  return {
    config: next,
    ref,
    summary: `koda-tested: ${ref} (overall ${pick.entry.overall}, residency ${pick.entry.residency.region})`,
  };
}
