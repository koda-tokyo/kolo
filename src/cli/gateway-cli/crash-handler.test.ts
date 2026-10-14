import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCrashRecord,
  CRASH_EXIT_DEADLINE_MS,
  installGatewayCrashHandlers,
  writeCrashRecord,
} from "./crash-handler.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-crash-"));
});
afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("crash record", () => {
  it("captures error, stack, pid, version and uptime", () => {
    const rec = buildCrashRecord("uncaughtException", new TypeError("boom"), new Date(0));
    expect(rec).toMatchObject({
      type: "uncaughtException",
      message: "boom",
      name: "TypeError",
      pid: process.pid,
      timestamp: "1970-01-01T00:00:00.000Z",
    });
    expect(rec.stack).toContain("boom");
    expect(typeof rec.version).toBe("string");
    expect(rec.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("stringifies non-Error rejection reasons", () => {
    expect(buildCrashRecord("unhandledRejection", { code: 7 }).message).toBe('{"code":7}');
    expect(buildCrashRecord("unhandledRejection", "plain").message).toBe("plain");
  });

  it("writes <dir>/crash-<ts>-<pid>.json as parseable JSON", () => {
    const rec = buildCrashRecord("uncaughtException", new Error("disk"));
    const file = writeCrashRecord(rec, path.join(dir, "logs"));
    expect(path.basename(file)).toMatch(/^crash-.*\.json$/);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toMatchObject({ message: "disk" });
  });
});

describe("installGatewayCrashHandlers", () => {
  const log = { error: vi.fn() };

  it("records and exits(1) on an uncaught exception", async () => {
    const exit = vi.fn();
    const h = installGatewayCrashHandlers({ log, exit, env: {}, logDir: () => dir });
    try {
      h.handle("uncaughtException", new Error("fatal"));
      await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
      const files = fs.readdirSync(dir).filter((f) => f.startsWith("crash-"));
      expect(files).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it("exits within the deadline even if flush hangs", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const h = installGatewayCrashHandlers({
      log,
      exit,
      env: {},
      logDir: () => dir,
      flush: () => new Promise<void>(() => {}),
    });
    try {
      h.handle("unhandledRejection", new Error("stuck"));
      await vi.advanceTimersByTimeAsync(CRASH_EXIT_DEADLINE_MS);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      h.dispose();
    }
  });

  it("does not crash on benign rejections", async () => {
    const exit = vi.fn();
    const h = installGatewayCrashHandlers({
      log,
      exit,
      env: {},
      logDir: () => dir,
      isBenignRejection: () => true,
    });
    try {
      h.handle("unhandledRejection", new Error("ECONNRESET"));
      await new Promise((r) => setTimeout(r, 10));
      expect(exit).not.toHaveBeenCalled();
      expect(fs.readdirSync(dir)).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("KOLO_CRASH_KEEPALIVE=1 records but stays alive", async () => {
    const exit = vi.fn();
    const h = installGatewayCrashHandlers({
      log,
      exit,
      env: { KOLO_CRASH_KEEPALIVE: "1" },
      logDir: () => dir,
    });
    try {
      h.handle("uncaughtException", new Error("debug"));
      await new Promise((r) => setTimeout(r, 10));
      expect(exit).not.toHaveBeenCalled();
      expect(fs.readdirSync(dir).some((f) => f.startsWith("crash-"))).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("dispose removes the process listeners", () => {
    const before = process.listenerCount("uncaughtException");
    const h = installGatewayCrashHandlers({ log, exit: vi.fn(), env: {}, logDir: () => dir });
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);
    h.dispose();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
