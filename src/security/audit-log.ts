// Security audit events for M2a policy decisions (tool capability, auth limits).
// Entries go to the M2b hash-chained audit log (src/audit); in-process listeners let callers and
// tests observe decisions synchronously.
import { auditSafe } from "../audit/audit-log.js";

export type AuditOutcome = "allowed" | "denied" | "error" | "failed";

export type AuditEvent = {
  ts: string;
  action: string;
  outcome: AuditOutcome;
  /** Agent id, user, or "anonymous". */
  identity?: string;
  device?: string;
  /** Session key or other scope the action applied to. */
  scope?: string;
  /** Subsystem that made the decision (cli-runner, pi-tools, http:/tools/invoke …). */
  source: string;
  detail?: Record<string, unknown>;
};

type Listener = (event: AuditEvent) => void;
const listeners = new Set<Listener>();

export function onAuditEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Never throws: audit failures must not take the request path down. */
export function recordAuditEvent(event: Omit<AuditEvent, "ts"> & { ts?: string }): AuditEvent {
  const full: AuditEvent = { ts: event.ts ?? new Date().toISOString(), ...event };
  for (const listener of listeners) {
    try {
      listener(full);
    } catch {
      // ignore listener failures
    }
  }
  void auditSafe({
    action: full.action,
    outcome: full.outcome === "allowed" ? "ok" : full.outcome,
    identity: full.identity ?? null,
    device: full.device ?? null,
    scope: full.scope ?? null,
    source: full.source,
    detail: full.detail,
  });
  return full;
}
