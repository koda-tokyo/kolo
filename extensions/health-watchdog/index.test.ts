import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi, startServices } from "../../test/fixtures/plugins/fake-api.js";
import plugin, {
  createWatchdog,
  registerHealthWatchdog,
  evaluateHealth,
  initialWatchdogState,
  resolveWatchdogConfig,
  stepWatchdog,
} from "./index.js";

const cfg = resolveWatchdogConfig({ failureThreshold: 2, escalateAfter: 3, restartCooldownMs: 10_000 });

describe("evaluateHealth", () => {
  it("is ok when the lease is ours, fresh and the port answers", () => {
    const v = evaluateHealth(
      { now: 100_000, lease: { exists: true, mtimeMs: 90_000, holder: { pid: 7 } }, selfPid: 7, portOpen: true, port: 1 },
      cfg,
    );
    expect(v).toEqual({ ok: true, problems: [] });
  });
  it("names every problem", () => {
    const v = evaluateHealth(
      { now: 200_000, lease: { exists: true, mtimeMs: 100_000, holder: { pid: 9 } }, holderAlive: false, selfPid: 7, portOpen: false, port: 42 },
      cfg,
    );
    expect(v.ok).toBe(false);
    expect(v.problems).toEqual([
      "lease held by another process (pid 9, dead)",
      "lease heartbeat stale (100 s)",
      "port 42 not accepting connections",
    ]);
  });
  it("reports a missing lease", () => {
    expect(evaluateHealth({ now: 1, lease: { exists: false }, selfPid: 1, portOpen: true, port: 1 }, cfg).problems).toEqual([
      "lease file missing",
    ]);
  });
});

describe("stepWatchdog", () => {
  it("restarts at the threshold, respects the cooldown, escalates once, recovers", () => {
    let state = initialWatchdogState();
    const bad = { ok: false, problems: ["x"] };
    let r = stepWatchdog(state, bad, cfg, 1_000);
    expect(r.actions).toEqual(["failed"]);
    r = stepWatchdog(r.state, bad, cfg, 2_000);
    expect(r.actions).toEqual(["failed", "restart"]);
    r = stepWatchdog(r.state, bad, cfg, 3_000);
    expect(r.actions).toEqual(["failed", "escalate"]); // cooldown blocks a second restart
    r = stepWatchdog(r.state, bad, cfg, 13_000);
    expect(r.actions).toEqual(["failed", "restart"]); // cooldown over, already escalated
    r = stepWatchdog(r.state, { ok: true, problems: [] }, cfg, 14_000);
    expect(r.actions).toEqual(["recovered"]);
    expect(r.state.failures).toBe(0);
    expect(r.state.escalated).toBe(false);
    state = r.state;
    expect(stepWatchdog(state, { ok: true, problems: [] }, cfg, 15_000).actions).toEqual([]);
  });
  it("never restarts when restart=false", () => {
    const c = resolveWatchdogConfig({ restart: false, failureThreshold: 1 });
    expect(stepWatchdog(initialWatchdogState(), { ok: false, problems: ["x"] }, c, 1).actions).toEqual(["failed"]);
  });
});

describe("watchdog service", () => {
  const fakes: ReturnType<typeof createFakeApi>[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const f of fakes.splice(0)) {
      await f.dispose();
      f.cleanup();
    }
  });

  it("audits failures, restarts through the supervisor and escalates to a session", async () => {
    const fake = createFakeApi({
      id: "health-watchdog",
      pluginConfig: { failureThreshold: 2, escalateAfter: 3, restartCooldownMs: 10_000, port: 4321, escalation: { sessionKey: "agent:main:main" } },
    });
    fakes.push(fake);
    let now = 1_000_000;
    let portOpen = false;
    const wd = createWatchdog(fake.api, {
      now: () => now,
      selfPid: 7,
      pidAlive: () => true,
      probePort: async () => portOpen,
      readLease: () => ({ exists: true, mtimeMs: now - 1000, holder: { pid: 7, port: 4321 } }),
    });
    await wd.tick();
    now += 1000;
    await wd.tick();
    now += 1000;
    await wd.tick();
    expect(fake.audits.map((a) => a.action)).toEqual([
      "health.check",
      "health.check",
      "health.restart",
      "health.check",
      "health.escalated",
    ]);
    expect(fake.restarts).toHaveLength(1);
    expect(fake.systemEvents).toEqual([
      { text: expect.stringContaining("failed 3 consecutive checks"), sessionKey: "agent:main:main" },
    ]);
    portOpen = true;
    await wd.tick();
    expect(fake.audits.at(-1)?.action).toBe("health.recovered");
    expect(fake.api.signals.get<{ ok: boolean }>("health.gateway")?.ok).toBe(true);
  });

  it("reads the real lease file and ticks on the lifecycle interval (fake clock)", async () => {
    vi.useFakeTimers();
    const fake = createFakeApi({ id: "health-watchdog", pluginConfig: { intervalMs: 5000, port: 4000 } });
    fakes.push(fake);
    fs.writeFileSync(
      path.join(fake.api.paths.runDir, "gateway.lock"),
      JSON.stringify({ pid: process.pid, hostname: "h", startedAt: Date.now(), port: 4000 }),
    );
    let probes = 0;
    registerHealthWatchdog(fake.api, { probePort: async () => (probes++, true) });
    await startServices(fake);
    expect(fake.services.map((s) => s.id)).toEqual(["health-watchdog"]);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(probes).toBe(1);
    expect(fake.audits).toEqual([]); // healthy: nothing to say
    expect(fake.api.signals.get<{ ok: boolean }>("health.gateway")?.ok).toBe(true);
    await fake.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(probes).toBe(1); // interval released with the instance
    expect(fake.api.lifecycle.disposed).toBe(true);
  });

  it("registers a service through the default export", () => {
    const fake = createFakeApi({ id: "health-watchdog" });
    fakes.push(fake);
    plugin.register(fake.api);
    expect(fake.services).toHaveLength(1);
  });
});
