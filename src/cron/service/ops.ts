import type { CronJobCreate, CronJobPatch } from "../types.js";
import type { CronServiceState } from "./state.js";
import {
  applyJobPatch,
  computeJobNextRunAtMs,
  createJob,
  findJobOrThrow,
  isJobDue,
  nextWakeAtMs,
  recomputeNextRuns,
} from "./jobs.js";
import { locked } from "./locked.js";
import { ensureLoaded, persist, warnIfDisabled } from "./store.js";
import { armTimer, emit, executeJob, stopTimer, wake } from "./timer.js";

export async function start(state: CronServiceState) {
  await locked(state, async () => {
    if (!state.deps.cronEnabled) {
      state.deps.log.info({ enabled: false }, "cron: disabled");
      return;
    }
    await ensureLoaded(state);
    recomputeNextRuns(state);
    await persist(state);
    armTimer(state);
    state.deps.log.info(
      {
        enabled: true,
        jobs: state.store?.jobs.length ?? 0,
        nextWakeAtMs: nextWakeAtMs(state) ?? null,
      },
      "cron: started",
    );
  });
}

export function stop(state: CronServiceState) {
  stopTimer(state);
}

// The timer tick executes every due job (a model call that can run for minutes)
// INSIDE the store lock, so any read that also took the lock waited behind it: cron.status 27 s and
// cron.list 75 s measured on a busy gateway, and the cron tool timing out inside agent turns.
// Reads need the store loaded, not the lock: once loaded, the in-memory store is the same object
// the tick mutates, so a read outside the lock sees a consistent point-in-time snapshot.
async function ensureLoadedForRead(state: CronServiceState) {
  const jobRunning = state.store?.jobs.some((j) => typeof j.state.runningAtMs === "number");
  if (state.store && jobRunning) {
    // The tick holds the lock for the whole model call; answer from the loaded store now.
    return;
  }
  // Idle: take the lock as before, so a read still waits for a pending load or persist.
  await locked(state, async () => {
    await ensureLoaded(state);
  });
}

export async function status(state: CronServiceState) {
  await ensureLoadedForRead(state);
  return {
    enabled: state.deps.cronEnabled,
    storePath: state.deps.storePath,
    jobs: state.store?.jobs.length ?? 0,
    nextWakeAtMs: state.deps.cronEnabled ? (nextWakeAtMs(state) ?? null) : null,
  };
}

export async function list(state: CronServiceState, opts?: { includeDisabled?: boolean }) {
  await ensureLoadedForRead(state);
  const includeDisabled = opts?.includeDisabled === true;
  const jobs = (state.store?.jobs ?? []).filter((j) => includeDisabled || j.enabled);
  return jobs.toSorted((a, b) => (a.state.nextRunAtMs ?? 0) - (b.state.nextRunAtMs ?? 0));
}

export async function add(state: CronServiceState, input: CronJobCreate) {
  return await locked(state, async () => {
    warnIfDisabled(state, "add");
    await ensureLoaded(state);
    const job = createJob(state, input);
    state.store?.jobs.push(job);
    await persist(state);
    armTimer(state);
    emit(state, {
      jobId: job.id,
      action: "added",
      nextRunAtMs: job.state.nextRunAtMs,
    });
    return job;
  });
}

export async function update(state: CronServiceState, id: string, patch: CronJobPatch) {
  return await locked(state, async () => {
    warnIfDisabled(state, "update");
    await ensureLoaded(state);
    const job = findJobOrThrow(state, id);
    const now = state.deps.nowMs();
    applyJobPatch(job, patch);
    job.updatedAtMs = now;
    if (job.enabled) {
      job.state.nextRunAtMs = computeJobNextRunAtMs(job, now);
    } else {
      job.state.nextRunAtMs = undefined;
      job.state.runningAtMs = undefined;
    }

    await persist(state);
    armTimer(state);
    emit(state, {
      jobId: id,
      action: "updated",
      nextRunAtMs: job.state.nextRunAtMs,
    });
    return job;
  });
}

export async function remove(state: CronServiceState, id: string) {
  return await locked(state, async () => {
    warnIfDisabled(state, "remove");
    await ensureLoaded(state);
    const before = state.store?.jobs.length ?? 0;
    if (!state.store) {
      return { ok: false, removed: false } as const;
    }
    state.store.jobs = state.store.jobs.filter((j) => j.id !== id);
    const removed = (state.store.jobs.length ?? 0) !== before;
    await persist(state);
    armTimer(state);
    if (removed) {
      emit(state, { jobId: id, action: "removed" });
    }
    return { ok: true, removed } as const;
  });
}

export async function run(state: CronServiceState, id: string, mode?: "due" | "force") {
  return await locked(state, async () => {
    warnIfDisabled(state, "run");
    await ensureLoaded(state);
    const job = findJobOrThrow(state, id);
    const now = state.deps.nowMs();
    const due = isJobDue(job, now, { forced: mode === "force" });
    if (!due) {
      return { ok: true, ran: false, reason: "not-due" as const };
    }
    await executeJob(state, job, now, { forced: mode === "force" });
    await persist(state);
    armTimer(state);
    return { ok: true, ran: true } as const;
  });
}

export function wakeNow(
  state: CronServiceState,
  opts: { mode: "now" | "next-heartbeat"; text: string },
) {
  return wake(state, opts);
}
