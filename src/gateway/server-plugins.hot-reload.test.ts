// Gateway hot reload (M7): a plugin file is rewritten and, after `plugins.reload` (WS) or
// POST /api/plugins/{id}/reload, the gateway answers with the new behaviour without restarting;
// a plugin that throws is quarantined and listed; an `mcp.servers` change in kolo.json reconnects
// only the affected server through the config watcher (no restart).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

// fileURLToPath, not URL.pathname: the latter yields "/C:/…" on Windows and resolves nowhere.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_MCP_SERVER = path.join(ROOT, "test", "fixtures", "mcp", "fake-mcp-server.mjs");
const SCHEMA = { type: "object", additionalProperties: false, properties: {} };

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let ownerToken = "";
let pluginDir = "";
let emptyBundled = "";
const prevBundled = process.env.KOLO_BUNDLED_PLUGINS_DIR;
const audit: AuditEvent[] = [];
let stopAudit = () => {};

function pluginSource(version: string, opts: { throwOnLoad?: boolean } = {}) {
  return `
${opts.throwOnLoad ? 'throw new Error("broken plugin file");' : ""}
export default {
  id: "hot",
  version: "${version}",
  register(api) {
    api.registerTool({ name: "hot_tool_${version}", description: "t", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [] }) });
    api.registerGatewayMethod("hot.version", ({ respond }) => respond(true, { version: "${version}" }, undefined));
    api.lifecycle.setInterval(() => {}, 1000);
  },
};
`;
}

// The suite hooks give every test a fresh config root (KOLO_CONFIG_PATH moves between tests)
// while the gateway keeps watching the path it booted with. The reloader reads the snapshot from
// the current path, so a config change is written to both: the current file carries the content,
// the boot-time file triggers the watcher.
let bootConfigPath = "";

function configPath() {
  return process.env.KOLO_CONFIG_PATH ?? "";
}

function writeKoloJson(extra: Record<string, unknown>) {
  const token = (testState.gatewayAuth as { token?: string } | undefined)?.token;
  const config = {
    gateway: { bind: "loopback", auth: { mode: "token", token }, reload: { debounceMs: 100 } },
    plugins: { load: { paths: [pluginDir] } },
    ...extra,
  };
  const body = `${JSON.stringify(config, null, 2)}\n`;
  for (const file of new Set([configPath(), bootConfigPath].filter(Boolean))) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = (p: string) => `http://127.0.0.1:${port}${p}`;

beforeAll(async () => {
  delete process.env.KOLO_GATEWAY_TOKEN;
  delete process.env.KOLO_GATEWAY_PASSWORD;
  setCredentialStoreForTest(null);
  emptyBundled = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-hot-nobundle-"));
  process.env.KOLO_BUNDLED_PLUGINS_DIR = emptyBundled;
  pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-hot-plugin-"));
  fs.writeFileSync(
    path.join(pluginDir, "KoLo.plugin.json"),
    JSON.stringify({ id: "hot", configSchema: SCHEMA }),
  );
  fs.writeFileSync(path.join(pluginDir, "index.ts"), pluginSource("v1"));
  stopAudit = onAuditEvent((e) => audit.push(e));
  port = await getFreePort();
  // The test config root is created by the hooks; write the file the mocked loadConfig reads.
  writeKoloJson({});
  bootConfigPath = configPath();
  server = await startGatewayServer(port, { bind: "loopback" });
  ownerToken = (testState.gatewayAuth as { token?: string } | undefined)?.token ?? "";
});

afterAll(async () => {
  stopAudit();
  await flushAudit();
  await server?.close();
  setCredentialStoreForTest(null);
  fs.rmSync(pluginDir, { recursive: true, force: true });
  fs.rmSync(emptyBundled, { recursive: true, force: true });
  if (prevBundled === undefined) {
    delete process.env.KOLO_BUNDLED_PLUGINS_DIR;
  } else {
    process.env.KOLO_BUNDLED_PLUGINS_DIR = prevBundled;
  }
});

async function wsCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  try {
    await connectOk(ws, { token: ownerToken });
    const res = await rpcReq<T>(ws, method, params);
    if (!res.ok) {
      throw new Error(`${method}: ${JSON.stringify(res.error)}`);
    }
    return res.payload as T;
  } finally {
    ws.close();
  }
}

type ListResult = {
  ok: true;
  plugins: Array<{
    id: string;
    status: string;
    error?: string;
    quarantined: boolean;
    reloads: number;
    tools: string[];
    watched: boolean;
  }>;
  hotReload: { enabled: boolean; watching: boolean };
};

describe("plugin hot reload over the gateway", () => {
  it("lists the plugin as loaded and answers its gateway method", async () => {
    const list = await wsCall<ListResult>("plugins.list");
    const hot = list.plugins.find((p) => p.id === "hot");
    expect(hot).toMatchObject({
      status: "loaded",
      quarantined: false,
      reloads: 0,
      tools: ["hot_tool_v1"],
    });
    expect(list.hotReload.enabled).toBe(true);
    expect(await wsCall<{ version: string }>("hot.version")).toEqual({ version: "v1" });
  });

  it("reloads the rewritten file through WS and serves the new behaviour without a restart", async () => {
    fs.writeFileSync(path.join(pluginDir, "index.ts"), pluginSource("v2"));
    const res = await wsCall<{ plugin: { ok: boolean; status: string; reloads: number } }>(
      "plugins.reload",
      { id: "hot" },
    );
    expect(res.plugin).toMatchObject({ ok: true, status: "loaded" });
    expect(await wsCall<{ version: string }>("hot.version")).toEqual({ version: "v2" });
    const list = await wsCall<ListResult>("plugins.list");
    expect(list.plugins.find((p) => p.id === "hot")?.tools).toEqual(["hot_tool_v2"]);
    const actions = audit
      .filter((e) => (e.detail as { plugin?: string })?.plugin === "hot")
      .map((e) => e.action);
    expect(actions).toContain("plugin.loaded");
    expect(actions).toContain("plugin.disposed");
    expect(actions).toContain("plugin.reloaded");
    expect(
      audit.some((e) => e.action === "plugin.reload_requested" && e.source === "ws:plugins.reload"),
    ).toBe(true);
  });

  it("quarantines a broken file over HTTP and recovers on the next reload", async () => {
    fs.writeFileSync(path.join(pluginDir, "index.ts"), pluginSource("v3", { throwOnLoad: true }));
    const broken = await fetch(url("/api/plugins/hot/reload"), {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(broken.status).toBe(200);
    const body = (await broken.json()) as {
      ok: boolean;
      plugin: { ok: boolean; status: string; error?: string };
    };
    expect(body.plugin.ok).toBe(false);
    expect(body.plugin.status).toBe("error");
    expect(body.plugin.error).toContain("broken plugin file");
    // The gateway is still up and the list shows the quarantine with its error.
    const list = (await (
      await fetch(url("/api/plugins"), { headers: { authorization: `Bearer ${ownerToken}` } })
    ).json()) as ListResult;
    expect(list.plugins.find((p) => p.id === "hot")).toMatchObject({
      status: "error",
      quarantined: true,
    });
    expect(list.plugins.find((p) => p.id === "hot")?.error).toContain("broken plugin file");
    expect(audit.some((e) => e.action === "plugin.failed")).toBe(true);
    fs.writeFileSync(path.join(pluginDir, "index.ts"), pluginSource("v4"));
    const fixed = await fetch(url("/api/plugins/hot/reload"), {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(((await fixed.json()) as { plugin: { ok: boolean } }).plugin.ok).toBe(true);
    expect(await wsCall<{ version: string }>("hot.version")).toEqual({ version: "v4" });
  });

  it("refuses without a token, 404s an unknown plugin", async () => {
    expect((await fetch(url("/api/plugins"))).status).toBe(401);
    const missing = await fetch(url(`/api/plugins/nope-${randomUUID()}/reload`), {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(missing.status).toBe(404);
  });

  it("reconnects an MCP server when mcp.servers changes in kolo.json (config watcher, no restart)", async () => {
    const before = (await (
      await fetch(url("/api/mcp/servers"), { headers: { authorization: `Bearer ${ownerToken}` } })
    ).json()) as { servers: Array<{ id: string }> };
    expect(before.servers.find((s) => s.id === "fake")).toBeUndefined();
    writeKoloJson({
      mcp: {
        servers: {
          fake: { transport: "stdio", command: process.execPath, args: [FAKE_MCP_SERVER] },
        },
      },
    });
    let state = "";
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const res = (await (
        await fetch(url("/api/mcp/servers"), { headers: { authorization: `Bearer ${ownerToken}` } })
      ).json()) as { servers: Array<{ id: string; state: string }> };
      state = res.servers.find((s) => s.id === "fake")?.state ?? "";
      if (state === "ready") {
        break;
      }
      await sleep(250);
    }
    expect(state).toBe("ready");
    // Still the same process: the hot plugin answers and no restart was requested.
    expect(await wsCall<{ version: string }>("hot.version")).toEqual({ version: "v4" });
    writeKoloJson({});
    const gone = Date.now() + 10_000;
    let present = true;
    while (Date.now() < gone && present) {
      const res = (await (
        await fetch(url("/api/mcp/servers"), { headers: { authorization: `Bearer ${ownerToken}` } })
      ).json()) as { servers: Array<{ id: string }> };
      present = res.servers.some((s) => s.id === "fake");
      if (present) {
        await sleep(250);
      }
    }
    expect(present).toBe(false);
  });
});
