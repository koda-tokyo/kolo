// `kurahi models list --live` (KoLo 2.0, M9c): ask each configured provider that has a models
// endpoint for its current list and add the models the offline registry does not know.
import type { KoLoConfig } from "../../config/config.js";
import type { ModelRow } from "./list.types.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import { listProviders } from "../../providers/registry.js";
import { probeProvider } from "../providers/probe.js";
import { resolveProviderKey } from "../providers/shared.js";
import { modelKey } from "./shared.js";

export type LiveModelsResult = {
  rows: ModelRow[];
  errors: Array<{ provider: string; error: string }>;
};

export async function collectLiveModelRows(params: {
  cfg: KoLoConfig;
  agentDir: string;
  known: Set<string>;
  providerFilter?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<LiveModelsResult> {
  const store = ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false });
  const rows: ModelRow[] = [];
  const errors: LiveModelsResult["errors"] = [];
  const candidates = listProviders().filter((entry) => {
    if (entry.modelsEndpoint === null) {
      return false;
    }
    if (params.providerFilter && entry.id !== params.providerFilter) {
      return false;
    }
    // Only providers the operator wired (a config entry or a stored key); never a cold scan.
    const inConfig = Boolean(params.cfg.models?.providers?.[entry.id]);
    const key = resolveProviderKey({ entry, cfg: params.cfg, store, env: params.env });
    return inConfig || (key.configured && key.source !== "none-needed");
  });
  await Promise.all(
    candidates.map(async (entry) => {
      const key = resolveProviderKey({ entry, cfg: params.cfg, store, env: params.env });
      const baseUrl = params.cfg.models?.providers?.[entry.id]?.baseUrl || entry.baseUrl;
      if (!baseUrl) {
        return;
      }
      const result = await probeProvider({
        entry,
        baseUrl,
        apiKey: key.apiKey,
        fetchFn: params.fetchFn,
        timeoutMs: params.timeoutMs,
      });
      if (!result.ok) {
        errors.push({ provider: entry.id, error: result.error });
        return;
      }
      for (const id of result.models) {
        const key = modelKey(entry.id, id);
        if (params.known.has(key)) {
          continue;
        }
        rows.push({
          key,
          name: id,
          input: "-",
          contextWindow: null,
          local: null,
          available: true,
          tags: ["live"],
          missing: false,
        });
      }
    }),
  );
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return { rows, errors };
}
