// Enterprise credential isolation (Kurahi 2.0.3).
// With `auth.isolation: "explicit"` a non-main agent never inherits or merges the main agent's
// profiles; it sees only the profile ids granted in `auth.grants[agentId]`.
import path from "node:path";
import type { KoLoConfig } from "../../config/types.js";
import type { AuthProfileStore } from "./types.js";
import {
  canonicalizeAgentDir,
  collectReferencedAgentIds,
  resolveEffectiveAgentDir,
} from "../../config/agent-dirs.js";
import { loadConfig } from "../../config/io.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { AUTH_STORE_VERSION } from "./constants.js";

export type AuthIsolation =
  | { mode: "inherit" }
  | { mode: "explicit"; grants: Record<string, string[]>; cfg: KoLoConfig };

/** Isolation policy from config; a config that cannot be read keeps the compatible default. */
export function resolveAuthIsolation(cfg?: KoLoConfig): AuthIsolation {
  let config = cfg;
  if (!config) {
    try {
      config = loadConfig();
    } catch {
      return { mode: "inherit" };
    }
  }
  if (config?.auth?.isolation !== "explicit") {
    return { mode: "inherit" };
  }
  const grants: Record<string, string[]> = {};
  for (const [id, profiles] of Object.entries(config.auth.grants ?? {})) {
    grants[normalizeAgentId(id)] = profiles;
  }
  return { mode: "explicit", grants, cfg: config };
}

/** The agent id whose agentDir this is, or undefined when no configured agent owns it. */
export function agentIdForDir(
  cfg: KoLoConfig,
  agentDir: string,
  grantIds: string[] = [],
): string | undefined {
  const target = canonicalizeAgentDir(agentDir);
  const ids = new Set([
    ...collectReferencedAgentIds(cfg),
    ...grantIds.map((id) => normalizeAgentId(id)),
  ]);
  for (const id of ids) {
    if (canonicalizeAgentDir(resolveEffectiveAgentDir(cfg, id)) === target) {
      return id;
    }
  }
  // Default layout: <state>/agents/<id>/agent
  const parts = path.resolve(agentDir).split(path.sep);
  if (parts.at(-1) === "agent" && parts.at(-3) === "agents" && parts.at(-2)) {
    return normalizeAgentId(parts.at(-2)!);
  }
  return undefined;
}

/**
 * The view of an agent's credentials under explicit isolation: only granted profile ids, taken
 * from the agent's own store first and the main store second. Nothing else is visible.
 */
export function grantedAuthStore(params: {
  own: AuthProfileStore;
  main: AuthProfileStore;
  granted: string[];
}): AuthProfileStore {
  const profiles: AuthProfileStore["profiles"] = {};
  for (const id of params.granted) {
    const cred = params.own.profiles[id] ?? params.main.profiles[id];
    if (cred) {
      profiles[id] = cred;
    }
  }
  const keep = new Set(Object.keys(profiles));
  const pick = <T>(record?: Record<string, T>) =>
    record ? Object.fromEntries(Object.entries(record).filter(([id]) => keep.has(id))) : undefined;
  const order = params.own.order
    ? Object.fromEntries(
        Object.entries(params.own.order).map(([provider, ids]) => [
          provider,
          ids.filter((id) => keep.has(id)),
        ]),
      )
    : undefined;
  return {
    version: AUTH_STORE_VERSION,
    profiles,
    ...(order ? { order } : {}),
    ...(params.own.lastGood
      ? {
          lastGood: Object.fromEntries(
            Object.entries(params.own.lastGood).filter(([, id]) => keep.has(id)),
          ),
        }
      : {}),
    ...(params.own.usageStats
      ? { usageStats: pick(params.own.usageStats) as AuthProfileStore["usageStats"] }
      : {}),
  };
}
