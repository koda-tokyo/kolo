import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "./test-helpers/fast-coding-tools.js";
import type { KoLoConfig } from "../config/config.js";
import type { AnyAgentTool } from "./tools/common.js";
import { __resetJobsForTest, getJob, markJobRunning, startJob } from "./jobs.js";
import { createKipEngineTaskTool, KIP_ENGINE_TOOL_NAME } from "./kip-engine-task.js";
import {
  checkToolPermission,
  resolveToolPermissions,
  ToolPermissionDeniedError,
  wrapToolWithPermissionGuard,
} from "./permissions.js";
import { createKoLoCodingTools } from "./pi-tools.js";

type EngineMode = "ready" | "fail" | "hang" | "create-error";

type ServerState = {
  mode: EngineMode;
  created: Array<{ project: string; goal: string; profile?: string; auth?: string }>;
  merged: string[];
  cancelled: string[];
};

let server: http.Server;
let port = 0;
const state: ServerState = { mode: "ready", created: [], merged: [], cancelled: [] };

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-kip-engine-"));
  process.env.KOLO_STATE_DIR = tmpHome;
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/tasks") {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        if (state.mode === "create-error") {
          sendJson(res, 500, { error: "engine boom" });
          return;
        }
        const body = JSON.parse(raw || "{}") as {
          project?: string;
          goal?: string;
          profile?: string;
        };
        state.created.push({
          project: body.project ?? "",
          goal: body.goal ?? "",
          profile: body.profile,
          auth: req.headers.authorization,
        });
        sendJson(res, 200, { id: "task-1", status: "queued" });
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks/task-1/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write('event: progress\ndata: {"step":1}\n\n');
      if (state.mode === "hang") {
        res.write('event: progress\ndata: {"step":2}\n\n');
        return; // keep open until the client aborts
      }
      res.write('event: progress\ndata: {"step":2}\n\n');
      if (state.mode === "fail") {
        res.write('event: status\ndata: {"status":"failed","error":"engine boom"}\n\n');
      } else {
        res.write('event: status\ndata: {"status":"ready","summary":"Built the thing"}\n\n');
      }
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks/task-1") {
      if (state.mode === "fail") {
        sendJson(res, 200, { id: "task-1", status: "failed", error: "engine boom" });
        return;
      }
      if (state.mode === "hang") {
        sendJson(res, 200, { id: "task-1", status: "running" });
        return;
      }
      sendJson(res, 200, { id: "task-1", status: "ready", summary: "Built the thing" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/task-1/merge") {
      state.merged.push("task-1");
      sendJson(res, 200, { ok: true, merge: { commit: "abc123" } });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/task-1/cancel") {
      state.cancelled.push("task-1");
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  __resetJobsForTest();
  state.mode = "ready";
  state.created.length = 0;
  state.merged.length = 0;
  state.cancelled.length = 0;
});

let tokenFile = "";
beforeAll(() => {
  tokenFile = path.join(os.tmpdir(), `kolo-kip-token-${process.pid}`);
  fs.writeFileSync(tokenFile, "test-token\n");
});
afterAll(() => {
  fs.rmSync(tokenFile, { force: true });
});

function makeTool(
  overrides?: Partial<Parameters<typeof createKipEngineTaskTool>[0]>,
): AnyAgentTool {
  return createKipEngineTaskTool({
    baseUrl: `http://127.0.0.1:${port}`,
    tokenFile,
    agentId: "main",
    sessionKey: "agent:main:main",
    ...overrides,
  });
}

function seedParentJob(): string {
  const parent = startJob({ agent: "main", sessionKey: "agent:main:main", kind: "agent" });
  markJobRunning(parent.id);
  return parent.id;
}

type Details = Record<string, unknown> & { ok?: boolean; taskId?: string };

async function runTool(
  tool: AnyAgentTool,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Details> {
  const result = await tool.execute("call-1", params as never, signal, undefined);
  return (result.details ?? {}) as Details;
}

describe("kip_engine_task tool", () => {
  it("creates a task, streams progress into a child job, and reports ready-to-merge without merging", async () => {
    const parentId = seedParentJob();
    const details = await runTool(makeTool(), { project: "demo", goal: "build it" });
    expect(details.ok).toBe(true);
    expect(details.taskId).toBe("task-1");
    expect(details.status).toBe("ready");
    expect(details.mergeReady).toBe(true);
    expect(details.merged).toBeUndefined();
    expect(details.parentJobId).toBe(parentId);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({
      project: "demo",
      goal: "build it",
      auth: "Bearer test-token",
    });
    expect(state.merged).toHaveLength(0);
    const child = getJob(String(details.jobId));
    expect(child?.status).toBe("succeeded");
    expect(child?.parentJobId).toBe(parentId);
    expect(child?.kind).toBe("kip-engine-task");
    expect(child?.summary).toContain("Built the thing");
    expect((child?.steps ?? 0) >= 2).toBe(true);
  });

  it("merges only when merge=true is passed", async () => {
    seedParentJob();
    const details = await runTool(makeTool(), { project: "demo", goal: "build it", merge: true });
    expect(details.ok).toBe(true);
    expect(state.merged).toEqual(["task-1"]);
    expect((details.merged as { ok?: boolean }).ok).toBe(true);
  });

  it("reports failure and fails the child job when the task fails", async () => {
    state.mode = "fail";
    seedParentJob();
    const details = await runTool(makeTool(), { project: "demo", goal: "build it" });
    expect(details.ok).toBe(false);
    expect(details.status).toBe("failed");
    const child = getJob(String(details.jobId));
    expect(child?.status).toBe("failed");
    expect(child?.error).toBe("engine boom");
  });

  it("surfaces engine creation errors without touching merge", async () => {
    state.mode = "create-error";
    const details = await runTool(makeTool(), { project: "demo", goal: "build it" });
    expect(details.ok).toBe(false);
    expect(String(details.error)).toContain("500");
    expect(state.merged).toHaveLength(0);
  });

  it("validates required params", async () => {
    const details = await runTool(makeTool(), { project: "", goal: "" });
    expect(details.ok).toBe(false);
    expect(String(details.error)).toContain("project and goal are required");
    expect(state.created).toHaveLength(0);
  });

  it("cancels the engine task when the run aborts mid-stream", async () => {
    state.mode = "hang";
    seedParentJob();
    const controller = new AbortController();
    const pending = runTool(makeTool(), { project: "demo", goal: "build it" }, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 200));
    controller.abort();
    const details = await pending;
    expect(details.aborted).toBe(true);
    expect(state.cancelled).toEqual(["task-1"]);
  });

  it("fails cleanly when the engine is unreachable", async () => {
    const tool = createKipEngineTaskTool({
      baseUrl: "http://127.0.0.1:1",
      agentId: "main",
      sessionKey: "agent:main:main",
    });
    const details = await runTool(tool, { project: "demo", goal: "build it" });
    expect(details.ok).toBe(false);
    expect(String(details.error)).toContain("cannot reach the KIP engine");
  });
});

describe("kip_engine_task permissions (exec class)", () => {
  const WS = "/ws";

  it("classifies plain runs and merge requests as distinct exec targets", () => {
    expect(
      checkToolPermission({
        toolName: KIP_ENGINE_TOOL_NAME,
        args: { project: "p", goal: "g" },
        permissionSet: resolveToolPermissions({
          entry: ["exec:kip_engine_task"],
          workspaceDir: WS,
        }),
        workspaceDir: WS,
      }).ok,
    ).toBe(true);
    const denied = checkToolPermission({
      toolName: KIP_ENGINE_TOOL_NAME,
      args: { project: "p", goal: "g", merge: true },
      permissionSet: resolveToolPermissions({ entry: ["exec:kip_engine_task"], workspaceDir: WS }),
      workspaceDir: WS,
    });
    expect(denied.ok).toBe(false);
    expect(
      checkToolPermission({
        toolName: KIP_ENGINE_TOOL_NAME,
        args: { project: "p", goal: "g", merge: true },
        permissionSet: resolveToolPermissions({
          entry: ["exec:kip_engine_task:merge"],
          workspaceDir: WS,
        }),
        workspaceDir: WS,
      }).ok,
    ).toBe(true);
  });

  it("denies merge=true at dispatch through the guard wrapper", async () => {
    const set = resolveToolPermissions({ entry: ["exec:kip_engine_task"], workspaceDir: WS });
    const guarded = wrapToolWithPermissionGuard(makeTool(), {
      permissionSet: set,
      workspaceDir: WS,
      agentId: "main",
      sessionKey: "agent:main:main",
    });
    await expect(
      guarded.execute(
        "call-2",
        { project: "demo", goal: "build it", merge: true } as never,
        undefined,
        undefined,
      ),
    ).rejects.toBeInstanceOf(ToolPermissionDeniedError);
    // Nothing reached the engine.
    expect(state.created).toHaveLength(0);
    expect(state.merged).toHaveLength(0);
  });
});

describe("kip_engine_task registration", () => {
  it("is absent by default and present when kipEngine is enabled", () => {
    const off = createKoLoCodingTools({
      config: { agents: { list: [{ id: "main" }] } } as unknown as KoLoConfig,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/kolo-kip-reg",
      agentDir: "/tmp/kolo-kip-reg",
    });
    expect(off.some((tool) => tool.name === KIP_ENGINE_TOOL_NAME)).toBe(false);

    const on = createKoLoCodingTools({
      config: {
        kipEngine: { enabled: true, baseUrl: `http://127.0.0.1:${port}` },
        agents: { list: [{ id: "main" }] },
      } as unknown as KoLoConfig,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/kolo-kip-reg",
      agentDir: "/tmp/kolo-kip-reg",
    });
    expect(on.some((tool) => tool.name === KIP_ENGINE_TOOL_NAME)).toBe(true);

    // enabled without baseUrl stays off (misconfiguration is not registered)
    const noUrl = createKoLoCodingTools({
      config: {
        kipEngine: { enabled: true },
        agents: { list: [{ id: "main" }] },
      } as unknown as KoLoConfig,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/kolo-kip-reg",
      agentDir: "/tmp/kolo-kip-reg",
    });
    expect(noUrl.some((tool) => tool.name === KIP_ENGINE_TOOL_NAME)).toBe(false);
  });
});
