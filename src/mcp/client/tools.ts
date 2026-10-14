// MCP tools as agent tools (KoLo 2.0, M6). Each exposed server tool becomes an AgentTool with
// the server's JSON schema as parameters; every call is audited (`mcp.tool_call`) with the
// server, tool, outcome and duration. Names on the wire are `mcp_<server>_<tool>`; the id
// `mcp:<server>:<tool>` rides in metadata (policy globs, Code Mode namespace, audit).
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AnyAgentTool } from "../../agents/tools/common.js";
import { recordAuditEvent } from "../../security/audit-log.js";
import { getMcpManager, type McpClientManager, type McpExposedTool } from "./manager.js";
import { mcpToolId, mcpToolWireName, setMcpToolMeta } from "./meta.js";

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | {
      type: "resource";
      resource?: { uri?: string; text?: string; mimeType?: string; blob?: string };
    }
  | { type: string; [k: string]: unknown };

function toAgentContent(blocks: unknown[]): AgentToolResult<unknown>["content"] {
  const out: AgentToolResult<unknown>["content"] = [];
  for (const raw of blocks) {
    const block = raw as ContentBlock;
    if (!block || typeof block !== "object") {
      continue;
    }
    if (block.type === "text" && typeof (block as { text?: unknown }).text === "string") {
      out.push({ type: "text", text: (block as { text: string }).text });
    } else if (block.type === "image" && typeof (block as { data?: unknown }).data === "string") {
      const img = block as { data: string; mimeType?: string };
      out.push({ type: "image", data: img.data, mimeType: img.mimeType ?? "image/png" });
    } else if (block.type === "resource") {
      const res = (block as { resource?: { uri?: string; text?: string; mimeType?: string } })
        .resource;
      const text = typeof res?.text === "string" ? res.text : `[resource ${res?.uri ?? ""}]`;
      out.push({ type: "text", text });
    } else {
      out.push({ type: "text", text: JSON.stringify(block) });
    }
  }
  return out;
}

/** Keeps the server's schema shape; guarantees a top-level object for the providers. */
function parametersOf(schema: Record<string, unknown>): Record<string, unknown> {
  const s = schema && typeof schema === "object" ? { ...schema } : {};
  if (s.type !== "object") {
    s.type = "object";
  }
  if (!s.properties || typeof s.properties !== "object") {
    s.properties = {};
  }
  return s;
}

export function createMcpAgentTool(
  info: McpExposedTool,
  ctx: { manager: McpClientManager; agentId?: string; sessionKey?: string },
): AnyAgentTool {
  const id = mcpToolId(info.server, info.name);
  const tool: AnyAgentTool = {
    name: mcpToolWireName(info.server, info.name),
    label: `MCP ${info.server}: ${info.name}`,
    description: `[MCP server "${info.server}"] ${info.description?.trim() || info.name}`,
    parameters: parametersOf(info.inputSchema) as AnyAgentTool["parameters"],
    execute: async (_toolCallId, args, signal) => {
      const t0 = Date.now();
      const params =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const audit = (outcome: "allowed" | "error", detail: Record<string, unknown>) =>
        recordAuditEvent({
          action: "mcp.tool_call",
          outcome,
          identity: ctx.agentId,
          scope: ctx.sessionKey,
          source: "mcp-client",
          detail: { server: info.server, tool: info.name, id, ms: Date.now() - t0, ...detail },
        });
      let result: Awaited<ReturnType<McpClientManager["callTool"]>>;
      try {
        result = await ctx.manager.callTool(info.server, info.name, params, signal);
      } catch (err) {
        audit("error", { error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
        throw err;
      }
      const content = toAgentContent(result.content);
      if (result.isError) {
        const text = content
          .map((c) => (c.type === "text" ? c.text : ""))
          .filter(Boolean)
          .join("\n");
        audit("error", { error: text.slice(0, 500) || "tool reported an error" });
        throw new Error(text || `mcp tool ${id} reported an error`);
      }
      audit("allowed", { blocks: content.length });
      return {
        content: content.length > 0 ? content : [{ type: "text", text: "" }],
        details: result.structuredContent ?? { content: result.content },
      };
    },
  };
  setMcpToolMeta(tool, { id, server: info.server, tool: info.name, execLike: info.execLike });
  return tool;
}

/** Agent tools for every exposed MCP tool of every ready server (synchronous snapshot). */
export function createMcpTools(ctx: {
  agentId?: string;
  sessionKey?: string;
  manager?: McpClientManager;
}): AnyAgentTool[] {
  const manager = ctx.manager ?? getMcpManager();
  const taken = new Set<string>();
  const out: AnyAgentTool[] = [];
  for (const info of manager.exposedTools()) {
    const tool = createMcpAgentTool(info, {
      manager,
      agentId: ctx.agentId,
      sessionKey: ctx.sessionKey,
    });
    if (taken.has(tool.name)) {
      continue;
    }
    taken.add(tool.name);
    out.push(tool);
  }
  return out;
}
