import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { chainEntries, type SigningKey, signManifest } from "./manifest.js";
import { buildReport, readReport, reportToMarkdown, verifyReport, writeReport } from "./report.js";
import { movedHomeOf, parseDisruptions, scanForLeaks } from "./runner.js";
import { scoreRun } from "./scorer.js";
import {
  CONTINUITY_MANIFEST_VERSION,
  type ContinuityManifest,
  type ContinuityRun,
  type ProbeSnapshot,
} from "./types.js";

const KEY: SigningKey = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
})();

function manifest(sha: string): ContinuityManifest {
  const chained = chainEntries([
    { kind: "identity", name: "IDENTITY.md", sha256: sha },
    { kind: "audit", name: "chain", value: { ok: true, entries: 1, lastSeq: 1 } },
  ]);
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
        audit: 1,
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
    chat: { ok: true, model: "alpha", marker: "CM-1", text: "model=alpha; marker=CM-1; echo=hi" },
    audit: { ok: true, entries: 1, lastSeq: 1, headHash: "h1" },
    auditAnchor: pid === 2 ? { seq: 1, hash: "h1" } : undefined,
    authEnforced: true,
    role: {},
  };
}

function run(): ContinuityRun {
  const before = { manifest: manifest("aa"), probes: probes(1) };
  const after = { manifest: manifest("aa"), probes: probes(2) };
  const outcome = {
    disruption: "restart" as const,
    applied: true,
    detail: "restarted",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:05.000Z",
    expectedMarker: "CM-1",
  };
  const leakScan = { scanned: 4, leaked: false, where: [] };
  const invariants = scoreRun({ disruption: "restart", before, after, outcome, leakScan });
  return { disruption: "restart", before, outcome, after, invariants, leakScan };
}

describe("continuity report", () => {
  test("builds a summary, a badge and markdown; writes three files; reads back", () => {
    const report = buildReport({
      resident: "alice",
      gateway: { baseUrl: "http://127.0.0.1:1", mode: "throwaway" },
      runs: [run()],
      createdAt: "2026-01-01T00:01:00.000Z",
    });
    expect(report.summary.verdict).toBe("PASS");
    expect(report.summary.fail).toBe(0);
    expect(report.summary.badge).toMatch(
      /^continuity PASS \| resident=alice \| restart \| pass=\d+ fail=0 skip=\d+ \| [0-9a-f]{8}>[0-9a-f]{8} \| 2026-01-01T00:01:00.000Z$/,
    );
    const md = reportToMarkdown(report);
    expect(md).toContain("# Continuity report: alice");
    expect(md).toContain("| C1 identity files unchanged | pass |");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cont-report-"));
    try {
      const files = writeReport(dir, report);
      expect(fs.existsSync(files.json)).toBe(true);
      expect(fs.readFileSync(files.badge, "utf8").trim()).toBe(report.summary.badge);
      expect(readReport(files.json).summary.badge).toBe(report.summary.badge);
      expect(() => readReport(files.md)).toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("verifyReport accepts an untouched report and catches edits to manifests, scores and badge", () => {
    const report = buildReport({
      resident: "alice",
      gateway: { baseUrl: "http://127.0.0.1:1", mode: "throwaway" },
      runs: [run()],
    });
    expect(verifyReport(report).ok).toBe(true);

    const manifestEdit = structuredClone(report);
    manifestEdit.runs[0].after.manifest.entries[0].sha256 = "bb";
    const v1 = verifyReport(manifestEdit);
    expect(v1.ok).toBe(false);
    expect(v1.runs[0].afterManifest).toBe(false);

    const scoreEdit = structuredClone(report);
    scoreEdit.runs[0].invariants[1].status = "fail";
    scoreEdit.summary.fail = 1;
    scoreEdit.summary.pass -= 1;
    scoreEdit.summary.verdict = "FAIL";
    const v2 = verifyReport(scoreEdit);
    expect(v2.ok).toBe(false);
    expect(v2.runs[0].mismatches[0]).toContain("C1: stored fail, recomputed pass");

    const badgeEdit = structuredClone(report);
    badgeEdit.summary.badge = badgeEdit.summary.badge.replace("PASS", "FAIL");
    expect(verifyReport(badgeEdit)).toMatchObject({ ok: false, badgeMatches: false });

    const countEdit = structuredClone(report);
    countEdit.summary.skip = 7;
    expect(verifyReport(countEdit)).toMatchObject({ ok: false, summaryMatches: false });
  });
});

describe("runner helpers", () => {
  test("parseDisruptions accepts all, lists and rejects unknown names", () => {
    expect(parseDisruptions(undefined)).toEqual(["model-swap", "restart", "move", "close"]);
    expect(parseDisruptions("restart,close,restart")).toEqual(["restart", "close"]);
    expect(() => parseDisruptions("reboot")).toThrow(/unknown disruption: reboot/);
  });

  test("scanForLeaks finds the owner credential and private keys, ignores short secrets", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const texts = [
      { where: "GET /a", text: '{"ok":true}' },
      { where: "GET /b", text: `{"token":"${token}"}` },
      { where: "manifest", text: "-----BEGIN PRIVATE KEY-----\nabc" },
    ];
    const scan = scanForLeaks(texts, [token, "short"]);
    expect(scan).toEqual({
      scanned: 3,
      leaked: true,
      where: ["GET /b: owner credential", "manifest: -----BEGIN PRIVATE KEY-----"],
    });
    expect(scanForLeaks([{ where: "x", text: "short" }], ["short"]).leaked).toBe(false);
  });

  test("movedHomeOf keeps the .kolo-test suffix", () => {
    expect(path.basename(movedHomeOf("/tmp/x/cont.kolo-test"))).toBe("cont-moved.kolo-test");
    expect(path.basename(movedHomeOf("/tmp/x/cont"))).toBe("cont-moved");
  });
});
