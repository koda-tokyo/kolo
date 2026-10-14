// `kip_engine_task` agent tool (KoLo 2.0, M5b): bridges the KIP headless engine's loopback
// HTTP API into an agent turn. Creates a task, streams its progress into a child job in the
// jobs registry (linked to the session's active job via parentJobId), and returns the task
// summary plus its "ready to merge" state. Merging is NEVER automatic: it requires
// merge=true AND a permission rule matching the `kip_engine_task:merge` exec target (the
// permission guard denies at dispatch otherwise). Every engine interaction is audited.
//
// Engine API (loopback):
//   POST /tasks {project, goal, profile}   → {id, status, …}
//   GET  /tasks/:id                        → {id, status, summary, …}
//   GET  /tasks/:id/events                 → SSE progress/status stream
//   POST /tasks/:id/cancel                 → {ok}
//   POST /tasks/:id/merge                  → {ok, merge?}
import { Type } from "@sinclair/typebox";
import fs from "node:fs/promises";
import type { AnyAgentTool } from "./tools/common.js";
import { auditSafe } from "../audit/audit-log.js";
import {
  completeJob,
  findActiveJobForSession,
  markJobRunning,
  startJob,
  updateJobProgress,
} from "./jobs.js";
import { parseJsonLoose, parseSseFrames } from "./kip-engine-client.js";
import { jsonResult } from "./tools/common.js";

export const KIP_ENGINE_TOOL_NAME = "kip_engine_task";

const DEFAULT_TASK_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 1_800_000;
const MAX_SSE_EVENTS = 10_000;
const MERGE_READY_STATUSES = new Set(["ready", "ready_to_merge"]);
const TERMINAL_STATUSES = new Set(["ready", "ready_to_merge", "completed", "failed", "cancelled"]);

const KipEngineTaskSchema = Type.Object({
  project: Type.String({ description: "KIP project identifier the task runs against." }),
  goal: Type.String({ description: "What the engine should accomplish." }),
  profile: Type.Optional(
    Type.String({ description: "Engine profile name. Default: the engine's default profile." }),
  ),
  merge: Type.Optional(
    Type.Boolean({
      description:
        "Merge the result once the task is ready. Requires the merge permission " +
        "(exec:kip_engine_task:merge). Default: false — the task stops at 'ready to merge'.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: MIN_TIMEOUT_MS,
      maximum: MAX_TIMEOUT_MS,
      description:
        "Cap for waiting on completion. Default: 300000 (config: kipEngine.taskTimeoutMs).",
    }),
  ),
});

export type KipEngineToolOptions = {
  /** Loopback base URL of the KIP headless engine (no trailing slash). */
  baseUrl: string;
  /** Path to a file holding the bearer token for the engine API. */
  tokenFile?: string;
  agentId?: string;
  sessionKey?: string;
  /** Config default for the wait cap (kipEngine.taskTimeoutMs). */
  defaultTimeoutMs?: number;
};

function errorResult(
  message: string,
  details: Record<string, unknown>,
): ReturnType<typeof jsonResult> {
  return {
    content: [{ type: "text", text: `kip_engine_task failed: ${message}` }],
    details: { ok: false, error: message, ...details },
  };
}

export function createKipEngineTaskTool(opts: KipEngineToolOptions): AnyAgentTool {
  const audit = (action: string, detail: Record<string, unknown>) =>
    void auditSafe({
      identity: opts.agentId ?? null,
      scope: opts.sessionKey ?? null,
      action: `kip_engine_task.${action}`,
      outcome: "ok",
      source: "agents.kip-engine-task",
      detail,
    });

  const engineFetch = async (
    path: string,
    token: string | undefined,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${opts.baseUrl}${path}`, { ...init, headers });
  };

  const tool: AnyAgentTool = {
    name: KIP_ENGINE_TOOL_NAME,
    label: "KIP Engine Task",
    description:
      "Run a task on the KIP headless engine: creates the task, streams progress, and returns " +
      "the summary and whether the result is ready to merge. Merging only happens when merge=true " +
      "and the agent holds the merge permission. Long-running: prefer a precise goal.",
    parameters: KipEngineTaskSchema,
    execute: async (_toolCallId, args, signal) => {
      const params = (args ?? {}) as {
        project?: unknown;
        goal?: unknown;
        profile?: unknown;
        merge?: unknown;
        timeoutMs?: unknown;
      };
      const project = typeof params.project === "string" ? params.project.trim() : "";
      const goal = typeof params.goal === "string" ? params.goal.trim() : "";
      const profile = typeof params.profile === "string" ? params.profile.trim() : undefined;
      const wantMerge = params.merge === true;
      if (!project || !goal) {
        return errorResult("project and goal are required", { project, goal });
      }
      const timeoutMs = Math.min(
        Math.max(
          typeof params.timeoutMs === "number"
            ? params.timeoutMs
            : (opts.defaultTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS),
          MIN_TIMEOUT_MS,
        ),
        MAX_TIMEOUT_MS,
      );

      let token: string | undefined;
      if (opts.tokenFile) {
        try {
          token = (await fs.readFile(opts.tokenFile, "utf8")).trim();
        } catch (err) {
          return errorResult(`cannot read engine token file (${String(err)})`, {});
        }
        if (!token) {
          return errorResult("engine token file is empty", {});
        }
      }

      // Child job linked to the session's active run job.
      const parent = opts.sessionKey ? findActiveJobForSession(opts.sessionKey) : undefined;
      const job = startJob({
        agent: opts.agentId ?? "main",
        sessionKey: opts.sessionKey ?? "",
        kind: "kip-engine-task",
        parentJobId: parent?.id,
      });
      markJobRunning(job.id);

      // 1. Create the task.
      let taskId: string;
      try {
        const res = await engineFetch("/tasks", token, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project, goal, ...(profile ? { profile } : {}) }),
          signal,
        });
        const body = parseJsonLoose(await res.text());
        if (!res.ok || typeof body.id !== "string") {
          const message = `engine returned ${res.status} on task creation`;
          completeJob(job.id, { status: "failed", error: message });
          return errorResult(message, { status: res.status });
        }
        taskId = body.id;
      } catch (err) {
        const message = `cannot reach the KIP engine at ${opts.baseUrl} (${String(err)})`;
        completeJob(job.id, { status: "failed", error: message });
        return errorResult(message, {});
      }
      audit("create", { project, taskId, profile: profile ?? null, mergeRequested: wantMerge });

      // 2. Stream progress until terminal status, timeout, or abort.
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const combined: AbortSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;
      let progressEvents = 0;
      let lastStatus = "queued";
      let summary: string | undefined;
      let timedOut = false;
      let aborted = false;
      try {
        const res = await engineFetch(`/tasks/${taskId}/events`, token, {
          headers: { Accept: "text/event-stream" },
          signal: combined,
        });
        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            const { frames, rest } = parseSseFrames(buffer);
            buffer = rest;
            for (const frame of frames) {
              if (progressEvents >= MAX_SSE_EVENTS) {
                break;
              }
              progressEvents += 1;
              updateJobProgress(job.id, { steps: progressEvents });
              const data = parseJsonLoose(frame.data);
              if (typeof data.status === "string") {
                lastStatus = data.status;
              }
              if (typeof data.summary === "string" && data.summary) {
                summary = data.summary;
              }
              if (TERMINAL_STATUSES.has(lastStatus)) {
                await reader.cancel().catch(() => {});
                break;
              }
            }
            if (TERMINAL_STATUSES.has(lastStatus) || progressEvents >= MAX_SSE_EVENTS) {
              break;
            }
          }
        }
      } catch (err) {
        if (timeoutController.signal.aborted && !(signal?.aborted ?? false)) {
          timedOut = true;
        } else if (signal?.aborted) {
          aborted = true;
        } else {
          // Stream broke (engine restart, network): fall through to the final state poll.
          void err;
        }
      } finally {
        clearTimeout(timer);
      }

      // 3. Abort path: cancel the engine task, close the child job, report.
      if (aborted) {
        try {
          await engineFetch(`/tasks/${taskId}/cancel`, token, { method: "POST" });
          audit("cancel", { taskId, reason: "run aborted" });
        } catch {
          // Best effort.
        }
        completeJob(job.id, {
          status: "cancelled",
          steps: progressEvents,
          summary: `Aborted while waiting on engine task ${taskId}.`,
        });
        return {
          content: [
            { type: "text", text: `kip_engine_task aborted; engine task ${taskId} cancelled.` },
          ],
          details: { ok: false, aborted: true, taskId },
        };
      }

      // 4. Final state poll (source of truth for status/summary).
      let finalState: Record<string, unknown> = {};
      try {
        const res = await engineFetch(`/tasks/${taskId}`, token, { signal });
        if (res.ok) {
          finalState = parseJsonLoose(await res.text());
        }
      } catch {
        // Keep the streamed state.
      }
      const status = typeof finalState.status === "string" ? finalState.status : lastStatus;
      if (typeof finalState.summary === "string" && finalState.summary) {
        summary = finalState.summary;
      }
      const mergeReady = MERGE_READY_STATUSES.has(status);
      const failed = status === "failed" || status === "cancelled";

      // 5. Merge only on explicit request AND readiness. (The permission guard already
      //    denied merge=true at dispatch without the merge rule; this is the second gate.)
      let merged: Record<string, unknown> | undefined;
      if (wantMerge && mergeReady && !timedOut) {
        try {
          const res = await engineFetch(`/tasks/${taskId}/merge`, token, { method: "POST" });
          const body = parseJsonLoose(await res.text());
          merged = { ok: res.ok, status: res.status, ...body };
          audit("merge", { taskId, ok: res.ok });
        } catch (err) {
          merged = { ok: false, error: String(err) };
        }
      }

      completeJob(job.id, {
        status: failed ? "failed" : "succeeded",
        steps: progressEvents,
        summary: summary ?? `Engine task ${taskId} finished with status "${status}".`,
        ...(failed && typeof finalState.error === "string" ? { error: finalState.error } : {}),
      });

      return jsonResult({
        ok: !failed,
        taskId,
        status,
        mergeReady,
        ...(merged ? { merged } : {}),
        ...(summary ? { summary } : {}),
        progressEvents,
        ...(timedOut ? { timedOut: true } : {}),
        jobId: job.id,
        ...(parent ? { parentJobId: parent.id } : {}),
      });
    },
  };
  return tool;
}
