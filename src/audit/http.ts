// One-line audit hook for HTTP auth refusals (401/403) (KoLo 2.0, M2b).
import type { IncomingMessage } from "node:http";
import { auditSafe } from "./audit-log.js";

export function auditHttpAuthFailure(
  req: IncomingMessage | undefined | null,
  status: 401 | 403,
  reason: string,
): void {
  let pathname: string | null = null;
  try {
    pathname = req?.url ? new URL(req.url, "http://localhost").pathname : null;
  } catch {
    pathname = null;
  }
  void auditSafe({
    action: "http.auth",
    outcome: "denied",
    source: "gateway.http",
    detail: {
      status,
      reason,
      method: req?.method ?? null,
      path: pathname, // path only: query strings can carry tokens
      ip: req?.socket?.remoteAddress ?? null,
      userAgent:
        typeof req?.headers?.["user-agent"] === "string"
          ? req.headers["user-agent"].slice(0, 200)
          : null,
    },
  });
}
