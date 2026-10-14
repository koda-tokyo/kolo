import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEASE_FILENAME, LeaseManager } from "./lease.js";

let dir: string;
const managers: LeaseManager[] = [];

function make(opts: Partial<ConstructorParameters<typeof LeaseManager>[0]> = {}) {
  const m = new LeaseManager({ runtimeDir: dir, generation: 1, port: 18800, ...opts });
  managers.push(m);
  return m;
}

function writeLock(body: Record<string, unknown>, ageMs = 0) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LEASE_FILENAME);
  fs.writeFileSync(file, JSON.stringify(body));
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
  return file;
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kolo-lease-")), "run");
});

afterEach(() => {
  for (const m of managers.splice(0)) {
    m.release();
  }
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe("LeaseManager", () => {
  it("acquires with an exclusive create and writes the holder record", () => {
    const m = make();
    const res = m.acquire();
    expect(res.ok).toBe(true);
    expect(m.isHeld).toBe(true);
    const body = JSON.parse(fs.readFileSync(m.lockPath, "utf8"));
    expect(body).toMatchObject({
      pid: process.pid,
      port: 18800,
      hostname: os.hostname(),
      leaseId: m.leaseId,
    });
    expect(typeof body.startedAt).toBe("number");
  });

  it("refuses a second acquire while the holder is alive and fresh", () => {
    const a = make();
    expect(a.acquire().ok).toBe(true);
    const b = make({ port: 18801 });
    const res = b.acquire();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.existing.holder.pid).toBe(process.pid);
      expect(res.existing.holder.port).toBe(18800);
    }
    expect(b.isHeld).toBe(false);
    // the refused contender must not have touched the holder's lock
    expect(JSON.parse(fs.readFileSync(a.lockPath, "utf8")).leaseId).toBe(a.leaseId);
  });

  it("reclaims a lock whose pid is dead (same host)", () => {
    writeLock({ pid: 999_999, hostname: os.hostname(), startedAt: 1, leaseId: "old" });
    const m = make({ isPidAlive: () => false });
    const res = m.acquire();
    expect(res).toMatchObject({ ok: true, staleCleaned: true });
    expect(JSON.parse(fs.readFileSync(m.lockPath, "utf8")).leaseId).toBe(m.leaseId);
  });

  it("reclaims a lock whose heartbeat is older than 60 s even if the pid looks alive", () => {
    writeLock({ pid: process.pid, hostname: "other-host", startedAt: 1, leaseId: "old" }, 61_000);
    const m = make({ isPidAlive: () => true });
    expect(m.acquire()).toMatchObject({ ok: true, staleCleaned: true });
  });

  it("does not use pid liveness for a lock from another host", () => {
    writeLock({ pid: 999_999, hostname: "other-host", startedAt: 1, leaseId: "old" });
    const m = make({ isPidAlive: () => false });
    expect(m.acquire().ok).toBe(false);
  });

  it("honours a fresh unparseable lock (holder may be mid-write)", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LEASE_FILENAME), "{");
    expect(make().acquire().ok).toBe(false);
  });

  it("release removes the lock so the next instance acquires", () => {
    const a = make();
    a.acquire();
    a.release();
    expect(fs.existsSync(a.lockPath)).toBe(false);
    expect(make().acquire().ok).toBe(true);
  });

  it("renew refreshes the heartbeat and detects a stolen lock", () => {
    const a = make();
    a.acquire();
    const past = new Date(Date.now() - 30_000);
    fs.utimesSync(a.lockPath, past, past);
    expect(a.renew().ok).toBe(true);
    expect(Date.now() - fs.statSync(a.lockPath).mtimeMs).toBeLessThan(5_000);

    fs.writeFileSync(a.lockPath, JSON.stringify({ pid: 1, hostname: "x", leaseId: "thief" }));
    expect(a.renew().ok).toBe(false);
    expect(a.isHeld).toBe(false);
    // losing the lease must not delete the new holder's lock
    a.release();
    expect(JSON.parse(fs.readFileSync(a.lockPath, "utf8")).leaseId).toBe("thief");
  });

  it("calls onLost when the lock is replaced under the holder", () => {
    let lostHolder: unknown = "unset";
    const a = make({ onLost: (h) => (lostHolder = h) });
    a.acquire();
    fs.writeFileSync(a.lockPath, JSON.stringify({ pid: 4242, hostname: "x", leaseId: "thief" }));
    a.renew();
    expect(lostHolder).toMatchObject({ pid: 4242, leaseId: "thief" });
  });
});
