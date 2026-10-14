/**
 * Circadian (KoLo 2.0, M7). Off by default.
 *
 * Publishes the phase of day as a signal (`circadian.phase`), an agent tool (`circadian_phase`),
 * a JSON file (`<stateDir>/signals/circadian.json`) and, when `notifySessionKey` is set, a system
 * event on every phase change. Phases carry behaviour flags (monitoring, alert threshold, cleanup
 * window, expected activity) that other plugins and trigger rules read instead of hard-coding
 * hours. The default table: dawn 06-09, morning 09-12, midday 12-14, afternoon 14-18, evening
 * 18-21, night 21-02, deep-night 02-06.
 */
import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

export type PhaseFlags = {
  monitoring: "reduced" | "normal" | "heightened";
  alertThreshold: "critical-only" | "all";
  cleanupAllowed: boolean;
  expectedActivity: "minimal" | "low" | "normal" | "high";
};

export type PhaseDef = { name: string; from: number; to: number } & Partial<PhaseFlags>;

export const DEFAULT_PHASES: PhaseDef[] = [
  { name: "dawn", from: 6, to: 9, monitoring: "normal", alertThreshold: "all", cleanupAllowed: false, expectedActivity: "low" },
  { name: "morning", from: 9, to: 12, monitoring: "heightened", alertThreshold: "all", cleanupAllowed: false, expectedActivity: "high" },
  { name: "midday", from: 12, to: 14, monitoring: "normal", alertThreshold: "all", cleanupAllowed: false, expectedActivity: "normal" },
  { name: "afternoon", from: 14, to: 18, monitoring: "heightened", alertThreshold: "all", cleanupAllowed: false, expectedActivity: "high" },
  { name: "evening", from: 18, to: 21, monitoring: "normal", alertThreshold: "all", cleanupAllowed: false, expectedActivity: "normal" },
  { name: "night", from: 21, to: 2, monitoring: "reduced", alertThreshold: "all", cleanupAllowed: true, expectedActivity: "low" },
  { name: "deep-night", from: 2, to: 6, monitoring: "reduced", alertThreshold: "critical-only", cleanupAllowed: true, expectedActivity: "minimal" },
];

const DEFAULT_FLAGS: PhaseFlags = {
  monitoring: "normal",
  alertThreshold: "all",
  cleanupAllowed: false,
  expectedActivity: "normal",
};

export type CircadianConfig = {
  intervalMs: number;
  timezone?: string;
  phases: PhaseDef[];
  notifySessionKey?: string;
  writeFile: boolean;
};

export function resolveCircadianConfig(raw: Record<string, unknown> | undefined): CircadianConfig {
  const cfg = raw ?? {};
  const interval = cfg.intervalMs;
  const phases = Array.isArray(cfg.phases) && cfg.phases.length > 0 ? (cfg.phases as PhaseDef[]) : DEFAULT_PHASES;
  return {
    intervalMs:
      typeof interval === "number" && Number.isFinite(interval) ? Math.max(5_000, Math.floor(interval)) : 60_000,
    timezone: typeof cfg.timezone === "string" && cfg.timezone.trim() ? cfg.timezone.trim() : undefined,
    phases,
    notifySessionKey: typeof cfg.notifySessionKey === "string" ? cfg.notifySessionKey : undefined,
    writeFile: cfg.writeFile !== false,
  };
}

export type LocalClock = { hour: number; minute: number; weekday: number; date: string };

/** Local wall clock in `timezone` (IANA) or the process zone; weekday 1=Mon … 7=Sun. */
export function localClock(date: Date, timezone?: string): LocalClock {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const days: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: days[parts.weekday] ?? 1,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export type PhaseSnapshot = LocalClock & PhaseFlags & { phase: string; weekend: boolean; timezone: string | null };

/** Pure: clock + table → phase and flags. Ranges wrap midnight (night 21-2). */
export function resolvePhase(clock: LocalClock, phases: PhaseDef[], timezone?: string): PhaseSnapshot {
  const inRange = (p: PhaseDef) =>
    p.from < p.to ? clock.hour >= p.from && clock.hour < p.to : clock.hour >= p.from || clock.hour < p.to;
  const def = phases.find(inRange) ?? { name: "unknown", from: 0, to: 24 };
  return {
    ...clock,
    phase: def.name,
    weekend: clock.weekday >= 6,
    timezone: timezone ?? null,
    monitoring: def.monitoring ?? DEFAULT_FLAGS.monitoring,
    alertThreshold: def.alertThreshold ?? DEFAULT_FLAGS.alertThreshold,
    cleanupAllowed: def.cleanupAllowed ?? DEFAULT_FLAGS.cleanupAllowed,
    expectedActivity: def.expectedActivity ?? DEFAULT_FLAGS.expectedActivity,
  };
}

export function createCircadian(api: KoLoPluginApi, now: () => Date = () => new Date()) {
  const cfg = resolveCircadianConfig(api.pluginConfig);
  let last: PhaseSnapshot | null = null;
  const file = path.join(api.paths.stateDir, "signals", "circadian.json");

  const current = (): PhaseSnapshot => resolvePhase(localClock(now(), cfg.timezone), cfg.phases, cfg.timezone);

  const publish = (snapshot: PhaseSnapshot) => {
    api.signals.set("circadian.phase", snapshot);
    if (cfg.writeFile) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, `${JSON.stringify({ ...snapshot, updatedAt: now().toISOString() }, null, 2)}\n`, {
          mode: 0o600,
        });
      } catch (err) {
        api.logger.warn(`[circadian] could not write ${file}: ${String(err)}`);
      }
    }
  };

  const tick = (): PhaseSnapshot => {
    const snapshot = current();
    const changed = last === null || last.phase !== snapshot.phase;
    if (changed) {
      api.logger.info(`[circadian] phase ${last ? `${last.phase} → ` : ""}${snapshot.phase} (${snapshot.hour}:00, ${snapshot.weekend ? "weekend" : "weekday"})`);
      api.audit({
        action: "circadian.phase_changed",
        detail: { from: last?.phase ?? null, to: snapshot.phase, hour: snapshot.hour, weekend: snapshot.weekend },
      });
      if (cfg.notifySessionKey && last !== null) {
        try {
          api.enqueueSystemEvent(
            `Circadian phase: ${snapshot.phase} (monitoring ${snapshot.monitoring}, alerts ${snapshot.alertThreshold}, cleanup ${snapshot.cleanupAllowed ? "allowed" : "not allowed"}).`,
            cfg.notifySessionKey,
          );
        } catch (err) {
          api.logger.warn(`[circadian] notify failed: ${String(err)}`);
        }
      }
    }
    last = snapshot;
    publish(snapshot);
    return snapshot;
  };

  return { cfg, tick, current, file };
}

const circadianPlugin = {
  id: "circadian",
  name: "Circadian",
  description: "Phase-of-day signal for agents, plugins and schedules",
  register(api: KoLoPluginApi) {
    const circadian = createCircadian(api);
    api.registerTool(
      {
        name: "circadian_phase",
        label: "Circadian phase",
        description:
          "Current phase of day (dawn, morning, midday, afternoon, evening, night, deep-night) with the behaviour flags for it: monitoring level, alert threshold, whether cleanup work is allowed, expected activity.",
        parameters: Type.Object({}),
        execute: async () => {
          const snapshot = circadian.current();
          return {
            content: [
              {
                type: "text" as const,
                text: `Phase: ${snapshot.phase} (${String(snapshot.hour).padStart(2, "0")}:${String(snapshot.minute).padStart(2, "0")}${snapshot.timezone ? ` ${snapshot.timezone}` : ""}, ${snapshot.weekend ? "weekend" : "weekday"}). Monitoring ${snapshot.monitoring}; alerts ${snapshot.alertThreshold}; cleanup ${snapshot.cleanupAllowed ? "allowed" : "not allowed"}; expected activity ${snapshot.expectedActivity}.`,
              },
            ],
            details: snapshot,
          };
        },
      },
      { names: ["circadian_phase"] },
    );
    api.registerService({
      id: "circadian",
      start: () => {
        circadian.tick();
        api.lifecycle.setInterval(() => circadian.tick(), circadian.cfg.intervalMs);
      },
    });
  },
};

export default circadianPlugin;
