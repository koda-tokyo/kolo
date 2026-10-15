import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import { EvidenceRecorder } from "../evidence/recorder.js";
import { EVENTS_FILE, MANIFEST_FILE } from "../evidence/store.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import {
  EVIDENCE_EXIT,
  runEvidenceExport,
  runEvidenceList,
  runEvidencePrune,
  runEvidenceShow,
  runEvidenceVerify,
} from "./evidence-cli.js";

let home: string;
let env: NodeJS.ProcessEnv;
let out: string[];
let errs: string[];
let runtime: RuntimeEnv;

function record(id: string, endedAt: string) {
  const idn = loadOrCreateDeviceIdentity(path.join(home, "identity", "continuity-signing.json"));
  const r = new EvidenceRecorder(
    {
      id,
      agent: "alice",
      sessionKey: "agent:alice:main",
      kind: "agent",
      startedAt: new Date(Date.parse(endedAt) - 5000).toISOString(),
    },
    { env, key: { privateKeyPem: idn.privateKeyPem, publicKeyPem: idn.publicKeyPem } },
  );
  r.start({ prompt: "hello" });
  r.toolStart({ toolCallId: "t", name: "read", args: { path: "a" } });
  r.toolEnd({ toolCallId: "t", name: "read", result: "x", isError: false });
  r.finish({ status: "succeeded", steps: 1, toolCalls: 1, endedAt });
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-evcli-"));
  env = { ...process.env, KOLO_HOME: home, KOLO_STATE_DIR: home };
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

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("kurahi evidence", () => {
  test("list and show", () => {
    expect(runEvidenceList({}, { runtime, env })).toBe(0);
    expect(out[0]).toContain("no jobs recorded yet");
    record("job-a", new Date().toISOString());
    out = [];
    expect(runEvidenceList({}, { runtime, env })).toBe(0);
    expect(out[0]).toContain("job-a");
    expect(out[0]).toContain("succeeded");
    out = [];
    expect(runEvidenceList({ json: true }, { runtime, env })).toBe(0);
    expect(JSON.parse(out[0]).jobs[0]).toMatchObject({ jobId: "job-a", signed: true, events: 4 });
    out = [];
    expect(runEvidenceShow("job-a", {}, { runtime, env })).toBe(0);
    const text = out[0];
    expect(text).toContain("job          job-a");
    expect(text).toContain("tool calls   1 (0 failed): read x1");
    expect(text).toContain("signed       yes");
    expect(runEvidenceShow("missing", {}, { runtime, env })).toBe(EVIDENCE_EXIT.failed);
    expect(errs[0]).toContain("no evidence for job missing");
    expect(runEvidenceShow("../x", {}, { runtime, env })).toBe(EVIDENCE_EXIT.usage);
  });

  test("export then verify, zip and dir, with a tampered copy failing", async () => {
    record("job-b", new Date().toISOString());
    const zip = path.join(home, "b.zip");
    expect(await runEvidenceExport("job-b", { out: zip }, { runtime, env })).toBe(0);
    expect(out[0]).toContain(`bundle       ${zip} (zip`);
    expect(out[0]).toContain("verify with");
    out = [];
    expect(await runEvidenceVerify(zip, {}, { runtime, env })).toBe(0);
    expect(out[0]).toContain("verdict      PASS");
    const dir = path.join(home, "b-dir");
    out = [];
    expect(await runEvidenceExport("job-b", { out: dir, json: true }, { runtime, env })).toBe(0);
    expect(JSON.parse(out[0]).format).toBe("dir");
    const events = path.join(dir, EVENTS_FILE);
    fs.appendFileSync(events, `${JSON.stringify({ seq: 99, type: "tool.call" })}\n`);
    out = [];
    expect(await runEvidenceVerify(dir, {}, { runtime, env })).toBe(EVIDENCE_EXIT.failed);
    expect(out[0]).toContain("verdict      FAIL");
    expect(out[0]).toContain("chain        FAIL");
    out = [];
    expect(await runEvidenceVerify(dir, { json: true }, { runtime, env })).toBe(
      EVIDENCE_EXIT.failed,
    );
    expect(JSON.parse(out[0]).ok).toBe(false);
    expect(await runEvidenceVerify(path.join(home, "nope"), {}, { runtime, env })).toBe(
      EVIDENCE_EXIT.failed,
    );
    expect(await runEvidenceVerify("", {}, { runtime, env })).toBe(EVIDENCE_EXIT.usage);
    expect(await runEvidenceExport("job-zzz", {}, { runtime, env })).toBe(EVIDENCE_EXIT.failed);
    expect(fs.existsSync(path.join(dir, MANIFEST_FILE))).toBe(true);
  });

  test("prune applies retention and honours --dry-run", () => {
    record("old", new Date(Date.now() - 40 * 86_400_000).toISOString());
    record("new", new Date().toISOString());
    expect(runEvidencePrune({ days: "30", dryRun: true }, { runtime, env })).toBe(0);
    expect(out[0]).toContain("would remove 1 job older than 30 days");
    expect(fs.existsSync(path.join(home, "evidence", "old"))).toBe(true);
    out = [];
    expect(runEvidencePrune({ days: "30" }, { runtime, env })).toBe(0);
    expect(out[0]).toContain("removed 1 job");
    expect(fs.existsSync(path.join(home, "evidence", "old"))).toBe(false);
    expect(fs.existsSync(path.join(home, "evidence", "new"))).toBe(true);
    expect(runEvidencePrune({ days: "-1" }, { runtime, env })).toBe(EVIDENCE_EXIT.usage);
  });
});
