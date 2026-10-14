import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelJob,
  completeJob,
  getJob,
  isJobCancelled,
  JOB_HISTORY_LIMIT,
  JOB_INTERRUPTED_ERROR,
  listJobs,
  markJobRunning,
  onJobCompleted,
  registerJobCancel,
  resolveJobsFile,
  startJob,
  updateJobProgress,
  __resetJobsForTest,
  type JobRecord,
} from "./jobs.js";

let tmpHome = "";

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-jobs-"));
  process.env.KOLO_STATE_DIR = tmpHome;
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KOLO_STATE_DIR;
});

beforeEach(() => {
  __resetJobsForTest();
});

describe("jobs registry lifecycle", () => {
  it("starts queued, moves to running, then terminal", () => {
    const job = startJob({ agent: "main", sessionKey: "agent:main:main" });
    expect(job.status).toBe("queued");
    expect(job.id).toBeTruthy();
    markJobRunning(job.id);
    expect(getJob(job.id)?.status).toBe("running");
    const done = completeJob(job.id, { status: "succeeded", steps: 3, toolCalls: 2 });
    expect(done?.status).toBe("succeeded");
    expect(done?.steps).toBe(3);
    expect(done?.toolCalls).toBe(2);
    expect(done?.endedAt).toBeTruthy();
  });

  it("completeJob is a no-op once terminal", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    completeJob(job.id, { status: "failed", error: "boom" });
    const after = completeJob(job.id, { status: "succeeded" });
    expect(after?.status).toBe("failed");
    expect(after?.error).toBe("boom");
  });

  it("markJobRunning never revives a terminal job", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    completeJob(job.id, { status: "cancelled" });
    markJobRunning(job.id);
    expect(getJob(job.id)?.status).toBe("cancelled");
  });

  it("tracks progress while running only", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    updateJobProgress(job.id, { steps: 5, toolCalls: 4 });
    expect(getJob(job.id)?.steps).toBe(5);
    completeJob(job.id, { status: "succeeded" });
    updateJobProgress(job.id, { steps: 99 });
    expect(getJob(job.id)?.steps).toBe(5);
  });

  it("records loop_stopped with summary", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    completeJob(job.id, {
      status: "loop_stopped",
      summary: "Stopped: 4 identical exec calls in a row",
      error: "identical_calls",
    });
    const rec = getJob(job.id);
    expect(rec?.status).toBe("loop_stopped");
    expect(rec?.summary).toContain("identical exec calls");
  });
});

describe("jobs registry cancellation", () => {
  it("invokes the registered cancel handle and marks cancelled", () => {
    const handle = vi.fn();
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    registerJobCancel(job.id, handle);
    const result = cancelJob(job.id, { requestedBy: "test" });
    expect(result.ok).toBe(true);
    expect(handle).toHaveBeenCalledOnce();
    expect(getJob(job.id)?.status).toBe("cancelled");
  });

  it("reports not_found for unknown ids", () => {
    const result = cancelJob("does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
    }
  });

  it("reports already_finished for terminal jobs and does not call the handle", () => {
    const handle = vi.fn();
    const job = startJob({ agent: "main", sessionKey: "s" });
    registerJobCancel(job.id, handle);
    completeJob(job.id, { status: "succeeded" });
    const result = cancelJob(job.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("already_finished");
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it("flags queued-then-cancelled jobs so the runner skips them", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    cancelJob(job.id);
    expect(isJobCancelled(job.id)).toBe(true);
    // markJobRunning must not revive a cancelled job.
    markJobRunning(job.id);
    expect(getJob(job.id)?.status).toBe("cancelled");
  });
});

describe("jobs registry listing", () => {
  it("lists newest first and filters by agent/status", () => {
    const a = startJob({ agent: "main", sessionKey: "s1" });
    const b = startJob({ agent: "atlas", sessionKey: "s2" });
    markJobRunning(b.id);
    completeJob(b.id, { status: "succeeded" });
    const all = listJobs();
    expect(all[0].id).toBe(b.id);
    expect(all[1].id).toBe(a.id);
    expect(listJobs({ agent: "main" }).map((j) => j.id)).toEqual([a.id]);
    expect(listJobs({ status: "succeeded" }).map((j) => j.id)).toEqual([b.id]);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      startJob({ agent: "main", sessionKey: `s${i}` });
    }
    expect(listJobs({ limit: 2 })).toHaveLength(2);
  });

  it("bounds history to JOB_HISTORY_LIMIT, keeping live jobs", () => {
    const live = startJob({ agent: "main", sessionKey: "live" });
    for (let i = 0; i < JOB_HISTORY_LIMIT + 20; i++) {
      const j = startJob({ agent: "batch", sessionKey: `s${i}` });
      completeJob(j.id, { status: "succeeded" });
    }
    const all = listJobs({ limit: JOB_HISTORY_LIMIT });
    expect(all.length).toBeLessThanOrEqual(JOB_HISTORY_LIMIT);
    // The still-queued live job must never be trimmed.
    expect(getJob(live.id)).toBeDefined();
  });
});

describe("jobs registry completion notices", () => {
  it("notifies listeners once on terminal transition", () => {
    const seen: JobRecord[] = [];
    const off = onJobCompleted((job) => seen.push(job));
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    completeJob(job.id, { status: "succeeded" });
    completeJob(job.id, { status: "failed" }); // no-op, no second notice
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe("succeeded");
    off();
    const job2 = startJob({ agent: "main", sessionKey: "s2" });
    completeJob(job2.id, { status: "failed" });
    expect(seen).toHaveLength(1);
  });

  it("a throwing listener does not break completion", () => {
    onJobCompleted(() => {
      throw new Error("listener boom");
    });
    const job = startJob({ agent: "main", sessionKey: "s" });
    expect(() => completeJob(job.id, { status: "succeeded" })).not.toThrow();
    expect(getJob(job.id)?.status).toBe("succeeded");
  });
});

describe("jobs registry persistence", () => {
  it("mirrors to run/jobs.json and reloads", async () => {
    expect(resolveJobsFile()).toBe(path.join(tmpHome, "run", "jobs.json"));
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    completeJob(job.id, { status: "succeeded", steps: 1, toolCalls: 1 });
    // scheduleSave is debounced (250ms) — wait it out.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const file = resolveJobsFile();
    expect(fs.existsSync(file)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as JobRecord[];
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.some((j) => j.id === job.id && j.status === "succeeded")).toBe(true);

    // A fresh registry (as after a restart) reloads the mirror.
    __resetJobsForTest();
    expect(getJob(job.id)?.status).toBe("succeeded");
  });

  it("reports a job that was running when the process ended as interrupted (M11)", async () => {
    const running = startJob({ agent: "main", sessionKey: "s-running" });
    markJobRunning(running.id);
    const queued = startJob({ agent: "main", sessionKey: "s-queued" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Simulate the next process: nothing in memory, only the mirror on disk.
    __resetJobsForTest();
    expect(getJob(running.id)).toMatchObject({ status: "failed", error: JOB_INTERRUPTED_ERROR });
    expect(getJob(queued.id)).toMatchObject({ status: "failed", error: JOB_INTERRUPTED_ERROR });
    expect(getJob(running.id)?.endedAt).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const raw = JSON.parse(fs.readFileSync(resolveJobsFile(), "utf8")) as JobRecord[];
    expect(raw.find((j) => j.id === running.id)?.status).toBe("failed");
  });
});
