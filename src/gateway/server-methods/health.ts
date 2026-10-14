import type { GatewayRequestHandlers } from "./types.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { ensureAuthProfileStore } from "../../agents/auth-profiles.js";
import { getStatusSummary } from "../../commands/status.js";
import { loadConfig } from "../../config/config.js";
import { getApiHealthSummary, type ProviderHealth } from "../../consciousness/api-health.js";
import { getAllConsciousnessStates } from "../../consciousness/engine.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { HEALTH_REFRESH_INTERVAL_MS } from "../server-constants.js";
import { formatError } from "../server-utils.js";
import { formatForLog } from "../ws-log.js";

// ── Deep Health Types ──────────────────────────────────────────────────

export type AuthProfileHealthEntry = {
  profileId: string;
  provider: string;
  type: "api_key" | "oauth" | "token";
  /** Whether this profile has a valid credential right now */
  valid: boolean;
  /** For oauth/token: ms until expiry (negative = expired) */
  ttlMs: number | null;
  /** ISO string of when the credential expires */
  expiresAt: string | null;
  /** Whether the profile is in cooldown from errors/rate-limiting */
  inCooldown: boolean;
  /** Last successful use timestamp */
  lastUsed: number | null;
  /** Failure reason if disabled */
  disabledReason: string | null;
};

export type ConsciousnessHealthEntry = {
  agentId: string;
  running: boolean;
  totalTicks: number;
  totalActions: number;
  circuitBroken: boolean;
  circuitBrokenAt: string | null;
  circuitBreakerRetries: number;
  sleepMode: boolean;
  consecutiveErrors: number;
  startedAt: string;
};

export type DeepHealthSummary = {
  ok: boolean;
  ts: number;
  durationMs: number;
  gateway: {
    uptimeMs: number;
    pid: number;
    memoryMb: number;
    nodeVersion: string;
    platform: string;
  };
  auth: {
    profiles: AuthProfileHealthEntry[];
    totalProfiles: number;
    validProfiles: number;
    expiringWithinHour: number;
  };
  providers: Record<string, ProviderHealth>;
  consciousness: ConsciousnessHealthEntry[];
  /** Standard health snapshot (channels, sessions, etc.) */
  health: unknown;
};

// ── Auth Profile Health ────────────────────────────────────────────────

function buildAuthProfileHealth(): DeepHealthSummary["auth"] {
  const cfg = loadConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const agentDir = resolveAgentWorkspaceDir(cfg, defaultAgentId);
  const store = ensureAuthProfileStore(agentDir);

  const now = Date.now();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const profiles: AuthProfileHealthEntry[] = [];

  for (const [profileId, cred] of Object.entries(store.profiles)) {
    const usageStats = store.usageStats?.[profileId];
    const inCooldown = usageStats
      ? Boolean(
          (usageStats.cooldownUntil && now < usageStats.cooldownUntil) ||
          (usageStats.disabledUntil && now < usageStats.disabledUntil),
        )
      : false;

    let ttlMs: number | null = null;
    let expiresAt: string | null = null;
    let valid = true;

    if (cred.type === "oauth") {
      if (typeof cred.expires === "number" && cred.expires > 0) {
        ttlMs = cred.expires - now;
        expiresAt = new Date(cred.expires).toISOString();
        valid = ttlMs > 0;
      }
    } else if (cred.type === "token") {
      if (typeof cred.expires === "number" && cred.expires > 0) {
        ttlMs = cred.expires - now;
        expiresAt = new Date(cred.expires).toISOString();
        valid = ttlMs > 0;
      }
    }
    // api_key credentials don't expire

    profiles.push({
      profileId,
      provider: cred.provider,
      type: cred.type,
      valid: valid && !inCooldown,
      ttlMs,
      expiresAt,
      inCooldown,
      lastUsed: usageStats?.lastUsed ?? null,
      disabledReason: usageStats?.disabledReason ?? null,
    });
  }

  return {
    profiles,
    totalProfiles: profiles.length,
    validProfiles: profiles.filter((p) => p.valid).length,
    expiringWithinHour: profiles.filter(
      (p) => p.ttlMs !== null && p.ttlMs > 0 && p.ttlMs < ONE_HOUR_MS,
    ).length,
  };
}

// ── Consciousness Health ───────────────────────────────────────────────

function buildConsciousnessHealth(): ConsciousnessHealthEntry[] {
  const states = getAllConsciousnessStates();
  const entries: ConsciousnessHealthEntry[] = [];

  for (const [agentId, state] of states) {
    entries.push({
      agentId,
      running: state.running,
      totalTicks: state.totalTicks,
      totalActions: state.totalActions,
      circuitBroken: state.circuitBroken,
      circuitBrokenAt: state.circuitBrokenAt,
      circuitBreakerRetries: state.circuitBreakerRetries,
      sleepMode: state.sleepMode,
      consecutiveErrors: state.consecutiveErrors,
      startedAt: state.startedAt,
    });
  }

  return entries;
}

// ── Handlers ───────────────────────────────────────────────────────────

export const healthHandlers: GatewayRequestHandlers = {
  health: async ({ respond, context, params }) => {
    const { getHealthCache, refreshHealthSnapshot, logHealth } = context;
    const wantsProbe = params?.probe === true;
    const now = Date.now();
    const cached = getHealthCache();
    if (!wantsProbe && cached && now - cached.ts < HEALTH_REFRESH_INTERVAL_MS) {
      respond(true, cached, undefined, { cached: true });
      void refreshHealthSnapshot({ probe: false }).catch((err) =>
        logHealth.error(`background health refresh failed: ${formatError(err)}`),
      );
      return;
    }
    try {
      const snap = await refreshHealthSnapshot({ probe: wantsProbe });
      respond(true, snap, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  "health.deep": async ({ respond, context }) => {
    const start = Date.now();
    try {
      const { getHealthCache, refreshHealthSnapshot, logHealth } = context;

      // Get or refresh the standard health snapshot
      let healthSnap = getHealthCache();
      if (!healthSnap) {
        healthSnap = await refreshHealthSnapshot({ probe: false }).catch((err) => {
          logHealth.error(`deep health: standard health failed: ${formatError(err)}`);
          return null;
        });
      }

      // Gateway process info
      const mem = process.memoryUsage();
      const gateway = {
        uptimeMs: Math.round(process.uptime() * 1000),
        pid: process.pid,
        memoryMb: Math.round(mem.heapUsed / (1024 * 1024)),
        nodeVersion: process.version,
        platform: process.platform,
      };

      // Auth profile health (TTL, validity, cooldown)
      const auth = buildAuthProfileHealth();

      // API provider health (from consciousness api-health tracker)
      const providers = getApiHealthSummary();

      // Consciousness engine state (circuit breaker, sleep mode, tick counts)
      const consciousness = buildConsciousnessHealth();

      const summary: DeepHealthSummary = {
        ok: true,
        ts: Date.now(),
        durationMs: Date.now() - start,
        gateway,
        auth,
        providers,
        consciousness,
        health: healthSnap,
      };

      respond(true, summary, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)));
    }
  },

  status: async ({ respond }) => {
    const status = await getStatusSummary();
    respond(true, status, undefined);
  },
};
