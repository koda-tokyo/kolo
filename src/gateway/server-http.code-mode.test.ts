// Gateway round trip for Code Mode (M6): a script calling two tools over POST /api/code-mode/run
// and WS codeMode.run, auth/scope gates, the tool-call budget, audit rows under the run id, and
// the MCP inventory route.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { flushAudit } from "../audit/index.js";
import { onAuditEvent, type AuditEvent } from "../security/audit-log.js";
import { setCredentialStoreForTest } from "./pair-store.js";
import { testState } from "./test-helpers.mocks.js";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  rpcReq,
  startGatewayServer,
} from "./test-helpers.server.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let ownerToken = "";
const audit: AuditEvent[] = [];
let stopAudit = () => {};

const AGENTS = {
  list: [{ id: "main", tools: { allow: ["agents_list", "sessions_list"] } }],
  // oxlint-disable-next-line typescript/no-explicit-any
} as any;

beforeEach(() => {
  testState.agentsConfig = AGENTS;
});

beforeAll(async () => {
  delete process.env.KOLO_GATEWAY_TOKEN;
  delete process.env.KOLO_GATEWAY_PASSWORD;
  setCredentialStoreForTest(null);
  testState.agentsConfig = AGENTS;
  stopAudit = onAuditEvent((e) => audit.push(e));
  port = await getFreePort();
  server = await startGatewayServer(port, { bind: "loopback" });
  ownerToken = (testState.gatewayAuth as { token?: string } | undefined)?.token ?? "";
});

afterAll(async () => {
  stopAudit();
  await flushAudit();
  await server?.close();
  setCredentialStoreForTest(null);
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;

async function post(p: string, body: unknown, token?: string) {
  return await fetch(url(p), {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const TWO_TOOLS =
  "const agents = await tools.agents_list({}); const sessions = await tools.sessions_list({});" +
  " console.log('agents', agents.text.length > 0); return { agents: typeof agents.text, sessions: typeof sessions.text, both: 2 };";

describe("POST /api/code-mode/run", () => {
  it("runs a script that calls two tools and audits each call under the run id", async () => {
    audit.length = 0;
    const res = await post(
      "/api/code-mode/run",
      { script: TWO_TOOLS, sessionKey: "main" },
      ownerToken,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      runId: string;
      value: unknown;
      calls: Array<{ tool: string; ok: boolean }>;
      logs: Array<{ level: string; text: string }>;
      tools: string[];
      error?: { message: string };
    };
    expect(body.ok, JSON.stringify(body.error)).toBe(true);
    expect(body.value).toEqual({ agents: "string", sessions: "string", both: 2 });
    expect(body.calls.map((c) => [c.tool, c.ok])).toEqual([
      ["agents_list", true],
      ["sessions_list", true],
    ]);
    expect(body.logs).toEqual([{ level: "log", text: "agents true" }]);
    expect(body.tools).toEqual(["agents_list", "sessions_list"]);
    const mine = audit.filter((e) => (e.detail as { runId?: string })?.runId === body.runId);
    expect(mine.map((e) => e.action)).toEqual([
      "code_mode.start",
      "code_mode.tool_call",
      "code_mode.tool_call",
      "code_mode.run",
    ]);
    expect(mine[0]).toMatchObject({
      source: "http:/api/code-mode/run",
      identity: "main",
      scope: "agent:main:main",
    });
    expect((mine[0].detail as { principal?: string }).principal).toMatch(/^owner:/);
  });

  it("answers 401 without a token and 400 on a bad body", async () => {
    expect((await post("/api/code-mode/run", { script: "return 1;" })).status).toBe(401);
    const bad = await post("/api/code-mode/run", { script: "" }, ownerToken);
    expect(bad.status).toBe(400);
    const lang = await post(
      "/api/code-mode/run",
      { script: "return 1;", language: "py" },
      ownerToken,
    );
    expect(lang.status).toBe(400);
  });

  it("hides tools outside the agent policy and the per-run allowlist", async () => {
    const res = await post(
      "/api/code-mode/run",
      { script: "return Object.keys(tools);", allowTools: ["agents_*"] },
      ownerToken,
    );
    const body = (await res.json()) as { ok: boolean; value: string[] };
    expect(body.ok).toBe(true);
    expect(body.value).toEqual(["agents_list"]);
  });

  it("stops at maxToolCalls", async () => {
    const res = await post(
      "/api/code-mode/run",
      {
        script: "for (let i = 0; i < 5; i++) await tools.agents_list({}); return 'x';",
        maxToolCalls: 2,
      },
      ownerToken,
    );
    const body = (await res.json()) as { ok: boolean; error?: { code: string }; toolCalls: number };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("tool_call_limit");
    expect(body.toolCalls).toBe(3);
  });

  it("reports a script error with its message", async () => {
    const res = await post(
      "/api/code-mode/run",
      { script: "throw new RangeError('nope');" },
      ownerToken,
    );
    const body = (await res.json()) as { ok: boolean; error?: { code: string; message: string } };
    expect(body.ok).toBe(false);
    expect(body.error).toMatchObject({ code: "script_error", message: "RangeError: nope" });
  });
});

describe("WS codeMode.run and mcp.status", () => {
  it("runs the same script over the socket and validates params", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.once("open", resolve));
    await connectOk(ws, { token: ownerToken });
    const res = await rpcReq<{ ok: boolean; value: unknown; calls: unknown[] }>(
      ws,
      "codeMode.run",
      {
        script: TWO_TOOLS,
      },
    );
    expect(res.ok).toBe(true);
    expect(res.payload?.value).toEqual({ agents: "string", sessions: "string", both: 2 });
    expect(res.payload?.calls).toHaveLength(2);
    const bad = await rpcReq(ws, "codeMode.run", { script: "return 1;", bogus: true });
    expect(bad.ok).toBe(false);
    const status = await rpcReq<{ servers: unknown[] }>(ws, "mcp.status", {});
    expect(status.ok).toBe(true);
    expect(Array.isArray(status.payload?.servers)).toBe(true);
    ws.close();
  });
});

describe("GET /api/mcp/servers", () => {
  it("lists configured servers (none here) and needs auth", async () => {
    expect((await fetch(url("/api/mcp/servers"))).status).toBe(401);
    const res = await fetch(url("/api/mcp/servers"), {
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, servers: [] });
  });
});
