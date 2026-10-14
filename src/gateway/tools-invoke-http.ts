import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedGatewayAuth } from "./auth.js";
import { loadConfig } from "../config/config.js";
import { isTestDefaultMemorySlotDisabled } from "../plugins/config-state.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { guardToolCall, logGuardDecision } from "./guard/index.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendForbidden,
  sendUnauthorized,
} from "./http-common.js";
import { getHeader } from "./http-utils.js";
import {
  checkInvocableCapability,
  resolveInvocableSessionKey,
  resolveInvocableTools,
} from "./invocable-tools.js";
import { authorizeHttpBearer } from "./pair-auth.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;
const MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_get"]);

type ToolsInvokeBody = {
  tool?: unknown;
  action?: unknown;
  args?: unknown;
  sessionKey?: unknown;
  dryRun?: unknown;
};

function resolveSessionKeyFromBody(body: ToolsInvokeBody): string | undefined {
  if (typeof body.sessionKey === "string" && body.sessionKey.trim()) {
    return body.sessionKey.trim();
  }
  return undefined;
}

function resolveMemoryToolDisableReasons(cfg: ReturnType<typeof loadConfig>): string[] {
  if (!process.env.VITEST) {
    return [];
  }
  const reasons: string[] = [];
  const plugins = cfg.plugins;
  const slotRaw = plugins?.slots?.memory;
  const slotDisabled =
    slotRaw === null || (typeof slotRaw === "string" && slotRaw.trim().toLowerCase() === "none");
  const pluginsDisabled = plugins?.enabled === false;
  const defaultDisabled = isTestDefaultMemorySlotDisabled(cfg);

  if (pluginsDisabled) {
    reasons.push("plugins.enabled=false");
  }
  if (slotDisabled) {
    reasons.push(slotRaw === null ? "plugins.slots.memory=null" : 'plugins.slots.memory="none"');
  }
  if (!pluginsDisabled && !slotDisabled && defaultDisabled) {
    reasons.push("memory plugin disabled by test default");
  }
  return reasons;
}

function mergeActionIntoArgsIfSupported(params: {
  toolSchema: unknown;
  action: string | undefined;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const { toolSchema, action, args } = params;
  if (!action) {
    return args;
  }
  if (args.action !== undefined) {
    return args;
  }
  // TypeBox schemas are plain objects; many tools define an `action` property.
  const schemaObj = toolSchema as { properties?: Record<string, unknown> } | null;
  const hasAction = Boolean(
    schemaObj &&
    typeof schemaObj === "object" &&
    schemaObj.properties &&
    "action" in schemaObj.properties,
  );
  if (!hasAction) {
    return args;
  }
  return { ...args, action };
}

export async function handleToolsInvokeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { auth: ResolvedGatewayAuth; maxBodyBytes?: number; trustedProxies?: string[] },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/tools/invoke") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const authResult = await authorizeHttpBearer(req, {
    auth: opts.auth,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    minScope: "attach",
  });
  if (!authResult.ok) {
    if (authResult.status === 403) {
      sendForbidden(res);
    } else {
      sendUnauthorized(res);
    }
    return true;
  }

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) {
    return true;
  }
  const body = (bodyUnknown ?? {}) as ToolsInvokeBody;

  const toolName = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!toolName) {
    sendInvalidRequest(res, "tools.invoke requires body.tool");
    return true;
  }

  if (process.env.VITEST && MEMORY_TOOL_NAMES.has(toolName)) {
    const reasons = resolveMemoryToolDisableReasons(cfg);
    if (reasons.length > 0) {
      const suffix = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
      sendJson(res, 400, {
        ok: false,
        error: {
          type: "invalid_request",
          message:
            `memory tools are disabled in tests${suffix}. ` +
            'Enable by setting plugins.slots.memory="memory-core" (and ensure plugins.enabled is not false).',
        },
      });
      return true;
    }
  }

  const action = typeof body.action === "string" ? body.action.trim() : undefined;

  const argsRaw = body.args;
  const args =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};

  const sessionKey = resolveInvocableSessionKey(cfg, resolveSessionKeyFromBody(body));

  // Resolve message channel/account hints (optional headers) for policy inheritance.
  const messageChannel = normalizeMessageChannel(getHeader(req, "x-kolo-message-channel") ?? "");
  const accountId = getHeader(req, "x-kolo-account-id")?.trim() || undefined;

  // Same policy stack as the embedded runner (core + plugin + MCP tools), M6 shared module.
  const resolved = resolveInvocableTools({
    cfg,
    sessionKey,
    messageChannel: messageChannel ?? undefined,
    accountId,
  });
  const agentId = resolved.agentId;

  // Backend capability gate (M2a): an agent whose backend declares tools=none gets no tools here
  // either; the attempt is rejected and audited.
  const capabilityDecision = checkInvocableCapability(resolved, toolName, "http:/tools/invoke");
  if (!capabilityDecision.ok) {
    sendJson(res, 403, {
      ok: false,
      error: { type: "permission_denied", message: capabilityDecision.reason },
    });
    return true;
  }

  const tool = resolved.tools.find((t) => t.name === toolName);
  if (!tool) {
    sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    });
    return true;
  }

  try {
    const toolArgs = mergeActionIntoArgsIfSupported({
      // oxlint-disable-next-line typescript/no-explicit-any
      toolSchema: (tool as any).parameters,
      action,
      args,
    });

    // ── Guard: risk assessment + path validation before execution ──
    const command = typeof toolArgs.command === "string" ? toolArgs.command : undefined;
    const guardResult = await guardToolCall({
      toolName,
      args: toolArgs,
      command,
      workspaceRoots: [process.cwd()],
    });
    logGuardDecision({ toolName, result: guardResult, sessionKey, agentId });

    if (guardResult.blocked) {
      sendJson(res, 403, {
        ok: false,
        error: {
          type: "permission_denied",
          message: guardResult.explainer ?? `Access denied for ${toolName}`,
          details: { risk: guardResult.risk.tier, flags: guardResult.risk.flags },
        },
      });
      return true;
    }

    // oxlint-disable-next-line typescript/no-explicit-any
    const result = await (tool as any).execute?.(`http-${Date.now()}`, toolArgs);
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      error: { type: "tool_error", message: err instanceof Error ? err.message : String(err) },
    });
  }

  return true;
}
