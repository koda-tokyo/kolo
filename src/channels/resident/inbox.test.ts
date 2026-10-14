import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  pruneInbox,
  resolveInboxDir,
  resolveInboxLimits,
  saveInboundBufferToInbox,
  saveInboundFilesToInbox,
} from "./inbox.js";

let home = "";
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-inbox-"));
  env = { KOLO_HOME: home, KOLO_STATE_DIR: home };
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe("channel inbox (M14a)", () => {
  test("copies files under inbox/<channel>/<day>/ with caps", () => {
    const src = path.join(home, "a.png");
    fs.writeFileSync(src, Buffer.alloc(100));
    const big = path.join(home, "big.bin");
    fs.writeFileSync(big, Buffer.alloc(5000));
    const limits = { ...resolveInboxLimits(), maxFileBytes: 1024, maxFilesPerMessage: 2 };
    const now = new Date("2026-10-14T01:02:03Z");
    const out = saveInboundFilesToInbox({
      channel: "LINE",
      messageId: "m/1",
      files: [{ path: src }, { path: big }, { path: src, name: "b.png" }, { path: src }],
      limits,
      now,
      env,
    });
    expect(out.saved.map((f) => f.name)).toEqual(["a.png", "b.png"]);
    expect(out.skipped).toEqual([
      { name: "big.bin", reason: "too_large" },
      { name: "a.png", reason: "limit" },
    ]);
    const dir = resolveInboxDir("line", now, env);
    expect(path.dirname(out.saved[0].path)).toBe(dir);
    expect(out.saved[0].path).toContain("m_1-1-a.png");
    expect(fs.existsSync(src)).toBe(true);
  });

  test("saves inline buffers and prunes old days", () => {
    const limits = resolveInboxLimits();
    const old = saveInboundBufferToInbox({
      channel: "webhook",
      name: "../x.txt",
      data: Buffer.from("hi"),
      limits,
      now: new Date("2026-01-01T00:00:00Z"),
      env,
    });
    expect("path" in old && old.path.endsWith("x.txt")).toBe(true);
    const fresh = saveInboundBufferToInbox({
      channel: "webhook",
      name: "y.txt",
      data: Buffer.from("hi"),
      limits,
      now: new Date("2026-10-14T00:00:00Z"),
      env,
    });
    expect("path" in fresh).toBe(true);
    const tooBig = saveInboundBufferToInbox({
      channel: "webhook",
      name: "z.bin",
      data: Buffer.alloc(10),
      limits: { ...limits, maxFileBytes: 5 },
      env,
    });
    expect(tooBig).toEqual({ skipped: "too_large" });
    const removed = pruneInbox({ retentionDays: 30, now: new Date("2026-10-14T00:00:00Z"), env });
    expect(removed).toBe(1);
    expect(fs.existsSync(path.join(home, "inbox", "webhook", "2026-10-14"))).toBe(true);
  });
});
