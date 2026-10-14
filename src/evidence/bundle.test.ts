import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { EvidenceManifest } from "./types.js";
import { appendAudit, resolveAuditDir } from "../audit/audit-log.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { snapshotDirName, snapshotsRoot } from "../snapshots/store.js";
import {
  AUDIT_SLICE_FILE,
  exportEvidenceBundle,
  REPORT_FILE,
  sliceAuditLog,
  SNAPSHOT_INDEX_FILE,
} from "./bundle.js";
import { emitEvidenceSignal } from "./bus.js";
import { EvidenceRecorder } from "./recorder.js";
import {
  EVENTS_FILE,
  MANIFEST_FILE,
  resolveEvidenceLimits,
  signEvidenceManifest,
} from "./store.js";
import { loadBundle, verifyBundleFiles, verifyEvidenceBundle } from "./verify.js";

let home: string;
let env: NodeJS.ProcessEnv;
let key: { privateKeyPem: string; publicKeyPem: string };
const sessionKey = "agent:alice:main";
const job = { id: "job-7", agent: "alice", sessionKey, kind: "agent", startedAt: "" };

function keyAt(file: string) {
  const id = loadOrCreateDeviceIdentity(file);
  return { privateKeyPem: id.privateKeyPem, publicKeyPem: id.publicKeyPem };
}

async function recordJob(opts: { includePrompts?: boolean } = {}): Promise<string> {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const r = new EvidenceRecorder(
    { ...job, startedAt },
    {
      env,
      key,
      limits: { ...resolveEvidenceLimits(), includePrompts: opts.includePrompts ?? false },
      onError: (m) => {
        throw new Error(m);
      },
    },
  );
  r.start({ prompt: "Rename the helper in src/a.ts", provider: "p", model: "m", runId: "run-7" });
  r.modelTurn({ provider: "p", model: "m", usage: { input: 20, output: 3 }, text: "Editing." });
  // A real snapshot object under the state dir so the export can include it.
  const objects = path.join(snapshotsRoot(home), snapshotDirName(sessionKey), "objects");
  fs.mkdirSync(objects, { recursive: true });
  const content = Buffer.from("export const a = 1;\n");
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(content).digest("hex");
  fs.writeFileSync(path.join(objects, hash), content);
  emitEvidenceSignal({
    kind: "permission",
    sessionKey,
    tool: "edit",
    decision: "allow",
  });
  emitEvidenceSignal({
    kind: "snapshot",
    sessionKey,
    snapshotId: "snap-1",
    tool: "edit",
    files: [{ path: "/w/src/a.ts", existed: true, hash, size: content.length }],
  });
  r.toolStart({
    toolCallId: "t1",
    name: "edit",
    args: { path: "src/a.ts", oldText: "a", newText: "b" },
  });
  r.toolEnd({ toolCallId: "t1", name: "edit", result: "ok", isError: false });
  const audit = await appendAudit(
    {
      identity: "alice",
      scope: sessionKey,
      action: "agent.permission_denied",
      outcome: "denied",
      source: "test",
      detail: { tool: "exec" },
    },
    { dir: resolveAuditDir(env) },
  );
  await appendAudit(
    { identity: "bob", scope: "agent:bob:main", action: "x", outcome: "ok", source: "test" },
    { dir: resolveAuditDir(env) },
  );
  r.audit(audit);
  r.modelTurn({
    provider: "p",
    model: "m",
    usage: { input: 30, output: 4 },
    text: "Renamed the helper.",
  });
  r.finish({ status: "succeeded", steps: 2, toolCalls: 1, endedAt: new Date().toISOString() });
  return r.dir;
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bundle-"));
  env = { ...process.env, KOLO_HOME: home, KOLO_STATE_DIR: home };
  key = keyAt(path.join(home, "identity", "continuity-signing.json"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("evidence bundle", () => {
  test("export to a directory and verify offline", async () => {
    await recordJob();
    const out = path.join(home, "out", "bundle");
    const result = await exportEvidenceBundle({ jobId: job.id, out, env, key });
    expect(result.format).toBe("dir");
    expect(result.files).toEqual([
      REPORT_FILE,
      AUDIT_SLICE_FILE,
      EVENTS_FILE,
      MANIFEST_FILE,
      SNAPSHOT_INDEX_FILE,
      expect.stringMatching(/^snapshots\/objects\/[0-9a-f]{64}$/),
    ]);
    const v = await verifyEvidenceBundle(out);
    expect(v.problems).toEqual([]);
    expect(v).toMatchObject({
      ok: true,
      chainOk: true,
      rootOk: true,
      filesOk: true,
      signatureOk: true,
      keyIdOk: true,
      recordedOk: true,
      auditSliceOk: true,
      snapshotsOk: true,
      events: 9,
    });
    expect(v.summary).toMatchObject({
      status: "succeeded",
      modelTurns: 2,
      toolCalls: 1,
      filesChanged: ["/w/src/a.ts", "src/a.ts"],
      usage: { input: 50, output: 7 },
      permissions: { allowed: 1, denied: 0 },
      auditSeqs: [1],
    });
    const slice = fs.readFileSync(path.join(out, AUDIT_SLICE_FILE), "utf8").trim().split("\n");
    expect(slice).toHaveLength(1);
    expect(slice[0]).toContain("agent.permission_denied");
    const report = fs.readFileSync(path.join(out, REPORT_FILE), "utf8");
    expect(report).toContain("# Evidence report: job job-7");
    expect(report).toContain("recorded as a digest");
    expect(report).toContain("`src/a.ts`");
    expect(report).toContain("| 1 | edit |");
    expect(report).toContain("permission allow: edit");
    expect(report).toContain("Renamed the helper.");
    expect(report).not.toContain("Rename the helper in src/a.ts");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(out, MANIFEST_FILE), "utf8"),
    ) as EvidenceManifest;
    expect(manifest.recorded?.signer.keyId).toBe(manifest.signer.keyId);
    expect(Object.keys(manifest.files).toSorted()).toEqual(
      result.files.filter((f) => f !== MANIFEST_FILE).toSorted(),
    );
    expect(JSON.stringify(manifest)).not.toContain("PRIVATE KEY");
  });

  test("export to a zip verifies and round-trips the same files", async () => {
    await recordJob({ includePrompts: true });
    const out = path.join(home, "out", "bundle.zip");
    const result = await exportEvidenceBundle({ jobId: job.id, out, env, key });
    expect(result.format).toBe("zip");
    expect(fs.statSync(out).size).toBe(result.bytes);
    const files = await loadBundle(out);
    expect([...files.keys()].toSorted()).toEqual(result.files);
    const v = verifyBundleFiles(files);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
    expect(files.get(REPORT_FILE)!.toString("utf8")).toContain("Rename the helper in src/a.ts");
  });

  test("tampering is detected: events, files, manifest, objects, extra files", async () => {
    await recordJob();
    const out = path.join(home, "out", "b");
    await exportEvidenceBundle({ jobId: job.id, out, env, key });
    const pristine = await loadBundle(out);
    const mutate = (fn: (files: Map<string, Buffer>) => void) => {
      const files = new Map(pristine);
      fn(files);
      return verifyBundleFiles(files);
    };

    const edited = mutate((f) => {
      const lines = f.get(EVENTS_FILE)!.toString("utf8").split("\n");
      expect(lines[4]).toContain('"path":"src/a.ts"');
      lines[4] = lines[4].replace('"path":"src/a.ts"', '"path":"src/b.ts"');
      f.set(EVENTS_FILE, Buffer.from(lines.join("\n")));
    });
    expect(edited.ok).toBe(false);
    expect(edited.chainOk).toBe(false);
    expect(edited.firstBreak).toBe(4);
    expect(edited.filesOk).toBe(false);

    const dropped = mutate((f) => {
      const lines = f.get(EVENTS_FILE)!.toString("utf8").split("\n");
      lines.splice(4, 1);
      f.set(EVENTS_FILE, Buffer.from(lines.join("\n")));
    });
    expect(dropped.chainOk).toBe(false);

    const report = mutate((f) => f.set(REPORT_FILE, Buffer.from("# nothing happened\n")));
    expect(report.ok).toBe(false);
    expect(report.filesOk).toBe(false);
    expect(report.problems).toContain(`${REPORT_FILE} does not match its manifest digest`);

    const missing = mutate((f) => f.delete(AUDIT_SLICE_FILE));
    expect(missing.problems).toContain(`${AUDIT_SLICE_FILE} listed in the manifest but missing`);

    const extra = mutate((f) => f.set("notes.txt", Buffer.from("hi")));
    expect(extra.ok).toBe(false);
    expect(extra.problems).toContain("notes.txt is not listed in the manifest");

    const status = mutate((f) => {
      const m = JSON.parse(f.get(MANIFEST_FILE)!.toString("utf8")) as EvidenceManifest;
      m.status = "failed";
      f.set(MANIFEST_FILE, Buffer.from(JSON.stringify(m)));
    });
    expect(status.signatureOk).toBe(false);
    expect(status.ok).toBe(false);

    const object = mutate((f) => {
      const name = [...f.keys()].find((k) => k.startsWith("snapshots/objects/"))!;
      f.set(name, Buffer.from("export const a = 2;\n"));
    });
    expect(object.snapshotsOk).toBe(false);
    expect(object.filesOk).toBe(false);

    const slice = mutate((f) => {
      const line = JSON.parse(f.get(AUDIT_SLICE_FILE)!.toString("utf8").trim());
      line.outcome = "ok";
      f.set(AUDIT_SLICE_FILE, Buffer.from(`${JSON.stringify(line)}\n`));
    });
    expect(slice.auditSliceOk).toBe(false);
  });

  test("re-signing an altered log with another key passes the export signature but not the job-end one", async () => {
    await recordJob();
    const out = path.join(home, "out", "c");
    await exportEvidenceBundle({ jobId: job.id, out, env, key });
    const files = await loadBundle(out);
    const original = JSON.parse(files.get(MANIFEST_FILE)!.toString("utf8")) as EvidenceManifest;
    // Drop the permission event and rebuild a consistent chain, then sign with a different key.
    const { eventHash, EVIDENCE_GENESIS } = await import("./store.js");
    const events = files
      .get(EVENTS_FILE)!
      .toString("utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((e) => e.type !== "permission");
    let prev = EVIDENCE_GENESIS;
    const rebuilt = events.map((e, i) => {
      const base = { seq: i + 1, ts: e.ts, type: e.type, jobId: e.jobId, data: e.data };
      const hash = eventHash(prev, base);
      const next = { ...base, prev, hash };
      prev = hash;
      return next;
    });
    const eventsRaw = Buffer.from(rebuilt.map((e) => `${JSON.stringify(e)}\n`).join(""));
    files.set(EVENTS_FILE, eventsRaw);
    const { sha256Hex } = await import("../continuity-suite/manifest.js");
    const { signer: _s, signature: _g, ...unsigned } = original;
    unsigned.events = { ...unsigned.events, root: prev, count: rebuilt.length };
    unsigned.files[EVENTS_FILE] = { sha256: sha256Hex(eventsRaw), size: eventsRaw.length };
    const other = keyAt(path.join(home, "identity", "other.json"));
    const resigned = signEvidenceManifest(unsigned, other);
    files.set(MANIFEST_FILE, Buffer.from(JSON.stringify(resigned)));
    const v = verifyBundleFiles(files);
    expect(v.chainOk).toBe(true);
    expect(v.filesOk).toBe(true);
    expect(v.signatureOk).toBe(true);
    expect(v.recordedOk).toBe(false);
    expect(v.ok).toBe(false);
    expect(v.manifest?.signer.keyId).not.toBe(original.signer.keyId);
  });

  test("export refuses unknown and unfinished jobs", async () => {
    await expect(
      exportEvidenceBundle({ jobId: "nope", out: path.join(home, "x"), env, key }),
    ).rejects.toThrow(/no evidence/);
    const r = new EvidenceRecorder(
      { ...job, id: "job-8", startedAt: new Date().toISOString() },
      { env, key },
    );
    r.start({ prompt: "x" });
    await expect(
      exportEvidenceBundle({ jobId: "job-8", out: path.join(home, "x"), env, key }),
    ).rejects.toThrow(/not finished/);
    await expect(
      exportEvidenceBundle({ jobId: "../etc", out: path.join(home, "x"), env, key }),
    ).rejects.toThrow(/invalid job id/);
  });

  test("audit slice: window and session/job matching", async () => {
    const dir = path.join(home, "audit");
    const t0 = Date.parse("2026-10-14T10:00:00.000Z");
    let i = 0;
    const now = () => new Date(t0 + i++ * 10_000);
    await appendAudit(
      { action: "early", outcome: "ok", source: "t", scope: sessionKey },
      { dir, now },
    );
    await appendAudit(
      { action: "in", outcome: "ok", source: "t", scope: "AGENT:ALICE:MAIN" },
      { dir, now },
    );
    await appendAudit(
      { action: "byjob", outcome: "ok", source: "t", detail: { jobId: "j" } },
      { dir, now },
    );
    await appendAudit(
      { action: "byrun", outcome: "ok", source: "t", detail: { runId: "r" } },
      { dir, now },
    );
    await appendAudit(
      { action: "other", outcome: "ok", source: "t", scope: "agent:bob:main" },
      { dir, now },
    );
    await appendAudit(
      { action: "late", outcome: "ok", source: "t", scope: sessionKey },
      { dir, now },
    );
    const slice = sliceAuditLog({
      auditDir: dir,
      jobId: "j",
      sessionKey,
      runId: "r",
      startedAt: new Date(t0 + 10_000 - 500).toISOString(),
      endedAt: new Date(t0 + 30_000 + 500).toISOString(),
    });
    expect(slice.map((e) => e.action)).toEqual(["in", "byjob", "byrun"]);
  });
});
