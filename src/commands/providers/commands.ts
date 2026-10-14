// `kolo providers list|add|test|remove|default` (KoLo 2.0, M9c).
//
// Pure command functions over a RuntimeEnv so the CLI wiring and the tests share them.
// Errors carry their exit code (docs/CLI_STYLE.md): 1 failed, 2 usage, 3 unreachable, 4 auth.
import fs from "node:fs";
import type { RuntimeEnv } from "../../runtime.js";
import { resolveKoLoAgentDir } from "../../agents/agent-paths.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import { type KoLoConfig, loadConfig } from "../../config/config.js";
import { listProviders } from "../../providers/registry.js";
import { renderTable } from "../../terminal/table.js";
import { updateConfig } from "../models/shared.js";
import { applyAuthProfileConfig } from "../onboard-auth.config-core.js";
import { probeProvider, type ProbeParams } from "./probe.js";
import {
  buildProviderConfig,
  PROVIDERS_EXIT,
  ProvidersCommandError,
  ProvidersUsageError,
  readKeyFromStdin,
  removeProviderKeys,
  resolveBaseUrlForAdd,
  resolvePrimaryModelRef,
  resolveProviderKey,
  resolveRegistryEntry,
  storeProviderKey,
  validateKey,
} from "./shared.js";

export type ProvidersDeps = {
  loadConfig?: () => KoLoConfig;
  updateConfig?: typeof updateConfig;
  agentDir?: () => string;
  /** Prompt for a key when stdin is a terminal and no flag gave one. */
  promptKey?: (message: string) => Promise<string>;
  /** Confirmation for `remove` without --yes. */
  confirm?: (message: string) => Promise<boolean>;
  fetchFn?: typeof fetch;
  readStdin?: () => Promise<string>;
  readFile?: (path: string) => string;
  env?: NodeJS.ProcessEnv;
  isTty?: () => boolean;
};

function deps(d: ProvidersDeps) {
  return {
    loadConfig: d.loadConfig ?? loadConfig,
    updateConfig: d.updateConfig ?? updateConfig,
    agentDir: d.agentDir ?? resolveKoLoAgentDir,
    readStdin: d.readStdin ?? readKeyFromStdin,
    env: d.env ?? process.env,
    isTty: d.isTty ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY)),
  };
}

export type ProviderListRow = {
  id: string;
  name: string;
  api: string;
  region: string;
  configured: boolean;
  source: string;
  default: boolean;
  modelsEndpoint: boolean;
  /** True for entries generated from the public catalogue (hidden by `list` unless `--all`). */
  catalogue: boolean;
};

export function collectProviderRows(params: {
  cfg: KoLoConfig;
  agentDir: string;
  env?: NodeJS.ProcessEnv;
}): ProviderListRow[] {
  const store = ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false });
  const primary = resolvePrimaryModelRef(params.cfg);
  return listProviders().map((entry) => {
    const key = resolveProviderKey({ entry, cfg: params.cfg, store, env: params.env });
    return {
      id: entry.id,
      name: entry.displayName,
      api: entry.apiStyle,
      region: entry.regionNote,
      configured: key.configured,
      source: key.source ?? "-",
      default: primary?.provider === entry.id,
      modelsEndpoint: entry.modelsEndpoint !== null,
      catalogue: entry.source === "catalogue",
    };
  });
}

export async function providersListCommand(
  opts: { json?: boolean; all?: boolean; search?: string },
  runtime: RuntimeEnv,
  d: ProvidersDeps = {},
): Promise<void> {
  const r = deps(d);
  const every = collectProviderRows({ cfg: r.loadConfig(), agentDir: r.agentDir(), env: r.env });
  const needle = opts.search?.trim().toLowerCase();
  // Catalogue entries are shown when asked for (--all), searched for, configured or the default.
  const rows = every.filter((row) =>
    needle
      ? `${row.id} ${row.name} ${row.region}`.toLowerCase().includes(needle)
      : opts.all || !row.catalogue || row.configured || row.default,
  );
  const hidden = every.length - rows.length;
  if (opts.json) {
    runtime.log(JSON.stringify({ ok: true, providers: rows, hidden }, null, 2));
    return;
  }
  runtime.log(
    renderTable({
      columns: [
        { key: "id", header: "ID" },
        { key: "name", header: "NAME" },
        { key: "api", header: "API" },
        { key: "region", header: "REGION", flex: true },
        { key: "configured", header: "CONFIGURED" },
        { key: "default", header: "DEFAULT" },
      ],
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        api: row.api,
        region: row.region,
        configured: row.configured ? `yes (${row.source})` : "no",
        default: row.default ? "*" : "",
      })),
    }),
  );
  if (hidden > 0) {
    runtime.log(
      needle
        ? `${hidden} providers do not match; drop --search to see the rest`
        : `${hidden} more providers from the public catalogue; use --all or --search <text>`,
    );
  }
}

export type ProvidersAddOptions = {
  baseUrl?: string;
  apiKeyStdin?: boolean;
  apiKeyFile?: string;
  model?: string;
  json?: boolean;
};

export async function providersAddCommand(
  id: string,
  opts: ProvidersAddOptions,
  runtime: RuntimeEnv,
  d: ProvidersDeps = {},
): Promise<void> {
  const r = deps(d);
  const entry = resolveRegistryEntry(id);
  const baseUrl = resolveBaseUrlForAdd(entry, opts.baseUrl);
  if (opts.apiKeyStdin && opts.apiKeyFile) {
    throw new ProvidersUsageError("give one of --api-key-stdin or --api-key-file");
  }

  let key: string | undefined;
  if (entry.authHeader !== "none") {
    if (opts.apiKeyStdin) {
      key = validateKey(await r.readStdin());
    } else if (opts.apiKeyFile) {
      const read = d.readFile ?? ((p: string) => fs.readFileSync(p, "utf8"));
      key = validateKey(read(opts.apiKeyFile));
    } else if (d.promptKey && r.isTty()) {
      key = validateKey(await d.promptKey(`Key for provider ${entry.id}`));
    } else {
      const envValue = entry.envVar ? r.env[entry.envVar]?.trim() : undefined;
      if (!envValue) {
        throw new ProvidersUsageError(
          `no key given. Use --api-key-stdin, --api-key-file <path>${
            entry.envVar ? ` or set ${entry.envVar}` : ""
          }`,
        );
      }
      key = envValue;
    }
  }

  const agentDir = r.agentDir();
  let profileId: string | undefined;
  if (key) {
    profileId = storeProviderKey(entry.id, key, agentDir);
  }
  const modelId = opts.model?.trim() || entry.defaultModel;
  await r.updateConfig((cfg) => {
    const providers = { ...cfg.models?.providers };
    providers[entry.id] = buildProviderConfig({
      entry,
      baseUrl,
      model: modelId,
      existing: providers[entry.id],
    });
    let next: KoLoConfig = {
      ...cfg,
      models: { mode: cfg.models?.mode ?? "merge", providers },
    };
    if (profileId) {
      next = applyAuthProfileConfig(next, { profileId, provider: entry.id, mode: "api_key" });
    }
    return next;
  });

  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          ok: true,
          id: entry.id,
          baseUrl,
          api: entry.apiStyle,
          keyStored: Boolean(profileId),
          model: modelId ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }
  runtime.log(`provider   ${entry.id}`);
  runtime.log(`base url   ${baseUrl}`);
  runtime.log(`key        ${profileId ? `stored (profile ${profileId})` : "not needed"}`);
  runtime.log(
    `model      ${modelId ?? "none; add one with: kolo providers default " + entry.id + " --model <id>"}`,
  );
  runtime.log(`next       kolo providers test ${entry.id}`);
}

export async function providersTestCommand(
  id: string,
  opts: { model?: string; json?: boolean; timeout?: number; baseUrl?: string },
  runtime: RuntimeEnv,
  d: ProvidersDeps = {},
): Promise<void> {
  const r = deps(d);
  const entry = resolveRegistryEntry(id);
  const cfg = r.loadConfig();
  const store = ensureAuthProfileStore(r.agentDir(), { allowKeychainPrompt: false });
  const key = resolveProviderKey({ entry, cfg, store, env: r.env });
  const configuredBaseUrl = cfg.models?.providers?.[entry.id]?.baseUrl;
  const baseUrl = opts.baseUrl?.trim() || configuredBaseUrl || entry.baseUrl;
  if (!baseUrl) {
    throw new ProvidersUsageError(`provider "${entry.id}" has no base URL; add it first`);
  }
  if (!key.configured) {
    throw new ProvidersCommandError(
      `provider "${entry.id}" has no key. Add one with: kolo providers add ${entry.id} --api-key-stdin`,
      PROVIDERS_EXIT.auth,
    );
  }
  const probe: ProbeParams = {
    entry,
    baseUrl,
    apiKey: key.apiKey,
    model: opts.model,
    timeoutMs: opts.timeout,
    fetchFn: d.fetchFn,
  };
  const result = await probeProvider(probe);
  if (opts.json) {
    runtime.log(JSON.stringify({ id: entry.id, baseUrl, ...result }, null, 2));
  } else if (result.ok) {
    const count = result.via === "models" ? `${result.models.length} models` : "one-token reply";
    runtime.log(`ok  ${entry.id}  ${result.latencyMs} ms  ${count}`);
  }
  if (!result.ok) {
    throw new ProvidersCommandError(
      `provider "${entry.id}": ${result.error} after ${result.latencyMs} ms`,
      result.exitCode,
    );
  }
}

export async function providersRemoveCommand(
  id: string,
  opts: { yes?: boolean; json?: boolean },
  runtime: RuntimeEnv,
  d: ProvidersDeps = {},
): Promise<void> {
  const r = deps(d);
  const entry = resolveRegistryEntry(id);
  if (!opts.yes) {
    if (!d.confirm || !r.isTty()) {
      throw new ProvidersUsageError("pass --yes to remove without a prompt");
    }
    const ok = await d.confirm(`Remove provider ${entry.id} and its stored key?`);
    if (!ok) {
      runtime.log("cancelled");
      return;
    }
  }
  const removedProfiles = removeProviderKeys(entry.id, r.agentDir());
  let removedConfig = false;
  await r.updateConfig((cfg) => {
    const providers = { ...cfg.models?.providers };
    removedConfig = entry.id in providers;
    delete providers[entry.id];
    const profiles = { ...cfg.auth?.profiles };
    for (const profileId of Object.keys(profiles)) {
      if (profiles[profileId]?.provider === entry.id) {
        delete profiles[profileId];
      }
    }
    const order = { ...cfg.auth?.order };
    delete order[entry.id];
    return {
      ...cfg,
      models: cfg.models ? { ...cfg.models, providers } : cfg.models,
      auth: cfg.auth ? { ...cfg.auth, profiles, order } : cfg.auth,
    };
  });
  if (opts.json) {
    runtime.log(
      JSON.stringify({ ok: true, id: entry.id, removedConfig, removedProfiles }, null, 2),
    );
    return;
  }
  runtime.log(
    `removed    ${entry.id} (${removedConfig ? "config" : "no config entry"}, ${removedProfiles.length} stored key${removedProfiles.length === 1 ? "" : "s"})`,
  );
}

export async function providersDefaultCommand(
  id: string,
  opts: { model?: string; json?: boolean },
  runtime: RuntimeEnv,
  d: ProvidersDeps = {},
): Promise<void> {
  const r = deps(d);
  const entry = resolveRegistryEntry(id);
  const cfg = r.loadConfig();
  const configured = cfg.models?.providers?.[entry.id];
  const modelId =
    opts.model?.trim() || configured?.models?.[0]?.id || entry.defaultModel || undefined;
  if (!modelId) {
    throw new ProvidersUsageError(`provider "${entry.id}" has no default model; give --model <id>`);
  }
  const ref = `${entry.id}/${modelId}`;
  await r.updateConfig((current) => ({
    ...current,
    agents: {
      ...current.agents,
      defaults: {
        ...current.agents?.defaults,
        model: { ...current.agents?.defaults?.model, primary: ref },
      },
    },
  }));
  if (opts.json) {
    runtime.log(JSON.stringify({ ok: true, primary: ref }, null, 2));
    return;
  }
  runtime.log(`primary    ${ref}`);
}
