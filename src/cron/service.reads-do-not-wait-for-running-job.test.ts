import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CronService } from "./service.js";

// Orion measured cron.status at 27 s and cron.list at 75 s on her gateway: the timer tick runs
// every due job inside the store lock, and reads queued behind a model call. Reads must answer
// while a job is running.
const noopLogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

async function makeStorePath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-cron-"));
  return {
    storePath: path.join(dir, "cron", "jobs.json"),
    cleanup: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("CronService reads while a job is running", () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  it("status and list answer while an isolated job holds the tick", async () => {
    const store = await makeStorePath();
    cleanup = store.cleanup;
    let releaseJob: (() => void) | null = null;
    const jobStarted = new Promise<void>((resolve) => {
      releaseJob = () => resolve();
    });
    let finishJob: ((v: { status: "ok" }) => void) | null = null;
    const runIsolatedAgentJob = vi.fn(
      () =>
        new Promise<{ status: "ok" }>((resolve) => {
          finishJob = resolve;
          releaseJob?.();
        }),
    );
    const cron = new CronService({
      storePath: store.storePath,
      cronEnabled: true,
      log: noopLogger,
      enqueueSystemEvent: vi.fn(),
      requestHeartbeatNow: vi.fn(),
      runIsolatedAgentJob,
    });
    await cron.start();
    await cron.add({
      name: "slow model call",
      enabled: true,
      schedule: { kind: "at", atMs: Date.now() + 20 },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "think for a while" },
    });
    await Promise.race([jobStarted, sleep(2000)]);
    expect(runIsolatedAgentJob).toHaveBeenCalledTimes(1);

    // The job is now running inside the tick. Reads must not wait for it.
    const timeout = sleep(500).then(() => "timed out" as const);
    const status = await Promise.race([cron.status(), timeout]);
    const list = await Promise.race([cron.list({ includeDisabled: true }), timeout]);
    expect(status).not.toBe("timed out");
    expect(list).not.toBe("timed out");
    expect((status as { jobs: number }).jobs).toBe(1);
    expect((list as Array<{ name: string }>).map((j) => j.name)).toEqual(["slow model call"]);

    finishJob?.({ status: "ok" });
    await sleep(50);
    cron.stop();
  });
});
