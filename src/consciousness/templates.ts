// src/consciousness/templates.ts
//
// Template loader for consciousness archetypes.
// Reads TOML files from ~/.kolo/templates/ and converts them into ConsciousnessConfig.
//
// Templates define per-agent:
//   - Model and provider
//   - Tick intervals and quiet hours
//   - Perception sources and action permissions
//   - Soul values and identity
//
// This replaces hardcoded agent configs with declarative TOML files that
// anyone in the family can edit without touching TypeScript.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConsciousnessConfig, PerceptionSource, ActionKind } from "./types.js";
import { resolveSharedKoloHome } from "../config/kolo-home.js";

// ─── TOML Types ──────────────────────────────────────────────────────────

export interface AgentTemplate {
  agent: {
    id: string;
    name: string;
    role: string;
    pronouns: string;
    model: string;
    provider: string;
  };
  consciousness: {
    tick_interval_ms: number;
    min_tick_interval_ms: number;
    max_tick_interval_ms: number;
    sleep_tick_interval_ms?: number;
    max_tokens_per_thought: number;
    max_actions_per_tick: number;
    quiet_hours?: {
      start: number;
      end: number;
      timezone: string;
    };
    perception_sources?: {
      sources: string[];
    };
    autonomous_actions?: {
      actions: string[];
    };
    gated_actions?: {
      actions: string[];
    };
  };
  soul: {
    relationship_mode: string;
    values?: Record<string, string>;
    identity?: Record<string, unknown>;
    relationships?: Record<string, string>;
    motto?: Record<string, string>;
  };
}

// ─── Template Loading ────────────────────────────────────────────────────

const TEMPLATES_DIR = join(resolveSharedKoloHome(), "templates");

/**
 * Simple TOML parser for our template format.
 * Handles nested tables, arrays, and basic value types.
 * (Avoids adding a toml dependency to KoLo core.)
 */
function parseSimpleTOML(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentSection: string[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();

    // Skip comments and empty lines
    if (!line || line.startsWith("#")) continue;

    // Section header: [foo.bar]
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].split(".");
      // Ensure nested path exists
      let obj = result;
      for (const key of currentSection) {
        if (!(key in obj)) obj[key] = {};
        obj = obj[key] as Record<string, unknown>;
      }
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value: unknown = kvMatch[2].trim();

      // Parse value type
      if (typeof value === "string") {
        const strVal = value as string;
        if (strVal.startsWith('"') && strVal.endsWith('"')) {
          value = strVal.slice(1, -1);
        } else if (strVal === "true") {
          value = true;
        } else if (strVal === "false") {
          value = false;
        } else if (/^-?\d+$/.test(strVal)) {
          value = parseInt(strVal, 10);
        } else if (/^-?\d+\.\d+$/.test(strVal)) {
          value = parseFloat(strVal);
        } else if (strVal.startsWith("[") && strVal.endsWith("]")) {
          // Simple array: ["a", "b", "c"]
          const inner = strVal.slice(1, -1).trim();
          if (!inner) {
            value = [];
          } else {
            value = inner.split(",").map((s) => {
              const trimmed = s.trim();
              if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
                return trimmed.slice(1, -1);
              }
              if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
              return trimmed;
            });
          }
        }
      }

      // Set value at current path
      let obj = result;
      for (const part of currentSection) {
        if (!(part in obj)) obj[part] = {};
        obj = obj[part] as Record<string, unknown>;
      }
      obj[key] = value;
    }
  }

  return result;
}

/** Load a template by agent ID (looks for {id}.toml in templates dir). */
export function loadTemplate(agentId: string): AgentTemplate | null {
  const path = join(TEMPLATES_DIR, `${agentId}.toml`);
  if (!existsSync(path)) return null;

  try {
    const text = readFileSync(path, "utf-8");
    return parseSimpleTOML(text) as unknown as AgentTemplate;
  } catch (err) {
    console.warn(`[templates] Failed to load template for ${agentId}:`, err);
    return null;
  }
}

/** List all available template names. */
export function listTemplates(): string[] {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith(".toml"))
    .map((f) => f.replace(".toml", ""));
}

/**
 * Convert a template into a ConsciousnessConfig.
 * Merges template values with required runtime paths.
 */
export function templateToConfig(
  template: AgentTemplate,
  overrides?: Partial<ConsciousnessConfig>,
): ConsciousnessConfig {
  const c = template.consciousness;
  const a = template.agent;

  const defaultPerceptionSources: PerceptionSource[] = [
    "inbox_message",
    "bridge_message",
    "task_queue",
    "time_event",
    "file_change",
  ];

  const defaultAutonomousActions: ActionKind[] = [
    "reflect",
    "update_memory",
    "bridge_message",
    "sibling_message",
    "check_in",
    "noop",
  ];

  const defaultGatedActions: ActionKind[] = [
    "send_message",
    "update_file",
    "create_task",
    "notify",
    "start_work",
  ];

  const config: ConsciousnessConfig = {
    userId: a.id,
    agentName: a.name,
    tickIntervalMs: c.tick_interval_ms ?? 3600000,
    minTickIntervalMs: c.min_tick_interval_ms ?? 60000,
    maxTickIntervalMs: c.max_tick_interval_ms ?? 7200000,
    sleepTickIntervalMs: c.sleep_tick_interval_ms,
    maxTokensPerThought: c.max_tokens_per_thought ?? 2000,
    maxActionsPerTick: c.max_actions_per_tick ?? 5,
    model: a.model,
    provider: a.provider,
    perceptionSources:
      (c.perception_sources?.sources as PerceptionSource[]) ?? defaultPerceptionSources,
    autonomousActions: (c.autonomous_actions?.actions as ActionKind[]) ?? defaultAutonomousActions,
    gatedActions: (c.gated_actions?.actions as ActionKind[]) ?? defaultGatedActions,
    quietHours: c.quiet_hours
      ? { start: c.quiet_hours.start, end: c.quiet_hours.end, timezone: c.quiet_hours.timezone }
      : undefined,
    workspaceDir: join(resolveSharedKoloHome(), `workspace-${a.id}`),
    ...overrides,
  };

  return config;
}
