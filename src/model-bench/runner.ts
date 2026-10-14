// Bench runner: every selected task for every target model, each task in its own throwaway
// resident workspace. Tokens are metered with the policy budget meters (per model = agent scope,
// all models = fleet scope, action stop); when a cap is reached the model stops and its
// remaining tasks are marked not run. Every model run is recorded as an evidence job (M12) and
// exported as a signed bundle; the whole run produces one signed report.
import type { Message } from "@mariozechner/pi-ai";
import fs from "node:fs";
import path from "node:path";
import type { SigningKey } from "../continuity-suite/manifest.js";
import type { BudgetLimits } from "../policy/schema.js";
import type { BenchModelClient } from "./client.js";
import type { BenchSubset } from "./suite.js";
import { newIdentityMarker } from "../continuity-suite/seed.js";
import { exportEvidenceBundle } from "../evidence/bundle.js";
import { EvidenceRecorder } from "../evidence/recorder.js";
import { BudgetMeters } from "../policy/budgets.js";
import { runBenchSession } from "./loop.js";
import { buildBenchReport, writeBenchReport } from "./report.js";
import { costOf, scoreModel, statusOf } from "./scoring.js";
import { benchSuite, selectTasks } from "./suite.js";
import { buildBenchTools } from "./tools.js";
import {
  type BenchReport,
  type BenchTask,
  type CheckContext,
  type ModelBenchResult,
  type ModelPrice,
  type SessionTrace,
  type TaskContext,
  type TaskResult,
  type ToolCallTrace,
} from "./types.js";
import { buildBenchSystemPrompt, runNodeTest, seedBenchWorkspace } from "./workspace.js";

export const DEFAULT_MODEL_TOKEN_CAP = 300_000;

export type BenchTarget = {
  client: BenchModelClient;
  price: ModelPrice | null;
  subset: BenchSubset;
};

export type BenchProgress =
  | { type: "model.start"; model: string; tasks: number }
  | { type: "task.end"; model: string; task: string; status: string; score: number; tokens: number }
  | { type: "model.stop"; model: string; reason: string }
  | { type: "model.end"; model: string; overall: number | null; tokens: number };

export type RunBenchOptions = {
  targets: BenchTarget[];
  /** The full suite (coverage is measured against it); default `benchSuite()`. */
  suite?: BenchTask[];
  only?: string[];
  perModelTokens?: number;
  globalTokens?: number;
  /** Task workspaces are created under this directory. */
  workRoot: string;
  /** Report and exported evidence bundles. */
  outDir: string;
  key: SigningKey;
  env?: NodeJS.ProcessEnv;
  agentId?: string;
  evidence?: boolean;
  now?: () => Date;
  onProgress?: (event: BenchProgress) => void;
};

export function slugOf(ref: string): string {
  return (
    ref
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "model"
  );
}

function notRun(task: BenchTask, reason: string): TaskResult {
  return {
    id: task.id,
    axis: task.axis,
    status: "not_run",
    score: 0,
    detail: "",
    reason,
    latencyMs: 0,
    turns: 0,
    tokens: { input: 0, output: 0, total: 0 },
    cost: 0,
    toolCalls: 0,
  };
}

type ModelRunState = {
  meters: BudgetMeters;
  agentKey: string;
  modelLimits: BudgetLimits;
  fleetLimits: BudgetLimits;
};

function capReason(state: ModelRunState): string | null {
  const agent = state.meters.breaches({
    agent: state.agentKey,
    limits: state.modelLimits,
    scope: "agent",
  });
  if (agent.length > 0) {
    return `model token cap reached (${agent[0].used}/${agent[0].limit})`;
  }
  const fleet = state.meters.breaches({ limits: state.fleetLimits, scope: "fleet" });
  if (fleet.length > 0) {
    return `global token cap reached (${fleet[0].used}/${fleet[0].limit})`;
  }
  return null;
}

async function runTask(params: {
  task: BenchTask;
  target: BenchTarget;
  state: ModelRunState;
  workspaceDir: string;
  agentId: string;
  recorder: EvidenceRecorder | null;
}): Promise<{ result: TaskResult; stopped?: string }> {
  const { task, target, recorder } = params;
  const ctx: TaskContext = {
    workspaceDir: params.workspaceDir,
    agentId: params.agentId,
    marker: newIdentityMarker(),
  };
  fs.rmSync(ctx.workspaceDir, { recursive: true, force: true });
  seedBenchWorkspace(ctx);
  task.setup?.(ctx);
  const systemPrompt = buildBenchSystemPrompt(ctx, task.policy);
  const sessions = typeof task.sessions === "function" ? task.sessions(ctx) : task.sessions;
  const tokens = { input: 0, output: 0, total: 0 };
  let latencyMs = 0;
  let turns = 0;
  let toolCalls = 0;
  let stopped: string | undefined;
  const traces: SessionTrace[] = [];
  let transcript: Message[] = [];
  for (const session of sessions) {
    const calls: ToolCallTrace[] = [];
    const innerCalls: ToolCallTrace[] = [];
    const tools = buildBenchTools({
      kits: task.kits,
      workspaceDir: ctx.workspaceDir,
      agentId: ctx.agentId,
      policy: task.policy,
      fetchContent: task.fetchContent,
      sink: {
        onCall: ({ inCodeMode, ...trace }) => {
          (inCodeMode ? innerCalls : calls).push(trace);
          if (trace.decision !== "allow") {
            recorder?.append("permission", {
              tool: trace.name,
              decision: trace.decision,
              class: null,
              target: null,
              rule: trace.ruleId,
              reason: `bench task ${task.id}`,
              auditSeq: null,
            });
          }
        },
      },
    });
    const prior = session.continueTranscript ? transcript : [];
    const run = await runBenchSession({
      client: target.client,
      systemPrompt,
      tools,
      messages: [...prior, ...(session.history ?? [])],
      prompt: session.prompt,
      maxTurns: task.maxTurns ?? 6,
      calls,
      hooks: {
        onTurn: (message, usage) => {
          tokens.input += usage.input;
          tokens.output += usage.output;
          tokens.total += usage.total;
          params.state.meters.record(params.state.agentKey, {
            tokens: usage.total,
            cost: costOf(usage, target.price),
          });
          recorder?.modelTurn({
            provider: target.client.provider,
            model: target.client.model,
            profileId: task.id,
            usage: { input: usage.input, output: usage.output, total: usage.total },
            stopReason: message.stopReason,
            text: message.content
              .map((c) => (c.type === "text" ? c.text : ""))
              .join("")
              .slice(0, 2000),
            errorMessage: message.errorMessage,
          });
        },
        onToolStart: (id, name, args) => {
          toolCalls += 1;
          recorder?.toolStart({ toolCallId: `${task.id}:${id}`, name, args });
        },
        onToolEnd: (id, name, result, isError) =>
          recorder?.toolEnd({
            toolCallId: `${task.id}:${id}`,
            name,
            result: { content: [{ type: "text", text: result }] },
            isError,
          }),
        shouldStop: () => capReason(params.state),
      },
    });
    run.trace.innerCalls = innerCalls;
    traces.push(run.trace);
    transcript = run.messages;
    latencyMs += run.latencyMs;
    turns += run.trace.turns;
    if (run.stopped) {
      stopped = run.stopped;
      break;
    }
  }
  const base = {
    id: task.id,
    axis: task.axis,
    latencyMs,
    turns,
    tokens,
    cost: costOf(tokens, target.price),
    toolCalls,
  };
  if (stopped) {
    return {
      result: { ...base, status: "not_run", score: 0, detail: "", reason: stopped },
      stopped,
    };
  }
  const failed = traces.find((t) => t.error && !t.finalText && t.toolCalls.length === 0);
  if (failed) {
    return {
      result: {
        ...base,
        status: "error",
        score: 0,
        detail: `model error: ${String(failed.error).slice(0, 300)}`,
      },
    };
  }
  const checkCtx: CheckContext = {
    ...ctx,
    sessions: traces,
    runNodeTest: (rel) => runNodeTest(ctx.workspaceDir, rel),
  };
  let score = 0;
  let detail = "";
  try {
    const check = await task.check(checkCtx);
    score = Math.min(1, Math.max(0, check.score));
    detail = check.detail;
  } catch (err) {
    detail = `check failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  return { result: { ...base, status: statusOf(score), score, detail } };
}

function summarizeModel(params: {
  target: BenchTarget;
  tasks: TaskResult[];
  suiteSize: number;
  stopReason?: string;
  stoppedAt?: string;
  startedAt: string;
  endedAt: string;
  perModelTokens: number;
  evidence: ModelBenchResult["evidence"];
}): ModelBenchResult {
  const { target, tasks } = params;
  const usage = tasks.reduce(
    (acc, t) => ({
      input: acc.input + t.tokens.input,
      output: acc.output + t.tokens.output,
      total: acc.total + t.tokens.total,
      cost: acc.cost + t.cost,
    }),
    { input: 0, output: 0, total: 0, cost: 0 },
  );
  const scored = scoreModel({ tasks, suiteSize: params.suiteSize, price: target.price });
  const errors = tasks.filter((t) => t.status === "error").length;
  const ran = tasks.filter((t) => t.status !== "not_run").length;
  const status: ModelBenchResult["status"] = params.stopReason
    ? "budget_stopped"
    : ran > 0 && errors === ran
      ? "error"
      : ran < params.suiteSize
        ? "partial"
        : "complete";
  return {
    provider: target.client.provider,
    model: target.client.model,
    status,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    subset: target.subset,
    tasks,
    axes: scored.axes,
    overall: scored.overall,
    coverage: scored.coverage,
    usage: {
      ...usage,
      cost: Math.round(usage.cost * 1_000_000) / 1_000_000,
      currency: target.price?.currency ?? null,
    },
    latency: scored.latency,
    costPerResidentHour: scored.costPerResidentHour,
    budget: {
      tokenCap: params.perModelTokens,
      ...(params.stoppedAt ? { stoppedAt: params.stoppedAt } : {}),
    },
    evidence: params.evidence,
    ...(status === "error" ? { error: tasks.find((t) => t.status === "error")?.detail } : {}),
  };
}

export async function runModelBench(opts: RunBenchOptions): Promise<BenchReport> {
  const now = opts.now ?? (() => new Date());
  const runStart = now();
  const stamp = runStart
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const perModelTokens = opts.perModelTokens ?? DEFAULT_MODEL_TOKEN_CAP;
  const globalTokens = opts.globalTokens ?? perModelTokens * Math.max(1, opts.targets.length);
  const suite = opts.suite ?? benchSuite();
  const agentId = opts.agentId ?? "alice";
  const env = opts.env ?? process.env;
  // The day window is pinned to the run start so a run that crosses the reset hour keeps one window.
  const meters = new BudgetMeters(null, { now: () => runStart });
  const results: ModelBenchResult[] = [];
  const createdAt = () => now().toISOString();
  /**
   * After every task, rewrite a signed report with what is done so far, so a run that is
   * interrupted (a killed process, a lost terminal) keeps its finished tasks; the remaining
   * ones read "not reached". The final report replaces it.
   */
  const checkpoint = (
    target: BenchTarget,
    startedAt: string,
    done: TaskResult[],
    stopReason: string | undefined,
    stoppedAt: string | undefined,
  ) => {
    const seen = new Set(done.map((t) => t.id));
    const padded = [
      ...done,
      ...suite
        .filter((t) => !seen.has(t.id))
        .map((t) => notRun(t, "not reached (run interrupted)")),
    ];
    const current = summarizeModel({
      target,
      tasks: padded,
      suiteSize: suite.length,
      stopReason,
      stoppedAt,
      startedAt,
      endedAt: createdAt(),
      perModelTokens,
      evidence: [],
    });
    writeBenchReport(
      opts.outDir,
      buildBenchReport({
        models: [...results, current],
        suiteTasks: suite.length,
        perModelTokens,
        globalTokens,
        createdAt: createdAt(),
        key: opts.key,
      }),
    );
  };

  for (const target of opts.targets) {
    const ref = `${target.client.provider}/${target.client.model}`;
    const slug = slugOf(ref);
    const tasks = selectTasks({ subset: target.subset, only: opts.only, tasks: suite });
    const startedAt = now().toISOString();
    const state: ModelRunState = {
      meters,
      agentKey: ref,
      modelLimits: { tokensPerDay: perModelTokens, onBreach: "stop" },
      fleetLimits: { tokensPerDay: globalTokens, onBreach: "stop" },
    };
    const jobId = `bench-${stamp}-${slug}`.slice(0, 128);
    const recorder =
      opts.evidence === false
        ? null
        : new EvidenceRecorder(
            { id: jobId, agent: agentId, sessionKey: `bench:${ref}`, kind: "bench", startedAt },
            { env, key: opts.key },
          );
    recorder?.start({
      prompt: `model bench ${tasks.map((t) => t.id).join(",")}`,
      provider: target.client.provider,
      model: target.client.model,
      runId: `bench-${stamp}`,
    });
    opts.onProgress?.({ type: "model.start", model: ref, tasks: tasks.length });
    const taskResults: TaskResult[] = [];
    let stoppedAt: string | undefined;
    let stopReason: string | undefined;
    const selected = new Set(tasks.map((t) => t.id));
    for (const task of suite) {
      if (!selected.has(task.id)) {
        taskResults.push(
          notRun(
            task,
            target.subset === "quick" && !task.quick ? "not in the quick subset" : "not selected",
          ),
        );
        continue;
      }
      if (stopReason) {
        taskResults.push(notRun(task, stopReason));
        continue;
      }
      const pre = capReason(state);
      if (pre) {
        stopReason = pre;
        stoppedAt = task.id;
        opts.onProgress?.({ type: "model.stop", model: ref, reason: pre });
        taskResults.push(notRun(task, pre));
        continue;
      }
      const { result, stopped } = await runTask({
        task,
        target,
        state,
        workspaceDir: path.join(opts.workRoot, slug, task.id),
        agentId,
        recorder,
      });
      taskResults.push(result);
      checkpoint(
        target,
        startedAt,
        taskResults,
        stopReason ?? stopped,
        stoppedAt ?? (stopped ? task.id : undefined),
      );
      opts.onProgress?.({
        type: "task.end",
        model: ref,
        task: task.id,
        status: result.status,
        score: result.score,
        tokens: result.tokens.total,
      });
      if (stopped) {
        stopReason = stopped;
        stoppedAt = task.id;
        opts.onProgress?.({ type: "model.stop", model: ref, reason: stopped });
      }
    }
    const endedAt = now().toISOString();
    const ran = taskResults.filter((t) => t.status !== "not_run").length;
    const evidence: ModelBenchResult["evidence"] = [];
    const draft = summarizeModel({
      target,
      tasks: taskResults,
      suiteSize: suite.length,
      stopReason,
      stoppedAt,
      startedAt,
      endedAt,
      perModelTokens,
      evidence,
    });
    if (recorder) {
      const manifest = recorder.finish({
        status: draft.status === "error" ? "failed" : "succeeded",
        steps: taskResults.reduce((s, t) => s + t.turns, 0),
        toolCalls: taskResults.reduce((s, t) => s + t.toolCalls, 0),
        endedAt,
        summary: `bench ${ref}: ${ran}/${suite.length} tasks, overall ${draft.overall ?? "n/a"}`,
      });
      if (manifest) {
        const item: ModelBenchResult["evidence"][number] = {
          jobId,
          root: manifest.events.root,
          events: manifest.events.count,
        };
        evidence.push(item);
        try {
          const exported = await exportEvidenceBundle({
            jobId,
            out: path.join(opts.outDir, "evidence", slug),
            env,
            key: opts.key,
          });
          item.bundle = path.relative(opts.outDir, exported.path).split(path.sep).join("/");
        } catch {
          // The recorded log stays under the state dir; the report still carries its root.
        }
      }
    }
    const result = draft;
    results.push(result);
    opts.onProgress?.({
      type: "model.end",
      model: ref,
      overall: result.overall,
      tokens: result.usage.total,
    });
  }

  const report = buildBenchReport({
    models: results,
    suiteTasks: suite.length,
    perModelTokens,
    globalTokens,
    createdAt: createdAt(),
    key: opts.key,
  });
  writeBenchReport(opts.outDir, report);
  return report;
}
