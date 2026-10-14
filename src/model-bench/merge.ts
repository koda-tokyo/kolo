// Merge signed reports of chunked runs (a slow local model benchmarked a few tasks at a time)
// into one signed report. Every input must verify. Per model and task the latest result that
// ran wins; usage is the real spend of every input; evidence jobs are kept from all inputs.
import type { SigningKey } from "../continuity-suite/manifest.js";
import type { BenchReport, BenchTask, ModelBenchResult, TaskResult } from "./types.js";
import { getModelPrice } from "../providers/registry.js";
import { buildBenchReport, verifyBenchReport } from "./report.js";
import { scoreModel } from "./scoring.js";
import { benchSuite } from "./suite.js";

export class BenchMergeError extends Error {}

export function mergeBenchReports(params: {
  reports: BenchReport[];
  key: SigningKey;
  createdAt: string;
  suite?: BenchTask[];
}): BenchReport {
  const suite = params.suite ?? benchSuite();
  if (params.reports.length === 0) {
    throw new BenchMergeError("no reports to merge");
  }
  for (const report of params.reports) {
    const check = verifyBenchReport(report);
    if (!check.ok) {
      throw new BenchMergeError(`report ${report.hash.slice(0, 12)}: ${check.reason}`);
    }
  }
  const ordered = params.reports.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
  const byModel = new Map<string, ModelBenchResult[]>();
  for (const report of ordered) {
    for (const m of report.models) {
      const ref = `${m.provider}/${m.model}`;
      byModel.set(ref, [...(byModel.get(ref) ?? []), m]);
    }
  }
  const models: ModelBenchResult[] = [];
  for (const runs of byModel.values()) {
    const first = runs[0];
    const tasks: TaskResult[] = suite.map((task) => {
      const results = runs
        .map((r) => r.tasks.find((t) => t.id === task.id))
        .filter((t): t is TaskResult => Boolean(t));
      const ran = results.filter((t) => t.status !== "not_run");
      return (
        ran[ran.length - 1] ??
        results[results.length - 1] ?? {
          id: task.id,
          axis: task.axis,
          status: "not_run",
          score: 0,
          detail: "",
          reason: "not selected",
          latencyMs: 0,
          turns: 0,
          tokens: { input: 0, output: 0, total: 0 },
          cost: 0,
          toolCalls: 0,
        }
      );
    });
    const price = getModelPrice(first.provider, first.model);
    const scored = scoreModel({ tasks, suiteSize: suite.length, price });
    const usage = runs.reduce(
      (acc, r) => ({
        input: acc.input + r.usage.input,
        output: acc.output + r.usage.output,
        total: acc.total + r.usage.total,
        cost: acc.cost + r.usage.cost,
      }),
      { input: 0, output: 0, total: 0, cost: 0 },
    );
    const notRun = tasks.filter((t) => t.status === "not_run").length;
    const ranTasks = tasks.length - notRun;
    const errors = tasks.filter((t) => t.status === "error").length;
    const quickOnly = runs.every((r) => r.subset === "quick");
    const stopped = runs.some((r) => r.status === "budget_stopped") && notRun > 0;
    models.push({
      provider: first.provider,
      model: first.model,
      status: stopped
        ? "budget_stopped"
        : ranTasks > 0 && errors === ranTasks
          ? "error"
          : notRun > 0
            ? "partial"
            : "complete",
      startedAt: runs.map((r) => r.startedAt).toSorted()[0],
      endedAt: runs.map((r) => r.endedAt).toSorted()[runs.length - 1],
      subset: quickOnly ? "quick" : "full",
      tasks,
      axes: scored.axes,
      overall: scored.overall,
      coverage: scored.coverage,
      usage: {
        ...usage,
        cost: Math.round(usage.cost * 1_000_000) / 1_000_000,
        currency: first.usage.currency,
      },
      latency: scored.latency,
      costPerResidentHour: scored.costPerResidentHour,
      budget: { tokenCap: Math.max(...runs.map((r) => r.budget.tokenCap)) },
      evidence: runs.flatMap((r) => r.evidence),
    });
  }
  return buildBenchReport({
    models,
    suiteTasks: suite.length,
    perModelTokens: Math.max(...ordered.map((r) => r.budget.perModelTokens)),
    globalTokens: Math.max(...ordered.map((r) => r.budget.globalTokens)),
    createdAt: params.createdAt,
    key: params.key,
    mergedFrom: ordered.map((r) => r.hash),
  });
}
