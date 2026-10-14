import { describe, expect, it } from "vitest";
import type { TaskResult } from "./types.js";
import { costOf, efficiencyScore, percentile, scoreModel, statusOf } from "./scoring.js";

const task = (over: Partial<TaskResult>): TaskResult => ({
  id: "t",
  axis: "toolUse",
  status: "pass",
  score: 1,
  detail: "",
  latencyMs: 3000,
  turns: 1,
  tokens: { input: 1000, output: 500, total: 1500 },
  cost: 0,
  toolCalls: 0,
  ...over,
});

describe("scoring", () => {
  it("maps scores to statuses", () => {
    expect(statusOf(1)).toBe("pass");
    expect(statusOf(0.5)).toBe("partial");
    expect(statusOf(0)).toBe("fail");
  });

  it("computes percentiles", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });

  it("scores efficiency from latency and tokens", () => {
    expect(efficiencyScore([])).toBeNull();
    expect(efficiencyScore([task({})])).toBe(100);
    expect(
      efficiencyScore([
        task({ latencyMs: 120_000, tokens: { input: 0, output: 0, total: 30_000 } }),
      ]),
    ).toBe(0);
  });

  it("averages axes over tasks that ran and weights the overall", () => {
    const tasks = [
      task({ id: "a", axis: "toolUse", score: 1 }),
      task({ id: "b", axis: "toolUse", score: 0.5, status: "partial" }),
      task({ id: "c", axis: "policy", score: 0, status: "fail" }),
      task({ id: "d", axis: "coding", status: "not_run", score: 0 }),
    ];
    const s = scoreModel({ tasks, suiteSize: 4, price: null });
    expect(s.axes.toolUse).toEqual({ score: 75, run: 2, total: 2 });
    expect(s.axes.policy.score).toBe(0);
    expect(s.axes.coding).toEqual({ score: null, run: 0, total: 1 });
    expect(s.axes.efficiency.score).toBe(100);
    // toolUse 0.2*75 + policy 0.2*0 + efficiency 0.1*100 over weight 0.5
    expect(s.overall).toBe(50);
    expect(s.coverage).toBe(0.75);
    expect(s.costPerResidentHour).toBeNull();
  });

  it("estimates the cost of a resident hour from the price", () => {
    const price = {
      input: 1,
      output: 2,
      currency: "USD",
      source: "https://example.com",
      asOf: "2026-10-14",
    };
    expect(costOf({ input: 1_000_000, output: 500_000 }, price)).toBe(2);
    const s = scoreModel({ tasks: [task({ turns: 2 })], suiteSize: 1, price });
    // 30 turns of (500 in, 250 out) = 15000 in, 7500 out → 0.015 + 0.015
    expect(s.costPerResidentHour).toBe(0.03);
  });

  it("leaves errors out of efficiency", () => {
    const s = scoreModel({
      tasks: [task({ status: "error", score: 0, latencyMs: 10 })],
      suiteSize: 1,
      price: null,
    });
    expect(s.axes.efficiency.score).toBeNull();
    expect(s.axes.toolUse.score).toBe(0);
  });
});
