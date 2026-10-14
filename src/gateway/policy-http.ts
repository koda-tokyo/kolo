// HTTP handlers for the policy routes (KoLo 2.0, M13c), declared in http-routes.ts:
// getPolicyStatus (observe), killPolicy and releasePolicy (admin; the policy's `kill.mayFlip`
// can narrow that to owner). Auth is enforced by the router before these run; the principal a
// pair credential carries is read back here only to apply `mayFlip`.
import type { IncomingMessage } from "node:http";
import type { RouteHandler } from "./http-registry.js";
import { getPolicyEngine, type PolicyEngine } from "../policy/engine.js";
import { readJsonBodyOrError, sendJson } from "./http-common.js";
import { getHttpPrincipal } from "./pair-auth.js";

const MAX_BODY_BYTES = 16 * 1024;
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** Scope of the caller: a pair credential's scope, else the owner token / admin session. */
export function callerScope(req: IncomingMessage): "owner" | "admin" | "attach" | "observe" {
  return getHttpPrincipal(req)?.scope ?? "owner";
}

function callerIdentity(req: IncomingMessage): string {
  const principal = getHttpPrincipal(req);
  if (principal?.kind === "pair") {
    return `device:${principal.deviceName}#${principal.fingerprint.slice(0, 12)}`;
  }
  return "owner";
}

export type KillBody = { agent?: string; all?: boolean; reason?: string };

export function parseKillBody(
  raw: unknown,
): { ok: true; body: KillBody } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, body: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  const body: KillBody = {};
  if (obj.agent !== undefined) {
    if (typeof obj.agent !== "string" || !AGENT_ID_RE.test(obj.agent.trim())) {
      return { ok: false, error: "agent must be an agent id" };
    }
    body.agent = obj.agent.trim().toLowerCase();
  }
  if (obj.all !== undefined) {
    if (typeof obj.all !== "boolean") {
      return { ok: false, error: "all must be a boolean" };
    }
    body.all = obj.all;
  }
  if (obj.reason !== undefined) {
    if (typeof obj.reason !== "string" || obj.reason.length > 500) {
      return { ok: false, error: "reason must be a string of at most 500 characters" };
    }
    body.reason = obj.reason;
  }
  if (!body.agent && !body.all) {
    return { ok: false, error: "pass agent or all: true" };
  }
  return { ok: true, body };
}

export function createPolicyHttpHandlers(deps: { engine?: () => PolicyEngine } = {}) {
  const engine = () => deps.engine?.() ?? getPolicyEngine();

  const getPolicyStatus: RouteHandler = (_req, res) => {
    sendJson(res, 200, { ok: true, status: engine().status() });
  };

  const flip = async (
    req: IncomingMessage,
    res: Parameters<RouteHandler>[1],
    action: "kill" | "release",
  ) => {
    const scope = callerScope(req);
    if (!engine().mayFlip(scope)) {
      sendJson(res, 403, {
        ok: false,
        error: `policy kill switch may not be flipped by scope ${scope} (kill.mayFlip)`,
      });
      return;
    }
    const raw = await readJsonBodyOrError(req, res, MAX_BODY_BYTES);
    if (raw === undefined) {
      return;
    }
    const parsed = parseKillBody(raw);
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, error: parsed.error });
      return;
    }
    const agent = parsed.body.all ? null : (parsed.body.agent ?? null);
    const by = callerIdentity(req);
    if (action === "kill") {
      const result = engine().kill({ agent, by, reason: parsed.body.reason });
      sendJson(res, 200, {
        ok: true,
        agent,
        jobsAborted: result.jobsAborted,
        status: engine().status(),
      });
      return;
    }
    const result = engine().release({ agent, by });
    sendJson(res, 200, { ok: true, agent, released: result.released, status: engine().status() });
  };

  const killPolicy: RouteHandler = (req, res) => flip(req, res, "kill");
  const releasePolicy: RouteHandler = (req, res) => flip(req, res, "release");

  return { getPolicyStatus, killPolicy, releasePolicy };
}
