// Typed signatures for the sandbox (KoLo 2.0, M6): the tool registry's JSON schemas rendered
// as a `.d.ts` the model reads in the tool description, so it writes `await tools.x({...})`
// with the right argument shapes. Pure function of the tool list; no I/O.
import type { AnyAgentTool } from "../agents/tools/common.js";
import { listSandboxTools, type SandboxToolSpec } from "./tool-names.js";

type Schema = Record<string, unknown>;

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function key(name: string): string {
  return IDENT.test(name) ? name : JSON.stringify(name);
}

function indent(text: string, depth: number): string {
  const pad = "  ".repeat(depth);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function literal(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "unknown";
}

/** JSON Schema (the subset TypeBox tools use) → TypeScript type text. */
export function schemaToType(schema: unknown, depth = 0): string {
  if (depth > 8 || !schema || typeof schema !== "object") {
    return "unknown";
  }
  const s = schema as Schema;
  if (Array.isArray(s.enum)) {
    return s.enum.map(literal).join(" | ") || "never";
  }
  if ("const" in s) {
    return literal(s.const);
  }
  for (const combinator of ["anyOf", "oneOf"] as const) {
    const parts = s[combinator];
    if (Array.isArray(parts) && parts.length > 0) {
      return parts.map((p) => schemaToType(p, depth + 1)).join(" | ");
    }
  }
  if (Array.isArray(s.allOf) && s.allOf.length > 0) {
    return s.allOf.map((p) => schemaToType(p, depth + 1)).join(" & ");
  }
  const type = Array.isArray(s.type) ? s.type : typeof s.type === "string" ? [s.type] : [];
  if (type.length > 1) {
    return type.map((t) => schemaToType({ ...s, type: t }, depth + 1)).join(" | ");
  }
  switch (type[0]) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const items = s.items;
      if (Array.isArray(items)) {
        return `[${items.map((i) => schemaToType(i, depth + 1)).join(", ")}]`;
      }
      const inner = schemaToType(items, depth + 1);
      return /[|&]/.test(inner) ? `Array<${inner}>` : `${inner}[]`;
    }
    case "object":
    case undefined: {
      const props = s.properties as Record<string, unknown> | undefined;
      if (!props || Object.keys(props).length === 0) {
        if (s.additionalProperties && typeof s.additionalProperties === "object") {
          return `Record<string, ${schemaToType(s.additionalProperties, depth + 1)}>`;
        }
        return type[0] === "object" ? "Record<string, unknown>" : "unknown";
      }
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const lines = Object.entries(props).map(([name, sub]) => {
        const desc = (sub as Schema)?.description;
        const doc = typeof desc === "string" && desc.trim() ? `/** ${oneLine(desc)} */\n` : "";
        const opt = required.has(name) ? "" : "?";
        return `${doc}${key(name)}${opt}: ${schemaToType(sub, depth + 1)};`;
      });
      return `{\n${indent(lines.join("\n"), 1)}\n}`;
    }
    default:
      return "unknown";
  }
}

function oneLine(text: string): string {
  return text.replace(/\*\//g, "* /").replace(/\s+/g, " ").trim();
}

function docBlock(text: string | undefined, maxChars: number): string {
  if (!text?.trim()) {
    return "";
  }
  const clean = text.replace(/\*\//g, "* /").trim();
  const body = clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
  const lines = body.split(/\r?\n/).map((l) => ` * ${l}`.trimEnd());
  return `/**\n${lines.join("\n")}\n */\n`;
}

type Node = { children: Map<string, Node>; spec?: SandboxToolSpec };

function renderNode(node: Node, depth: number, maxDescChars: number): string {
  const out: string[] = [];
  for (const [name, child] of node.children) {
    if (child.spec) {
      const tool = child.spec.tool;
      const argType = schemaToType(tool.parameters, 0);
      const doc = docBlock(tool.description, maxDescChars);
      out.push(
        `${doc}function ${name}(args: ${argType}): Promise<ToolResult>;`.replace(
          /^function/m,
          "function",
        ),
      );
    } else {
      out.push(`namespace ${name} {\n${indent(renderNode(child, depth + 1, maxDescChars), 1)}\n}`);
    }
  }
  return out.join("\n");
}

export type BuildToolsDtsOptions = {
  allowTools?: readonly string[];
  /** Characters of a tool description kept in its JSDoc. Default 400. */
  maxDescriptionChars?: number;
};

/** `.d.ts` describing `tools`, `console`, `sleep` and `ToolResult` for the sandbox. */
export function buildToolsDts(
  tools: readonly AnyAgentTool[],
  opts: BuildToolsDtsOptions = {},
): string {
  const specs = listSandboxTools(tools, opts.allowTools);
  const root: Node = { children: new Map() };
  for (const spec of specs) {
    let node = root;
    for (const seg of spec.path.slice(0, -1)) {
      let next = node.children.get(seg);
      if (!next) {
        next = { children: new Map() };
        node.children.set(seg, next);
      }
      node = next;
    }
    node.children.set(spec.path[spec.path.length - 1], { children: new Map(), spec });
  }
  const maxDesc = opts.maxDescriptionChars ?? 400;
  const body = renderNode(root, 0, maxDesc);
  return [
    "/** What every tool call resolves to. `details` is the tool's structured payload when it has one. */",
    "type ToolResult = { text: string; details?: unknown; images?: number };",
    "",
    "declare namespace tools {",
    body ? indent(body, 1) : "  // no tools available in this run",
    "}",
    "/** console.log/info/warn/error/debug are captured and returned with the run. */",
    "declare const console: { log(...a: unknown[]): void; info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void; debug(...a: unknown[]): void };",
    "/** Pause up to 30 000 ms (counts against the wall clock). */",
    "declare function sleep(ms: number): Promise<void>;",
    "",
  ].join("\n");
}
