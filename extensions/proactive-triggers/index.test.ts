import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeApi, startServices } from "../../test/fixtures/plugins/fake-api.js";
import plugin, {
  conditionHolds,
  createTriggers,
  cronMatches,
  evaluateRules,
  parseDuration,
  resolveTriggersConfig,
  type Probe,
} from "./index.js";

const MIN = 60_000;
const local = (t: number) => {
  const d = new Date(t);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return {
    minute: d.getUTCMinutes(),
    hour: d.getUTCHours(),
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    weekday,
    minuteKey: d.toISOString().slice(0, 16),
  };
};

describe("parseDuration / cronMatches", () => {
  it("parses units", () => {
    expect(parseDuration("15m")).toBe(15 * MIN);
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
    expect(parseDuration("1.5d")).toBe(1.5 * 86_400_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration(500)).toBe(500);
    expect(parseDuration("soon")).toBeNull();
  });
  it("matches 5-field cron with ranges, steps, lists and Sunday as 0/7", () => {
    const sun9 = { minute: 0, hour: 9, day: 11, month: 10, weekday: 7 };
    expect(cronMatches("0 9 * * *", sun9)).toBe(true);
    expect(cronMatches("0 9 * * 0", sun9)).toBe(true);
    expect(cronMatches("0 9 * * 7", sun9)).toBe(true);
    expect(cronMatches("0 9 * * 1-5", sun9)).toBe(false);
    expect(cronMatches("*/15 8-10 * 10 *", { ...sun9, minute: 45 })).toBe(true);
    expect(cronMatches("*/15 8-10 * 10 *", { ...sun9, minute: 50 })).toBe(false);
    expect(cronMatches("0 9 * *", sun9)).toBe(false);
    expect(cronMatches("0 25 * * *", sun9)).toBe(false);
  });
});

describe("resolveTriggersConfig", () => {
  it("keeps valid rules and reports the rest", () => {
    const { config, problems } = resolveTriggersConfig({
      rules: [
        { id: "a", every: "5m", message: "m", sessionKey: "s" },
        { id: "a", every: "5m", message: "m", sessionKey: "s" },
        { id: "b", cron: "0 9 * * *", message: "m", sessionKey: "s", cooldown: "1h" },
        { id: "c", message: "m", sessionKey: "s" },
        { id: "d", every: "never", message: "m", sessionKey: "s" },
        { id: "e", every: "1m", message: "", sessionKey: "s" },
      ],
    });
    expect(config.dryRun).toBe(true);
    expect(config.rules.map((r) => r.id)).toEqual(["a", "b"]);
    expect(problems).toEqual([
      "rule #1: duplicate id a",
      "rule c: needs every or cron",
      'rule d: invalid every "never"',
      "rule e: message and sessionKey are required",
    ]);
  });
});

describe("evaluateRules", () => {
  const probe = (files: Record<string, number>, signals: Record<string, unknown> = {}): Probe => ({
    fileMtime: (p) => files[p] ?? null,
    signal: (n) => signals[n],
    local,
  });
  const base = Date.UTC(2026, 9, 13, 9, 0, 0); // Tue 09:00 UTC

  it("interval rules fire, then wait for the interval; cooldown and conditions gate them", () => {
    const { config } = resolveTriggersConfig({
      rules: [
        { id: "every", every: "10m", message: "m", sessionKey: "s" },
        { id: "cool", every: "1m", cooldown: "30m", message: "m", sessionKey: "s" },
        { id: "cond", every: "1m", message: "m", sessionKey: "s", condition: { fileNewerThan: { path: "/inbox", minutes: 5 }, hoursBetween: [8, 18], weekdays: [1, 2, 3, 4, 5] } },
      ],
    });
    let r = evaluateRules(config.rules, {}, base, probe({ "/inbox": base - 2 * MIN }), (p) => p);
    expect(r.fired.map((x) => x.id)).toEqual(["every", "cool", "cond"]);
    r = evaluateRules(config.rules, r.state, base + 2 * MIN, probe({ "/inbox": base - 2 * MIN }), (p) => p);
    expect(r.fired.map((x) => x.id)).toEqual(["cond"]); // every: not yet; cool: cooldown; cond: 1m passed, file 4 min old (< 5)
    r = evaluateRules(config.rules, r.state, base + 10 * MIN, probe({ "/inbox": base - 2 * MIN }), (p) => p);
    expect(r.fired.map((x) => x.id)).toEqual(["every"]); // cond: file 12 min old → not newer than 5
    r = evaluateRules(config.rules, r.state, base + 31 * MIN, probe({ "/inbox": base + 30 * MIN }), (p) => p);
    expect(r.fired.map((x) => x.id).sort()).toEqual(["cond", "cool", "every"]);
  });

  it("cron rules fire once per matching minute and read signals", () => {
    const { config } = resolveTriggersConfig({
      rules: [
        { id: "nine", cron: "0 9 * * 1-5", message: "m", sessionKey: "s" },
        { id: "night", cron: "* * * * *", message: "m", sessionKey: "s", condition: { signalEquals: { name: "circadian.phase", path: "phase", value: "deep-night" } } },
      ],
    });
    const p = probe({}, { "circadian.phase": { phase: "morning" } });
    let r = evaluateRules(config.rules, {}, base, p, (x) => x);
    expect(r.fired.map((x) => x.id)).toEqual(["nine"]);
    r = evaluateRules(config.rules, r.state, base + 20_000, p, (x) => x);
    expect(r.fired).toEqual([]); // same minute, already tried
    r = evaluateRules(config.rules, r.state, base + MIN, probe({}, { "circadian.phase": { phase: "deep-night" } }), (x) => x);
    expect(r.fired.map((x) => x.id)).toEqual(["night"]);
    expect(conditionHolds({ fileMissing: "/x" }, base, p, (x) => x)).toBe(true);
    expect(conditionHolds({ fileExists: "/x" }, base, p, (x) => x)).toBe(false);
  });
});

describe("proactive-triggers plugin", () => {
  const fakes: ReturnType<typeof createFakeApi>[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    for (const f of fakes.splice(0)) {
      await f.dispose();
      f.cleanup();
    }
  });

  it("dry run audits without sending; real run sends a system event and persists state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T09:00:00Z"));
    const rules = [{ id: "ping", every: "1m", message: "check the inbox", sessionKey: "agent:main:main" }];
    const dry = createFakeApi({ id: "proactive-triggers", pluginConfig: { tickMs: 1000, rules } });
    fakes.push(dry);
    plugin.register(dry.api);
    await startServices(dry);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(dry.systemEvents).toEqual([]);
    expect(dry.audits.map((a) => a.action)).toEqual(["proactive.dry_run"]);

    const live = createFakeApi({ id: "proactive-triggers", pluginConfig: { dryRun: false, tickMs: 1000, rules } });
    fakes.push(live);
    const triggers = createTriggers(live.api);
    expect(triggers.tick()).toEqual(["ping"]);
    expect(live.systemEvents).toEqual([{ text: "check the inbox", sessionKey: "agent:main:main" }]);
    expect(live.audits.map((a) => a.action)).toEqual(["proactive.fired"]);
    expect(JSON.parse(fs.readFileSync(path.join(live.home, "proactive", "state.json"), "utf-8")).ping.lastFiredAt).toBe(
      Date.now(),
    );
    // A fresh instance (restart / reload) reads the persisted state and does not re-fire.
    expect(createTriggers(live.api).tick()).toEqual([]);
  });
});
