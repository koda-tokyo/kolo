import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acquireRefreshLock,
  isRefreshLockStale,
  parseRefreshLock,
  releaseRefreshLock,
  withRefreshLock,
} from "./refresh-lock.js";

const alive = () => true;

describe("refresh lock", () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-refresh-lock-"));
    lockPath = path.join(dir, "run", "oauth-refresh.lock");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("acquires a fresh lock, creating the run directory, and release unlinks it", () => {
    expect(acquireRefreshLock(lockPath, { pid: 42, now: () => 1_000, isPidAlive: alive })).toBe(
      true,
    );
    expect(fs.readFileSync(lockPath, "utf8")).toBe("42:1000");
    releaseRefreshLock(lockPath);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("blocks while another live process holds a recent lock", () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "7:5000");
    expect(
      acquireRefreshLock(lockPath, {
        pid: 8,
        now: () => 6_000,
        timeoutMs: 30_000,
        isPidAlive: alive,
      }),
    ).toBe(false);
    expect(fs.readFileSync(lockPath, "utf8")).toBe("7:5000");
  });

  it('takes over an empty lock file (the old release wrote "")', () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "");
    expect(acquireRefreshLock(lockPath, { pid: 9, now: () => 10, isPidAlive: alive })).toBe(true);
    expect(fs.readFileSync(lockPath, "utf8")).toBe("9:10");
  });

  it("takes over an unparseable lock", () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "garbage");
    expect(acquireRefreshLock(lockPath, { pid: 9, now: () => 10, isPidAlive: alive })).toBe(true);
  });

  it("takes over a lock older than the timeout", () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "7:1000");
    expect(
      acquireRefreshLock(lockPath, {
        pid: 9,
        now: () => 1000 + 30_001,
        timeoutMs: 30_000,
        isPidAlive: alive,
      }),
    ).toBe(true);
  });

  it("takes over a lock whose holder is gone", () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, "7:1000");
    expect(
      acquireRefreshLock(lockPath, {
        pid: 9,
        now: () => 1001,
        timeoutMs: 30_000,
        isPidAlive: () => false,
      }),
    ).toBe(true);
  });

  it("a second refresh after a release is not blocked", async () => {
    const opts = { isPidAlive: alive };
    expect(await withRefreshLock(lockPath, async () => "first", opts)).toBe("first");
    expect(await withRefreshLock(lockPath, async () => "second", opts)).toBe("second");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("withRefreshLock returns null when the lock is held", async () => {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, `${process.pid}:${Date.now()}`);
    expect(await withRefreshLock(lockPath, async () => "ran")).toBeNull();
  });

  it("parse and staleness helpers", () => {
    expect(parseRefreshLock("")).toBeNull();
    expect(parseRefreshLock("x:y")).toBeNull();
    expect(parseRefreshLock("12:34")).toEqual({ pid: 12, timestamp: 34 });
    expect(isRefreshLockStale("", { isPidAlive: alive })).toBe(true);
    expect(isRefreshLockStale("12:34", { now: () => 35, isPidAlive: alive })).toBe(false);
  });
});
