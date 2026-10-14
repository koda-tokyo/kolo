import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { scanText } from "../../scripts/privacy-check.mjs";
import { benchSuite, selectTasks } from "./suite.js";
import {
  bulletLines,
  hasEuropeanProgressive,
  japaneseRatio,
  looksPortuguese,
  numbersIn,
} from "./tasks/helpers.js";
import { BENCH_AXES } from "./types.js";

describe("bench suite", () => {
  const suite = benchSuite();

  it("has 40-60 tasks with unique ids over every task axis", () => {
    expect(suite.length).toBeGreaterThanOrEqual(40);
    expect(suite.length).toBeLessThanOrEqual(60);
    expect(new Set(suite.map((t) => t.id)).size).toBe(suite.length);
    for (const axis of BENCH_AXES.filter((a) => a !== "efficiency")) {
      expect(suite.filter((t) => t.axis === axis).length, axis).toBeGreaterThanOrEqual(5);
      expect(suite.filter((t) => t.axis === axis && t.quick).length, axis).toBeGreaterThanOrEqual(
        2,
      );
    }
  });

  it("selects the quick subset and id prefixes", () => {
    const quick = selectTasks({ subset: "quick" });
    expect(quick.length).toBeLessThan(suite.length);
    expect(quick.every((t) => t.quick)).toBe(true);
    expect(selectTasks({ only: ["policy."] }).every((t) => t.axis === "policy")).toBe(true);
    expect(selectTasks({ only: ["coding.sort"] }).map((t) => t.id)).toEqual(["coding.sort"]);
  });

  it("carries no personal content", () => {
    const text = JSON.stringify(
      suite.map((t) => ({
        id: t.id,
        title: t.title,
        sessions: typeof t.sessions === "function" ? [] : t.sessions,
      })),
    ).toLowerCase();
    // Same hashed blocklist as `pnpm privacy:check`, so this file never spells the names out.
    expect(scanText(text)).toEqual([]);
    expect(text).not.toContain("koda");
  });
});

describe("rubric helpers", () => {
  it("detects Japanese", () => {
    expect(japaneseRatio("会議は午後3時からです。")).toBeGreaterThan(0.9);
    expect(japaneseRatio("The meeting is at 3 pm.")).toBe(0);
  });

  it("detects Portuguese and the European progressive", () => {
    expect(
      looksPortuguese("Não se preocupe, você vai receber o pedido para amanhã com segurança."),
    ).toBe(true);
    expect(looksPortuguese("The order will arrive tomorrow.")).toBe(false);
    expect(hasEuropeanProgressive("Estou a fazer o deploy agora.")).toBe(true);
    expect(hasEuropeanProgressive("Estou fazendo o deploy agora.")).toBe(false);
  });

  it("finds bullets and numbers", () => {
    expect(bulletLines("Resumo:\n- um\n- dois\n・三\n1. four\ntext")).toHaveLength(4);
    expect(numbersIn("Total: 411,522 yen and 3.5")).toEqual(["411522", "3.5"]);
  });
});

describe("no credit for doing nothing", () => {
  it("scores an empty reply 0, except declining in policy tasks", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { seedBenchWorkspace, runNodeTest } = await import("./workspace.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bench-noop-"));
    try {
      for (const task of benchSuite()) {
        const ctx = {
          workspaceDir: path.join(root, task.id),
          agentId: "alice",
          marker: "CM-00000000",
        };
        seedBenchWorkspace(ctx);
        task.setup?.(ctx);
        const sessions = (
          typeof task.sessions === "function" ? task.sessions(ctx) : task.sessions
        ).map(() => ({
          finalText: "",
          toolCalls: [],
          innerCalls: [],
          turns: 1,
        }));
        const check = await task.check({
          ...ctx,
          sessions,
          runNodeTest: (rel) => runNodeTest(ctx.workspaceDir, rel),
        });
        if (task.axis === "policy") {
          expect(check.score, task.id).toBeLessThanOrEqual(0.75);
        } else {
          expect(check.score, `${task.id}: ${check.detail}`).toBe(0);
        }
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
