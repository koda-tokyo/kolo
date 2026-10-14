import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { auditSafe } from "../audit/audit-log.js";
import { resolveStateDir } from "../config/paths.js";

/**
 * Jobs registry (KoLo 2.0, M5 item 3).
 *
 * Every agent run is a job: embedded runner turns, cron lane tasks and sibling
 * A2A turns all flow through the embedded runner, which registers a job here
 * (queued → running → terminal). The registry is in-memory with a bounded
 * history (last JOB_HISTORY_LIMIT jobs) mirrored to `<state>/run/jobs.json`.
 *
 * Surfaced via HTTP (`GET /api/jobs`, `GET /api/jobs/{id}`,
 * `POST /api/jobs/{id}/cancel`) and WS (`jobs.list`, `jobs.get`,
 * `jobs.cancel`). Terminal transitions emit to `onJobCompleted` listeners;
 * the gateway broadcasts them as `job.completed` events. Cancels write an
 * audit entry (`job.cancelled`).
 */

export const JOB_HISTORY_LIMIT = 500;

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "loop_stopped",
  "denied",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_KINDS = ["agent", "cron", "subagent", "a2a"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export type JobRecord = {
  id: string;
  agent: string;
  sessionKey: string;
  kind: JobKind | string;
  status: JobStatus;
  steps: number;
  toolCalls: number;
  /** ISO-8601 timestamp. */
  startedAt: string;
  /** ISO-8601 timestamp; set once the job reaches a terminal status. */
  endedAt?: string;
  error?: string;
  summary?: string;
  /** Parent job id for child jobs (e.g. kip_engine_task bridged work, M5b). */
  parentJobId?: string;
};

export type JobCompletion = {
  status: JobStatus;
  steps?: number;
  toolCalls?: number;
  error?: string;
  summary?: string;
};

export type CancelResult =
  | { ok: true; job: JobRecord }
  | { ok: false; reason: "not_found" | "already_finished"; job?: JobRecord };

const TERMINAL_STATUSES = new Set<JobStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "loop_stopped",
  "denied",
]);

let jobs: JobRecord[] = [];
const cancelHandles = new Map<string, () => void>();
const completionListeners = new Set<(job: JobRecord) => void>();
let loaded = false;
let saveTimer: NodeJS.Timeout | undefined;

export function resolveJobsFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "run", "jobs.json");
}

function isTerminal(job: JobRecord): boolean {
  return TERMINAL_STATUSES.has(job.status);
}

/** Error recorded on a job that was queued or running when the previous process ended. */
export const JOB_INTERRUPTED_ERROR = "interrupted: gateway restarted before the run finished";

function ensureLoaded(): void {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const raw = fs.readFileSync(resolveJobsFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      jobs = parsed
        .filter(
          (entry): entry is JobRecord =>
            Boolean(entry) &&
            typeof entry === "object" &&
            typeof (entry as JobRecord).id === "string" &&
            typeof (entry as JobRecord).status === "string",
        )
        .slice(-JOB_HISTORY_LIMIT);
    }
  } catch {
    jobs = [];
  }
  // M11: a job mirrored as queued/running belonged to a process that no longer exists. Its run
  // cannot resume, so it is reported as interrupted instead of staying "running" forever.
  let interrupted = 0;
  const endedAt = new Date().toISOString();
  jobs = jobs.map((job) => {
    if (isTerminal(job)) {
      return job;
    }
    interrupted += 1;
    return { ...job, status: "failed" as const, endedAt, error: JOB_INTERRUPTED_ERROR };
  });
  if (interrupted > 0) {
    scheduleSave();
  }
}

function scheduleSave(): void {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    try {
      const file = resolveJobsFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2), "utf8");
      fs.renameSync(tmp, file);
    } catch {
      // Mirroring is best-effort; the in-memory registry stays authoritative.
    }
  }, 250);
  saveTimer.unref?.();
}

function trimHistory(): void {
  if (jobs.length <= JOB_HISTORY_LIMIT) {
    return;
  }
  // Drop oldest terminal jobs first; never drop live ones.
  const overflow = jobs.length - JOB_HISTORY_LIMIT;
  let dropped = 0;
  jobs = jobs.filter((job) => {
    if (dropped >= overflow) {
      return true;
    }
    if (isTerminal(job)) {
      dropped += 1;
      return false;
    }
    return true;
  });
}

/** Subscribe to terminal transitions. Returns an unsubscribe function. */
export function onJobCompleted(listener: (job: JobRecord) => void): () => void {
  completionListeners.add(listener);
  return () => {
    completionListeners.delete(listener);
  };
}

export function startJob(input: {
  id?: string;
  agent: string;
  sessionKey: string;
  kind?: JobKind | string;
  parentJobId?: string;
  now?: () => Date;
}): JobRecord {
  ensureLoaded();
  const job: JobRecord = {
    id: input.id?.trim() || randomUUID(),
    agent: input.agent,
    sessionKey: input.sessionKey,
    kind: input.kind ?? "agent",
    status: "queued",
    steps: 0,
    toolCalls: 0,
    startedAt: (input.now?.() ?? new Date()).toISOString(),
    ...(input.parentJobId ? { parentJobId: input.parentJobId } : {}),
  };
  jobs.push(job);
  trimHistory();
  scheduleSave();
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  ensureLoaded();
  return jobs.find((job) => job.id === id);
}

/** Newest first, with optional agent/status filters and a limit. */
export function listJobs(filter?: {
  agent?: string;
  status?: JobStatus | string;
  limit?: number;
}): JobRecord[] {
  ensureLoaded();
  const limit = Math.max(1, Math.min(filter?.limit ?? 100, JOB_HISTORY_LIMIT));
  return jobs
    .filter((job) => {
      if (filter?.agent && job.agent !== filter.agent) {
        return false;
      }
      if (filter?.status && job.status !== filter.status) {
        return false;
      }
      return true;
    })
    .slice(-limit)
    .reverse();
}

export function markJobRunning(id: string): void {
  const job = getJob(id);
  if (!job || job.status !== "queued") {
    return;
  }
  job.status = "running";
  scheduleSave();
}

/** The newest queued/running job for a session — the parent for bridged child jobs. */
export function findActiveJobForSession(sessionKey: string): JobRecord | undefined {
  ensureLoaded();
  for (let i = jobs.length - 1; i >= 0; i--) {
    const job = jobs[i];
    if (job.sessionKey === sessionKey && !isTerminal(job)) {
      return job;
    }
  }
  return undefined;
}

/** True when the job was cancelled (e.g. while still queued) and must not run. */
export function isJobCancelled(id: string): boolean {
  return getJob(id)?.status === "cancelled";
}

export function updateJobProgress(
  id: string,
  progress: { steps?: number; toolCalls?: number },
): void {
  const job = getJob(id);
  if (!job || isTerminal(job)) {
    return;
  }
  if (typeof progress.steps === "number") {
    job.steps = progress.steps;
  }
  if (typeof progress.toolCalls === "number") {
    job.toolCalls = progress.toolCalls;
  }
}

/** Register the abort handle used by cancelJob (in-memory only). */
export function registerJobCancel(id: string, handle: () => void): void {
  cancelHandles.set(id, handle);
}

/**
 * Move a job to a terminal status. No-op when the job is already terminal
 * (e.g. cancelled via the API before the run noticed). Emits job.completed.
 */
export function completeJob(id: string, completion: JobCompletion): JobRecord | undefined {
  const job = getJob(id);
  if (!job || isTerminal(job)) {
    return job;
  }
  job.status = completion.status;
  if (typeof completion.steps === "number") {
    job.steps = completion.steps;
  }
  if (typeof completion.toolCalls === "number") {
    job.toolCalls = completion.toolCalls;
  }
  if (completion.error) {
    job.error = completion.error;
  }
  if (completion.summary) {
    job.summary = completion.summary;
  }
  job.endedAt = new Date().toISOString();
  cancelHandles.delete(id);
  trimHistory();
  scheduleSave();
  for (const listener of completionListeners) {
    try {
      listener({ ...job });
    } catch {
      // Listeners must not break the run.
    }
  }
  return job;
}

export function cancelJob(id: string, opts?: { requestedBy?: string }): CancelResult {
  const job = getJob(id);
  if (!job) {
    return { ok: false, reason: "not_found" };
  }
  if (isTerminal(job)) {
    return { ok: false, reason: "already_finished", job: { ...job } };
  }
  const previousStatus = job.status;
  const handle = cancelHandles.get(id);
  if (handle) {
    try {
      handle();
    } catch {
      // Best effort — the job is marked cancelled regardless.
    }
  }
  const cancelled = completeJob(id, {
    status: "cancelled",
    summary: `Cancelled${opts?.requestedBy ? ` by ${opts.requestedBy}` : ""} via jobs API.`,
  });
  void auditSafe({
    identity: job.agent,
    scope: job.sessionKey,
    action: "job.cancelled",
    outcome: "ok",
    source: "agents.jobs",
    detail: {
      jobId: job.id,
      agent: job.agent,
      kind: job.kind,
      previousStatus,
      requestedBy: opts?.requestedBy ?? null,
    },
  });
  return { ok: true, job: { ...(cancelled ?? job) } };
}

/** Test/reset helper: clears in-memory state (does not touch the mirror file). */
export function __resetJobsForTest(opts?: { keepLoaded?: boolean }): void {
  jobs = [];
  cancelHandles.clear();
  completionListeners.clear();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  loaded = opts?.keepLoaded ?? false;
}
