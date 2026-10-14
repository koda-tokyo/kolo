import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { RunOptions } from "../continuity-suite/runner.js";
import type { RuntimeEnv } from "../runtime.js";
import { chainEntries, type SigningKey, signManifest } from "../continuity-suite/manifest.js";
import { buildReport, REPORT_JSON, writeReport } from "../continuity-suite/report.js";
import { scoreRun } from "../continuity-suite/scorer.js";
import {
  CONTINUITY_MANIFEST_VERSION,
  type ContinuityManifest,
  type ContinuityReport,
  type ContinuityRun,
  type ProbeSnapshot,
} from "../continuity-suite/types.js";
import {
  buildRunOptions,
  CONTINUITY_EXIT,
  readFactsFile,
  runContinuityBadge,
  runContinuityRun,
  runContinuityVerify,
} from "./continuity-cli.js";

const KEY: SigningKey = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
})();

function manifest(): ContinuityManifest {
  const chained = chainEntries([{ kind: "identity", name: "IDENTITY.md", sha256: "aa" }]);
  return signManifest(
    {
      version: CONTINUITY_MANIFEST_VERSION,
      resident: "alice",
      createdAt: "2026-01-01T00:00:00.000Z",
      counts: {
        identity: 1,
        memory: 0,
        role: 0,
        model: 0,
        job: 0,
        session: 0,
        transcript: 0,
        audit: 0,
      },
      entries: chained.entries,
      root: chained.root,
    },
    KEY,
  );
}

function probes(pid: number): ProbeSnapshot {
  return {
    takenAt: "2026-01-01T00:00:00.000Z",
    health: { pid },
    sessions: [],
    jobs: [],
    devices: [],
    recall: [],
    chat: { ok: true, model: "alpha", marker: "CM-1", text: "" },
    audit: { ok: true, entries: 1, lastSeq: 1, headHash: "h1" },
    auditAnchor: pid === 2 ? { seq: 1, hash: "h1" } : undefined,
    authEnforced: true,
    role: {},
  };
}

function fakeReport(verdict: "PASS" | "FAIL" = "PASS"): ContinuityReport {
  const before = { manifest: manifest(), probes: probes(1) };
  const after = { manifest: manifest(), probes: probes(2) };
  if (verdict === "FAIL") {
    after.probes.authEnforced = false;
  }
  const outcome = {
    disruption: "restart" as const,
    applied: true,
    detail: "restarted",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    expectedMarker: "CM-1",
  };
  const leakScan = { scanned: 1, leaked: false, where: [] };
  const run: ContinuityRun = {
    disruption: "restart",
    before,
    outcome,
    after,
    invariants: scoreRun({ disruption: "restart", before, after, outcome, leakScan }),
    leakScan,
  };
  return buildReport({
    resident: "alice",
    gateway: { baseUrl: "http://127.0.0.1:1", mode: "throwaway" },
    runs: [run],
  });
}

function runtime(): RuntimeEnv & { out: string[]; err: string[]; codes: number[] } {
  const out: string[] = [];
  const err: string[] = [];
  const codes: number[] = [];
  return {
    out,
    err,
    codes,
    log: (...args: unknown[]) => out.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => err.push(args.map(String).join(" ")),
    exit: (code?: number) => {
      codes.push(code ?? 0);
      return undefined as never;
    },
  } as unknown as RuntimeEnv & { out: string[]; err: string[]; codes: number[] };
}

describe("kolo continuity run", () => {
  let dir = "";
  const savedToken = process.env.KOLO_GATEWAY_TOKEN;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cont-cli-"));
    delete process.env.KOLO_GATEWAY_TOKEN;
  });

  afterEach(() => {
    if (savedToken === undefined) {
      delete process.env.KOLO_GATEWAY_TOKEN;
    } else {
      process.env.KOLO_GATEWAY_TOKEN = savedToken;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("throwaway options come from flags and smoke env; attached needs a resident and a credential", async () => {
    const log = () => {};
    const t = await buildRunOptions(
      {
        throwaway: true,
        disruption: "restart,close",
        home: path.join(dir, "x.kolo-test"),
        port: "18891",
      },
      {},
      log,
    );
    expect(t).toMatchObject({
      mode: "throwaway",
      resident: "alice",
      disruptions: ["restart", "close"],
      port: 18891,
    });
    await expect(buildRunOptions({ throwaway: true, port: "nope" }, {}, log)).rejects.toThrow(
      /--port/,
    );
    await expect(buildRunOptions({ resident: "Bad Id" }, {}, log)).rejects.toThrow(/--resident/);
    await expect(buildRunOptions({}, {}, log)).rejects.toThrow(/--resident <id> is required/);
    const discover = async () => ({
      baseUrl: "http://127.0.0.1:9",
      token: undefined,
      tokenSource: "none",
    });
    await expect(buildRunOptions({ resident: "alice" }, { discover }, log)).rejects.toThrow(
      /no owner credential/,
    );
    const found = async () => ({
      baseUrl: "http://127.0.0.1:9",
      token: "tok",
      tokenSource: "file",
    });
    const a = await buildRunOptions(
      { resident: "alice", disruption: "all", swapTo: "p/m" },
      { discover: found },
      log,
    );
    expect(a).toMatchObject({
      mode: "attached",
      baseUrl: "http://127.0.0.1:9",
      token: "tok",
      swapTo: "p/m",
      chat: false,
    });
    expect((a as { disruptions: string[] }).disruptions).toHaveLength(4);
  });

  test("facts file is validated", () => {
    const file = path.join(dir, "facts.json");
    fs.writeFileSync(file, JSON.stringify([{ query: "a", expect: "A" }]));
    expect(readFactsFile(file)).toEqual([{ query: "a", expect: "A" }]);
    fs.writeFileSync(file, JSON.stringify([{ query: 1 }]));
    expect(() => readFactsFile(file)).toThrow(/entry 0/);
    fs.writeFileSync(file, "{}");
    expect(() => readFactsFile(file)).toThrow(/JSON array/);
  });

  test("run writes the report, prints a summary and exits 0 on PASS, 1 on FAIL, 2 on usage", async () => {
    const rt = runtime();
    let seen: RunOptions | undefined;
    const run = async (opts: RunOptions) => {
      seen = opts;
      return fakeReport("PASS");
    };
    const out = path.join(dir, "out");
    const code = await runContinuityRun(
      {
        throwaway: true,
        disruption: "restart",
        out,
        home: path.join(dir, "h.kolo-test"),
        quiet: true,
      },
      { runtime: rt, run },
    );
    expect(code).toBe(CONTINUITY_EXIT.ok);
    expect(seen?.mode).toBe("throwaway");
    expect(fs.existsSync(path.join(out, REPORT_JSON))).toBe(true);
    expect(rt.out.join("\n")).toContain("verdict      PASS");
    expect(rt.out.join("\n")).toContain("badge        continuity PASS");

    const failing = runtime();
    const code2 = await runContinuityRun(
      { throwaway: true, out, home: path.join(dir, "h.kolo-test"), quiet: true, json: true },
      { runtime: failing, run: async () => fakeReport("FAIL") },
    );
    expect(code2).toBe(CONTINUITY_EXIT.failed);
    expect(JSON.parse(failing.out[0]).summary.verdict).toBe("FAIL");

    const usage = runtime();
    expect(
      await runContinuityRun(
        { throwaway: true, disruption: "reboot", out },
        { runtime: usage, run },
      ),
    ).toBe(CONTINUITY_EXIT.usage);
    expect(usage.err[0]).toContain("unknown disruption");

    const unreachable = runtime();
    const dead = async () => {
      throw new Error("gateway http://127.0.0.1:1: /health HTTP 503");
    };
    expect(
      await runContinuityRun(
        { throwaway: true, out, home: path.join(dir, "h.kolo-test") },
        { runtime: unreachable, run: dead },
      ),
    ).toBe(CONTINUITY_EXIT.unreachable);
  });

  test("verify and badge read a saved report and detect tampering", () => {
    const report = fakeReport("PASS");
    const files = writeReport(path.join(dir, "out"), report);
    const rt = runtime();
    expect(runContinuityVerify(files.json, {}, { runtime: rt })).toBe(CONTINUITY_EXIT.ok);
    expect(rt.out.join("\n")).toContain("integrity    ok");
    const badge = runtime();
    expect(runContinuityBadge(files.json, { runtime: badge })).toBe(CONTINUITY_EXIT.ok);
    expect(badge.out[0]).toBe(report.summary.badge);

    const tampered = structuredClone(report);
    tampered.runs[0].invariants[1].status = "fail";
    fs.writeFileSync(files.json, JSON.stringify(tampered));
    const rt2 = runtime();
    expect(runContinuityVerify(files.json, { json: true }, { runtime: rt2 })).toBe(
      CONTINUITY_EXIT.failed,
    );
    expect(JSON.parse(rt2.out[0]).ok).toBe(false);
    const badge2 = runtime();
    expect(runContinuityBadge(files.json, { runtime: badge2 })).toBe(CONTINUITY_EXIT.failed);
    expect(badge2.out[0]).toContain("UNVERIFIED");

    const missing = runtime();
    expect(runContinuityVerify(path.join(dir, "nope.json"), {}, { runtime: missing })).toBe(
      CONTINUITY_EXIT.usage,
    );
  });
});
