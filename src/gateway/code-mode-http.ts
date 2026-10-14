// Code Mode over the gateway (KoLo 2.0, M6): one entry (`runCodeModeRequest`) shared by
// POST /api/code-mode/run and WS codeMode.run. The router/dispatcher has authenticated the
// caller (min scope: attach) and, for a paired device, checked the session allowlist; here the
// session's tool list is resolved through the same policy stack as /tools/invoke, the M2
// capability gate is applied per call, and the run is audited under its run id.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./http-registry.js";
import type { CodeModeRunParams, CodeModeRunResult } from "./protocol/index.js";
import {
  CODE_MODE_LIMIT_CEILINGS,
  runCodeModeScript,
  type CodeModeLimits,
} from "../code-mode/runner.js";
import { CODE_MODE_TOOL_NAME } from "../code-mode/tool.js";
import { loadConfig } from "../config/config.js";
import { getMcpManager } from "../mcp/client/manager.js";
import { readJsonBodyOrError, sendJson } from "./http-common.js";
import {
  checkInvocableCapability,
  resolveInvocableSessionKey,
  resolveInvocableTools,
} from "./invocable-tools.js";
import { getHttpPrincipal, principalIdentity } from "./pair-auth.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;

export type CodeModeRequestContext = {
  /** "http:/api/code-mode/run" | "ws:codeMode.run" */
  source: string;
  /** Credential identity (owner:…, device:…) for the audit row. */
  principal?: string;
  signal?: AbortSignal;
};

export type CodeModeRequestOutcome =
  | { ok: true; result: CodeModeRunResult }
  | {
      ok: false;
      status: 400 | 403;
      type: "invalid_request" | "permission_denied";
      message: string;
    };

function validateParams(
  raw: unknown,
): { ok: true; params: CodeModeRunParams } | { ok: false; message: string } {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.script !== "string" || !p.script.trim()) {
    return { ok: false, message: "script (string) is required" };
  }
  if (p.language !== undefined && p.language !== "js" && p.language !== "ts") {
    return { ok: false, message: 'language must be "js" or "ts"' };
  }
  if (p.sessionKey !== undefined && typeof p.sessionKey !== "string") {
    return { ok: false, message: "sessionKey must be a string" };
  }
  if (
    p.allowTools !== undefined &&
    (!Array.isArray(p.allowTools) ||
      p.allowTools.length > 256 ||
      p.allowTools.some((x) => typeof x !== "string" || !x.trim()))
  ) {
    return { ok: false, message: "allowTools must be an array of up to 256 globs" };
  }
  for (const [key, max] of [
    ["timeoutMs", CODE_MODE_LIMIT_CEILINGS.wallClockMs],
    ["maxToolCalls", CODE_MODE_LIMIT_CEILINGS.maxToolCalls],
  ] as const) {
    const v = p[key];
    if (v !== undefined && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max)) {
      return { ok: false, message: `${key} must be an integer between 1 and ${max}` };
    }
  }
  return { ok: true, params: p as CodeModeRunParams };
}

export async function runCodeModeRequest(
  raw: unknown,
  ctx: CodeModeRequestContext,
): Promise<CodeModeRequestOutcome> {
  const validated = validateParams(raw);
  if (!validated.ok) {
    return { ok: false, status: 400, type: "invalid_request", message: validated.message };
  }
  const params = validated.params;
  const cfg = loadConfig();
  const sessionKey = resolveInvocableSessionKey(cfg, params.sessionKey);
  const resolved = resolveInvocableTools({ cfg, sessionKey });
  // The gate that /tools/invoke applies per tool, applied once for the run itself …
  const runGate = checkInvocableCapability(resolved, CODE_MODE_TOOL_NAME, ctx.source);
  if (!runGate.ok) {
    return { ok: false, status: 403, type: "permission_denied", message: runGate.reason };
  }
  const limits: Partial<CodeModeLimits> = {
    ...(params.timeoutMs ? { wallClockMs: params.timeoutMs } : {}),
    ...(params.maxToolCalls ? { maxToolCalls: params.maxToolCalls } : {}),
  };
  const result = await runCodeModeScript({
    script: params.script,
    language: params.language,
    tools: resolved.tools.filter((t) => t.name !== CODE_MODE_TOOL_NAME),
    allowTools: params.allowTools,
    limits,
    audit: {
      agentId: resolved.agentId,
      sessionKey,
      source: ctx.source,
      principal: ctx.principal,
    },
    // … and again before every call the script makes (capability can be `none` for the agent).
    beforeToolCall: (tool) => {
      const gate = checkInvocableCapability(resolved, tool.name, ctx.source);
      if (!gate.ok) {
        throw new Error(gate.reason);
      }
    },
    signal: ctx.signal,
  });
  return { ok: true, result };
}

export function createCodeModeHttpHandlers(opts: { maxBodyBytes?: number } = {}) {
  return {
    runCodeMode: async (req: IncomingMessage, res: ServerResponse, _ctx: RouteContext) => {
      const body = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
      if (body === undefined) {
        return true;
      }
      const principal = getHttpPrincipal(req);
      const outcome = await runCodeModeRequest(body, {
        source: "http:/api/code-mode/run",
        principal: principal ? principalIdentity(principal) : undefined,
      });
      res.setHeader("Cache-Control", "no-store");
      if (!outcome.ok) {
        sendJson(res, outcome.status, {
          ok: false,
          error: { type: outcome.type, message: outcome.message },
        });
        return true;
      }
      sendJson(res, 200, outcome.result);
      return true;
    },

    listMcpServers: (_req: IncomingMessage, res: ServerResponse, _ctx: RouteContext) => {
      res.setHeader("Cache-Control", "no-store");
      sendJson(res, 200, { ok: true, servers: getMcpManager().servers() });
      return true;
    },
  };
}
