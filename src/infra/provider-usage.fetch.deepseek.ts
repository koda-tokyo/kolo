import type { ProviderUsageSnapshot, UsageWindow } from "./provider-usage.types.js";
import { fetchJson } from "./provider-usage.fetch.shared.js";
import { clampPercent, PROVIDER_LABELS } from "./provider-usage.shared.js";

type DeepSeekBalanceResponse = {
  currency?: string;
  balance?: number | string | null;
  grant_balance?: number | string | null;
};

/**
 * Fetch DeepSeek usage data (credit balance).
 *
 * DeepSeek's API returns balance at https://api.deepseek.com/user/balance.
 * Unlike Codex's rate-limit-based usage model, DeepSeek is pay-per-use,
 * so we track the remaining credit balance rather than a usage window.
 */
export async function fetchDeepSeekUsage(
  token: string,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<ProviderUsageSnapshot> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "KoLo",
    Accept: "application/json",
  };

  const res = await fetchJson(
    "https://api.deepseek.com/user/balance",
    { method: "GET", headers },
    timeoutMs,
    fetchFn,
  );

  if (res.status === 401 || res.status === 403) {
    return {
      provider: "deepseek",
      displayName: PROVIDER_LABELS["deepseek"],
      windows: [],
      error: "Token expired",
    };
  }

  if (!res.ok) {
    return {
      provider: "deepseek",
      displayName: PROVIDER_LABELS["deepseek"],
      windows: [],
      error: `HTTP ${res.status}`,
    };
  }

  try {
    const data = (await res.json()) as DeepSeekBalanceResponse;
    const windows: UsageWindow[] = [];

    // DeepSeek doesn't have rate-limit windows like Codex.
    // We surface balance as a pseudo-window for dashboard consistency.
    const balance =
      typeof data.balance === "number" ? data.balance : parseFloat(data.balance ?? "0") || 0;

    const grantBalance =
      typeof data.grant_balance === "number"
        ? data.grant_balance
        : parseFloat(data.grant_balance ?? "0") || 0;

    const total = balance + grantBalance;
    const currency = data.currency ?? "USD";

    // Show balance as the "usage window" for dashboard compatibility
    windows.push({
      label: `${currency} ${total.toFixed(2)}`,
      usedPercent: 0, // No usage cap — pay-per-use
      resetAt: undefined,
    });

    return {
      provider: "deepseek",
      displayName: PROVIDER_LABELS["deepseek"],
      windows,
      plan: `${currency} ${total.toFixed(2)}`,
    };
  } catch (err) {
    return {
      provider: "deepseek",
      displayName: PROVIDER_LABELS["deepseek"],
      windows: [],
      error: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
