// HTTP handlers for session discovery (KoLo 2.0, M3b). The router has already authenticated
// the request (minimum scope: attach) and resolved its principal; the session allowlist of a
// paired device is applied here so a restricted credential never sees a session it was not
// invited to (list: filtered; get: 404).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./http-registry.js";
import { loadConfig } from "../config/config.js";
import { sendJson } from "./http-common.js";
import { getHttpPrincipal } from "./pair-auth.js";
import { allowlistOf, discoverSessions, findSession } from "./session-discovery.js";

function intParam(raw: string | null, fallback: number | undefined, min: number, max: number) {
  if (raw === null || raw.trim() === "") {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return Number.NaN;
  }
  return Math.max(min, Math.min(max, n));
}

export function createSessionsHttpHandlers() {
  return {
    listSessions: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const q = ctx.url.searchParams;
      const limit = intParam(q.get("limit"), undefined, 1, 500);
      const activeMinutes = intParam(q.get("activeMinutes"), undefined, 1, 1_000_000);
      if (Number.isNaN(limit) || Number.isNaN(activeMinutes)) {
        sendJson(res, 400, { ok: false, error: "limit and activeMinutes must be integers" });
        return true;
      }
      const result = discoverSessions({
        cfg: loadConfig(),
        allowlist: allowlistOf(getHttpPrincipal(req)),
        agentId: q.get("agent") ?? undefined,
        search: q.get("search") ?? undefined,
        includeGlobal: q.get("includeGlobal") === "true",
        limit,
        activeMinutes,
      });
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, { ok: true, ...result });
      return true;
    },

    getSession: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const session = findSession({
        cfg: loadConfig(),
        allowlist: allowlistOf(getHttpPrincipal(req)),
        target: ctx.params.id ?? "",
      });
      res.setHeader("Cache-Control", "no-store");
      if (!session) {
        sendJson(res, 404, { ok: false, error: `No session found: ${ctx.params.id ?? ""}` });
        return true;
      }
      sendJson(res, 200, { ok: true, session });
      return true;
    },
  };
}
