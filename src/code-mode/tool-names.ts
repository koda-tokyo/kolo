// Tool ids and sandbox paths (KoLo 2.0, M6).
//
// A tool's *id* is its registry name (`read_file`, `web_fetch`) or, for an MCP tool, the
// `mcp:<server>:<tool>` id carried in its metadata. The *path* is where the script finds it:
// `tools.read_file(...)`, `tools.mcp.<server>.<tool>(...)`; the id is also reachable as
// `tools["mcp:<server>:<tool>"]`. Identifier-unsafe characters become `_`.
import type { AnyAgentTool } from "../agents/tools/common.js";
import { getMcpToolMeta } from "../mcp/client/meta.js";

export type SandboxToolSpec = {
  id: string;
  path: string[];
  tool: AnyAgentTool;
};

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "hasOwnProperty",
  "toString",
  "valueOf",
]);

export function identifierOf(segment: string): string {
  let out = segment.replace(/[^A-Za-z0-9_$]/g, "_");
  if (!IDENT.test(out)) {
    out = `_${out}`;
  }
  if (RESERVED.has(out)) {
    out = `${out}_`;
  }
  return out;
}

/** Canonical id of a tool: MCP tools keep their `mcp:<server>:<tool>` id, others their name. */
export function toolIdOf(tool: AnyAgentTool): string {
  const meta = getMcpToolMeta(tool);
  return meta ? meta.id : tool.name;
}

export function toolPathOf(tool: AnyAgentTool): string[] {
  const meta = getMcpToolMeta(tool);
  if (meta) {
    return ["mcp", identifierOf(meta.server), identifierOf(meta.tool)];
  }
  return [identifierOf(tool.name)];
}

/** Glob with `*` (any run of characters) over tool ids; case-insensitive. */
export function toolGlobMatches(pattern: string, id: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) {
    return false;
  }
  if (p === "*") {
    return true;
  }
  const re = new RegExp(
    `^${p
      .split("*")
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
  return re.test(id.toLowerCase());
}

export function toolAllowed(allow: readonly string[] | undefined, id: string): boolean {
  if (!allow) {
    return true;
  }
  return allow.some((pattern) => toolGlobMatches(pattern, id));
}

/**
 * Tools a script may call: the registry list minus anything outside `allow`, with unique
 * sandbox paths (a later duplicate path gets a numeric suffix so no tool is shadowed).
 */
export function listSandboxTools(
  tools: readonly AnyAgentTool[],
  allow?: readonly string[],
): SandboxToolSpec[] {
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const out: SandboxToolSpec[] = [];
  for (const tool of tools) {
    if (typeof tool?.name !== "string" || typeof tool.execute !== "function") {
      continue;
    }
    const id = toolIdOf(tool);
    if (seenIds.has(id) || !toolAllowed(allow, id)) {
      continue;
    }
    seenIds.add(id);
    let path = toolPathOf(tool);
    let key = path.join(".");
    for (let n = 2; seenPaths.has(key); n++) {
      path = [...path.slice(0, -1), `${path[path.length - 1]}_${n}`];
      key = path.join(".");
    }
    seenPaths.add(key);
    out.push({ id, path, tool });
  }
  return out;
}
