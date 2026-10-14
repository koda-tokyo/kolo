// Plugin loader (KoLo 2.0, M7: reloadable).
//
// `loadKoLoPlugins` discovers, validates and registers every plugin into one registry. The work
// for a single candidate lives in `loadPluginCandidate` so the host (host.ts) can run it again for
// one plugin after a file change or a config change: dispose the old instance, drop the plugin's
// files from the module cache, import and register the new one. The registry object keeps its
// identity across reloads; consumers never re-fetch it.
import { createJiti } from "jiti";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { KoLoConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import type {
  KoLoPluginAuditInput,
  KoLoPluginDefinition,
  KoLoPluginModule,
  KoLoPluginPaths,
  PluginDiagnostic,
  PluginLogger,
} from "./types.js";
import { koloLogDir, koloRunDir, koloSecretsDir } from "../config/kolo-home.js";
import { CONFIG_PATH, resolveStateDir } from "../config/paths.js";
import { authorizeGatewaySigusr1Restart, triggerKoLoRestart } from "../infra/restart.js";
import { enqueueSystemEvent } from "../infra/system-events.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { recordAuditEvent } from "../security/audit-log.js";
import { resolveUserPath } from "../utils.js";
import { clearPluginCommands } from "./commands.js";
import {
  normalizePluginsConfig,
  resolveEnableState,
  resolveMemorySlotDecision,
  type NormalizedPluginsConfig,
} from "./config-state.js";
import { discoverKoLoPlugins, type PluginCandidate } from "./discovery.js";
import { initializeGlobalHookRunner } from "./hook-runner-global.js";
import { createPluginHost, type PluginHost } from "./host.js";
import {
  createPluginLifecycle,
  createPluginSignalBus,
  type PluginLifecycleHandle,
  type PluginSignalBus,
} from "./lifecycle.js";
import { loadPluginManifestRegistry, type PluginManifestRecord } from "./manifest-registry.js";
import {
  createPluginRegistry,
  removePluginRegistrations,
  type PluginRecord,
  type PluginRegistry,
} from "./registry.js";
import { setActivePluginRegistry } from "./runtime.js";
import { createPluginRuntime } from "./runtime/index.js";
import { validateJsonSchemaValue } from "./schema-validator.js";

export type PluginLoadResult = PluginRegistry;

export type PluginLoadOptions = {
  config?: KoLoConfig;
  workspaceDir?: string;
  logger?: PluginLogger;
  coreGatewayHandlers?: Record<string, GatewayRequestHandler>;
  cache?: boolean;
  mode?: "full" | "validate";
  /** M7: write plugin.loaded / failed rows to the audit log (the gateway does; CLI reads do not). */
  audit?: boolean;
};

/** One loaded (or quarantined) plugin instance, owned by the host. */
export type PluginInstance = {
  record: PluginRecord;
  candidate: PluginCandidate;
  manifest: PluginManifestRecord;
  lifecycle: PluginLifecycleHandle;
  definition?: KoLoPluginDefinition;
  loadedAt: number;
  reloads: number;
  lastError?: string;
  /** True when the last load threw: the plugin is kept on disk and in the list, never run. */
  quarantined: boolean;
};

export type PluginLoadContext = {
  cfg: KoLoConfig;
  normalized: NormalizedPluginsConfig;
  workspaceDir?: string;
  logger: PluginLogger;
  validateOnly: boolean;
  audit: boolean;
  registry: PluginRegistry;
  createApi: ReturnType<typeof createPluginRegistry>["createApi"];
  jiti: ReturnType<typeof createJiti>;
  signals: PluginSignalBus;
  paths: KoLoPluginPaths;
  instances: Map<string, PluginInstance>;
  seenIds: Map<string, PluginRecord["origin"]>;
  memory: { slot: string | null | undefined; selectedId: string | null; matched: boolean };
};

const registryCache = new Map<string, PluginRegistry>();
const defaultLogger = () => createSubsystemLogger("plugins");

const resolvePluginSdkAlias = (): string | null => {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const isDistRuntime = modulePath.split(path.sep).includes("dist");
    const preferDist = process.env.VITEST || process.env.NODE_ENV === "test" || isDistRuntime;
    let cursor = path.dirname(modulePath);
    for (let i = 0; i < 6; i += 1) {
      const srcCandidate = path.join(cursor, "src", "plugin-sdk", "index.ts");
      const distCandidate = path.join(cursor, "dist", "plugin-sdk", "index.js");
      const orderedCandidates = preferDist
        ? [distCandidate, srcCandidate]
        : [srcCandidate, distCandidate];
      for (const candidate of orderedCandidates) {
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  } catch {
    // ignore
  }
  return null;
};

function buildCacheKey(params: {
  workspaceDir?: string;
  plugins: NormalizedPluginsConfig;
}): string {
  const workspaceKey = params.workspaceDir ? resolveUserPath(params.workspaceDir) : "";
  return `${workspaceKey}::${JSON.stringify(params.plugins)}`;
}

function validatePluginConfig(params: {
  schema?: Record<string, unknown>;
  cacheKey?: string;
  value?: unknown;
}): { ok: boolean; value?: Record<string, unknown>; errors?: string[] } {
  const schema = params.schema;
  if (!schema) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  const cacheKey = params.cacheKey ?? JSON.stringify(schema);
  const result = validateJsonSchemaValue({
    schema,
    cacheKey,
    value: params.value ?? {},
  });
  if (result.ok) {
    return { ok: true, value: params.value as Record<string, unknown> | undefined };
  }
  return { ok: false, errors: result.errors };
}

function resolvePluginModuleExport(moduleExport: unknown): {
  definition?: KoLoPluginDefinition;
  register?: KoLoPluginDefinition["register"];
} {
  const resolved =
    moduleExport &&
    typeof moduleExport === "object" &&
    "default" in (moduleExport as Record<string, unknown>)
      ? (moduleExport as { default: unknown }).default
      : moduleExport;
  if (typeof resolved === "function") {
    return {
      register: resolved as KoLoPluginDefinition["register"],
    };
  }
  if (resolved && typeof resolved === "object") {
    const def = resolved as KoLoPluginDefinition;
    const register = def.register ?? def.activate;
    return { definition: def, register };
  }
  return {};
}

function createPluginRecord(params: {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  source: string;
  origin: PluginRecord["origin"];
  workspaceDir?: string;
  enabled: boolean;
  configSchema: boolean;
}): PluginRecord {
  return {
    id: params.id,
    name: params.name ?? params.id,
    description: params.description,
    version: params.version,
    source: params.source,
    origin: params.origin,
    workspaceDir: params.workspaceDir,
    enabled: params.enabled,
    status: params.enabled ? "loaded" : "disabled",
    toolNames: [],
    hookNames: [],
    channelIds: [],
    providerIds: [],
    gatewayMethods: [],
    cliCommands: [],
    services: [],
    commands: [],
    httpHandlers: 0,
    hookCount: 0,
    configSchema: params.configSchema,
    configUiHints: undefined,
    configJsonSchema: undefined,
  };
}

function pushDiagnostics(diagnostics: PluginDiagnostic[], append: PluginDiagnostic[]) {
  diagnostics.push(...append);
}

export function resolvePluginPaths(env: NodeJS.ProcessEnv = process.env): KoLoPluginPaths {
  const home = resolveStateDir(env);
  return {
    home,
    stateDir: home,
    logDir: koloLogDir(home),
    runDir: koloRunDir(home),
    secretsDir: koloSecretsDir(home),
    configPath: CONFIG_PATH,
  };
}

export function auditPluginEvent(
  pluginId: string,
  input: KoLoPluginAuditInput & { source?: string },
): void {
  const outcome =
    input.outcome === "ok" || input.outcome === undefined
      ? "allowed"
      : input.outcome === "failed"
        ? "failed"
        : input.outcome;
  recordAuditEvent({
    action: input.action,
    outcome,
    identity: input.identity,
    scope: input.scope,
    source: input.source ?? `plugin:${pluginId}`,
    detail: input.detail,
  });
}

function restartGatewayViaSupervisor(pluginId: string, reason: string, logger: PluginLogger) {
  logger.warn(`[plugins] ${pluginId} requested a gateway restart: ${reason}`);
  const attempt = triggerKoLoRestart();
  if (attempt.ok) {
    return { ok: true, method: attempt.method, detail: attempt.detail };
  }
  // No external supervisor answered: fall back to the in-process restart path the config
  // reloader uses (SIGUSR1 handled by the gateway runner), when one is installed.
  if (process.listenerCount("SIGUSR1") > 0) {
    authorizeGatewaySigusr1Restart();
    process.emit("SIGUSR1");
    return { ok: true, method: "sigusr1", detail: attempt.detail };
  }
  return { ok: false, method: attempt.method, detail: attempt.detail ?? "no supervisor available" };
}

/** Drops a plugin's own files from the module cache so the next import re-evaluates them. */
export function invalidatePluginModules(
  jiti: ReturnType<typeof createJiti>,
  rootDir: string,
): string[] {
  // Cache keys are the resolver's spelling of the file (realpath: long 8.3 names, canonical
  // case, native separators). Match against both the given root and its realpath, in a
  // separator- and (on Windows) case-insensitive form, or a plugin under a temp dir such as
  // C:\Users\RUNNER~1\... is never evicted and the reload keeps serving the old module.
  const prefixes = new Set<string>();
  const canon = (p: string) => {
    const slashes = p.split(path.sep).join("/");
    const normalized = process.platform === "win32" ? slashes.toLowerCase() : slashes;
    return normalized.endsWith("/") ? normalized : `${normalized}/`;
  };
  prefixes.add(canon(rootDir));
  try {
    prefixes.add(canon(fs.realpathSync.native(rootDir)));
  } catch {
    // Directory may already be gone (unlink reload); the raw prefix still applies.
  }
  const dropped: string[] = [];
  const cache = jiti.cache as Record<string, unknown>;
  for (const key of Object.keys(cache)) {
    const canonKey = canon(key);
    if (canonKey.includes("/node_modules/")) {
      continue;
    }
    if ([...prefixes].some((prefix) => canonKey.startsWith(prefix))) {
      delete cache[key];
      dropped.push(key);
    }
  }
  return dropped;
}

function finishRecord(
  ctx: PluginLoadContext,
  record: PluginRecord,
  origin: PluginRecord["origin"],
) {
  ctx.registry.plugins.push(record);
  ctx.seenIds.set(record.id, origin);
}

function failRecord(
  ctx: PluginLoadContext,
  record: PluginRecord,
  origin: PluginRecord["origin"],
  message: string,
  diagnostic: string,
) {
  ctx.logger.error(`[plugins] ${record.id} ${message}`);
  record.status = "error";
  record.error = message;
  finishRecord(ctx, record, origin);
  ctx.registry.diagnostics.push({
    level: "error",
    pluginId: record.id,
    source: record.source,
    message: diagnostic,
  });
}

/**
 * Loads one discovered plugin into the context's registry. Returns the record pushed (every
 * outcome produces a record: loaded, disabled, or error = quarantined with the message).
 */
export function loadPluginCandidate(
  ctx: PluginLoadContext,
  candidate: PluginCandidate,
  manifestRecord: PluginManifestRecord,
  opts: { reload?: boolean; previous?: PluginInstance } = {},
): PluginRecord {
  const pluginId = manifestRecord.id;
  const existingOrigin = ctx.seenIds.get(pluginId);
  if (existingOrigin && !opts.reload) {
    const record = createPluginRecord({
      id: pluginId,
      name: manifestRecord.name ?? pluginId,
      description: manifestRecord.description,
      version: manifestRecord.version,
      source: candidate.source,
      origin: candidate.origin,
      workspaceDir: candidate.workspaceDir,
      enabled: false,
      configSchema: Boolean(manifestRecord.configSchema),
    });
    record.status = "disabled";
    record.error = `overridden by ${existingOrigin} plugin`;
    ctx.registry.plugins.push(record);
    return record;
  }

  const enableState = resolveEnableState(pluginId, candidate.origin, ctx.normalized);
  const entry = ctx.normalized.entries[pluginId];
  const record = createPluginRecord({
    id: pluginId,
    name: manifestRecord.name ?? pluginId,
    description: manifestRecord.description,
    version: manifestRecord.version,
    source: candidate.source,
    origin: candidate.origin,
    workspaceDir: candidate.workspaceDir,
    enabled: enableState.enabled,
    configSchema: Boolean(manifestRecord.configSchema),
  });
  record.kind = manifestRecord.kind;
  record.configUiHints = manifestRecord.configUiHints;
  record.configJsonSchema = manifestRecord.configSchema;

  const lifecycle = createPluginLifecycle();
  const instance: PluginInstance = {
    record,
    candidate,
    manifest: manifestRecord,
    lifecycle,
    loadedAt: Date.now(),
    reloads: opts.previous ? opts.previous.reloads + 1 : 0,
    quarantined: false,
  };
  ctx.instances.set(pluginId, instance);

  const quarantine = (message: string, diagnostic: string) => {
    instance.quarantined = true;
    instance.lastError = message;
    failRecord(ctx, record, candidate.origin, message, diagnostic);
    if (ctx.audit) {
      auditPluginEvent(pluginId, {
        action: "plugin.failed",
        outcome: "failed",
        source: "plugins",
        detail: { plugin: pluginId, source: record.source, error: message, reload: !!opts.reload },
      });
    }
    return record;
  };

  if (!enableState.enabled) {
    record.status = "disabled";
    record.error = enableState.reason;
    finishRecord(ctx, record, candidate.origin);
    return record;
  }

  if (!manifestRecord.configSchema) {
    return quarantine("missing config schema", "missing config schema");
  }

  let mod: KoLoPluginModule | null = null;
  try {
    mod = ctx.jiti(candidate.source) as KoLoPluginModule;
  } catch (err) {
    return quarantine(
      `failed to load from ${record.source}: ${String(err)}`,
      `failed to load plugin: ${String(err)}`,
    );
  }

  const resolved = resolvePluginModuleExport(mod);
  const definition = resolved.definition;
  const register = resolved.register;
  instance.definition = definition;

  if (definition?.id && definition.id !== record.id) {
    ctx.registry.diagnostics.push({
      level: "warn",
      pluginId: record.id,
      source: record.source,
      message: `plugin id mismatch (config uses "${record.id}", export uses "${definition.id}")`,
    });
  }

  record.name = definition?.name ?? record.name;
  record.description = definition?.description ?? record.description;
  record.version = definition?.version ?? record.version;
  const manifestKind = record.kind as string | undefined;
  const exportKind = definition?.kind as string | undefined;
  if (manifestKind && exportKind && exportKind !== manifestKind) {
    ctx.registry.diagnostics.push({
      level: "warn",
      pluginId: record.id,
      source: record.source,
      message: `plugin kind mismatch (manifest uses "${manifestKind}", export uses "${exportKind}")`,
    });
  }
  record.kind = definition?.kind ?? record.kind;

  if (record.kind === "memory" && ctx.memory.slot === record.id) {
    ctx.memory.matched = true;
  }

  const memoryDecision = resolveMemorySlotDecision({
    id: record.id,
    kind: record.kind,
    slot: ctx.memory.slot,
    selectedId: opts.reload && ctx.memory.selectedId === record.id ? null : ctx.memory.selectedId,
  });

  if (!memoryDecision.enabled) {
    record.enabled = false;
    record.status = "disabled";
    record.error = memoryDecision.reason;
    finishRecord(ctx, record, candidate.origin);
    return record;
  }

  if (memoryDecision.selected && record.kind === "memory") {
    ctx.memory.selectedId = record.id;
  }

  const validatedConfig = validatePluginConfig({
    schema: manifestRecord.configSchema,
    cacheKey: manifestRecord.schemaCacheKey,
    value: entry?.config,
  });

  if (!validatedConfig.ok) {
    const message = `invalid config: ${validatedConfig.errors?.join(", ")}`;
    return quarantine(message, message);
  }

  if (ctx.validateOnly) {
    finishRecord(ctx, record, candidate.origin);
    return record;
  }

  if (typeof register !== "function") {
    return quarantine(
      "plugin export missing register/activate",
      "plugin export missing register/activate",
    );
  }

  const api = ctx.createApi(record, {
    config: ctx.cfg,
    pluginConfig: validatedConfig.value,
    lifecycle: lifecycle.api,
    audit: (input) => auditPluginEvent(record.id, input),
    paths: ctx.paths,
    supervisor: {
      restartGateway: (reason) => restartGatewayViaSupervisor(record.id, reason, ctx.logger),
    },
    signals: ctx.signals.forPlugin(lifecycle.api),
    enqueueSystemEvent: (text, sessionKey) => enqueueSystemEvent(text, { sessionKey }),
  });

  try {
    const result = register(api);
    if (result && typeof result.then === "function") {
      ctx.registry.diagnostics.push({
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: "plugin register returned a promise; async registration is ignored",
      });
    }
    finishRecord(ctx, record, candidate.origin);
    if (ctx.audit) {
      auditPluginEvent(pluginId, {
        action: opts.reload ? "plugin.reloaded" : "plugin.loaded",
        source: "plugins",
        detail: {
          plugin: pluginId,
          source: record.source,
          version: record.version,
          tools: record.toolNames.length,
          services: record.services.length,
          reloads: instance.reloads,
        },
      });
    }
    return record;
  } catch (err) {
    // A throwing register may have left partial registrations behind: strip them, then
    // release whatever it grabbed through the api, so nothing of the failed instance runs.
    removePluginRegistrations(ctx.registry, record.id);
    void lifecycle.dispose();
    return quarantine(
      `failed during register from ${record.source}: ${String(err)}`,
      `plugin failed during register: ${String(err)}`,
    );
  }
}

/**
 * Disposes one instance: `dispose()` export, then api-owned resources. Never throws.
 * Registrations are removed by the caller (so the registry is consistent even if dispose hangs).
 */
export async function disposePluginInstance(
  ctx: PluginLoadContext,
  instance: PluginInstance,
  reason: string,
): Promise<void> {
  const id = instance.record.id;
  const errors: string[] = [];
  if (typeof instance.definition?.dispose === "function" && !instance.quarantined) {
    try {
      await Promise.race([
        Promise.resolve(instance.definition.dispose()),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000).unref?.()),
      ]);
    } catch (err) {
      errors.push(`dispose: ${String(err)}`);
    }
  }
  await instance.lifecycle.dispose((what, err) => errors.push(`${what}: ${String(err)}`));
  for (const message of errors) {
    ctx.logger.warn(`[plugins] ${id} dispose problem (${message})`);
  }
  // A gateway stop disposes every plugin; the stop itself is the audited event, not each plugin.
  if (ctx.audit && reason !== "gateway-stop") {
    auditPluginEvent(id, {
      action: "plugin.disposed",
      outcome: errors.length > 0 ? "failed" : "ok",
      source: "plugins",
      detail: { plugin: id, reason, errors: errors.length > 0 ? errors : undefined },
    });
  }
}

const hosts = new WeakMap<PluginRegistry, PluginHost>();

/** The host that owns a registry produced by `loadKoLoPlugins` (M7 reload surface). */
export function getPluginHost(registry: PluginRegistry): PluginHost | null {
  return hosts.get(registry) ?? null;
}

export function loadKoLoPlugins(options: PluginLoadOptions = {}): PluginRegistry {
  const cfg = options.config ?? {};
  const logger = options.logger ?? defaultLogger();
  const validateOnly = options.mode === "validate";
  const normalized = normalizePluginsConfig(cfg.plugins);
  const cacheKey = buildCacheKey({
    workspaceDir: options.workspaceDir,
    plugins: normalized,
  });
  const cacheEnabled = options.cache !== false;
  if (cacheEnabled) {
    const cached = registryCache.get(cacheKey);
    if (cached) {
      setActivePluginRegistry(cached, cacheKey);
      return cached;
    }
  }

  // Clear previously registered plugin commands before reloading
  clearPluginCommands();

  const runtime = createPluginRuntime();
  const { registry, createApi } = createPluginRegistry({
    logger,
    runtime,
    coreGatewayHandlers: options.coreGatewayHandlers as Record<string, GatewayRequestHandler>,
  });

  const discovery = discoverKoLoPlugins({
    workspaceDir: options.workspaceDir,
    extraPaths: normalized.loadPaths,
  });
  const manifestRegistry = loadPluginManifestRegistry({
    config: cfg,
    workspaceDir: options.workspaceDir,
    cache: options.cache,
    candidates: discovery.candidates,
    diagnostics: discovery.diagnostics,
  });
  pushDiagnostics(registry.diagnostics, manifestRegistry.diagnostics);

  const pluginSdkAlias = resolvePluginSdkAlias();
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
    ...(pluginSdkAlias
      ? {
          alias: { "KoLo/plugin-sdk": pluginSdkAlias },
        }
      : {}),
  });

  const ctx: PluginLoadContext = {
    cfg,
    normalized,
    workspaceDir: options.workspaceDir,
    logger,
    validateOnly,
    audit: options.audit === true,
    registry,
    createApi,
    jiti,
    signals: createPluginSignalBus(),
    paths: resolvePluginPaths(),
    instances: new Map(),
    seenIds: new Map(),
    memory: { slot: normalized.slots.memory, selectedId: null, matched: false },
  };

  const manifestByRoot = new Map(
    manifestRegistry.plugins.map((record) => [record.rootDir, record]),
  );

  for (const candidate of discovery.candidates) {
    const manifestRecord = manifestByRoot.get(candidate.rootDir);
    if (!manifestRecord) {
      continue;
    }
    loadPluginCandidate(ctx, candidate, manifestRecord);
  }

  if (typeof ctx.memory.slot === "string" && !ctx.memory.matched) {
    registry.diagnostics.push({
      level: "warn",
      message: `memory slot plugin not found or not marked as memory: ${ctx.memory.slot}`,
    });
  }

  if (cacheEnabled) {
    registryCache.set(cacheKey, registry);
  }
  hosts.set(
    registry,
    createPluginHost({
      ctx,
      cacheKey: cacheEnabled ? cacheKey : null,
      registryCache,
      manifestOptions: { workspaceDir: options.workspaceDir, cache: options.cache },
    }),
  );
  setActivePluginRegistry(registry, cacheKey);
  initializeGlobalHookRunner(registry);
  return registry;
}
