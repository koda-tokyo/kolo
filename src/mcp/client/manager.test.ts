// MCP client (KoLo 2.0, M6): stdio and streamable-HTTP transports against fake servers, the
// exposure policy, per-call audit, env hygiene, and supervised restart with backoff.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { onAuditEvent, type AuditEvent } from "../../security/audit-log.js";
import { McpClientManager, probeMcpServer } from "./manager.js";
import { getMcpToolMeta } from "./meta.js";
import { isExecLikeToolName, mcpToolExposed } from "./policy.js";
import { createMcpTools } from "./tools.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/mcp/fake-mcp-server.mjs",
);
const BASE_ENV = { PATH: process.env.PATH ?? "", KOLO_SHOULD_NOT_LEAK: "1" };
const stdioConfig = (extra: Record<string, unknown> = {}) => ({
  transport: "stdio" as const,
  command: process.execPath,
  args: [FIXTURE],
  ...extra,
});

const audit: AuditEvent[] = [];
let stopAudit = () => {};
beforeAll(() => {
  stopAudit = onAuditEvent((e) => audit.push(e));
});
afterAll(() => stopAudit());

const managers: McpClientManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()));
});

async function startManager(servers: Record<string, unknown>) {
  const manager = new McpClientManager({
    backoffMs: { initial: 100, max: 400 },
    baseEnv: { PATH: process.env.PATH ?? "" },
  });
  managers.push(manager);
  await manager.apply({ servers } as Parameters<McpClientManager["apply"]>[0]);
  return manager;
}

describe("policy", () => {
  it("recognises exec-like names", () => {
    for (const n of ["run_command", "shellExec", "files.delete", "rm", "write_file", "deploy"]) {
      expect(isExecLikeToolName(n), n).toBe(true);
    }
    for (const n of ["read_file", "search", "list_dir", "get_weather", "echo"]) {
      expect(isExecLikeToolName(n), n).toBe(false);
    }
  });

  it("denies exec-like tools by default and needs a specific glob to allow them", () => {
    expect(mcpToolExposed({ server: "s", tool: "echo" })).toMatchObject({ exposed: true });
    expect(mcpToolExposed({ server: "s", tool: "run_command" })).toMatchObject({
      exposed: false,
      reason: "exec-like tool denied by default",
    });
    expect(mcpToolExposed({ server: "s", tool: "run_command", allowTools: ["*"] }).exposed).toBe(
      false,
    );
    expect(
      mcpToolExposed({ server: "s", tool: "run_command", allowTools: ["run_*"] }).exposed,
    ).toBe(true);
    expect(
      mcpToolExposed({ server: "s", tool: "run_command", allowTools: ["mcp:s:run_command"] })
        .exposed,
    ).toBe(true);
    expect(mcpToolExposed({ server: "s", tool: "echo", allowTools: ["add"] })).toMatchObject({
      exposed: false,
      reason: "not in allowTools",
    });
  });
});

describe("stdio transport", () => {
  it("connects, inventories tools/resources/prompts, applies policy, calls a tool, audits", async () => {
    audit.length = 0;
    const manager = await startManager({ fake: stdioConfig({ env: BASE_ENV }) });
    const [status] = manager.servers();
    expect(status.state).toBe("ready");
    expect(status.serverName).toBe("fake-mcp");
    expect(status.tools.map((t) => [t.name, t.exposed])).toEqual([
      ["echo", true],
      ["add", true],
      ["fail", true],
      ["run_command", false],
      ["env_keys", true],
      ["slow", true],
    ]);
    expect(status.resources).toEqual([
      { uri: "memo://hello", name: "hello", mimeType: "text/plain", description: "A greeting" },
    ]);
    expect(status.prompts).toEqual([
      { name: "greet", description: "Greeting prompt", arguments: ["name"] },
    ]);

    const tools = createMcpTools({ manager, agentId: "tester", sessionKey: "agent:tester:main" });
    expect(tools.map((t) => t.name)).toEqual([
      "mcp_fake_echo",
      "mcp_fake_add",
      "mcp_fake_fail",
      "mcp_fake_env_keys",
      "mcp_fake_slow",
    ]);
    expect(getMcpToolMeta(tools[1])).toEqual({
      id: "mcp:fake:add",
      server: "fake",
      tool: "add",
      execLike: false,
    });
    expect(tools[1].parameters).toMatchObject({
      type: "object",
      properties: { a: { type: "number" } },
    });

    const add = await tools[1].execute("c1", { a: 2, b: 5 });
    expect(add.content).toEqual([{ type: "text", text: "7" }]);
    expect(add.details).toEqual({ sum: 7 });
    const echo = await tools[0].execute("c2", { text: "hey" });
    expect(echo.details).toEqual({ content: [{ type: "text", text: "hey" }] });
    await expect(tools[2].execute("c3", { reason: "bad input" })).rejects.toThrow("bad input");

    const rows = audit.filter((e) => e.action === "mcp.tool_call");
    expect(rows.map((e) => [e.outcome, (e.detail as { tool: string }).tool])).toEqual([
      ["allowed", "add"],
      ["allowed", "echo"],
      ["error", "fail"],
    ]);
    expect(rows[0]).toMatchObject({
      identity: "tester",
      scope: "agent:tester:main",
      source: "mcp-client",
      detail: { server: "fake", id: "mcp:fake:add" },
    });
  });

  it("gives the child only the base env plus its own env, never the gateway's", async () => {
    const manager = new McpClientManager({ baseEnv: { PATH: process.env.PATH ?? "" } });
    managers.push(manager);
    process.env.KOLO_GATEWAY_TOKEN_TEST_LEAK = "secret";
    try {
      await manager.apply({ servers: { fake: stdioConfig({ env: { FAKE_EXTRA: "1" } }) } });
      const [tool] = createMcpTools({ manager }).filter((t) => t.name === "mcp_fake_env_keys");
      const res = await tool.execute("c", {});
      const keys = (res.content[0] as { text: string }).text.split(",");
      expect(keys).toContain("FAKE_EXTRA");
      expect(keys).toContain("PATH");
      expect(keys).not.toContain("KOLO_GATEWAY_TOKEN_TEST_LEAK");
    } finally {
      delete process.env.KOLO_GATEWAY_TOKEN_TEST_LEAK;
    }
  });

  it("exposes an exec-like tool only with an explicit allow glob", async () => {
    const manager = await startManager({
      fake: stdioConfig({ allowTools: ["run_command", "echo"] }),
    });
    const names = createMcpTools({ manager }).map((t) => t.name);
    expect(names).toEqual(["mcp_fake_echo", "mcp_fake_run_command"]);
  });

  it("restarts a server that exits, with backoff, and keeps serving", async () => {
    const manager = await startManager({
      fake: stdioConfig({ env: { FAKE_MCP_EXIT_AFTER_MS: "300" } }),
    });
    expect(manager.servers()[0].state).toBe("ready");
    const seen = new Set<string>();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const s = manager.servers()[0];
      seen.add(s.state);
      if (s.restarts >= 1 && s.state === "ready") {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    const s = manager.servers()[0];
    expect(s.restarts).toBeGreaterThanOrEqual(1);
    expect(s.state).toBe("ready");
    expect([...seen].some((x) => x === "backoff" || x === "error")).toBe(true);
    const [echo] = createMcpTools({ manager }).filter((t) => t.name === "mcp_fake_echo");
    expect((await echo.execute("c", { text: "again" })).content[0]).toEqual({
      type: "text",
      text: "again",
    });
  }, 15_000);

  it("reports an error state (and no tools) for a command that cannot start", async () => {
    const manager = await startManager({
      broken: { transport: "stdio", command: process.execPath, args: ["-e", "process.exit(2)"] },
    });
    const s = manager.servers()[0];
    expect(["error", "backoff"]).toContain(s.state);
    expect(manager.exposedTools()).toEqual([]);
  });

  it("probe connects once and tears down", async () => {
    const status = await probeMcpServer("fake", stdioConfig(), {
      baseEnv: { PATH: process.env.PATH ?? "" },
    });
    expect(status.state).toBe("ready");
    expect(status.tools.length).toBe(6);
  });
});

describe("streamable-HTTP transport", () => {
  let server: http.Server;
  let url = "";
  const seenHeaders: string[] = [];

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      seenHeaders.push(String(req.headers["x-fake-auth"] ?? ""));
      const chunks: Buffer[] = [];
      for await (const c of req) {
        chunks.push(c as Buffer);
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? JSON.parse(raw) : undefined;
      // Stateless mode: a fresh server + transport per request (SDK pattern).
      const mcp = new McpServer({ name: "fake-http", version: "0.0.1" });
      mcp.registerTool(
        "search",
        { description: "Search docs", inputSchema: { q: z.string() } },
        async ({ q }) => ({ content: [{ type: "text", text: `found ${q}` }] }),
      );
      mcp.registerTool(
        "delete_doc",
        { description: "Delete", inputSchema: { id: z.string() } },
        async () => ({ content: [{ type: "text", text: "deleted" }] }),
      );
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("connects with headers, lists tools with policy, calls one", async () => {
    const manager = await startManager({
      docs: { transport: "http", url, headers: { "x-fake-auth": "tok-123" } },
    });
    const s = manager.servers()[0];
    expect(s.state).toBe("ready");
    expect(s.tools.map((t) => [t.name, t.exposed])).toEqual([
      ["search", true],
      ["delete_doc", false],
    ]);
    expect(seenHeaders).toContain("tok-123");
    const [search] = createMcpTools({ manager });
    expect(search.name).toBe("mcp_docs_search");
    const res = await search.execute("c", { q: "kolo" });
    expect(res.content).toEqual([{ type: "text", text: "found kolo" }]);
  });

  it("reports an unreachable endpoint without throwing", async () => {
    const manager = await startManager({
      dead: { transport: "http", url: "http://127.0.0.1:9/mcp", timeoutMs: 2000 },
    });
    expect(["error", "backoff"]).toContain(manager.servers()[0].state);
    expect(manager.servers()[0].lastError).toBeTruthy();
  });
});

describe("manager.apply", () => {
  it("stops removed/disabled servers and leaves unchanged ones connected", async () => {
    const manager = await startManager({ a: stdioConfig(), b: stdioConfig() });
    expect(manager.servers().map((s) => s.id)).toEqual(["a", "b"]);
    const before = manager.servers()[0].connectedAt;
    await manager.apply({ servers: { a: stdioConfig(), b: stdioConfig({ enabled: false }) } });
    expect(manager.servers().map((s) => s.id)).toEqual(["a"]);
    expect(manager.servers()[0].connectedAt).toBe(before);
    await manager.stop();
    expect(manager.servers()).toEqual([]);
  });
});
