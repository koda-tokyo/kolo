import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KoLoConfig } from "../config/config.js";
import type { CommandRunner } from "./pull-request.js";
import type { FactoryEvent } from "./types.js";
import { __resetJobsForTest, getJob } from "../agents/jobs.js";
import { __resetEvidenceForTest } from "../evidence/recorder.js";
import { readJobEvents, readJobManifest } from "../evidence/store.js";
import { FactoryRunner, describeEngineEvent } from "./runner.js";
import { __resetFactoryForTest, createCard, getCard, onFactoryEvent } from "./store.js";

// A fake KIP engine speaking the `kip-engine serve` shapes: {task} envelopes, SSE frames with
// `event: <type>` and `data: {seq, ts, taskId, type, data}`, `event: end` at the end.
type Mode = "ready" | "fail" | "hang" | "create-error";
type FakeState = {
  mode: Mode;
  created: Array<Record<string, unknown>>;
  runs: string[];
  cancelled: string[];
  merged: Array<Record<string, unknown>>;
  openStreams: http.ServerResponse[];
};

let server: http.Server;
let baseUrl = "";
let home = "";
const state: FakeState = {
  mode: "ready",
  created: [],
  runs: [],
  cancelled: [],
  merged: [],
  openStreams: [],
};

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function frame(seq: number, type: string, data: Record<string, unknown>): string {
  const ev = { seq, ts: new Date().toISOString(), taskId: "001-goal", type, data };
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

function taskRecord(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "001-goal",
    specId: "001-goal",
    goal: "Build the thing",
    title: "Build the thing",
    status,
    branch: "kip/001-goal",
    baseBranch: "main",
    ...extra,
  };
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-factory-runner-"));
  process.env.KOLO_STATE_DIR = home;
  process.env.KOLO_HOME = home;
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.headers.authorization !== "Bearer factory-test-token") {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks") {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        if (state.mode === "create-error") {
          sendJson(res, 500, { error: "engine boom" });
          return;
        }
        state.created.push(JSON.parse(raw || "{}") as Record<string, unknown>);
        // Like the real engine without run:true honoured: the task is created, not started.
        sendJson(res, 201, { task: taskRecord("created") });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/001-goal/run") {
      state.runs.push("001-goal");
      sendJson(res, 202, { task: taskRecord("spec"), running: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks/001-goal/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write("retry: 2000\n\n");
      res.write(frame(1, "status", { status: "spec", phase: "requirements" }));
      res.write(frame(2, "phase", { phase: "planning", message: "3 subtasks" }));
      res.write(frame(3, "status", { status: "coding" }));
      res.write(frame(4, "tool", { toolName: "Write", toolCallId: "t1", durationMs: 12 }));
      if (state.mode === "hang") {
        state.openStreams.push(res);
        return;
      }
      res.write(frame(5, "status", { status: "qa" }));
      if (state.mode === "fail") {
        res.write(frame(6, "error", { message: "tests failed twice" }));
        res.write(frame(7, "status", { status: "failed", error: "tests failed twice" }));
        res.write(frame(8, "done", { status: "failed", error: "tests failed twice" }));
      } else {
        res.write(frame(6, "status", { status: "ready_to_merge" }));
        res.write(frame(7, "done", { status: "ready_to_merge" }));
      }
      res.write("event: end\ndata: {}\n\n");
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks/001-goal") {
      const status =
        state.mode === "fail" ? "failed" : state.mode === "hang" ? "coding" : "ready_to_merge";
      sendJson(res, 200, {
        task: taskRecord(status, state.mode === "fail" ? { error: "tests failed twice" } : {}),
        running: state.mode === "hang",
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/001-goal/cancel") {
      state.cancelled.push("001-goal");
      for (const open of state.openStreams.splice(0)) {
        open.write("event: end\ndata: {}\n\n");
        open.end();
      }
      sendJson(res, 200, { cancelled: true, task: taskRecord("cancelled") });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/001-goal/merge") {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
      });
      req.on("end", () => {
        state.merged.push(JSON.parse(raw || "{}") as Record<string, unknown>);
        sendJson(res, 200, {
          success: true,
          task: taskRecord("merged"),
          filesMerged: 3,
          staged: true,
          commit: "abc123",
        });
      });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      resolve();
    });
  });
  fs.writeFileSync(path.join(home, "engine.token"), "factory-test-token\n", { mode: 0o600 });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
  state.mode = "ready";
  state.created.length = 0;
  state.runs.length = 0;
  state.cancelled.length = 0;
  state.merged.length = 0;
  __resetJobsForTest();
  __resetEvidenceForTest();
  __resetFactoryForTest({ env: process.env });
});

afterEach(() => {
  fs.rmSync(path.join(home, "factory"), { recursive: true, force: true });
});

const REPO = path.join(os.tmpdir(), "repo-alice");

function config(extra: Partial<KoLoConfig> = {}): KoLoConfig {
  return {
    kipEngine: { enabled: true, baseUrl, tokenFile: path.join(home, "engine.token") },
    ...extra,
  } as KoLoConfig;
}

function runner(cfg: KoLoConfig, exec?: CommandRunner): FactoryRunner {
  return new FactoryRunner({ getConfig: () => cfg, exec, gatewayVersion: "test" });
}

describe("FactoryRunner", () => {
  it("refuses to run without an engine configured", () => {
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const result = runner({} as KoLoConfig).start(card.id, { requestedBy: "owner:token" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.code).toBe("not_configured");
    expect(runner(config()).start("nope", { requestedBy: "x" })).toMatchObject({
      code: "not_found",
    });
  });

  it("runs a card to ready: timeline, columns, job and evidence", async () => {
    const moves: string[] = [];
    onFactoryEvent((e: FactoryEvent) => {
      if (e.kind === "card.moved") {
        moves.push(`${e.from}>${e.to}`);
      }
    });
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(config());
    const started = r.start(card.id, { requestedBy: "owner:token" });
    expect(started.ok).toBe(true);
    const jobId = started.ok ? started.jobId : "";
    expect(r.isRunning(card.id)).toBe(true);
    expect(getCard(card.id)?.runningJobId).toBe(jobId);
    expect(r.start(card.id, { requestedBy: "owner:token" })).toMatchObject({ code: "running" });
    await r.wait(card.id);

    const done = getCard(card.id)!;
    expect(done.column).toBe("ready");
    expect(done.engineTaskId).toBe("001-goal");
    expect(done.branch).toBe("kip/001-goal");
    expect(done.runningJobId).toBeNull();
    expect(done.jobIds).toEqual([jobId]);
    expect(done.evidenceIds).toEqual([jobId]);
    expect(done.pr).toBeNull();
    expect(moves).toEqual(["inbox>spec", "spec>build", "build>review", "review>ready"]);
    expect(state.created[0]).toMatchObject({ project: REPO, goal: "Build the thing", run: true });
    expect(state.runs).toEqual(["001-goal"]);
    const kinds = done.timeline.map((e) => e.kind);
    expect(kinds[0]).toBe("created");
    expect(kinds).toContain("run");
    expect(kinds.filter((k) => k === "engine").length).toBeGreaterThanOrEqual(6);
    expect(done.timeline.some((e) => e.kind === "pr" && e.text.includes("kip/001-goal"))).toBe(
      true,
    );
    expect(done.timeline[done.timeline.length - 1].kind).toBe("job");

    const job = getJob(jobId)!;
    expect(job.kind).toBe("factory");
    expect(job.agent).toBe("alice");
    expect(job.status).toBe("succeeded");
    expect(job.steps).toBe(6);

    const events = readJobEvents(jobId);
    expect(events[0].type).toBe("job.start");
    expect(events[0].data.workspaceDir).toBe(REPO);
    expect(events.filter((e) => e.type === "tool.call")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool.result")).toHaveLength(6);
    expect(events[events.length - 1].type).toBe("job.end");
    expect(events[events.length - 1].data.status).toBe("succeeded");
    expect(readJobManifest(jobId)?.events.count).toBe(events.length);
  });

  it("opens a pull request through git push and gh when factory.github is enabled", async () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];
    const exec: CommandRunner = async (file, args, opts) => {
      calls.push({ file, args, cwd: opts.cwd });
      return file === "gh"
        ? { code: 0, stdout: "https://github.com/alice/repo/pull/42\n", stderr: "" }
        : { code: 0, stdout: "", stderr: "" };
    };
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(
      config({ factory: { github: { enabled: true, remote: "upstream", base: "main" } } }),
      exec,
    );
    r.start(card.id, { requestedBy: "owner:token" });
    await r.wait(card.id);
    const done = getCard(card.id)!;
    expect(done.column).toBe("ready");
    expect(done.pr).toMatchObject({
      url: "https://github.com/alice/repo/pull/42",
      number: 42,
      branch: "kip/001-goal",
      base: "main",
    });
    expect(calls.map((c) => c.file)).toEqual(["git", "gh"]);
    expect(calls[0].args).toEqual(["push", "-u", "upstream", "kip/001-goal"]);
    expect(calls[0].cwd).toBe(REPO);
    expect(calls[1].args.slice(0, 4)).toEqual(["pr", "create", "--head", "kip/001-goal"]);
    expect(calls[1].args).toContain("--base");
    expect(getJob(done.jobIds[0])?.summary).toContain("pull/42");
  });

  it("keeps the card ready when the pull request cannot be opened", async () => {
    const exec: CommandRunner = async (file) =>
      file === "git"
        ? { code: 1, stdout: "", stderr: "fatal: could not read from remote" }
        : { code: 0, stdout: "", stderr: "" };
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(config({ factory: { github: { enabled: true } } }), exec);
    r.start(card.id, { requestedBy: "owner:token" });
    await r.wait(card.id);
    const done = getCard(card.id)!;
    expect(done.column).toBe("ready");
    expect(done.pr).toBeNull();
    expect(done.timeline.some((e) => e.kind === "error" && e.text.includes("git push"))).toBe(true);
  });

  it("never merges without the policy and the permission; merges with both", async () => {
    const plain = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(config());
    r.start(plain.id, { requestedBy: "owner:token", mergeAllowed: true });
    await r.wait(plain.id);
    expect(getCard(plain.id)?.column).toBe("ready");
    expect(state.merged).toEqual([]);

    const gated = createCard({
      goal: "Build the thing",
      repo: REPO,
      owner: "alice",
      policy: { autoMerge: true },
    });
    // The owner resident has rules, but not the merge target.
    const noMerge = runner(
      config({
        agents: { list: [{ id: "alice", permissions: ["exec:kip_engine_task"] }] },
      } as Partial<KoLoConfig>),
    );
    noMerge.start(gated.id, { requestedBy: "alice" });
    await noMerge.wait(gated.id);
    const skipped = getCard(gated.id)!;
    expect(skipped.column).toBe("ready");
    expect(skipped.timeline.some((e) => e.kind === "merge" && /skipped/.test(e.text))).toBe(true);
    expect(state.merged).toEqual([]);

    const allowed = createCard({
      goal: "Build the thing",
      repo: REPO,
      owner: "alice",
      policy: { autoMerge: true },
    });
    const withMerge = runner(
      config({
        agents: { list: [{ id: "alice", permissions: ["exec:kip_engine_task:merge"] }] },
      } as Partial<KoLoConfig>),
    );
    withMerge.start(allowed.id, { requestedBy: "alice" });
    await withMerge.wait(allowed.id);
    const merged = getCard(allowed.id)!;
    expect(merged.column).toBe("merged");
    expect(state.merged).toEqual([{ commit: true }]);
    expect(merged.timeline.some((e) => e.kind === "merge" && /Merged/.test(e.text))).toBe(true);
    expect(getJob(merged.jobIds[0])?.status).toBe("succeeded");
  });

  it("fails the card when the engine fails, and retries from failed", async () => {
    state.mode = "fail";
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(config());
    r.start(card.id, { requestedBy: "owner:token" });
    await r.wait(card.id);
    const failed = getCard(card.id)!;
    expect(failed.column).toBe("failed");
    expect(failed.error).toContain("tests failed twice");
    expect(getJob(failed.jobIds[0])?.status).toBe("failed");
    const evidence = readJobEvents(failed.jobIds[0]);
    expect(evidence.filter((e) => e.type === "tool.result" && e.data.isError)).toHaveLength(1);

    state.mode = "ready";
    const again = r.start(card.id, { requestedBy: "alice" });
    expect(again.ok).toBe(true);
    await r.wait(card.id);
    const retried = getCard(card.id)!;
    expect(retried.column).toBe("ready");
    expect(retried.error).toBeNull();
    expect(retried.jobIds).toHaveLength(2);
    expect(retried.timeline.some((e) => e.kind === "moved" && e.text.includes("retry"))).toBe(true);
  });

  it("fails the card when the engine refuses the task", async () => {
    state.mode = "create-error";
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(config());
    r.start(card.id, { requestedBy: "owner:token" });
    await r.wait(card.id);
    expect(getCard(card.id)?.column).toBe("failed");
    expect(getCard(card.id)?.error).toContain("500");
    expect(getJob(getCard(card.id)!.jobIds[0])?.status).toBe("failed");
  });

  it("cancels a run: engine task cancelled, card failed, job cancelled", async () => {
    state.mode = "hang";
    const card = createCard({ goal: "Build the thing", repo: REPO, owner: "alice" });
    const r = runner(config());
    const started = r.start(card.id, { requestedBy: "owner:token" });
    expect(started.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(getCard(card.id)?.column).toBe("build");
    expect(r.cancel("nope", "owner:token")).toMatchObject({ code: "not_found" });
    expect(r.cancel(card.id, "owner:token")).toMatchObject({ ok: true });
    await r.wait(card.id);
    expect(state.cancelled).toEqual(["001-goal"]);
    const done = getCard(card.id)!;
    expect(done.column).toBe("failed");
    expect(done.error).toBe("run cancelled");
    expect(getJob(done.jobIds[0])?.status).toBe("cancelled");
    expect(r.cancel(card.id, "owner:token")).toMatchObject({ code: "not_running" });
    expect(r.start(card.id, { requestedBy: "owner:token" }).ok).toBe(true);
    await r.close();
    expect(r.isRunning(card.id)).toBe(false);
  });

  it("describes engine events in one line", () => {
    const ev = (type: string, data: Record<string, unknown>) => ({
      type,
      payload: { type, data },
    });
    expect(describeEngineEvent(ev("status", { status: "qa", phase: "review" }))).toBe(
      "status qa (review)",
    );
    expect(describeEngineEvent(ev("tool", { toolName: "Write", isError: true }))).toBe(
      "tool Write failed",
    );
    expect(describeEngineEvent(ev("progress", { stage: "build", percent: 40 }))).toBe("build 40%");
    expect(describeEngineEvent(ev("done", { status: "failed", error: "x" }))).toBe(
      "done: failed (x)",
    );
    expect(describeEngineEvent({ type: "custom", payload: {}, summary: "s" })).toBe("custom: s");
  });
});
