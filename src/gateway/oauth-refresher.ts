// Gateway OAuth refresher. Keeps the OAuth credentials the gateway is configured with fresh
// so no request pays for a refresh and no agent gets a 401 at expiry. It runs only when there
// is something to refresh: OAuth-kind auth profiles under KOLO_HOME, or sources from the
// `oauth-sources` operator overlay. With neither it does not start and logs nothing.
//
// Each target is refreshed under a cross-process lock (src/infra/refresh-lock.ts) so several
// processes sharing one credential never refresh it concurrently; a failed refresh backs off
// exponentially (5 min doubling to 30 min) instead of hammering a rate-limited endpoint.

import type { KoLoConfig } from "../config/config.js";
import { withRefreshLock } from "../infra/refresh-lock.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  type OAuthRefreshOutcome,
  type OAuthRefreshTarget,
  resolveOAuthRefreshTargets,
  resolveTargetLockPath,
} from "./oauth-sources.js";

const log = createSubsystemLogger("gateway/oauth-refresher");

export const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
/** Refresh when a credential expires within this window. */
export const DEFAULT_MIN_VALID_MS = 5 * 60_000;
const COOLDOWN_BASE_MS = 5 * 60_000;
const COOLDOWN_MAX_MS = 30 * 60_000;

export type OAuthRefresherOptions = {
  cfg: KoLoConfig;
  intervalMs?: number;
  minValidMs?: number;
  /** Injected for tests; defaults to the configured profiles plus overlay sources. */
  targets?: OAuthRefreshTarget[];
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
};

export type OAuthRefresherHandle = {
  started: boolean;
  /** Why the refresher did not start (nothing configured) or a description of what it watches. */
  reason: string;
  targets: readonly OAuthRefreshTarget[];
  /** Run one refresh pass now (also used by the timer). */
  tick: () => Promise<Map<string, OAuthRefreshOutcome | null>>;
  /** The pass started at boot (resolved immediately when nothing is configured). */
  initial: Promise<Map<string, OAuthRefreshOutcome | null>>;
  stop: () => void;
};

type TargetState = { failures: number; lastFailureAt: number };

function cooldownMs(failures: number): number {
  return Math.min(COOLDOWN_BASE_MS * 2 ** Math.max(0, failures - 1), COOLDOWN_MAX_MS);
}

/**
 * Start the refresher. Returns a handle; `started` is false when nothing is configured, in
 * which case no timer exists and nothing was logged.
 */
export function startOAuthRefresher(opts: OAuthRefresherOptions): OAuthRefresherHandle {
  const targets = opts.targets ?? resolveOAuthRefreshTargets(opts.cfg);
  const now = opts.now ?? Date.now;
  const minValidMs = opts.minValidMs ?? DEFAULT_MIN_VALID_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const states = new Map<string, TargetState>();

  const refreshOne = async (target: OAuthRefreshTarget): Promise<OAuthRefreshOutcome | null> => {
    const state = states.get(target.id) ?? { failures: 0, lastFailureAt: 0 };
    if (state.failures > 0 && now() - state.lastFailureAt < cooldownMs(state.failures)) {
      return null;
    }
    const outcome = await withRefreshLock(resolveTargetLockPath(target), () =>
      target.refresh({ minValidMs }),
    );
    if (outcome === null) {
      log.debug(`${target.id}: refresh lock held elsewhere; skipped`);
      return null;
    }
    if (outcome.ok) {
      if (state.failures > 0) {
        log.info(`${target.id}: refresh recovered after ${state.failures} failure(s)`);
      }
      states.set(target.id, { failures: 0, lastFailureAt: 0 });
      if (outcome.refreshed) {
        const minutes =
          outcome.expiresAt !== undefined ? ((outcome.expiresAt - now()) / 60_000).toFixed(0) : "?";
        log.info(`${target.id}: credential refreshed, valid for ${minutes} min`);
      }
    } else {
      const failures = state.failures + 1;
      states.set(target.id, { failures, lastFailureAt: now() });
      log.warn(
        `${target.id}: refresh failed (${outcome.error ?? "unknown error"}); next attempt in ${(
          cooldownMs(failures) / 60_000
        ).toFixed(0)} min`,
      );
    }
    return outcome;
  };

  const tick = async () => {
    const results = new Map<string, OAuthRefreshOutcome | null>();
    for (const target of targets) {
      try {
        results.set(target.id, await refreshOne(target));
      } catch (err) {
        results.set(target.id, {
          ok: false,
          refreshed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return results;
  };

  if (targets.length === 0) {
    return {
      started: false,
      reason: "no OAuth profiles or sources configured",
      targets,
      tick,
      initial: Promise.resolve(new Map()),
      stop: () => {},
    };
  }

  const reason = `${targets.length} target(s): ${targets.map((t) => t.id).join(", ")}`;
  log.info(`OAuth refresher started (${reason}; interval ${intervalMs / 1000}s)`);
  const setIntervalFn = opts.setInterval ?? globalThis.setInterval;
  const clearIntervalFn = opts.clearInterval ?? globalThis.clearInterval;
  const timer = setIntervalFn(() => {
    void tick();
  }, intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
  const initial = tick();
  return {
    started: true,
    reason,
    targets,
    tick,
    initial,
    stop: () => clearIntervalFn(timer),
  };
}
