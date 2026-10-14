import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { emitEvidenceSignal, hasEvidenceListeners } from "./bus.js";
import {
  __resetEvidenceForTest,
  EvidenceRecorder,
  finishEvidence,
  getEvidenceRecorder,
  startEvidence,
} from "./recorder.js";
import { boundedText, boundedValue } from "./redact.js";
import {
  EVENTS_FILE,
  EVIDENCE_GENESIS,
  MANIFEST_FILE,
  readEventsFile,
  readJobManifest,
  resolveEvidenceLimits,
  verifyEventChain,
  verifyEvidenceSignature,
} from "./store.js";

let home: string;
let env: NodeJS.ProcessEnv;
let key: { privateKeyPem: string; publicKeyPem: string };

const job = {
  id: "job-1",
  agent: "alice",
  sessionKey: "agent:alice:main",
  kind: "agent",
  startedAt: "2026-10-14T00:00:00.000Z",
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-evidence-"));
  env = { ...process.env, KOLO_HOME: home, KOLO_STATE_DIR: home };
  const id = loadOrCreateDeviceIdentity(path.join(home, "identity", "signing.json"));
  key = { privateKeyPem: id.privateKeyPem, publicKeyPem: id.publicKeyPem };
});

afterEach(() => {
  __resetEvidenceForTest();
  fs.rmSync(home, { recursive: true, force: true });
});

function make(limits: Partial<ReturnType<typeof resolveEvidenceLimits>> = {}) {
  return new EvidenceRecorder(job, {
    env,
    key,
    limits: { ...resolveEvidenceLimits(), ...limits },
    now: () => new Date("2026-10-14T00:00:01.000Z"),
    onError: (m) => {
      throw new Error(m);
    },
  });
}

describe("evidence recorder", () => {
  test("chains every event and signs a manifest at finish", () => {
    const r = make();
    r.start({ prompt: "Summarise the README", provider: "p", model: "m", runId: "run-1" });
    r.toolStart({ toolCallId: "t1", name: "read", args: { path: "README.md" } });
    r.toolEnd({ toolCallId: "t1", name: "read", result: "# Title", isError: false });
    r.modelTurn({ provider: "p", model: "m", usage: { input: 10, output: 5 }, text: "Done." });
    const manifest = r.finish({ status: "succeeded", steps: 1, toolCalls: 1 });
    expect(manifest).not.toBeNull();
    const events = readEventsFile(path.join(r.dir, EVENTS_FILE));
    expect(events.map((e) => e.type)).toEqual([
      "job.start",
      "tool.call",
      "tool.result",
      "model.turn",
      "job.end",
    ]);
    expect(events[0].prev).toBe(EVIDENCE_GENESIS);
    const chain = verifyEventChain(events);
    expect(chain.ok).toBe(true);
    expect(chain.root).toBe(manifest!.events.root);
    expect(manifest!.events.count).toBe(5);
    expect(manifest!.files[EVENTS_FILE].size).toBe(fs.statSync(path.join(r.dir, EVENTS_FILE)).size);
    const sig = verifyEvidenceSignature(manifest!, manifest!.signer, manifest!.signature);
    expect(sig).toEqual({ keyIdOk: true, signatureOk: true });
    expect(readJobManifest(job.id, env)?.signature).toBe(manifest!.signature);
    // The prompt is a digest by default.
    expect(events[0].data.prompt).toBeUndefined();
    expect(events[0].data.promptDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(events[0].data.promptChars).toBe(20);
    expect(events[3].data.excerpt).toBe("Done.");
    expect(events[3].data.text).toBeUndefined();
  });

  test("an edited line breaks the chain and the file digest", () => {
    const r = make();
    r.start({ prompt: "x" });
    r.toolStart({ toolCallId: "t1", name: "exec", args: { command: "ls" } });
    r.toolEnd({ toolCallId: "t1", name: "exec", result: "a\nb", isError: false });
    const manifest = r.finish({ status: "succeeded", steps: 1, toolCalls: 1 })!;
    const file = path.join(r.dir, EVENTS_FILE);
    const pristine = readEventsFile(file);
    const dropped = verifyEventChain(pristine.filter((e) => e.type !== "tool.result"));
    expect(dropped.ok).toBe(false);
    expect(dropped.firstBreak).toBe(2);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines[1] = lines[1].replace('"command":"ls"', '"command":"rm"');
    fs.writeFileSync(file, lines.join("\n"));
    const chain = verifyEventChain(readEventsFile(file));
    expect(chain.ok).toBe(false);
    expect(chain.firstBreak).toBe(1);
    expect(chain.reason).toContain("does not recompute");
    expect(fs.statSync(file).size).toBe(manifest.files[EVENTS_FILE].size);
  });

  test("redacts secret keys and token patterns, bounds results", () => {
    const r = make({ maxEventBytes: 64 });
    r.start({ prompt: "x" });
    r.toolStart({
      toolCallId: "t1",
      name: "exec",
      args: { command: "curl", apiKey: "sk-abcdefghijklmnop", note: "ok" },
    });
    r.toolEnd({
      toolCallId: "t1",
      name: "exec",
      result: `Authorization: Bearer ${"a".repeat(40)}\n${"z".repeat(500)}`,
      isError: false,
    });
    r.finish({ status: "succeeded", steps: 1, toolCalls: 1 });
    const raw = fs.readFileSync(path.join(r.dir, EVENTS_FILE), "utf8");
    expect(raw).not.toContain("sk-abcdefghijklmnop");
    expect(raw).not.toContain("a".repeat(40));
    const events = readEventsFile(path.join(r.dir, EVENTS_FILE));
    const call = events[1].data;
    expect(JSON.stringify(call.args)).toContain("[redacted]");
    expect(call.argsDigest).toMatch(/^[0-9a-f]{64}$/);
    const result = events[2].data;
    expect(Buffer.byteLength(String(result.result))).toBeLessThanOrEqual(64);
    expect(result.resultClipped).toBe(true);
    expect(result.resultChars).toBeGreaterThan(500);
  });

  test("includePrompts keeps bounded prompt and assistant text", () => {
    const r = make({ includePrompts: true, maxEventBytes: 16 });
    r.start({ prompt: "a".repeat(40) });
    r.modelTurn({ text: "b".repeat(40) });
    r.finish({ status: "succeeded", steps: 0, toolCalls: 0 });
    const events = readEventsFile(path.join(r.dir, EVENTS_FILE));
    expect(events[0].data.prompt).toBe("a".repeat(16));
    expect(events[0].data.promptClipped).toBe(true);
    expect(events[1].data.text).toBe("b".repeat(16));
    expect(events[1].data.excerpt).toBeUndefined();
  });

  test("reasoning is recorded only with includeReasoning, redacted and bounded", () => {
    const secret = "sk-abcdefghijklmnopqrstuvwx";
    const off = make();
    off.modelTurn({ text: "ok", reasoning: `use ${secret}` });
    off.finish({ status: "succeeded", steps: 0, toolCalls: 0 });
    const offTurn = readEventsFile(path.join(off.dir, EVENTS_FILE))[0];
    expect(offTurn.data.reasoning).toBeUndefined();
    expect(offTurn.data.reasoningDigest).toBeUndefined();
    __resetEvidenceForTest();

    const on = new EvidenceRecorder(
      { ...job, id: `${job.id}-r` },
      {
        env,
        key,
        limits: { ...resolveEvidenceLimits(), includeReasoning: true, maxEventBytes: 256 },
        onError: (m) => {
          throw new Error(m);
        },
      },
    );
    const reasoning = `use ${secret} then ${"x".repeat(400)}`;
    on.modelTurn({ text: "ok", reasoning });
    on.finish({ status: "succeeded", steps: 0, toolCalls: 0 });
    const turn = readEventsFile(path.join(on.dir, EVENTS_FILE))[0];
    expect(turn.data.reasoningDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(turn.data.reasoningChars).toBe(reasoning.length);
    expect(String(turn.data.reasoning)).not.toContain(secret);
    expect(Buffer.byteLength(String(turn.data.reasoning))).toBeLessThanOrEqual(256);
    expect(turn.data.reasoningClipped).toBe(true);
  });

  test("caps close the log with a truncated event; job.end still lands", () => {
    const r = make({ maxEvents: 3 });
    r.start({ prompt: "x" });
    r.modelTurn({ text: "1" });
    r.modelTurn({ text: "2" });
    r.modelTurn({ text: "3" });
    r.modelTurn({ text: "4" });
    const manifest = r.finish({ status: "succeeded", steps: 0, toolCalls: 0 })!;
    const events = readEventsFile(path.join(r.dir, EVENTS_FILE));
    expect(events.map((e) => e.type)).toEqual([
      "job.start",
      "model.turn",
      "model.turn",
      "truncated",
      "job.end",
    ]);
    expect(events[3].data.reason).toBe("max_events");
    expect(manifest.events.truncated).toBe(true);
    expect(verifyEventChain(events).ok).toBe(true);
  });

  test("permission and snapshot signals for the session land in the log and stop at finish", () => {
    const r = make();
    r.start({ prompt: "x" });
    expect(hasEvidenceListeners(job.sessionKey)).toBe(true);
    emitEvidenceSignal({
      kind: "permission",
      sessionKey: job.sessionKey,
      tool: "write",
      decision: "deny",
      toolClass: "write",
      target: "secrets/x",
      rule: "default-deny:write",
      reason: "Permission denied",
      auditSeq: 7,
    });
    emitEvidenceSignal({
      kind: "snapshot",
      sessionKey: "AGENT:ALICE:MAIN",
      snapshotId: "snap-1",
      tool: "edit",
      files: [{ path: "/w/a.ts", existed: true, hash: "ab", size: 3 }],
    });
    emitEvidenceSignal({
      kind: "permission",
      sessionKey: "agent:bob:main",
      tool: "exec",
      decision: "allow",
    });
    r.finish({ status: "denied", steps: 0, toolCalls: 0 });
    expect(hasEvidenceListeners(job.sessionKey)).toBe(false);
    emitEvidenceSignal({
      kind: "permission",
      sessionKey: job.sessionKey,
      tool: "x",
      decision: "allow",
    });
    const events = readEventsFile(path.join(r.dir, EVENTS_FILE));
    expect(events.map((e) => e.type)).toEqual(["job.start", "permission", "snapshot", "job.end"]);
    expect(events[1].data).toMatchObject({ tool: "write", decision: "deny", auditSeq: 7 });
    expect(events[2].data).toMatchObject({ snapshotId: "snap-1", tool: "edit" });
  });

  test("audit links carry seq and hash only", () => {
    const r = make();
    r.start({ prompt: "x" });
    r.audit({
      seq: 12,
      hash: "h".repeat(64),
      action: "agent.loop_stopped",
      outcome: "denied",
      ts: "t",
    });
    r.audit(null);
    r.finish({ status: "loop_stopped", steps: 3, toolCalls: 3, error: "max_steps" });
    const events = readEventsFile(path.join(r.dir, EVENTS_FILE));
    expect(events[1].type).toBe("audit");
    expect(events[1].data).toEqual({
      seq: 12,
      hash: "h".repeat(64),
      action: "agent.loop_stopped",
      outcome: "denied",
      ts: "t",
    });
    expect(events.length).toBe(3);
  });

  test("finish is idempotent and the manifest is written atomically", () => {
    const r = make();
    r.start({ prompt: "x" });
    const a = r.finish({ status: "succeeded", steps: 0, toolCalls: 0 });
    const b = r.finish({ status: "failed", steps: 0, toolCalls: 0 });
    expect(b).toBe(a);
    expect(fs.readdirSync(r.dir).toSorted()).toEqual([EVENTS_FILE, MANIFEST_FILE]);
  });

  test("registry: disabled config records nothing; enabled records and finishes", () => {
    expect(startEvidence(job, { config: { evidence: { enabled: false } }, env })).toBeNull();
    const rec = startEvidence(job, { config: {}, env });
    expect(rec).not.toBeNull();
    expect(getEvidenceRecorder(job.id)).toBe(rec);
    rec!.start({ prompt: "x" });
    const manifest = finishEvidence(job.id, { status: "succeeded", steps: 0, toolCalls: 0 });
    expect(manifest?.events.count).toBe(2);
    expect(fs.existsSync(path.join(home, "identity", "continuity-signing.json"))).toBe(true);
    expect(getEvidenceRecorder(job.id)).toBeUndefined();
  });

  test("bounded helpers", () => {
    expect(boundedText("token=abcdef123456 tail", 1000).text).not.toContain("abcdef123456");
    expect(boundedText("ééééé", 4)).toEqual({ text: "éé", clipped: true });
    const v = boundedValue({ password: "p", n: 1 }, 1000);
    expect(v).toEqual({ value: { password: "[redacted]", n: 1 }, clipped: false });
    expect(boundedValue({ long: "x".repeat(100) }, 20).clipped).toBe(true);
  });
});
