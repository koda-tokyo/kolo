import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIT_GENESIS,
  appendAudit,
  auditFileForMonth,
  flushAudit,
  sha256Hex,
} from "./audit-log.js";
import { tailAudit, verifyAuditChain } from "./verify.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-audit-"));
});

afterEach(async () => {
  await flushAudit();
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => () => new Date(iso);

function lines(month: string): string[] {
  return fs.readFileSync(auditFileForMonth(dir, month), "utf8").trim().split("\n");
}

describe("audit chain", () => {
  it("appends hash-chained entries with seq, prev and hash", async () => {
    const a = await appendAudit(
      { action: "a", outcome: "ok", source: "test" },
      { dir, now: at("2026-10-13T01:00:00Z") },
    );
    const b = await appendAudit(
      { action: "b", outcome: "denied", source: "test", identity: "atlas" },
      { dir, now: at("2026-10-13T01:00:01Z") },
    );
    expect(a.seq).toBe(1);
    expect(a.prev).toBe(AUDIT_GENESIS);
    expect(b.seq).toBe(2);
    expect(b.prev).toBe(sha256Hex(lines("2026-10")[0]));
    expect(verifyAuditChain(dir)).toMatchObject({ ok: true, entries: 2, lastSeq: 2 });
    const head = JSON.parse(fs.readFileSync(path.join(dir, "HEAD"), "utf8"));
    expect(head).toMatchObject({
      day: "2026-10-13",
      month: "2026-10",
      seq: 2,
      lineHash: sha256Hex(lines("2026-10")[1]),
    });
  });

  it("serializes concurrent appends into one unbroken chain", async () => {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        appendAudit({ action: `x${i}`, outcome: "ok", source: "test" }, { dir }),
      ),
    );
    const result = verifyAuditChain(dir);
    expect(result.ok).toBe(true);
    expect(result.entries).toBe(25);
  });

  it("detects an edited line", async () => {
    for (let i = 0; i < 3; i++) {
      await appendAudit(
        { action: `e${i}`, outcome: "ok", source: "test" },
        { dir, now: at("2026-10-13T02:00:00Z") },
      );
    }
    const file = auditFileForMonth(dir, "2026-10");
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace('"action":"e1","outcome":"ok"', '"action":"e1","outcome":"denied"'),
    );
    const r = verifyAuditChain(dir);
    expect(r.ok).toBe(false);
    expect(r.firstBreak).toMatchObject({ line: 2, seq: 2 });
    expect(r.firstBreak?.reason).toMatch(/hash mismatch/);
  });

  it("detects a removed line and tail truncation", async () => {
    for (let i = 0; i < 4; i++) {
      await appendAudit(
        { action: `r${i}`, outcome: "ok", source: "test" },
        { dir, now: at("2026-10-13T03:00:00Z") },
      );
    }
    const file = auditFileForMonth(dir, "2026-10");
    const original = fs.readFileSync(file, "utf8").trim().split("\n");
    fs.writeFileSync(file, `${[original[0], original[2], original[3]].join("\n")}\n`);
    expect(verifyAuditChain(dir).firstBreak).toMatchObject({ line: 2, seq: 3 });
    // Dropping the last line keeps the chain internally valid; HEAD catches it.
    fs.writeFileSync(file, `${original.slice(0, 3).join("\n")}\n`);
    const r = verifyAuditChain(dir);
    expect(r.ok).toBe(false);
    expect(r.firstBreak?.reason).toMatch(/truncated/);
  });

  it("chains across a month rollover and records the closing day head", async () => {
    await appendAudit(
      { action: "sep", outcome: "ok", source: "test" },
      { dir, now: at("2026-09-30T23:59:59Z") },
    );
    await appendAudit(
      { action: "oct", outcome: "ok", source: "test" },
      { dir, now: at("2026-10-01T00:00:01Z") },
    );
    expect(fs.existsSync(auditFileForMonth(dir, "2026-09"))).toBe(true);
    const oct = JSON.parse(lines("2026-10")[0]);
    expect(oct.seq).toBe(2);
    expect(oct.prev).toBe(sha256Hex(lines("2026-09")[0]));
    expect(verifyAuditChain(dir)).toMatchObject({
      ok: true,
      entries: 2,
      months: ["2026-09", "2026-10"],
    });
    expect(verifyAuditChain(dir, { month: "2026-10" })).toMatchObject({ ok: true, entries: 1 });
    const heads = fs.readFileSync(path.join(dir, "HEADS.jsonl"), "utf8").trim().split("\n");
    expect(JSON.parse(heads[0])).toMatchObject({ day: "2026-09-30", seq: 1 });
    // Deleting the earlier month breaks the chain at the first October entry.
    fs.rmSync(auditFileForMonth(dir, "2026-09"));
    expect(verifyAuditChain(dir).firstBreak?.reason).toMatch(/genesis/);
  });

  it("redacts secret values on write and on tail", async () => {
    await appendAudit(
      {
        action: "device.token.issue",
        outcome: "ok",
        source: "test",
        detail: {
          token: "abcdef0123456789abcdef",
          nested: { password: "hunter2hunter2" },
          note: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123",
          sha256: "a".repeat(64),
        },
      },
      { dir },
    );
    const raw = fs.readFileSync(
      auditFileForMonth(dir, new Date().toISOString().slice(0, 7)),
      "utf8",
    );
    expect(raw).not.toContain("abcdef0123456789abcdef");
    expect(raw).not.toContain("hunter2hunter2");
    expect(raw).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(raw).toContain("a".repeat(64));
    const [entry] = tailAudit(dir, 5);
    expect(entry.detail).toMatchObject({ token: "[redacted]", nested: { password: "[redacted]" } });
    expect(verifyAuditChain(dir).ok).toBe(true);
  });

  it("tail returns the last n entries across months, oldest first", async () => {
    await appendAudit(
      { action: "t1", outcome: "ok", source: "test" },
      { dir, now: at("2026-09-30T10:00:00Z") },
    );
    await appendAudit(
      { action: "t2", outcome: "ok", source: "test" },
      { dir, now: at("2026-10-01T10:00:00Z") },
    );
    await appendAudit(
      { action: "t3", outcome: "ok", source: "test" },
      { dir, now: at("2026-10-01T10:00:01Z") },
    );
    expect(tailAudit(dir, 2).map((e) => e.action)).toEqual(["t2", "t3"]);
    expect(tailAudit(dir, 50).map((e) => e.action)).toEqual(["t1", "t2", "t3"]);
  });
});
