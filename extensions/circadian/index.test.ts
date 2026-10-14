import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi, startServices } from "../../test/fixtures/plugins/fake-api.js";
import plugin, { DEFAULT_PHASES, createCircadian, localClock, resolvePhase } from "./index.js";

describe("resolvePhase", () => {
  const at = (hour: number, weekday = 2) => ({ hour, minute: 0, weekday, date: "2026-10-13" });
  it("maps hours to the default table including the midnight wrap", () => {
    expect(resolvePhase(at(6), DEFAULT_PHASES).phase).toBe("dawn");
    expect(resolvePhase(at(11), DEFAULT_PHASES).phase).toBe("morning");
    expect(resolvePhase(at(13), DEFAULT_PHASES).phase).toBe("midday");
    expect(resolvePhase(at(17), DEFAULT_PHASES).phase).toBe("afternoon");
    expect(resolvePhase(at(20), DEFAULT_PHASES).phase).toBe("evening");
    expect(resolvePhase(at(23), DEFAULT_PHASES).phase).toBe("night");
    expect(resolvePhase(at(1), DEFAULT_PHASES).phase).toBe("night");
    expect(resolvePhase(at(3), DEFAULT_PHASES)).toMatchObject({
      phase: "deep-night",
      monitoring: "reduced",
      alertThreshold: "critical-only",
      cleanupAllowed: true,
      expectedActivity: "minimal",
      weekend: false,
    });
    expect(resolvePhase(at(3, 7), DEFAULT_PHASES).weekend).toBe(true);
  });
  it("falls back to defaults for a custom phase without flags", () => {
    const snap = resolvePhase(at(5), [{ name: "early", from: 4, to: 8 }]);
    expect(snap).toMatchObject({ phase: "early", monitoring: "normal", cleanupAllowed: false });
    expect(resolvePhase(at(12), [{ name: "early", from: 4, to: 8 }]).phase).toBe("unknown");
  });
});

describe("localClock", () => {
  it("honours an IANA timezone", () => {
    const d = new Date("2026-10-13T03:30:00Z");
    expect(localClock(d, "Asia/Tokyo")).toEqual({ hour: 12, minute: 30, weekday: 2, date: "2026-10-13" });
    expect(localClock(d, "America/Sao_Paulo").hour).toBe(0);
  });
});

describe("circadian plugin", () => {
  const fakes: ReturnType<typeof createFakeApi>[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const f of fakes.splice(0)) {
      await f.dispose();
      f.cleanup();
    }
  });

  it("publishes the signal, writes the file, audits and notifies on phase change only", () => {
    const fake = createFakeApi({
      id: "circadian",
      pluginConfig: { timezone: "UTC", notifySessionKey: "agent:main:main" },
    });
    fakes.push(fake);
    let now = new Date("2026-10-13T08:59:00Z");
    const c = createCircadian(fake.api, () => now);
    expect(c.tick().phase).toBe("dawn");
    expect(fake.api.signals.get<{ phase: string }>("circadian.phase")?.phase).toBe("dawn");
    expect(JSON.parse(fs.readFileSync(c.file, "utf-8")).phase).toBe("dawn");
    expect(fake.systemEvents).toEqual([]); // first observation is not a change
    now = new Date("2026-10-13T09:00:30Z");
    expect(c.tick().phase).toBe("morning");
    now = new Date("2026-10-13T09:05:00Z");
    c.tick();
    expect(fake.audits.map((a) => a.action)).toEqual(["circadian.phase_changed", "circadian.phase_changed"]);
    expect(fake.systemEvents).toEqual([{ text: expect.stringContaining("morning"), sessionKey: "agent:main:main" }]);
  });

  it("registers the tool and a service ticking on the lifecycle interval", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
    const fake = createFakeApi({ id: "circadian", pluginConfig: { intervalMs: 5000, timezone: "UTC", writeFile: false } });
    fakes.push(fake);
    plugin.register(fake.api);
    expect(fake.tools.map((t) => t.name)).toEqual(["circadian_phase"]);
    await startServices(fake);
    const result = (await fake.tools[0]!.execute("id", {})) as { details: { phase: string } };
    expect(result.details.phase).toBe("midday");
    const before = fake.audits.length;
    vi.setSystemTime(new Date("2026-10-13T14:00:00Z"));
    await vi.advanceTimersByTimeAsync(5_100);
    expect(fake.audits.length).toBe(before + 1);
    expect(fake.api.signals.get<{ phase: string }>("circadian.phase")?.phase).toBe("afternoon");
  });
});
