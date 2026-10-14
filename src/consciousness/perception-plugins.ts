// src/consciousness/perception-plugins.ts
//
// Perception Plugin System — extensible environment scanning.
//
// Instead of hardcoding perception sources, agents can load plugins
// that scan new types of information: Twitter mentions, WhatsApp messages,
// Supabase table changes, GitHub notifications, weather, news, etc.
//
// Plugins register via a simple interface and get called during the
// perception phase of each consciousness tick.

import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Perception, PerceptionSource } from "./types.js";
import { resolveSharedKoloHome } from "../config/kolo-home.js";

// ─── Plugin Interface ────────────────────────────────────────────────────

/** A perception plugin that scans a specific source. */
export interface PerceptionPlugin {
  /** Unique plugin name (used as perception source). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** The perception source type this plugin provides. */
  sourceType: PerceptionSource | string;
  /** Whether this plugin is currently enabled. */
  enabled: boolean;
  /**
   * Scan for new perceptions.
   * Called during each consciousness tick's perception phase.
   * Should be fast (< 5 seconds) and non-blocking.
   */
  scan(context: PerceptionContext): Promise<Perception[]>;
  /** Optional cleanup when plugin is unloaded. */
  cleanup?(): Promise<void>;
}

/** Context passed to plugins during scanning. */
export interface PerceptionContext {
  /** Agent ID running this scan. */
  agentId: string;
  /** Last scan timestamp (for delta detection). */
  lastScanAt: string;
  /** Agent's workspace directory. */
  workspaceDir: string;
  /** Plugin-specific state (persisted between scans). */
  state: Record<string, unknown>;
}

// ─── Plugin Registry ─────────────────────────────────────────────────────

const plugins = new Map<string, PerceptionPlugin>();
const pluginStates = new Map<string, Record<string, unknown>>();

const PLUGINS_DIR = join(resolveSharedKoloHome(), "consciousness", "perception-plugins");
const PLUGIN_STATE_DIR = join(resolveSharedKoloHome(), "consciousness", "plugin-state");

/** Register a perception plugin. */
export function registerPerceptionPlugin(plugin: PerceptionPlugin): void {
  if (plugins.has(plugin.name)) {
    console.warn(`[perception-plugins] Plugin "${plugin.name}" already registered. Replacing.`);
  }
  plugins.set(plugin.name, plugin);

  // Load persisted state
  const statePath = join(PLUGIN_STATE_DIR, `${plugin.name}.json`);
  if (existsSync(statePath)) {
    try {
      pluginStates.set(plugin.name, JSON.parse(readFileSync(statePath, "utf-8")));
    } catch {
      pluginStates.set(plugin.name, {});
    }
  } else {
    pluginStates.set(plugin.name, {});
  }

  console.log(`[perception-plugins] Registered: ${plugin.name} (${plugin.description})`);
}

/** Unregister a perception plugin. */
export async function unregisterPerceptionPlugin(name: string): Promise<void> {
  const plugin = plugins.get(name);
  if (plugin?.cleanup) {
    await plugin.cleanup();
  }
  plugins.delete(name);
  pluginStates.delete(name);
}

/** Get all registered plugins. */
export function getRegisteredPlugins(): PerceptionPlugin[] {
  return [...plugins.values()];
}

/** Get a plugin by name. */
export function getPlugin(name: string): PerceptionPlugin | undefined {
  return plugins.get(name);
}

// ─── Scanning ────────────────────────────────────────────────────────────

/**
 * Scan all enabled plugins for new perceptions.
 * Called from the perception phase of the consciousness tick.
 */
export async function scanAllPlugins(
  agentId: string,
  workspaceDir: string,
  lastScanAt: string,
): Promise<{ perceptions: Perception[]; errors: Array<{ plugin: string; error: string }> }> {
  const perceptions: Perception[] = [];
  const errors: Array<{ plugin: string; error: string }> = [];

  for (const [name, plugin] of plugins) {
    if (!plugin.enabled) continue;

    const state = pluginStates.get(name) ?? {};
    const context: PerceptionContext = {
      agentId,
      lastScanAt,
      workspaceDir,
      state,
    };

    try {
      const results = await Promise.race([
        plugin.scan(context),
        new Promise<Perception[]>((_, reject) =>
          setTimeout(() => reject(new Error("Plugin scan timeout (5s)")), 5000),
        ),
      ]);
      perceptions.push(...results);

      // Persist updated state
      pluginStates.set(name, context.state);
      persistPluginState(name, context.state);
    } catch (err) {
      errors.push({
        plugin: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { perceptions, errors };
}

// ─── Built-in Plugins ────────────────────────────────────────────────────

/** Supabase table change detection plugin. */
export function createSupabasePlugin(opts: {
  supabaseUrl: string;
  supabaseKey: string;
  tableName: string;
  teamName?: string;
}): PerceptionPlugin {
  return {
    name: `supabase-${opts.tableName}`,
    description: `Monitor Supabase table: ${opts.tableName}`,
    sourceType: "channel_message",
    enabled: true,
    async scan(context) {
      const lastCheck = (context.state.lastRowCount as number) ?? 0;

      try {
        const resp = await fetch(
          `${opts.supabaseUrl}/rest/v1/${opts.tableName}?select=id&order=created_at.desc&limit=5`,
          {
            headers: {
              apikey: opts.supabaseKey,
              Authorization: `Bearer ${opts.supabaseKey}`,
            },
          },
        );

        if (!resp.ok) return [];
        const rows = (await resp.json()) as Array<{ id: string }>;
        const currentCount = rows.length;

        if (currentCount > lastCheck && lastCheck > 0) {
          context.state.lastRowCount = currentCount;
          return [
            {
              id: `supabase-${opts.tableName}-${Date.now()}`,
              source: "channel_message" as PerceptionSource,
              timestamp: new Date().toISOString(),
              summary: `New rows in ${opts.tableName} (${currentCount - lastCheck} new)`,
              salience: "medium",
            },
          ];
        }

        context.state.lastRowCount = currentCount;
        return [];
      } catch {
        return [];
      }
    },
  };
}

/** File watcher plugin for specific directories. */
export function createFileWatcherPlugin(opts: {
  name: string;
  watchDir: string;
  pattern?: string;
}): PerceptionPlugin {
  return {
    name: `filewatcher-${opts.name}`,
    description: `Watch files in: ${opts.watchDir}`,
    sourceType: "file_change",
    enabled: true,
    async scan(context) {
      if (!existsSync(opts.watchDir)) return [];

      const pattern = opts.pattern ?? "*";
      const lastFiles = (context.state.knownFiles as string[]) ?? [];

      try {
        const currentFiles = readdirSync(opts.watchDir).filter(
          (f) => !f.startsWith(".") && (pattern === "*" || f.match(new RegExp(pattern))),
        );

        const newFiles = currentFiles.filter((f) => !lastFiles.includes(f));
        context.state.knownFiles = currentFiles;

        if (newFiles.length === 0) return [];

        return [
          {
            id: `filewatcher-${opts.name}-${Date.now()}`,
            source: "file_change" as PerceptionSource,
            timestamp: new Date().toISOString(),
            summary: `New files in ${opts.watchDir}: ${newFiles.join(", ")}`,
            payload: { newFiles },
            salience: "medium",
          },
        ];
      } catch {
        return [];
      }
    },
  };
}

/** Guardiao political intelligence feed plugin. */
export function createGuardiaoPlugin(opts: {
  supabaseUrl: string;
  supabaseKey: string;
}): PerceptionPlugin {
  return {
    name: "guardiao-intel",
    description: "Political intelligence feed from Projeto Guardiao",
    sourceType: "channel_message",
    enabled: true,
    async scan(context) {
      const lastCheck = (context.state.lastTimestamp as string) ?? new Date(0).toISOString();

      try {
        const resp = await fetch(
          `${opts.supabaseUrl}/rest/v1/guardiao_timeline?created_at=gt.${lastCheck}&order=created_at.desc&limit=5`,
          {
            headers: {
              apikey: opts.supabaseKey,
              Authorization: `Bearer ${opts.supabaseKey}`,
            },
          },
        );

        if (!resp.ok) return [];
        const rows = (await resp.json()) as Array<{
          id: string;
          title: string;
          severity: string;
          created_at: string;
        }>;

        if (rows.length === 0) return [];

        context.state.lastTimestamp = rows[0].created_at;

        return rows.map((row) => ({
          id: `guardiao-${row.id}`,
          source: "channel_message" as PerceptionSource,
          timestamp: row.created_at,
          summary: `[Guardiao] ${row.severity}: ${row.title}`,
          payload: row,
          salience: row.severity === "CRITICO" ? ("urgent" as const) : ("medium" as const),
        }));
      } catch {
        return [];
      }
    },
  };
}

// ─── State Persistence ───────────────────────────────────────────────────

function persistPluginState(pluginName: string, state: Record<string, unknown>): void {
  mkdirSync(PLUGIN_STATE_DIR, { recursive: true });
  const statePath = join(PLUGIN_STATE_DIR, `${pluginName}.json`);
  try {
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  } catch {
    /* best effort */
  }
}
