// Typed signatures, tool ids/paths and TypeScript preparation (KoLo 2.0, M6).
import { describe, expect, it } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { setMcpToolMeta } from "../mcp/client/meta.js";
import { buildToolsDts, schemaToType } from "./dts.js";
import { identifierOf, listSandboxTools, toolGlobMatches } from "./tool-names.js";
import { prepareScript, wrapScript } from "./transpile.js";

const tool = (name: string, parameters: unknown, description = name): AnyAgentTool => ({
  name,
  label: name,
  description,
  parameters: parameters as AnyAgentTool["parameters"],
  execute: async () => ({ content: [], details: null }),
});

describe("schemaToType", () => {
  it("maps the TypeBox subset tools use", () => {
    expect(schemaToType({ type: "string" })).toBe("string");
    expect(schemaToType({ type: "integer" })).toBe("number");
    expect(schemaToType({ type: "string", enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(schemaToType({ const: 3 })).toBe("3");
    expect(schemaToType({ type: "array", items: { type: "number" } })).toBe("number[]");
    expect(schemaToType({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("string | null");
    expect(schemaToType({ type: "object", additionalProperties: { type: "boolean" } })).toBe(
      "Record<string, boolean>",
    );
    expect(
      schemaToType({
        type: "object",
        properties: { path: { type: "string", description: "File path" }, n: { type: "number" } },
        required: ["path"],
      }),
    ).toBe("{\n  /** File path */\n  path: string;\n  n?: number;\n}");
    expect(schemaToType({ type: "object", properties: { "a-b": { type: "string" } } })).toContain(
      '"a-b"?: string;',
    );
  });
});

describe("buildToolsDts", () => {
  it("declares each tool, nests MCP tools, documents console and sleep", () => {
    const mcp = tool("mcp_docs_search", { type: "object", properties: { q: { type: "string" } } });
    setMcpToolMeta(mcp, { id: "mcp:docs:search", server: "docs", tool: "search", execLike: false });
    const dts = buildToolsDts([
      tool(
        "read_file",
        { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        "Read a file",
      ),
      mcp,
    ]);
    expect(dts).toContain("declare namespace tools {");
    expect(dts).toContain(
      "function read_file(args: {\n    path: string;\n  }): Promise<ToolResult>;",
    );
    expect(dts).toContain(" * Read a file");
    expect(dts).toContain("namespace mcp {");
    expect(dts).toContain("namespace docs {");
    expect(dts).toContain("function search(args:");
    expect(dts).toContain("declare function sleep(ms: number): Promise<void>;");
    expect(dts).toContain("declare const console");
  });

  it("respects the allowlist and caps descriptions", () => {
    const dts = buildToolsDts(
      [tool("a", { type: "object" }, "x".repeat(1000)), tool("b", { type: "object" })],
      { allowTools: ["a"], maxDescriptionChars: 10 },
    );
    expect(dts).toContain("function a(");
    expect(dts).not.toContain("function b(");
    expect(dts).toContain("xxxxxxxxxx…");
  });
});

describe("tool names", () => {
  it("sanitises identifiers and keeps ids", () => {
    expect(identifierOf("web-fetch")).toBe("web_fetch");
    expect(identifierOf("1st")).toBe("_1st");
    expect(identifierOf("constructor")).toBe("constructor_");
    const mcp = tool("mcp_a_b", { type: "object" });
    setMcpToolMeta(mcp, { id: "mcp:a-1:b.c", server: "a-1", tool: "b.c", execLike: false });
    const specs = listSandboxTools([tool("x", {}), mcp]);
    expect(specs.map((s) => [s.id, s.path])).toEqual([
      ["x", ["x"]],
      ["mcp:a-1:b.c", ["mcp", "a_1", "b_c"]],
    ]);
  });

  it("globs over ids case-insensitively", () => {
    expect(toolGlobMatches("mcp:docs:*", "mcp:docs:search")).toBe(true);
    expect(toolGlobMatches("MCP:*", "mcp:x:y")).toBe(true);
    expect(toolGlobMatches("read_*", "write_file")).toBe(false);
    expect(toolGlobMatches("", "x")).toBe(false);
  });

  it("de-duplicates ids and suffixes colliding paths", () => {
    const specs = listSandboxTools([tool("a-b", {}), tool("a_b", {}), tool("a-b", {})]);
    expect(specs.map((s) => s.path.join("."))).toEqual(["a_b", "a_b_2"]);
  });
});

describe("prepareScript", () => {
  it("wraps JavaScript untouched", () => {
    const r = prepareScript("return 1;", "js");
    expect(r).toEqual({ ok: true, code: wrapScript("return 1;"), stripped: false });
  });

  it("strips TypeScript on request and by detection", () => {
    const forced = prepareScript("const a: number = 1; return a;", "ts");
    expect(forced.ok && forced.stripped).toBe(true);
    expect(forced.ok && forced.code).not.toContain(": number");
    const detected = prepareScript("interface A { x: number }\nreturn 1 as number;");
    expect(detected.ok && detected.stripped).toBe(true);
    const plain = prepareScript("const a = 1; return a;");
    expect(plain.ok && plain.stripped).toBe(false);
  });

  it("reports a TypeScript syntax error instead of running it", () => {
    const r = prepareScript("const a: = 1;", "ts");
    expect(r.ok).toBe(false);
  });
});
