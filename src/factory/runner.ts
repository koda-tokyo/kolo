// Factory runner (KoLo 2.0, M15b): one engine run per card. Creates a KIP engine task for the
// card's goal, follows its event stream into the card timeline and into a job's evidence log,
// moves the card through the columns as the engine reports progress, and on "ready to merge"
// opens a pull request (factory.github) or records the ready branch. Merging is never automatic:
// it needs the card's autoMerge policy AND the merge permission (exec:kip_engine_task:merge held
// by the owner resident, or an owner/admin caller who asked for it).
//
// Each run is a job (kind "factory") in the jobs registry, so `kolo api cancelJob` and the
// evidence routes work for it like for any agent run.
import type { KoLoConfig } from "../config/config.js";
import type { CommandRunner } from "./pull-request.js";
import type { FactoryCard, FactoryColumn } from "./types.js";
import {
  completeJob,
  markJobRunning,
  registerJobCancel,
  startJob,
  updateJobProgress,
} from "../agents/jobs.js";
import {
  createKipEngineClient,
  type EngineStreamEvent,
  type KipEngineClient,
  KipEngineTokenError,
  unwrapTask,
} from "../agents/kip-engine-client.js";
import { checkToolPermission, resolveToolPermissions } from "../agents/permissions.js";
import { auditSafe } from "../audit/audit-log.js";
import { type EvidenceRecorder, finishEvidence, startEvidence } from "../evidence/recorder.js";
import { boundedText, boundedValue } from "../evidence/redact.js";
import { openPullRequest } from "./pull-request.js";
import { columnForEngineStatus, pathTo } from "./state.js";
import { annotateCard, getCard, isCardTerminal, moveCard } from "./store.js";

const ENGINE_TERMINAL = new Set([
  "ready",
  "ready_to_merge",
  "completed",
  "merged",
  "failed",
  "cancelled",
]);
const MERGE_READY = new Set(["ready", "ready_to_merge", "completed"]);
const DEFAULT_RUN_TIMEOUT_MS = 1_800_000;
const MAX_STREAM_EVENTS = 10_000;
const TIMELINE_DATA_BYTES = 2048;

export type FactoryRunnerOptions = {
  /** Live config: kipEngine, factory and evidence sections are read per run. */
  getConfig: () => KoLoConfig;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  /** Command runner for `git push` and `gh pr create` (tests inject a fake). */
  exec?: CommandRunner;
  gatewayVersion?: string;
  /** Wall-clock cap per run (default 30 minutes; kipEngine.taskTimeoutMs overrides). */
  runTimeoutMs?: number;
};

export type RunCardOptions = {
  /** Identity for the timeline and audit: a resident id, "owner:…" or "device:…". */
  requestedBy: string;
  /**
   * Whether the caller holds the merge permission. Undefined: derived from the owner resident's
   * permission rules (`exec:kip_engine_task:merge`). An attach credential never gets it.
   */
  mergeAllowed?: boolean;
  /** Engine profile override. */
  profile?: string;
};

export type RunCardResult =
  | { ok: true; jobId: string; card: FactoryCard }
  | {
      ok: false;
      code: "not_found" | "not_configured" | "running" | "terminal" | "column";
      error: string;
    };

export type CancelCardResult =
  | { ok: true; jobId: string }
  | { ok: false; code: "not_found" | "not_running"; error: string };

type ActiveRun = { jobId: string; controller: AbortController; done: Promise<void> };

/** One line of timeline text for an engine event. */
export function describeEngineEvent(ev: EngineStreamEvent): string {
  const d =
    ev.payload.data && typeof ev.payload.data === "object"
      ? (ev.payload.data as Record<string, unknown>)
      : ev.payload;
  const str = (key: string) => {
    const value = d[key];
    return typeof value === "string" ? value : "";
  };
  switch (ev.type) {
    case "status":
      return `status ${str("status") || ev.status || "?"}${str("phase") ? ` (${str("phase")})` : ""}${str("error") ? `: ${str("error")}` : ""}`;
    case "phase":
      return `${str("phase") || "phase"}${str("message") ? `: ${str("message")}` : ""}`;
    case "log":
      return str("message") || "log";
    case "tool":
      return `tool ${str("toolName") || "?"}${d.isError ? " failed" : ""}${typeof d.durationMs === "number" ? ` (${d.durationMs} ms)` : ""}`;
    case "progress":
      return `${str("stage") || "progress"}${typeof d.percent === "number" ? ` ${d.percent}%` : ""}${str("message") ? `: ${str("message")}` : ""}`;
    case "error":
      return `error: ${str("message") || "unknown"}`;
    case "done":
      return `done: ${str("status") || ev.status || "?"}${str("error") ? ` (${str("error")})` : ""}`;
    default:
      return ev.summary ? `${ev.type}: ${ev.summary}` : ev.type;
  }
}

function engineConfig(config: KoLoConfig): { baseUrl: string; tokenFile?: string } | null {
  const cfg = config.kipEngine;
  const baseUrl = cfg?.baseUrl?.trim();
  if (!cfg?.enabled || !baseUrl) {
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), tokenFile: cfg.tokenFile };
}

/** Whether the owner resident's permission rules allow `kip_engine_task` with merge=true. */
export function ownerHoldsMergePermission(card: FactoryCard, config: KoLoConfig): boolean {
  const set = resolveToolPermissions({
    entry: config.agents?.list?.find((entry) => entry.id === card.owner)?.permissions,
    defaults: config.agents?.defaults?.permissions,
    workspaceDir: card.repo,
  });
  if (!set.active) {
    // No rules configured: the guard is inert for tools, but a merge is a destructive action
    // and stays off until an operator writes the rule.
    return false;
  }
  return checkToolPermission({
    toolName: "kip_engine_task",
    args: { merge: true },
    permissionSet: set,
    workspaceDir: card.repo,
  }).ok;
}

export class FactoryRunner {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly opts: FactoryRunnerOptions;

  constructor(opts: FactoryRunnerOptions) {
    this.opts = opts;
  }

  isRunning(cardId: string): boolean {
    return this.runs.has(cardId);
  }

  activeJobId(cardId: string): string | undefined {
    return this.runs.get(cardId)?.jobId;
  }

  /** Resolves when the card's current run has ended (tests, graceful close). */
  async wait(cardId: string): Promise<void> {
    await this.runs.get(cardId)?.done;
  }

  /** Start a run. Returns synchronously with the job id; the run continues in the background. */
  start(cardId: string, opts: RunCardOptions): RunCardResult {
    const card = getCard(cardId);
    if (!card) {
      return { ok: false, code: "not_found", error: `card not found: ${cardId}` };
    }
    if (this.runs.has(cardId)) {
      return { ok: false, code: "running", error: `card ${cardId} already has a run in progress` };
    }
    if (isCardTerminal(card)) {
      return { ok: false, code: "terminal", error: `card ${cardId} is ${card.column}` };
    }
    if (card.column !== "inbox" && card.column !== "failed") {
      return {
        ok: false,
        code: "column",
        error: `card ${cardId} is in ${card.column}; runs start from inbox or failed`,
      };
    }
    const config = this.opts.getConfig();
    const engine = engineConfig(config);
    if (!engine) {
      return {
        ok: false,
        code: "not_configured",
        error: "the KIP engine is not configured (kipEngine.enabled and kipEngine.baseUrl)",
      };
    }
    if (card.column === "failed") {
      moveCard(card.id, "inbox", { by: opts.requestedBy, reason: "retry" });
    }
    const job = startJob({
      agent: card.owner,
      sessionKey: `factory:${card.boardId}:${card.id}`,
      kind: "factory",
    });
    markJobRunning(job.id);
    const controller = new AbortController();
    registerJobCancel(job.id, () => controller.abort());
    const recorder = startEvidence(job, {
      config,
      gatewayVersion: this.opts.gatewayVersion,
      env: this.opts.env,
    });
    recorder?.start({ prompt: card.goal, runId: card.id, workspaceDir: card.repo });
    annotateCard(card.id, {
      kind: "run",
      by: opts.requestedBy,
      text: `Run started by ${opts.requestedBy} (job ${job.id}).`,
      data: { jobId: job.id },
      patch: {
        runningJobId: job.id,
        addJobId: job.id,
        ...(recorder ? { addEvidenceId: job.id } : {}),
        error: null,
      },
    });
    void auditSafe({
      identity: opts.requestedBy,
      scope: `factory:${card.boardId}`,
      action: "factory.card.run",
      outcome: "ok",
      source: "factory.runner",
      detail: { cardId: card.id, jobId: job.id, owner: card.owner, repo: card.repo },
    });
    const client = createKipEngineClient({ ...engine, fetchImpl: this.opts.fetchImpl });
    const mergeAllowed = opts.mergeAllowed ?? ownerHoldsMergePermission(card, config);
    const done = this.execute({
      cardId: card.id,
      jobId: job.id,
      client,
      recorder,
      controller,
      config,
      requestedBy: opts.requestedBy,
      mergeAllowed,
      profile: opts.profile,
    }).finally(() => {
      this.runs.delete(card.id);
    });
    this.runs.set(card.id, { jobId: job.id, controller, done });
    return { ok: true, jobId: job.id, card: getCard(card.id) ?? card };
  }

  cancel(cardId: string, by: string): CancelCardResult {
    const run = this.runs.get(cardId);
    if (!getCard(cardId)) {
      return { ok: false, code: "not_found", error: `card not found: ${cardId}` };
    }
    if (!run) {
      return { ok: false, code: "not_running", error: `card ${cardId} has no run in progress` };
    }
    annotateCard(cardId, { kind: "run", by, text: `Cancel requested by ${by}.` });
    run.controller.abort();
    return { ok: true, jobId: run.jobId };
  }

  /** Cancel every run (gateway shutdown). */
  async close(): Promise<void> {
    for (const [cardId, run] of this.runs) {
      run.controller.abort();
      await run.done.catch(() => {});
      this.runs.delete(cardId);
    }
  }

  private async execute(ctx: {
    cardId: string;
    jobId: string;
    client: KipEngineClient;
    recorder: EvidenceRecorder | null;
    controller: AbortController;
    config: KoLoConfig;
    requestedBy: string;
    mergeAllowed: boolean;
    profile?: string;
  }): Promise<void> {
    const { cardId, jobId, client, recorder, controller } = ctx;
    const timeoutMs =
      ctx.config.kipEngine?.taskTimeoutMs ?? this.opts.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    let steps = 0;
    let taskId = "";
    let lastStatus = "";
    let summary: string | undefined;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();

    const fail = (error: string) => {
      const card = getCard(cardId);
      if (card && card.column !== "failed" && !isCardTerminal(card)) {
        moveCard(cardId, "failed", { by: "runner", reason: error });
      }
      annotateCard(cardId, { kind: "error", by: "runner", text: error, patch: { error } });
    };

    const follow = (target: FactoryColumn | null) => {
      const card = getCard(cardId);
      if (!card || !target || card.column === target) {
        return;
      }
      for (const step of pathTo(card.column, target)) {
        moveCard(cardId, step, { by: "engine", reason: `engine status ${lastStatus}` });
      }
    };

    try {
      const card = getCard(cardId);
      if (!card) {
        return;
      }
      // 1. Create the task (the engine starts it with run:true; older engines start on create).
      let created: Awaited<ReturnType<KipEngineClient["createTask"]>>;
      try {
        created = await client.createTask(
          {
            project: card.repo,
            projectPath: card.repo,
            goal: card.goal,
            title: card.title,
            run: true,
            ...(ctx.profile ? { profile: ctx.profile } : {}),
          },
          controller.signal,
        );
      } catch (err) {
        const message =
          err instanceof KipEngineTokenError
            ? err.message
            : `cannot reach the KIP engine at ${client.baseUrl} (${String(err)})`;
        fail(message);
        completeJob(jobId, { status: "failed", error: message });
        return;
      }
      const task = unwrapTask(created.body);
      if (!created.ok || typeof task.id !== "string") {
        const message = `engine returned ${created.status} on task creation`;
        fail(message);
        completeJob(jobId, { status: "failed", error: message });
        return;
      }
      taskId = task.id;
      lastStatus = typeof task.status === "string" ? task.status : "created";
      recorder?.toolStart({
        toolCallId: taskId,
        name: "kip_engine_task",
        args: { project: card.repo, goal: card.goal, taskId },
      });
      annotateCard(cardId, {
        kind: "engine",
        by: "engine",
        text: `Engine task ${taskId} created (status ${lastStatus}).`,
        data: { taskId, status: lastStatus },
        patch: {
          engineTaskId: taskId,
          ...(typeof task.branch === "string" ? { branch: task.branch } : {}),
        },
      });
      void auditSafe({
        identity: card.owner,
        scope: `factory:${card.boardId}`,
        action: "factory.engine.create",
        outcome: "ok",
        source: "factory.runner",
        detail: { cardId, jobId, taskId },
      });
      if (lastStatus === "created") {
        const run = await client.runTask(taskId, controller.signal);
        if (!run.ok) {
          const message = `engine returned ${run.status} on task run`;
          fail(message);
          completeJob(jobId, { status: "failed", error: message });
          return;
        }
        lastStatus =
          typeof unwrapTask(run.body).status === "string"
            ? String(unwrapTask(run.body).status)
            : lastStatus;
      }
      follow(columnForEngineStatus(lastStatus));

      // 2. Follow the stream; every event lands in the timeline and the evidence log.
      try {
        const streamed = await client.streamEvents(taskId, {
          signal: controller.signal,
          maxEvents: MAX_STREAM_EVENTS,
          isTerminal: (status) => ENGINE_TERMINAL.has(status),
          onEvent: (ev) => {
            steps += 1;
            updateJobProgress(jobId, { steps });
            if (ev.summary) {
              summary = ev.summary;
            }
            const bounded = boundedValue(ev.payload, TIMELINE_DATA_BYTES);
            if (ev.type !== "text") {
              annotateCard(cardId, {
                kind: "engine",
                by: "engine",
                text: describeEngineEvent(ev),
                data: {
                  type: ev.type,
                  seq: ev.seq ?? null,
                  payload: bounded.value,
                  clipped: bounded.clipped,
                },
              });
            }
            recorder?.append("tool.result", {
              toolCallId: taskId,
              name: "kip_engine_task",
              isError: ev.type === "error",
              engineEvent: ev.type,
              seq: ev.seq ?? null,
              status: ev.status ?? null,
              payload: boundedValue(ev.payload, recorder.limits.maxEventBytes).value,
            });
            if (ev.status && ev.status !== lastStatus) {
              lastStatus = ev.status;
              follow(columnForEngineStatus(lastStatus));
            }
          },
        });
        if (streamed.status) {
          lastStatus = streamed.status;
        }
        summary = streamed.summary ?? summary;
      } catch (err) {
        if (!controller.signal.aborted) {
          // Stream broke (engine restart): the final poll below is the source of truth.
          annotateCard(cardId, {
            kind: "engine",
            by: "runner",
            text: `Event stream ended early (${String(err)}); polling the task.`,
          });
        }
      }

      // 3. Abort: cancel the engine task and fail the card.
      if (controller.signal.aborted) {
        try {
          await client.cancelTask(taskId);
        } catch {
          // Best effort.
        }
        const reason = timedOut ? `run timed out after ${timeoutMs} ms` : "run cancelled";
        fail(reason);
        completeJob(jobId, { status: "cancelled", steps, summary: reason });
        return;
      }

      // 4. Final state.
      try {
        const final = await client.getTask(taskId);
        if (final.ok) {
          const t = unwrapTask(final.body);
          if (typeof t.status === "string") {
            lastStatus = t.status;
          }
          if (typeof t.summary === "string" && t.summary) {
            summary = t.summary;
          }
          if (typeof t.branch === "string" && t.branch) {
            annotateCard(cardId, {
              kind: "engine",
              by: "engine",
              text: `Branch ${t.branch}.`,
              patch: { branch: t.branch },
            });
          }
          if (
            typeof t.error === "string" &&
            t.error &&
            (lastStatus === "failed" || lastStatus === "cancelled")
          ) {
            summary = summary ?? t.error;
          }
        }
      } catch {
        // Keep the streamed state.
      }
      follow(columnForEngineStatus(lastStatus));

      if (lastStatus === "failed" || lastStatus === "cancelled") {
        const message = summary ?? `engine task ${taskId} ${lastStatus}`;
        fail(message);
        completeJob(jobId, { status: "failed", steps, error: message });
        return;
      }
      if (!MERGE_READY.has(lastStatus) && lastStatus !== "merged") {
        const message = `engine task ${taskId} ended with status "${lastStatus}"`;
        fail(message);
        completeJob(jobId, { status: "failed", steps, error: message });
        return;
      }

      // 5. Ready: pull request or ready branch, then the merge gate.
      const ready = getCard(cardId);
      if (!ready) {
        return;
      }
      if (MERGE_READY.has(lastStatus)) {
        await this.onReady(ready, ctx, taskId, summary);
      }
      const after = getCard(cardId);
      completeJob(jobId, {
        status: "succeeded",
        steps,
        summary:
          summary ??
          (after?.pr ? `Pull request ${after.pr.url}` : `Engine task ${taskId} is ready to merge.`),
      });
    } catch (err) {
      const message = `run failed: ${String(err)}`;
      fail(message);
      completeJob(jobId, { status: "failed", steps, error: message });
    } finally {
      clearTimeout(timer);
      const card = getCard(cardId);
      annotateCard(cardId, {
        kind: "job",
        by: "runner",
        text: `Job ${jobId} ended (${card?.column ?? "?"}).`,
        patch: { runningJobId: null, ...(summary ? { summary } : {}) },
      });
      const job = completeJob(jobId, { status: "failed", error: "run ended without a result" });
      finishEvidence(jobId, {
        status: job?.status ?? "failed",
        steps: job?.steps ?? steps,
        toolCalls: job?.toolCalls ?? 0,
        endedAt: job?.endedAt,
        error: job?.error,
        summary: job?.summary,
      });
    }
  }

  private async onReady(
    card: FactoryCard,
    ctx: {
      config: KoLoConfig;
      client: KipEngineClient;
      mergeAllowed: boolean;
      requestedBy: string;
    },
    taskId: string,
    summary: string | undefined,
  ): Promise<void> {
    const github = ctx.config.factory?.github;
    const branch = card.branch;
    if (github?.enabled && branch) {
      const result = await openPullRequest({
        repo: card.repo,
        branch,
        base: github.base,
        remote: github.remote?.trim() || "origin",
        title: card.title,
        body: `${card.goal}\n\nFactory card ${card.id} · engine task ${taskId}${summary ? `\n\n${boundedText(summary, 4000).text}` : ""}`,
        draft: github.draft,
        exec: this.opts.exec,
      });
      if (result.ok) {
        annotateCard(card.id, {
          kind: "pr",
          by: "runner",
          text: `Pull request opened: ${result.url}`,
          data: { url: result.url, number: result.number ?? null },
          patch: {
            pr: {
              url: result.url,
              number: result.number,
              branch,
              base: github.base,
              openedAt: new Date().toISOString(),
            },
          },
        });
        void auditSafe({
          identity: card.owner,
          scope: `factory:${card.boardId}`,
          action: "factory.pr.opened",
          outcome: "ok",
          source: "factory.runner",
          detail: { cardId: card.id, url: result.url, branch },
        });
      } else {
        annotateCard(card.id, {
          kind: "error",
          by: "runner",
          text: `Pull request not opened: ${result.error}. Branch ${branch} is ready in the repository.`,
        });
      }
    } else {
      annotateCard(card.id, {
        kind: "pr",
        by: "runner",
        text: branch
          ? `Ready branch ${branch} left in the repository (factory.github is off).`
          : "Engine reports ready to merge; no branch name was reported.",
      });
    }
    if (!card.policy.autoMerge) {
      return;
    }
    if (!ctx.mergeAllowed) {
      annotateCard(card.id, {
        kind: "merge",
        by: "runner",
        text: "Auto-merge skipped: the merge permission (exec:kip_engine_task:merge) is not held.",
      });
      void auditSafe({
        identity: ctx.requestedBy,
        scope: `factory:${card.boardId}`,
        action: "factory.merge.denied",
        outcome: "denied",
        source: "factory.runner",
        detail: { cardId: card.id, taskId },
      });
      return;
    }
    const merged = await ctx.client.mergeTask(taskId, { commit: true });
    void auditSafe({
      identity: ctx.requestedBy,
      scope: `factory:${card.boardId}`,
      action: "factory.merge",
      outcome: merged.ok ? "ok" : "error",
      source: "factory.runner",
      detail: { cardId: card.id, taskId, status: merged.status },
    });
    if (merged.ok) {
      annotateCard(card.id, {
        kind: "merge",
        by: "runner",
        text: "Merged through the engine.",
        data: boundedValue(merged.body, TIMELINE_DATA_BYTES).value as Record<string, unknown>,
      });
      const current = getCard(card.id);
      if (current && current.column === "ready") {
        moveCard(card.id, "merged", { by: ctx.requestedBy, reason: "auto-merge" });
      }
    } else {
      annotateCard(card.id, {
        kind: "error",
        by: "runner",
        text: `Merge failed (engine returned ${merged.status}); the card stays ready.`,
      });
    }
  }
}
