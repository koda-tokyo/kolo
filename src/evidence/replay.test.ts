import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { exportEvidenceBundle } from "./bundle.js";
import { emitEvidenceSignal } from "./bus.js";
import { EvidenceRecorder } from "./recorder.js";
import { runReplayCli } from "./replay-cli.js";
import { createStepper, describeEvent, formatStep, stateAt } from "./replay.js";
import { readJobEvents } from "./store.js";

let home: string;
let env: NodeJS.ProcessEnv;
const sessionKey = "agent:alice:main";

function record(): void {
  const idn = loadOrCreateDeviceIdentity(path.join(home, "identity", "continuity-signing.json"));
  const r = new EvidenceRecorder(
    {
      id: "job-r",
      agent: "alice",
      sessionKey,
      kind: "agent",
      startedAt: "2026-10-14T00:00:00.000Z",
    },
    {
      env,
      key: { privateKeyPem: idn.privateKeyPem, publicKeyPem: idn.publicKeyPem },
      now: (() => {
        let i = 0;
        return () => new Date(Date.parse("2026-10-14T00:00:00.000Z") + ++i * 250);
      })(),
    },
  );
  r.start({ prompt: "Fix the bug", provider: "p", model: "m" });
  r.modelTurn({ provider: "p", model: "m", usage: { input: 5, output: 1 }, text: "Looking." });
  emitEvidenceSignal({ kind: "permission", sessionKey, tool: "edit", decision: "allow" });
  r.toolStart({
    toolCallId: "t1",
    name: "edit",
    args: { path: "src/x.ts", oldText: "a", newText: "b" },
  });
  r.toolEnd({ toolCallId: "t1", name: "edit", result: "ok", isError: false });
  r.toolStart({ toolCallId: "t2", name: "exec", args: { command: "pnpm test" } });
  r.toolEnd({ toolCallId: "t2", name: "exec", result: "FAIL", isError: true, error: "exit 1" });
  r.modelTurn({ provider: "p", model: "m", usage: { input: 7, output: 2 }, text: "Fixed." });
  r.finish({ status: "succeeded", steps: 2, toolCalls: 2, endedAt: "2026-10-14T00:00:05.000Z" });
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-replay-"));
  env = { ...process.env, KOLO_HOME: home, KOLO_STATE_DIR: home };
  record();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("replay stepper", () => {
  test("state accumulates step by step and is clamped", () => {
    const events = readJobEvents("job-r", env);
    expect(events).toHaveLength(9);
    const s0 = stateAt(events, 0);
    expect(s0).toMatchObject({ step: 0, event: null, status: "not started", toolCalls: 0 });
    const s4 = stateAt(events, 4);
    expect(s4.event?.type).toBe("tool.call");
    expect(s4.openTools).toEqual([{ toolCallId: "t1", name: "edit" }]);
    expect(s4.filesTouched).toEqual(["src/x.ts"]);
    expect(s4.permissions).toEqual({ allowed: 1, denied: 0 });
    expect(s4.elapsedMs).toBe(1000);
    const s5 = stateAt(events, 5);
    expect(s5.openTools).toEqual([]);
    const s7 = stateAt(events, 7);
    expect(s7.toolErrors).toBe(1);
    expect(s7.status).toBe("running");
    const end = stateAt(events, 99);
    expect(end.step).toBe(9);
    expect(end.status).toBe("succeeded");
    expect(end.usage).toEqual({ input: 12, output: 3 });
    expect(end.lastText).toBe("Fixed.");
    const stepper = createStepper(events, 1);
    expect(stepper.current().step).toBe(1);
    expect(stepper.next().step).toBe(2);
    expect(stepper.prev().step).toBe(1);
    expect(stepper.prev().step).toBe(0);
    expect(stepper.prev().step).toBe(0);
    expect(stepper.jump(9).step).toBe(9);
    expect(stepper.next().step).toBe(9);
    expect(stepper.jump(-3).step).toBe(0);
  });

  test("describe and format are one line per fact, never raw secrets", () => {
    const events = readJobEvents("job-r", env);
    expect(describeEvent(events[0])).toContain("job start: alice agent on p/m; prompt 11 chars");
    expect(describeEvent(events[3])).toContain("tool call edit");
    expect(describeEvent(events[6])).toContain("tool result exec: error");
    expect(describeEvent(events[8])).toContain("job end: succeeded");
    const lines = formatStep(stateAt(events, 6));
    expect(lines[0]).toMatch(/^step {9}6\/9 {2}\+\d+ ms {2}tool\.call$/);
    expect(lines.find((l) => l.startsWith("tool calls"))).toContain("exec running");
    expect(formatStep(stateAt(events, 0))[0]).toContain("before the first event");
  });
});

describe("kolo evidence replay", () => {
  let out: string[];
  let errs: string[];
  let runtime: RuntimeEnv;
  beforeEach(() => {
    out = [];
    errs = [];
    runtime = {
      log: (...a: unknown[]) => void out.push(a.join(" ")),
      error: (...a: unknown[]) => void errs.push(a.join(" ")),
      exit: (code: number) => {
        throw new Error(`exit ${code}`);
      },
    };
  });

  test("--step prints one state, from a job id or a bundle", async () => {
    expect(await runReplayCli("job-r", { step: "4" }, { runtime, env })).toBe(0);
    expect(out[0]).toContain("step         4/9");
    const zip = path.join(home, "r.zip");
    await exportEvidenceBundle({ jobId: "job-r", out: zip, env });
    out = [];
    expect(await runReplayCli(zip, { step: "9", json: true }, { runtime, env })).toBe(0);
    expect(JSON.parse(out[0])).toMatchObject({ step: 9, status: "succeeded" });
    expect(await runReplayCli("job-r", { step: "42" }, { runtime, env })).toBe(2);
    expect(await runReplayCli("missing", {}, { runtime, env })).toBe(1);
    expect(await runReplayCli("", {}, { runtime, env })).toBe(2);
  });

  test("without a terminal every step is printed; with input the stepper is driven", async () => {
    expect(await runReplayCli("job-r", { json: true }, { runtime, env, isTTY: false })).toBe(0);
    expect(out).toHaveLength(9);
    expect(JSON.parse(out[8]).step).toBe(9);
    out = [];
    expect(
      await runReplayCli(
        "job-r",
        {},
        { runtime, env, input: ["n", "n", "p", "j 9", "x", "q", "n"] },
      ),
    ).toBe(0);
    const steps = out.filter((l) => l.startsWith("step ")).map((l) => l.slice(13, 16).trim());
    expect(steps).toEqual(["1/9", "2/9", "3/9", "2/9", "9/9"]);
    expect(out.some((l) => l.startsWith("commands:"))).toBe(true);
  });
});
