// Metadata an MCP-backed agent tool carries (KoLo 2.0, M6). The model-facing name is wire-safe
// (`mcp_<server>_<tool>`: providers only accept [A-Za-z0-9_-]); the registry id stays
// `mcp:<server>:<tool>` for policy globs, audit rows and the Code Mode namespace.
import type { AnyAgentTool } from "../../agents/tools/common.js";

export type McpToolMeta = {
  /** `mcp:<server>:<tool>` */
  id: string;
  server: string;
  /** Tool name as the server declares it. */
  tool: string;
  /** True when the tool name looks like it executes or mutates (needs an explicit allow). */
  execLike: boolean;
};

const META = new WeakMap<object, McpToolMeta>();

export function mcpToolId(server: string, tool: string): string {
  return `mcp:${server}:${tool}`;
}

export function mcpToolWireName(server: string, tool: string): string {
  return `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

export function setMcpToolMeta(tool: AnyAgentTool, meta: McpToolMeta): void {
  META.set(tool, meta);
}

export function getMcpToolMeta(tool: AnyAgentTool | undefined): McpToolMeta | undefined {
  return tool ? META.get(tool) : undefined;
}
