import { describe, expect, it } from "vitest";
import { DEFAULT_LOOP_LIMITS, LoopGuard, resolveLoopLimits } from "./loop-guard.js";

describe("resolveLoopLimits", () => {
  it("returns built-in defaults when nothing configured", () => {
    expect(resolveLoopLimits()).toEqual({
      maxSteps: DEFAULT_LOOP_LIMITS.maxSteps,
      maxIdenticalCalls: DEFAULT_LOOP_LIMITS.maxIdenticalCalls,
      noProgressSteps: DEFAULT_LOOP_LIMITS.noProgressSteps,
    });
  });

  it("applies defaults over built-ins", () => {
    const limits = resolveLoopLimits(undefined, {
      maxSteps: 50,
      doomLoop: { maxIdenticalCalls: 3 },
    });
    expect(limits.maxSteps).toBe(50);
    expect(limits.maxIdenticalCalls).toBe(3);
    expect(limits.noProgressSteps).toBe(DEFAULT_LOOP_LIMITS.noProgressSteps);
  });

  it("entry overrides defaults", () => {
    const limits = resolveLoopLimits(
      { maxSteps: 10 },
      { maxSteps: 50, doomLoop: { noProgressSteps: 6 } },
    );
    expect(limits.maxSteps).toBe(10);
    expect(limits.noProgressSteps).toBe(6);
  });

  it("ignores null/invalid values", () => {
    const limits = resolveLoopLimits({ maxSteps: null, doomLoop: null }, { maxSteps: 30 });
    expect(limits.maxSteps).toBe(30);
  });
});

describe("LoopGuard maxSteps", () => {
  it("does not stop within the step budget", () => {
    const guard = new LoopGuard({ maxSteps: 3, noProgressSteps: 100, maxIdenticalCalls: 100 });
    for (let i = 0; i < 3; i++) {
      guard.recordToolStart(`c${i}`, "read", { path: `/f${i}` });
      guard.recordToolEnd(`c${i}`, "read", `content-${i}`, false);
      expect(guard.check().stop).toBe(false);
    }
  });

  it("stops when the step budget is exceeded", () => {
    const guard = new LoopGuard({ maxSteps: 2, noProgressSteps: 100, maxIdenticalCalls: 100 });
    for (let i = 0; i < 2; i++) {
      guard.recordToolStart(`c${i}`, "read", { path: `/f${i}` });
      guard.recordToolEnd(`c${i}`, "read", `content-${i}`, false);
      guard.check();
    }
    guard.recordToolStart("c2", "read", { path: "/f2" });
    const verdict = guard.check();
    expect(verdict.stop).toBe(true);
    if (verdict.stop) {
      expect(verdict.reason).toBe("max_steps");
      expect(verdict.summary).toContain("step limit");
    }
  });
});

describe("LoopGuard identical-call streak", () => {
  it("stops after N identical calls in a row (default 4)", () => {
    const guard = new LoopGuard({ maxSteps: 100, noProgressSteps: 100 });
    let verdict = guard.check();
    for (let i = 0; i < 4; i++) {
      guard.recordToolStart(`c${i}`, "exec", { command: "ls" });
      guard.recordToolEnd(`c${i}`, "exec", "same-output", i > 0);
      verdict = guard.check();
      if (i < 3) {
        expect(verdict.stop).toBe(false);
      }
    }
    expect(verdict.stop).toBe(true);
    if (verdict.stop) {
      expect(verdict.reason).toBe("identical_calls");
      expect(verdict.summary).toContain("4 identical exec calls");
    }
  });

  it("resets the streak when args differ", () => {
    const guard = new LoopGuard({ maxSteps: 100, noProgressSteps: 100, maxIdenticalCalls: 3 });
    guard.recordToolStart("a", "exec", { command: "ls" });
    guard.recordToolEnd("a", "exec", "x", false);
    guard.recordToolStart("b", "exec", { command: "ls" });
    guard.recordToolEnd("b", "exec", "x", false);
    expect(guard.check().stop).toBe(false);
    guard.recordToolStart("c", "exec", { command: "pwd" });
    guard.recordToolEnd("c", "exec", "y", false);
    expect(guard.check().stop).toBe(false);
    guard.recordToolStart("d", "exec", { command: "ls" });
    guard.recordToolEnd("d", "exec", "x", false);
    expect(guard.check().stop).toBe(false);
  });

  it("treats key ordering as irrelevant in args", () => {
    const guard = new LoopGuard({ maxSteps: 100, noProgressSteps: 100, maxIdenticalCalls: 2 });
    guard.recordToolStart("a", "exec", { command: "ls", cwd: "/tmp" });
    guard.recordToolEnd("a", "exec", "x", false);
    guard.recordToolStart("b", "exec", { cwd: "/tmp", command: "ls" });
    guard.recordToolEnd("b", "exec", "x", false);
    const verdict = guard.check();
    expect(verdict.stop).toBe(true);
    if (verdict.stop) {
      expect(verdict.reason).toBe("identical_calls");
    }
  });
});

describe("LoopGuard no-progress window", () => {
  it("stops after 12 steps with no progress (errors only)", () => {
    const guard = new LoopGuard({ maxSteps: 100, maxIdenticalCalls: 100, noProgressSteps: 12 });
    let verdict = guard.check();
    for (let i = 0; i < 12; i++) {
      guard.recordToolStart(`c${i}`, "read", { path: `/missing-${i}` });
      guard.recordToolEnd(`c${i}`, "read", "file not found", true);
      verdict = guard.check();
      if (i < 11) {
        expect(verdict.stop).toBe(false);
      }
    }
    expect(verdict.stop).toBe(true);
    if (verdict.stop) {
      expect(verdict.reason).toBe("no_progress");
      expect(verdict.summary).toContain("no progress");
    }
  });

  it("successful write-class tool resets the window", () => {
    const guard = new LoopGuard({ maxSteps: 100, maxIdenticalCalls: 100, noProgressSteps: 3 });
    for (let i = 0; i < 2; i++) {
      guard.recordToolStart(`r${i}`, "read", { path: `/f${i}` });
      guard.recordToolEnd(`r${i}`, "read", "err", true);
      expect(guard.check().stop).toBe(false);
    }
    guard.recordToolStart("w", "write", { path: "/out", content: "hi" });
    guard.recordToolEnd("w", "write", "ok", false);
    expect(guard.check().stop).toBe(false);
    // Window restarted: two more errors are fine, third would stop.
    for (let i = 0; i < 2; i++) {
      guard.recordToolStart(`r2${i}`, "read", { path: `/g${i}` });
      guard.recordToolEnd(`r2${i}`, "read", "err", true);
      expect(guard.check().stop).toBe(false);
    }
    guard.recordToolStart("r23", "read", { path: "/g3" });
    guard.recordToolEnd("r23", "read", "err", true);
    expect(guard.check().stop).toBe(true);
  });

  it("changed result digest for a repeated call counts as progress", () => {
    const guard = new LoopGuard({ maxSteps: 100, maxIdenticalCalls: 100, noProgressSteps: 3 });
    const args = { command: "tail -f /tmp/log" };
    for (let i = 0; i < 6; i++) {
      guard.recordToolStart(`c${i}`, "exec", args);
      // Same call each time but the output keeps growing — that is progress.
      guard.recordToolEnd(`c${i}`, "exec", `line-${i}`, false);
      expect(guard.check().stop).toBe(false);
    }
  });

  it("unchanged result digest for a repeated non-write call is not progress", () => {
    const guard = new LoopGuard({ maxSteps: 100, maxIdenticalCalls: 100, noProgressSteps: 3 });
    const args = { command: "date" };
    let stopped = false;
    // First occurrence of a call counts as progress (new information); repeats
    // with an unchanged digest do not, so the window closes after 4 calls.
    for (let i = 0; i < 4; i++) {
      guard.recordToolStart(`c${i}`, "exec", args);
      guard.recordToolEnd(`c${i}`, "exec", "same-output", false);
      if (guard.check().stop) {
        stopped = true;
        break;
      }
    }
    expect(stopped).toBe(true);
  });

  it("distinct successful reads keep counting as progress", () => {
    const guard = new LoopGuard({ maxSteps: 100, maxIdenticalCalls: 100, noProgressSteps: 4 });
    for (let i = 0; i < 10; i++) {
      guard.recordToolStart(`c${i}`, "read", { path: `/file-${i}` });
      guard.recordToolEnd(`c${i}`, "read", `content-${i}`, false);
      expect(guard.check().stop).toBe(false);
    }
  });
});

describe("LoopGuard misc", () => {
  it("end without a matching start is ignored", () => {
    const guard = new LoopGuard();
    expect(() => guard.recordToolEnd("unknown", "read", "text", false)).not.toThrow();
    expect(guard.getSteps()).toBe(0);
  });

  it("getSteps and getStepsSinceProgress track state", () => {
    const guard = new LoopGuard();
    guard.recordToolStart("a", "read", { path: "/x" });
    guard.recordToolEnd("a", "read", "text", true);
    expect(guard.getSteps()).toBe(1);
    expect(guard.getStepsSinceProgress()).toBe(1);
    guard.recordToolStart("b", "write", { path: "/y" });
    guard.recordToolEnd("b", "write", "ok", false);
    expect(guard.getSteps()).toBe(2);
    expect(guard.getStepsSinceProgress()).toBe(0);
  });
});
