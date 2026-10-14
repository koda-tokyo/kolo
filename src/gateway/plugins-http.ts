// Plugin control surface over the gateway (KoLo 2.0, M7): one implementation shared by
// GET /api/plugins, POST /api/plugins/{id}/reload and the WS methods plugins.list / plugins.reload.
// Reads go through the live registry (not a fresh load), so quarantined plugins, reload counts and
// running services reflect what the gateway is actually running.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginHost, PluginHostPluginState, PluginReloadResult } from "../plugins/host.js";
import type { PluginRecord, PluginRegistry } from "../plugins/registry.js";
import type { RouteContext } from "./http-registry.js";
import { getPluginHost } from "../plugins/loader.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";
import { recordAuditEvent } from "../security/audit-log.js";
import { sendJson } from "./http-common.js";
import { getHttpPrincipal, principalIdentity } from "./pair-auth.js";

export type PluginStatusRow = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  kind?: string;
  origin: PluginRecord["origin"];
  source: string;
  enabled: boolean;
  status: PluginRecord["status"];
  error?: string;
  quarantined: boolean;
  loadedAt?: number;
  reloads: number;
  watched: boolean;
  tools: string[];
  services: string[];
  runningServices: string[];
  gatewayMethods: string[];
  httpRoutes: number;
  hooks: number;
  resources: number;
};

export type PluginsListResult = {
  ok: true;
  hotReload: { enabled: boolean; watch: boolean; debounceMs: number; watching: boolean };
  plugins: PluginStatusRow[];
  diagnostics: Array<{ level: "warn" | "error"; pluginId?: string; message: string }>;
};

// The running gateway's host: set at boot, cleared on close. The global "active registry" can be
// re-pointed by other loaders in the same process (CLI code paths, tests); the gateway's control
// surface must always answer for the registry the gateway actually serves.
let gatewayHost: PluginHost | null = null;

export function setGatewayPluginHost(host: PluginHost | null): void {
  gatewayHost = host;
}

function registryAndHost(): { registry: PluginRegistry | null; host: PluginHost | null } {
  if (gatewayHost) {
    return { registry: gatewayHost.registry, host: gatewayHost };
  }
  const registry = getActivePluginRegistry();
  return { registry, host: registry ? getPluginHost(registry) : null };
}

export function listPluginsLive(): PluginsListResult {
  const { registry, host } = registryAndHost();
  const states = new Map<string, PluginHostPluginState>(
    (host?.state() ?? []).map((s) => [s.id, s]),
  );
  const settings = host?.settings() ?? { enabled: false, watch: false, debounceMs: 0 };
  const plugins: PluginStatusRow[] = (registry?.plugins ?? []).map((record) => {
    const state = states.get(record.id);
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      description: record.description,
      kind: record.kind as string | undefined,
      origin: record.origin,
      source: record.source,
      enabled: record.enabled,
      status: record.status,
      error: record.error,
      quarantined: state?.quarantined ?? false,
      loadedAt: state?.loadedAt,
      reloads: state?.reloads ?? 0,
      watched: state?.watched ?? false,
      tools: [...record.toolNames],
      services: [...record.services],
      runningServices: state?.services ?? [],
      gatewayMethods: [...record.gatewayMethods],
      httpRoutes: record.httpHandlers,
      hooks: record.hookCount + record.hookNames.length,
      resources: state?.resources ?? 0,
    };
  });
  return {
    ok: true,
    hotReload: { ...settings, watching: host?.hasWatcher() ?? false },
    plugins,
    diagnostics: (registry?.diagnostics ?? []).map((d) => ({
      level: d.level,
      pluginId: d.pluginId,
      message: d.message,
    })),
  };
}

export type PluginReloadOutcome =
  | { ok: true; result: PluginReloadResult }
  | { ok: false; status: 404 | 409 | 503; message: string };

export async function reloadPluginLive(params: {
  id: string;
  source: string;
  identity?: string;
}): Promise<PluginReloadOutcome> {
  const id = params.id.trim();
  if (!id) {
    return { ok: false, status: 404, message: "plugin id required" };
  }
  const { registry, host } = registryAndHost();
  if (!registry || !host) {
    return { ok: false, status: 503, message: "no plugin host in this gateway" };
  }
  if (!host.settings().enabled) {
    return {
      ok: false,
      status: 409,
      message: "plugin hot reload is disabled (plugins.hotReload=false); restart the gateway",
    };
  }
  const known = registry.plugins.some((p) => p.id === id);
  const result = await host.reload(id, { reason: "manual" });
  if (!result.ok && !known && result.error?.startsWith("plugin not found")) {
    return { ok: false, status: 404, message: result.error };
  }
  recordAuditEvent({
    action: "plugin.reload_requested",
    outcome: result.ok ? "allowed" : "failed",
    identity: params.identity,
    source: params.source,
    detail: { plugin: id, status: result.status, error: result.error, reloads: result.reloads },
  });
  return { ok: true, result };
}

export function createPluginsHttpHandlers() {
  return {
    listPlugins: (_req: IncomingMessage, res: ServerResponse, _ctx: RouteContext) => {
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, listPluginsLive());
      return true;
    },
    reloadPlugin: async (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const principal = getHttpPrincipal(req);
      const outcome = await reloadPluginLive({
        id: ctx.params.id ?? "",
        source: "http:/api/plugins/{id}/reload",
        identity: principal ? principalIdentity(principal) : undefined,
      });
      res.setHeader("Cache-Control", "no-store");
      if (!outcome.ok) {
        sendJson(res, outcome.status, {
          ok: false,
          error: {
            type: outcome.status === 404 ? "not_found" : "unavailable",
            message: outcome.message,
          },
        });
        return true;
      }
      sendJson(res, 200, { ok: true, plugin: outcome.result });
      return true;
    },
  };
}
