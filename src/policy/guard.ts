// Tool-dispatch guard (KoLo 2.0, M13b): the single wrapper that puts every agent tool call
// (core tools, MCP tools, and scripts in Code Mode, which runs over the same wrapped list)
// through the policy engine. Replaces the M5 permission wrapper; the M5 rule set is passed in
// as one input so `policy > agents.list[].permissions > defaults` holds in one place.
//
// `ask` decisions reuse the exec approval path: the gateway broadcasts
// `exec.approval.requested` (channels forward it to humans), and the call runs only after an
// `allow-once`/`allow-always` decision arrives before the policy's timeout.
import { randomUUID } from "node:crypto";
import type { AnyAgentTool } from "../agents/pi-tools.types.js";
import { ToolPermissionDeniedError, type ToolPermissionSet } from "../agents/permissions.js";
import { callGatewayTool } from "../agents/tools/gateway.js";
import { getMcpToolMeta } from "../mcp/client/meta.js";
import { getPolicyEngine, type PolicyEngine } from "./engine.js";

const DEFAULT_ASK_TIMEOUT_MS = 120_000;

export class PolicyDeniedError extends ToolPermissionDeniedError {
  constructor(
    message: string,
    tools: string[],
    public readonly ruleId: string,
    public readonly effect: "deny" | "pause" | "ask",
  ) {
    super(message, tools);
    this.name = "PolicyDeniedError";
  }
}

export type PolicyGuardContext = {
  agentId: string;
  workspaceDir: string;
  sessionKey?: string;
  legacyPermissions?: ToolPermissionSet;
  engine?: PolicyEngine;
  /** Injected for tests; defaults to the gateway approval request. */
  askHuman?: (params: AskParams) => Promise<"allow" | "deny">;
};

export type AskParams = {
  agentId: string;
  sessionKey?: string;
  tool: string;
  args: Record<string, unknown>;
  ruleId: string;
  timeoutMs: number;
  channel?: string;
};

async function askViaGateway(params: AskParams): Promise<"allow" | "deny"> {
  const approvalId = randomUUID();
  try {
    const result = await callGatewayTool<{ decision?: string }>(
      "exec.approval.request",
      { timeoutMs: params.timeoutMs + 5_000 },
      {
        id: approvalId,
        command: `${params.tool} ${JSON.stringify(params.args).slice(0, 400)}`,
        host: "gateway",
        security: "policy",
        ask: `policy:${params.ruleId}${params.channel ? ` via ${params.channel}` : ""}`,
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        timeoutMs: params.timeoutMs,
      },
    );
    const decision = typeof result?.decision === "string" ? result.decision : "";
    return decision === "allow-once" || decision === "allow-always" ? "allow" : "deny";
  } catch {
    return "deny";
  }
}

/** Wrap one tool. The engine is consulted on every call; inert when no policy is loaded. */
export function wrapToolWithPolicyGuard(tool: AnyAgentTool, ctx: PolicyGuardContext): AnyAgentTool {
  const execute = tool.execute;
  if (typeof execute !== "function") {
    return tool;
  }
  const engine = ctx.engine ?? getPolicyEngine();
  const mcpServer = getMcpToolMeta(tool)?.server;
  return {
    ...tool,
    execute: async (...args: Parameters<typeof execute>) => {
      const toolArgs = (args[1] ?? {}) as Record<string, unknown>;
      const decision = engine.evaluate("tool", {
        agentId: ctx.agentId,
        tool: tool.name,
        args: toolArgs,
        sessionKey: ctx.sessionKey,
        mcpServer,
        workspaceDir: ctx.workspaceDir,
        legacyPermissions: ctx.legacyPermissions,
      });
      if (decision.effect === "allow") {
        return execute(...args);
      }
      if (decision.effect === "ask") {
        const approvals = engine.document?.approvals;
        const verdict = await (ctx.askHuman ?? askViaGateway)({
          agentId: ctx.agentId,
          sessionKey: ctx.sessionKey,
          tool: tool.name,
          args: toolArgs,
          ruleId: decision.ruleId,
          timeoutMs: approvals?.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS,
          channel: approvals?.channel,
        });
        if (verdict === "allow") {
          return execute(...args);
        }
        throw new PolicyDeniedError(
          `Policy: ${tool.name} needs a human approval (rule ${decision.ruleId}) and none was given.`,
          [tool.name],
          decision.ruleId,
          "ask",
        );
      }
      const label = decision.effect === "pause" ? "paused" : "denied";
      throw new PolicyDeniedError(
        `Policy ${label}: ${decision.reason} (rule ${decision.ruleId}). An owner can change the policy with \`kolo policy\`.`,
        [tool.name],
        decision.ruleId,
        decision.effect,
      );
    },
  } as AnyAgentTool;
}
