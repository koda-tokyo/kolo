/**
 * Gateway Operational Alerts
 *
 * Alert bus for production operational events.
 *
 * Delivery hierarchy (all attempted, swallowed on failure):
 *   1. WhatsApp — primary real-time channel
 *      Recipient: gateway.alerts.primaryRecipient in kolo.json
 *      or KOLO_ALERT_RECIPIENT env, or first number in channels.whatsapp.allowFrom.
 *   2. Matrix — secondary (register via registerMatrixAlertSender at boot)
 *   3. Operator inbox file — always available
 *   4. <KOLO_HOME>/alerts/ JSON files — external watchers poll this
 *
 * Aggregation:
 *   - First alert of a type fires immediately
 *   - Duplicate alerts of same type+severity suppressed for DEDUP_WINDOW_MS (5min)
 *   - Recovery events always sent immediately (never suppressed)
 *   - Suppression is logged, not silent
 *
 * The alert watchdog lives outside the gateway process (an external watcher): a process
 * cannot be trusted to report its own death.
 *
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveKoloHome } from "../config/kolo-home.js";
import { resolveSiblingInboxDir } from "../config/sibling-paths.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AlertKind = "failure" | "recovery";

export interface GatewayAlert {
  type: string;
  severity: AlertSeverity;
  kind: AlertKind;
  agentId?: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ── Config ─────────────────────────────────────────────────────────────────────

// <KOLO_HOME>/alerts — resolved per call so KOLO_HOME changes are honoured.
const alertsDir = (): string => join(resolveKoloHome(), "alerts");

/** 5-minute dedup window: aggregation preserves signal. */
const DEDUP_WINDOW_MS = 5 * 60_000;

/**
 * Resolve the primary alert recipient.
 *
 * Priority:
 *   1. gateway.alerts.primaryRecipient in kolo.json  (preferred — no numbers in code)
 *   2. KOLO_ALERT_RECIPIENT env var
 *   3. First number in channels.whatsapp.allowFrom   (safe fallback)
 *
 * Never hardwire a personal number into code or documentation.
 */
function resolvePrimaryRecipient(): string | null {
  try {
    const env = process.env.KOLO_ALERT_RECIPIENT;
    if (env?.trim()) return env.trim();

    const { loadConfig } = require("../config/config.js") as typeof import("../config/config.js");
    const cfg = loadConfig() as {
      gateway?: { alerts?: { primaryRecipient?: string } };
      channels?: { whatsapp?: { allowFrom?: string[] } };
    };

    const explicit = (cfg as any)?.gateway?.alerts?.primaryRecipient;
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();

    const allowFrom = cfg?.channels?.whatsapp?.allowFrom;
    if (Array.isArray(allowFrom) && allowFrom.length > 0) return allowFrom[0];

    return null;
  } catch {
    return null;
  }
}

/** Resolve Matrix room ID for alerts (optional). */
function resolveMatrixRecipient(): string | null {
  try {
    const env = process.env.KOLO_ALERT_MATRIX_TO;
    if (env?.trim()) return env.trim();
    const { loadConfig } = require("../config/config.js") as typeof import("../config/config.js");
    const cfg = loadConfig() as { gateway?: { alerts?: { matrixTo?: string } } };
    const room = (cfg as any)?.gateway?.alerts?.matrixTo;
    return typeof room === "string" && room.trim() ? room.trim() : null;
  } catch {
    return null;
  }
}

// ── Deduplication ──────────────────────────────────────────────────────────────

/** key = `${type}:${severity}`, value = last-fired timestamp */
const _dedupMap = new Map<string, number>();

/**
 * Returns true if this alert should fire (not suppressed).
 * Recovery events always fire (never suppressed).
 * Operational events suppressed within DEDUP_WINDOW_MS.
 */
function shouldFire(alert: GatewayAlert): boolean {
  if (alert.kind === "recovery") return true; // recoveries always fire immediately

  const key = `${alert.type}:${alert.severity}`;
  const last = _dedupMap.get(key);
  const now = Date.now();

  if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
    // Suppressed — write to file so it's not silently lost, but don't send real-time
    writeAlertFile({
      ...alert,
      details: {
        ...alert.details,
        suppressed: true,
        suppressedUntil: new Date(last + DEDUP_WINDOW_MS).toISOString(),
      },
    });
    return false;
  }

  _dedupMap.set(key, now);
  return true;
}

// ── Delivery ───────────────────────────────────────────────────────────────────

function writeAlertFile(alert: GatewayAlert): void {
  try {
    const ALERTS_DIR = alertsDir();
    mkdirSync(ALERTS_DIR, { recursive: true });
    const filename = `${Date.now()}-${alert.type.replace(/[^a-z0-9-]/gi, "_")}.json`;
    writeFileSync(join(ALERTS_DIR, filename), JSON.stringify(alert, null, 2) + "\n");
  } catch {
    /* filesystem full or permissions — swallow */
  }
}

function writeToTigerInbox(alert: GatewayAlert): void {
  try {
    const inboxDir = resolveSiblingInboxDir(process.env.KOLO_ALERT_INBOX_AGENT ?? "default");
    mkdirSync(inboxDir, { recursive: true });
    const label = alert.kind === "recovery" ? "RECOVERED" : alert.severity;
    const filename = `${Date.now()}-${label}-${alert.type}.md`;
    const content = [
      `# [${label}] ${alert.type}`,
      `**Time:** ${alert.timestamp}`,
      `**Message:** ${alert.message}`,
      alert.agentId ? `**Agent:** ${alert.agentId}` : null,
      alert.details ? `\n\`\`\`json\n${JSON.stringify(alert.details, null, 2)}\n\`\`\`` : null,
    ]
      .filter(Boolean)
      .join("\n");
    writeFileSync(join(inboxDir, filename), content + "\n");
  } catch {
    /* swallow */
  }
}

async function sendWhatsApp(alert: GatewayAlert): Promise<boolean> {
  const to = resolvePrimaryRecipient();
  if (!to) return false;
  try {
    const { sendMessageWhatsApp } = await import("../web/outbound.js");
    const prefix =
      alert.kind === "recovery"
        ? "[RECOVERED]"
        : alert.severity === "CRITICAL"
          ? "[CRITICAL]"
          : alert.severity === "WARNING"
            ? "[WARNING]"
            : "[INFO]";
    const text = `${prefix} KoLo Gateway\n\n${alert.type}\n${alert.message}\n\n${alert.timestamp}`;
    await sendMessageWhatsApp(to, text, { verbose: false });
    return true;
  } catch {
    return false;
  }
}

// Matrix registered at boot by server plugin layer — not directly imported (separate package)
let _matrixSender: ((roomId: string, text: string) => Promise<unknown>) | null = null;

export function registerMatrixAlertSender(
  fn: (roomId: string, text: string) => Promise<unknown>,
): void {
  _matrixSender = fn;
}

async function sendMatrix(alert: GatewayAlert): Promise<boolean> {
  const to = resolveMatrixRecipient();
  if (!to || !_matrixSender) return false;
  try {
    const prefix = alert.kind === "recovery" ? "[RECOVERED]" : `[${alert.severity}]`;
    const text = `${prefix} KoLo Gateway\n\n${alert.type}\n${alert.message}\n\n${alert.timestamp}`;
    await _matrixSender(to, text);
    return true;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Fire a gateway operational alert.
 *
 * Never throws. Applies deduplication. Delivers to all available channels.
 */
export async function fireAlert(
  type: string,
  severity: AlertSeverity,
  message: string,
  opts?: {
    agentId?: string;
    details?: Record<string, unknown>;
    kind?: AlertKind;
  },
): Promise<void> {
  const alert: GatewayAlert = {
    type,
    severity,
    kind: opts?.kind ?? "failure",
    message,
    agentId: opts?.agentId,
    details: opts?.details,
    timestamp: new Date().toISOString(),
  };

  if (!shouldFire(alert)) return; // suppressed by dedup

  // Synchronous fallbacks first
  writeAlertFile(alert);
  writeToTigerInbox(alert);

  // Real-time channels: INFO stays local; WARNING+CRITICAL go live
  if (severity !== "INFO") {
    await Promise.allSettled([sendWhatsApp(alert), sendMatrix(alert)]);
  }
}

// ── Operational event logging ────────────────────────────────

/**
 * Log a forced operational action as a real event (not buried in stdout).
 * These are NOT alerts — they don't go to WhatsApp. They go to the event log
 * and the operator inbox so restarts can be audited.
 */
export function logOperationalEvent(
  action:
    | "SIGKILL_ISSUED"
    | "PORT_FORCE_CLEARED"
    | "LEASE_FORCE_CLEANED"
    | "ALERT_SUPPRESSED"
    | "OLLAMA_FALLBACK"
    | "RESTART_REASON",
  details: Record<string, unknown>,
): void {
  writeAlertFile({
    type: `operational.${action.toLowerCase()}`,
    severity: "INFO",
    kind: "failure",
    message: `Operational event: ${action}`,
    details,
    timestamp: new Date().toISOString(),
  });
}

// ── Pre-built alert types ──────────────────────────────────────────────────────

// Failure alerts
export function alertGatewayShutdown(reason: string): Promise<void> {
  return fireAlert(
    "gateway_shutdown",
    "CRITICAL",
    `Kurahi gateway shut down unexpectedly: ${reason}`,
    { details: { pid: process.pid, uptime: process.uptime() } },
  );
}

export function alertCircuitTripped(
  agentId: string,
  providerId: string,
  failureCount: number,
): Promise<void> {
  return fireAlert(
    "circuit_tripped",
    "WARNING",
    `Circuit tripped for agent ${agentId} (provider: ${providerId}, failures: ${failureCount})`,
    { agentId, details: { providerId, failureCount } },
  );
}

export function alertAuthExpiring(provider: string, remainingMs: number): Promise<void> {
  const hours = Math.round((remainingMs / 3_600_000) * 10) / 10;
  const sev: AlertSeverity = remainingMs < 30 * 60_000 ? "CRITICAL" : "WARNING";
  return fireAlert(
    "auth_expiring",
    sev,
    `${provider} OAuth token expires in ${hours}h — refresh or switch to Ollama`,
    {
      details: {
        provider,
        remainingMs,
        expiresAt: new Date(Date.now() + remainingMs).toISOString(),
      },
    },
  );
}

export function alertTickFailureStreak(agentId: string, streak: number): Promise<void> {
  return fireAlert(
    "tick_failure_streak",
    "WARNING",
    `Agent ${agentId} has ${streak} consecutive consciousness tick failures`,
    { agentId, details: { streak } },
  );
}

// Recovery alerts (operators need closure, not just panic)
export function alertGatewayRecovered(uptimeMs: number): Promise<void> {
  return fireAlert(
    "gateway_recovered",
    "INFO",
    `Kurahi gateway recovered and is serving (uptime: ${Math.round(uptimeMs / 1000)}s)`,
    { kind: "recovery", details: { pid: process.pid } },
  );
}

export function alertCircuitRecovered(agentId: string, providerId: string): Promise<void> {
  return fireAlert(
    "circuit_recovered",
    "INFO",
    `Circuit recovered for agent ${agentId} (provider: ${providerId})`,
    { agentId, kind: "recovery", details: { providerId } },
  );
}

export function alertAuthRefreshed(provider: string): Promise<void> {
  return fireAlert("auth_refreshed", "INFO", `${provider} auth token refreshed successfully`, {
    kind: "recovery",
    details: { provider },
  });
}
