/**
 * API Health Monitor — Graceful degradation when LLM providers are down.
 *
 * Tracks API availability per provider and enables:
 * - Automatic pause when provider is confirmed down (vs code bugs)
 * - Fallback model chain (Anthropic → OpenAI → local Ollama)
 * - Auto-recovery probing (check every N minutes if provider is back)
 *
 */

export interface ProviderHealth {
  provider: string;
  status: "healthy" | "degraded" | "down";
  lastSuccess: string | null;
  lastFailure: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** When the provider was marked down */
  downSince: string | null;
}

/** Thresholds */
const DEGRADED_THRESHOLD = 2; // consecutive failures → degraded
const DOWN_THRESHOLD = 5; // consecutive failures → down
const RECOVERY_PROBE_INTERVAL_MS = 5 * 60_000; // 5 min between recovery probes

/** Per-provider health state */
const providerHealth = new Map<string, ProviderHealth>();

/**
 * Initialize or get health state for a provider.
 */
function getHealth(provider: string): ProviderHealth {
  let health = providerHealth.get(provider);
  if (!health) {
    health = {
      provider,
      status: "healthy",
      lastSuccess: null,
      lastFailure: null,
      consecutiveFailures: 0,
      lastError: null,
      downSince: null,
    };
    providerHealth.set(provider, health);
  }
  return health;
}

/**
 * Record a successful API call.
 */
export function recordApiSuccess(provider: string): void {
  const health = getHealth(provider);
  health.status = "healthy";
  health.lastSuccess = new Date().toISOString();
  health.consecutiveFailures = 0;
  health.lastError = null;

  if (health.downSince) {
    console.log(`[api-health] [${provider}] RECOVERED — was down since ${health.downSince}`);
    health.downSince = null;
  }
}

/**
 * Record a failed API call. Returns the updated status.
 */
export function recordApiFailure(provider: string, error: string): ProviderHealth {
  const health = getHealth(provider);
  health.consecutiveFailures++;
  health.lastFailure = new Date().toISOString();
  health.lastError = error;

  if (health.consecutiveFailures >= DOWN_THRESHOLD) {
    if (health.status !== "down") {
      health.downSince = new Date().toISOString();
      console.error(
        `[api-health] [${provider}] MARKED DOWN after ${health.consecutiveFailures} consecutive failures. ` +
          `Last error: ${error}`,
      );
    }
    health.status = "down";
  } else if (health.consecutiveFailures >= DEGRADED_THRESHOLD) {
    health.status = "degraded";
    console.warn(
      `[api-health] [${provider}] DEGRADED — ${health.consecutiveFailures} consecutive failures`,
    );
  }

  return health;
}

/**
 * Check if a provider is available for use.
 */
export function isProviderAvailable(provider: string): boolean {
  const health = getHealth(provider);
  if (health.status !== "down") return true;

  // Allow recovery probes periodically
  if (health.lastFailure) {
    const elapsed = Date.now() - new Date(health.lastFailure).getTime();
    if (elapsed >= RECOVERY_PROBE_INTERVAL_MS) {
      return true; // Allow one probe attempt
    }
  }

  return false;
}

/**
 * Get the best available provider from a priority chain.
 * Returns null if all providers are down.
 */
export function getBestProvider(
  chain: string[] = ["anthropic", "openai", "ollama"],
): string | null {
  for (const provider of chain) {
    if (isProviderAvailable(provider)) {
      return provider;
    }
  }
  return null;
}

/**
 * Classify an error as transient (API down) or permanent (code bug).
 * Transient errors trigger graceful degradation.
 * Permanent errors trigger the circuit breaker.
 */
export function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const transientPatterns = [
    /ECONNREFUSED/i,
    /ETIMEDOUT/i,
    /ENOTFOUND/i,
    /socket hang up/i,
    /429/, // Rate limit
    /503/, // Service unavailable
    /502/, // Bad gateway
    /500/, // Internal server error (sometimes transient)
    /overloaded/i,
    /capacity/i,
    /rate.limit/i,
    /timeout/i,
    /network/i,
  ];

  return transientPatterns.some((p) => p.test(message));
}

/**
 * Get health summary for all tracked providers (for /health endpoint).
 */
export function getApiHealthSummary(): Record<string, ProviderHealth> {
  const summary: Record<string, ProviderHealth> = {};
  for (const [provider, health] of providerHealth) {
    summary[provider] = { ...health };
  }
  return summary;
}
