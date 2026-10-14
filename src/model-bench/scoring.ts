// Scores: per task 0..1 from its rubric, per axis 0..100 as the mean over the tasks that ran,
// efficiency from latency and tokens, overall as the weighted mean of the axes that have a score
// (weights renormalised), plus an estimate of what an active resident costs per hour.
import {
  AXIS_WEIGHTS,
  type AxisScore,
  BENCH_AXES,
  type BenchAxis,
  type ModelPrice,
  type TaskResult,
  type TaskStatus,
} from "./types.js";

/** An active resident: model turns per hour assumed by the cost estimate. */
export const RESIDENT_TURNS_PER_HOUR = 30;

const LATENCY_BEST_MS = 3_000;
const LATENCY_WORST_MS = 120_000;
const TOKENS_BEST = 1_500;
const TOKENS_WORST = 30_000;

export function statusOf(score: number): Exclude<TaskStatus, "error" | "not_run"> {
  return score >= 0.999 ? "pass" : score > 0 ? "partial" : "fail";
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function costOf(
  tokens: { input: number; output: number },
  price: ModelPrice | null,
): number {
  if (!price) {
    return 0;
  }
  return (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
}

export function efficiencyScore(ran: TaskResult[]): number | null {
  if (ran.length === 0) {
    return null;
  }
  const latency = percentile(
    ran.map((t) => t.latencyMs),
    50,
  );
  const tokens = ran.reduce((s, t) => s + t.tokens.total, 0) / ran.length;
  const l = clamp01(1 - ((latency ?? 0) - LATENCY_BEST_MS) / (LATENCY_WORST_MS - LATENCY_BEST_MS));
  const k = clamp01(1 - (tokens - TOKENS_BEST) / (TOKENS_WORST - TOKENS_BEST));
  return round1(100 * (0.5 * l + 0.5 * k));
}

export function scoreModel(params: {
  tasks: TaskResult[];
  suiteSize: number;
  price: ModelPrice | null;
}): {
  axes: Record<BenchAxis, AxisScore>;
  overall: number | null;
  coverage: number;
  latency: { p50Ms: number | null; p90Ms: number | null };
  costPerResidentHour: number | null;
} {
  const ran = params.tasks.filter((t) => t.status !== "not_run");
  // A provider error says nothing about speed; it is scored 0 on its axis instead.
  const answered = ran.filter((t) => t.status !== "error");
  const axes = {} as Record<BenchAxis, AxisScore>;
  for (const axis of BENCH_AXES) {
    if (axis === "efficiency") {
      axes.efficiency = {
        score: efficiencyScore(answered),
        run: answered.length,
        total: params.tasks.length,
      };
      continue;
    }
    const all = params.tasks.filter((t) => t.axis === axis);
    const done = all.filter((t) => t.status !== "not_run");
    axes[axis] = {
      score:
        done.length === 0
          ? null
          : round1((100 * done.reduce((s, t) => s + t.score, 0)) / done.length),
      run: done.length,
      total: all.length,
    };
  }
  let weight = 0;
  let sum = 0;
  for (const axis of BENCH_AXES) {
    const score = axes[axis].score;
    if (score !== null) {
      weight += AXIS_WEIGHTS[axis];
      sum += AXIS_WEIGHTS[axis] * score;
    }
  }
  const turns = ran.reduce((s, t) => s + t.turns, 0);
  const input = ran.reduce((s, t) => s + t.tokens.input, 0);
  const output = ran.reduce((s, t) => s + t.tokens.output, 0);
  const costPerResidentHour =
    params.price && turns > 0
      ? Math.round(
          costOf(
            {
              input: (input / turns) * RESIDENT_TURNS_PER_HOUR,
              output: (output / turns) * RESIDENT_TURNS_PER_HOUR,
            },
            params.price,
          ) * 10_000,
        ) / 10_000
      : null;
  const latencies = ran.map((t) => t.latencyMs);
  return {
    axes,
    overall: weight > 0 ? round1(sum / weight) : null,
    coverage: params.suiteSize > 0 ? Math.round((ran.length / params.suiteSize) * 1000) / 1000 : 0,
    latency: { p50Ms: percentile(latencies, 50), p90Ms: percentile(latencies, 90) },
    costPerResidentHour,
  };
}
