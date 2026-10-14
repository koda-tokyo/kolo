import chokidar from "chokidar";
import { readFileSync } from "node:fs";
import type { KoLoConfig, ConfigFileSnapshot, GatewayReloadMode } from "../config/config.js";
import { auditSafe } from "../audit/audit-log.js";
import { type ChannelId, listChannelPlugins } from "../channels/plugins/index.js";
import {
  classifyPath,
  diffConfigs,
  type ConfigReloadClass,
} from "../gateway-v3/supervisor/config-reload.js";
import { getActivePluginRegistry } from "../plugins/runtime.js";

export type GatewayReloadSettings = {
  mode: GatewayReloadMode;
  debounceMs: number;
};

export type ChannelKind = ChannelId;

export type GatewayReloadPlan = {
  changedPaths: string[];
  restartGateway: boolean;
  restartReasons: string[];
  hotReasons: string[];
  reloadHooks: boolean;
  restartGmailWatcher: boolean;
  restartBrowserControl: boolean;
  restartCron: boolean;
  restartHeartbeat: boolean;
  restartChannels: Set<ChannelKind>;
  noopPaths: string[];
  /** M7: re-evaluate the affected plugins in place (entries, allow/deny, load paths). */
  reloadPlugins: boolean;
  /** M7: re-apply `mcp.servers`; only changed/added/removed servers reconnect. */
  reloadMcp: boolean;
};

type ReloadRule = {
  prefix: string;
  kind: "restart" | "hot" | "none";
  actions?: ReloadAction[];
};

type ReloadAction =
  | "reload-hooks"
  | "restart-gmail-watcher"
  | "restart-browser-control"
  | "restart-cron"
  | "restart-heartbeat"
  | "reload-plugins"
  | "reload-mcp"
  | `restart-channel:${ChannelId}`;

const DEFAULT_RELOAD_SETTINGS: GatewayReloadSettings = {
  mode: "hybrid",
  debounceMs: 300,
};

const BASE_RELOAD_RULES: ReloadRule[] = [
  { prefix: "gateway.remote", kind: "none" },
  { prefix: "gateway.reload", kind: "none" },
  { prefix: "hooks.gmail", kind: "hot", actions: ["restart-gmail-watcher"] },
  { prefix: "hooks", kind: "hot", actions: ["reload-hooks"] },
  {
    prefix: "agents.defaults.heartbeat",
    kind: "hot",
    actions: ["restart-heartbeat"],
  },
  { prefix: "agent.heartbeat", kind: "hot", actions: ["restart-heartbeat"] },
  { prefix: "cron", kind: "hot", actions: ["restart-cron"] },
  // M7: plugin and MCP config changes are applied in place by the plugin host / MCP manager.
  { prefix: "plugins", kind: "hot", actions: ["reload-plugins"] },
  { prefix: "mcp", kind: "hot", actions: ["reload-mcp"] },
  {
    prefix: "browser",
    kind: "hot",
    actions: ["restart-browser-control"],
  },
];

const BASE_RELOAD_RULES_TAIL: ReloadRule[] = [
  { prefix: "identity", kind: "none" },
  { prefix: "wizard", kind: "none" },
  { prefix: "logging", kind: "none" },
  { prefix: "models", kind: "none" },
  { prefix: "agents", kind: "none" },
  { prefix: "tools", kind: "none" },
  { prefix: "bindings", kind: "none" },
  { prefix: "audio", kind: "none" },
  { prefix: "agent", kind: "none" },
  { prefix: "routing", kind: "none" },
  { prefix: "messages", kind: "none" },
  { prefix: "session", kind: "none" },
  { prefix: "talk", kind: "none" },
  { prefix: "skills", kind: "none" },
  { prefix: "ui", kind: "none" },
  // Auth profile changes (token rotation, TTL updates) are read per-request via
  // loadConfig() / loadAuthProfileStore() — no restart needed. This prevents
  // token rotation from flushing all active sessions (KoLo v2 Phase 2).
  { prefix: "gateway.auth", kind: "none" },
  { prefix: "gateway", kind: "restart" },
  { prefix: "discovery", kind: "restart" },
  { prefix: "canvasHost", kind: "restart" },
];

let cachedReloadRules: ReloadRule[] | null = null;
let cachedRegistry: ReturnType<typeof getActivePluginRegistry> | null = null;

function listReloadRules(): ReloadRule[] {
  const registry = getActivePluginRegistry();
  if (registry !== cachedRegistry) {
    cachedReloadRules = null;
    cachedRegistry = registry;
  }
  if (cachedReloadRules) {
    return cachedReloadRules;
  }
  // Channel docking: plugins contribute hot reload/no-op prefixes here.
  const channelReloadRules: ReloadRule[] = listChannelPlugins().flatMap((plugin) => [
    ...(plugin.reload?.configPrefixes ?? []).map(
      (prefix): ReloadRule => ({
        prefix,
        kind: "hot",
        actions: [`restart-channel:${plugin.id}` as ReloadAction],
      }),
    ),
    ...(plugin.reload?.noopPrefixes ?? []).map(
      (prefix): ReloadRule => ({
        prefix,
        kind: "none",
      }),
    ),
  ]);
  const rules = [...BASE_RELOAD_RULES, ...channelReloadRules, ...BASE_RELOAD_RULES_TAIL];
  cachedReloadRules = rules;
  return rules;
}

function matchRule(path: string): ReloadRule | null {
  for (const rule of listReloadRules()) {
    if (path === rule.prefix || path.startsWith(`${rule.prefix}.`)) {
      return rule;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]",
  );
}

export function diffConfigPaths(prev: unknown, next: unknown, prefix = ""): string[] {
  if (prev === next) {
    return [];
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const paths: string[] = [];
    for (const key of keys) {
      const prevValue = prev[key];
      const nextValue = next[key];
      if (prevValue === undefined && nextValue === undefined) {
        continue;
      }
      const childPrefix = prefix ? `${prefix}.${key}` : key;
      const childPaths = diffConfigPaths(prevValue, nextValue, childPrefix);
      if (childPaths.length > 0) {
        paths.push(...childPaths);
      }
    }
    return paths;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length === next.length && prev.every((val, idx) => val === next[idx])) {
      return [];
    }
  }
  return [prefix || "<root>"];
}

export function resolveGatewayReloadSettings(cfg: KoLoConfig): GatewayReloadSettings {
  const rawMode = cfg.gateway?.reload?.mode;
  const mode =
    rawMode === "off" || rawMode === "restart" || rawMode === "hot" || rawMode === "hybrid"
      ? rawMode
      : DEFAULT_RELOAD_SETTINGS.mode;
  const debounceRaw = cfg.gateway?.reload?.debounceMs;
  const debounceMs =
    typeof debounceRaw === "number" && Number.isFinite(debounceRaw)
      ? Math.max(0, Math.floor(debounceRaw))
      : DEFAULT_RELOAD_SETTINGS.debounceMs;
  return { mode, debounceMs };
}

export function buildGatewayReloadPlan(changedPaths: string[]): GatewayReloadPlan {
  const plan: GatewayReloadPlan = {
    changedPaths,
    restartGateway: false,
    restartReasons: [],
    hotReasons: [],
    reloadHooks: false,
    restartGmailWatcher: false,
    restartBrowserControl: false,
    restartCron: false,
    restartHeartbeat: false,
    restartChannels: new Set(),
    noopPaths: [],
    reloadPlugins: false,
    reloadMcp: false,
  };

  const applyAction = (action: ReloadAction) => {
    if (action.startsWith("restart-channel:")) {
      const channel = action.slice("restart-channel:".length) as ChannelId;
      plan.restartChannels.add(channel);
      return;
    }
    switch (action) {
      case "reload-hooks":
        plan.reloadHooks = true;
        break;
      case "restart-gmail-watcher":
        plan.restartGmailWatcher = true;
        break;
      case "restart-browser-control":
        plan.restartBrowserControl = true;
        break;
      case "restart-cron":
        plan.restartCron = true;
        break;
      case "restart-heartbeat":
        plan.restartHeartbeat = true;
        break;
      case "reload-plugins":
        plan.reloadPlugins = true;
        break;
      case "reload-mcp":
        plan.reloadMcp = true;
        break;
      default:
        break;
    }
  };

  for (const path of changedPaths) {
    const rule = matchRule(path);
    if (!rule) {
      plan.restartGateway = true;
      plan.restartReasons.push(path);
      continue;
    }
    if (rule.kind === "restart") {
      plan.restartGateway = true;
      plan.restartReasons.push(path);
      continue;
    }
    if (rule.kind === "none") {
      plan.noopPaths.push(path);
      continue;
    }
    plan.hotReasons.push(path);
    for (const action of rule.actions ?? []) {
      applyAction(action);
    }
  }

  if (plan.restartGmailWatcher) {
    plan.reloadHooks = true;
  }

  return plan;
}

export type GatewayConfigReloader = {
  stop: () => Promise<void>;
};

export function startGatewayConfigReloader(opts: {
  initialConfig: KoLoConfig;
  readSnapshot: () => Promise<ConfigFileSnapshot>;
  onHotReload: (plan: GatewayReloadPlan, nextConfig: KoLoConfig) => Promise<void>;
  onRestart: (plan: GatewayReloadPlan, nextConfig: KoLoConfig) => void;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  watchPath: string;
  configPath?: string; // Optional: path for SIGUSR2 config reload
}): GatewayConfigReloader {
  let currentConfig = opts.initialConfig;
  let settings = resolveGatewayReloadSettings(currentConfig);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let running = false;
  let stopped = false;
  let restartQueued = false;
  let queuedDrainChanges = new Set<string>(); // Paths queued for drain-class changes

  const schedule = () => {
    if (stopped) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    const wait = settings.debounceMs;
    debounceTimer = setTimeout(() => {
      void runReload();
    }, wait);
  };

  const runReload = async () => {
    if (stopped) {
      return;
    }
    if (running) {
      pending = true;
      return;
    }
    running = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    try {
      const snapshot = await opts.readSnapshot();
      if (!snapshot.valid) {
        const issues = snapshot.issues.map((issue) => `${issue.path}: ${issue.message}`).join(", ");
        opts.log.warn(`config reload skipped (invalid config): ${issues}`);
        return;
      }
      const nextConfig = snapshot.config;
      const changedPaths = diffConfigPaths(currentConfig, nextConfig);
      currentConfig = nextConfig;
      settings = resolveGatewayReloadSettings(nextConfig);
      if (changedPaths.length === 0) {
        return;
      }

      opts.log.info(`config change detected; evaluating reload (${changedPaths.join(", ")})`);
      void auditSafe({
        identity: "config-file",
        action: "config.change",
        outcome: "ok",
        source: "config-reload",
        detail: { paths: changedPaths },
      });
      const plan = buildGatewayReloadPlan(changedPaths);

      // Expose v3 safety class for each changed path (diagnostic)
      for (const changedPath of plan.changedPaths) {
        const v3Class = classifyPath(changedPath);
        opts.log.info(`config path "${changedPath}" → v3 class: ${v3Class}`);
      }

      if (settings.mode === "off") {
        opts.log.info("config reload disabled (gateway.reload.mode=off)");
        return;
      }
      if (settings.mode === "restart") {
        if (!restartQueued) {
          restartQueued = true;
          opts.onRestart(plan, nextConfig);
        }
        return;
      }
      if (plan.restartGateway) {
        if (settings.mode === "hot") {
          opts.log.warn(
            `config reload requires gateway restart; hot mode ignoring (${plan.restartReasons.join(
              ", ",
            )})`,
          );
          return;
        }
        if (!restartQueued) {
          restartQueued = true;
          opts.onRestart(plan, nextConfig);
        }
        return;
      }

      await opts.onHotReload(plan, nextConfig);
    } catch (err) {
      opts.log.error(`config reload failed: ${String(err)}`);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        schedule();
      }
    }
  };

  // SIGUSR2 handler for hot config reload with v3 safety classification
  const handleSIGUSR2 = () => {
    if (stopped) {
      return;
    }
    if (!opts.configPath) {
      opts.log.warn("SIGUSR2 received but configPath not provided; ignoring");
      return;
    }

    (async () => {
      try {
        // 1. Read the new config file
        if (!opts.configPath) {
          opts.log.warn("SIGUSR2: configPath not available; cannot reload");
          return;
        }
        const raw = readFileSync(opts.configPath, "utf8");
        let newConfig: unknown;
        try {
          newConfig = JSON.parse(raw);
        } catch (parseErr) {
          opts.log.error(`SIGUSR2: failed to parse config: ${String(parseErr)}`);
          return;
        }

        if (!newConfig || typeof newConfig !== "object" || Array.isArray(newConfig)) {
          opts.log.error("SIGUSR2: invalid config (must be an object)");
          return;
        }

        // 2. Diff using v3 classifier
        const diff = diffConfigs(
          currentConfig as Record<string, unknown>,
          newConfig as Record<string, unknown>,
        );

        const totalChanges = diff.live.length + diff.drain.length + diff.restart.length;
        if (totalChanges === 0) {
          opts.log.info("SIGUSR2: no config changes detected");
          return;
        }

        opts.log.info(
          `SIGUSR2: ${totalChanges} change(s) — ` +
            `live=${diff.live.length} drain=${diff.drain.length} restart=${diff.restart.length}`,
        );

        // 3. For "restart" class changes: log WARN and do NOT apply
        if (diff.restart.length > 0) {
          for (const change of diff.restart) {
            opts.log.warn(`SIGUSR2: REFUSED restart-required change: ${change.path}`);
          }
          return;
        }

        // 4. For "drain" class changes: queue them
        if (diff.drain.length > 0) {
          for (const change of diff.drain) {
            queuedDrainChanges.add(change.path);
          }
          opts.log.info(
            `SIGUSR2: queued ${diff.drain.length} drain-class change(s): ` +
              `${Array.from(queuedDrainChanges).join(", ")}`,
          );
        }

        // 5. For "live" class changes: apply immediately
        if (diff.live.length > 0) {
          currentConfig = newConfig as KoLoConfig;
          settings = resolveGatewayReloadSettings(currentConfig);
          opts.log.info(
            `SIGUSR2: applied ${diff.live.length} live-class change(s): ` +
              `${diff.live.map((c) => c.path).join(", ")}`,
          );
          void auditSafe({
            identity: "config-file",
            action: "config.change",
            outcome: "ok",
            source: "config-reload.sigusr2",
            detail: { paths: diff.live.map((c) => c.path) },
          });
          // Trigger the hot reload callback for live changes
          const liveOnlyPlan: GatewayReloadPlan = {
            changedPaths: diff.live.map((c) => c.path),
            restartGateway: false,
            restartReasons: [],
            hotReasons: diff.live.map((c) => c.path),
            reloadHooks: false,
            restartGmailWatcher: false,
            restartBrowserControl: false,
            restartCron: false,
            restartHeartbeat: false,
            restartChannels: new Set(),
            noopPaths: [],
            reloadPlugins: false,
            reloadMcp: false,
          };
          await opts.onHotReload(liveOnlyPlan, currentConfig);
        }
      } catch (err) {
        opts.log.error(`SIGUSR2 handler error: ${String(err)}`);
      }
    })().catch(() => {});
  };

  process.on("SIGUSR2", handleSIGUSR2);

  const watcher = chokidar.watch(opts.watchPath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    usePolling: Boolean(process.env.VITEST),
  });

  watcher.on("add", schedule);
  watcher.on("change", schedule);
  watcher.on("unlink", schedule);
  let watcherClosed = false;
  watcher.on("error", (err) => {
    if (watcherClosed) {
      return;
    }
    watcherClosed = true;
    opts.log.warn(`config watcher error: ${String(err)}`);
    void watcher.close().catch(() => {});
  });

  return {
    stop: async () => {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = null;
      watcherClosed = true;
      process.removeListener("SIGUSR2", handleSIGUSR2);
      await watcher.close().catch(() => {});
    },
  };
}
