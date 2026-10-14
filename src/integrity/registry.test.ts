import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushAudit } from "../audit/audit-log.js";
import { tailAudit, verifyAuditChain } from "../audit/verify.js";
import {
  IntegrityGateError,
  INTEGRITY_EXIT_CODE,
  __testing as gateTesting,
  getIntegrityStatus,
  runBootIntegrityGate,
} from "./gate.js";
import { expandIntegrityPatterns } from "./glob.js";
import {
  initRegistry,
  resolveIntegrityLocations,
  updateRegistry,
  verifyRegistry,
  type IntegrityLocations,
} from "./registry.js";

let home: string;
let ext: string;
let loc: IntegrityLocations;
const prevEnv = { ...process.env };
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-integrity-home-"));
  ext = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-integrity-ext-"));
  process.env.KOLO_HOME = home;
  delete process.env.KOLO_INTEGRITY;
  delete process.env.KOLO_INTEGRITY_KEY_FILE;
  loc = resolveIntegrityLocations();
  write(path.join(home, "workspace-atlas", "SOUL.md"), "atlas soul\n");
  write(path.join(home, "workspace-iris", "SOUL.md"), "iris soul\n");
  write(path.join(home, "workspace-iris", "COVENANT.md"), "iris covenant\n");
  write(path.join(home, "workspace-iris", "notes.md"), "not constitution\n");
  write(path.join(ext, "SOUL_CORE", "MORAL_SPINE_SUMMARY.md"), "spine\n");
  write(path.join(ext, "SOUL_CORE", "HANDOFF_LATEST.md"), "changes every session\n");
  gateTesting.reset();
  log.info.mockReset();
  log.warn.mockReset();
  log.error.mockReset();
});

afterEach(async () => {
  await flushAudit();
  process.env = { ...prevEnv };
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(ext, { recursive: true, force: true });
});

const patterns = () => [
  "workspace-*/{SOUL,COVENANT}.md",
  `${ext}/SOUL_CORE/**`,
  `!${ext}/SOUL_CORE/HANDOFF_*.md`,
];

describe("glob expansion", () => {
  it("expands relative-to-KOLO_HOME, absolute, brace and negated patterns", () => {
    const files = expandIntegrityPatterns(patterns(), { baseDir: home });
    expect(files).toEqual(
      [
        path.join(ext, "SOUL_CORE", "MORAL_SPINE_SUMMARY.md"),
        path.join(home, "workspace-iris", "COVENANT.md"),
        path.join(home, "workspace-iris", "SOUL.md"),
        path.join(home, "workspace-atlas", "SOUL.md"),
      ].toSorted(),
    );
  });
});

describe("integrity registry", () => {
  it("is unconfigured before init and ok right after", () => {
    expect(verifyRegistry(loc).state).toBe("unconfigured");
    const { registry, createdKey } = initRegistry({ patterns: patterns(), loc });
    expect(createdKey).toBe(true);
    expect(registry.entries).toHaveLength(4);
    if (process.platform !== "win32") {
      // NTFS has no POSIX mode bits; fs.chmod is a no-op there and stat reports 0o666.
      expect(fs.statSync(loc.keyPath).mode & 0o777).toBe(0o600);
    }
    expect(verifyRegistry(loc)).toMatchObject({ state: "ok", checked: 4, problems: [] });
    expect(() => initRegistry({ patterns: patterns(), loc })).toThrow(/already exists/);
  });

  it("reports a changed file and a missing file by name", () => {
    initRegistry({ patterns: patterns(), loc });
    fs.appendFileSync(path.join(home, "workspace-atlas", "SOUL.md"), "edited\n");
    fs.rmSync(path.join(home, "workspace-iris", "COVENANT.md"));
    const r = verifyRegistry(loc);
    expect(r.state).toBe("failed");
    expect(
      r.problems.map((p) => `${p.kind}:${p.path}`).toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(
      [
        `missing:${path.join(home, "workspace-iris", "COVENANT.md")}`,
        `mismatch:${path.join(home, "workspace-atlas", "SOUL.md")}`,
      ].toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("rejects a registry edited without the key, and a deleted registry while the key exists", () => {
    initRegistry({ patterns: patterns(), loc });
    const reg = JSON.parse(fs.readFileSync(loc.registryPath, "utf8"));
    fs.appendFileSync(path.join(home, "workspace-atlas", "SOUL.md"), "edited\n");
    reg.entries = reg.entries.filter((e: { path: string }) => !e.path.includes("workspace-atlas"));
    fs.writeFileSync(loc.registryPath, JSON.stringify(reg));
    expect(verifyRegistry(loc).problems[0]?.message).toMatch(/signature is invalid/);
    expect(() =>
      updateRegistry({ paths: [path.join(home, "workspace-atlas", "SOUL.md")], loc }),
    ).toThrow(/signature/);
    fs.rmSync(loc.registryPath);
    expect(verifyRegistry(loc)).toMatchObject({ state: "failed" });
    expect(verifyRegistry(loc).problems[0]?.message).toMatch(/registry was deleted/);
  });

  it("update re-registers an intended change, adds and removes paths", () => {
    initRegistry({ patterns: patterns(), loc });
    const soul = path.join(home, "workspace-atlas", "SOUL.md");
    fs.appendFileSync(soul, "intended\n");
    expect(verifyRegistry(loc).state).toBe("failed");
    const { changes } = updateRegistry({
      paths: [soul, path.join(home, "workspace-iris", "notes.md")],
      loc,
    });
    expect(changes.map((c) => c.change)).toEqual(["updated", "added"]);
    expect(verifyRegistry(loc)).toMatchObject({ state: "ok", checked: 5 });
    updateRegistry({ paths: [path.join(home, "workspace-iris", "notes.md")], remove: true, loc });
    expect(verifyRegistry(loc).checked).toBe(4);
  });
});

describe("boot integrity gate", () => {
  it("refuses to start (exit code 3) on mismatch and audits the failure", async () => {
    initRegistry({ patterns: patterns(), loc });
    fs.appendFileSync(path.join(home, "workspace-iris", "SOUL.md"), "x\n");
    const err = await runBootIntegrityGate({ log }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrityGateError);
    expect((err as IntegrityGateError).exitCode).toBe(INTEGRITY_EXIT_CODE);
    expect(INTEGRITY_EXIT_CODE).toBe(3);
    expect((err as Error).message).toContain(path.join(home, "workspace-iris", "SOUL.md"));
    expect(getIntegrityStatus().integrity).toBe("failed");
    await flushAudit();
    const auditDir = path.join(home, "audit");
    expect(
      tailAudit(auditDir, 5).some((e) => e.action === "integrity.verify" && e.outcome === "failed"),
    ).toBe(true);
    expect(verifyAuditChain(auditDir).ok).toBe(true);
  });

  it("KOLO_INTEGRITY=warn logs and continues (health warn)", async () => {
    initRegistry({ patterns: patterns(), loc });
    fs.rmSync(path.join(home, "workspace-atlas", "SOUL.md"));
    const result = await runBootIntegrityGate({
      log,
      env: { ...process.env, KOLO_INTEGRITY: "warn" },
    });
    expect(result.state).toBe("failed");
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("development only"));
    expect(getIntegrityStatus().integrity).toBe("warn");
  });

  it("passes with an intact registry and with no registry at all", async () => {
    await expect(runBootIntegrityGate({ log })).resolves.toMatchObject({ state: "unconfigured" });
    initRegistry({ patterns: patterns(), loc });
    await expect(runBootIntegrityGate({ log })).resolves.toMatchObject({ state: "ok", checked: 4 });
    expect(getIntegrityStatus({ force: true }).integrity).toBe("ok");
  });
});
