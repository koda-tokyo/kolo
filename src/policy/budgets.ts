// Budget meters (KoLo 2.0, M13b). Per-agent and fleet counters over two windows: a day
// (tokens, cost) that starts at `budgets.resetHourUtc`, and a rolling fixed hour (tool calls).
// Persisted under <KOLO_HOME>/run/budgets.json (debounced, atomic) so a restart does not reset
// a spent budget; a window that has passed is reset on the next read.
import fs from "node:fs";
import path from "node:path";
import type { BudgetLimits } from "./schema.js";

export type Counter = { tokens: number; cost: number; toolCalls: number; jobs: number };

export type BudgetWindow = {
  /** ISO start of the window. */
  start: string;
  fleet: Counter;
  agents: Record<string, Counter>;
};

export type BudgetMetersState = {
  version: 1;
  day: BudgetWindow;
  hour: BudgetWindow;
  /** Agents paused by a `pause` breach, until release or the window that paused them resets. */
  paused: Record<string, { since: string; rule: string; window: "day" | "hour" }>;
  fleetPaused?: { since: string; rule: string; window: "day" | "hour" } | null;
};

export type BudgetUsage = { tokens?: number; cost?: number; toolCalls?: number; jobs?: number };

export type BudgetBreach = {
  scope: "fleet" | "agent";
  agent?: string;
  metric: "tokensPerDay" | "costPerDay" | "toolCallsPerHour";
  limit: number;
  used: number;
  action: "warn" | "pause" | "stop";
};

const SAVE_DEBOUNCE_MS = 250;

function emptyCounter(): Counter {
  return { tokens: 0, cost: 0, toolCalls: 0, jobs: 0 };
}

function dayStart(now: Date, resetHourUtc: number): Date {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHourUtc, 0, 0, 0),
  );
  if (start.getTime() > now.getTime()) {
    start.setUTCDate(start.getUTCDate() - 1);
  }
  return start;
}

function hourStart(now: Date): Date {
  const start = new Date(now.getTime());
  start.setUTCMinutes(0, 0, 0);
  return start;
}

function freshWindow(start: Date): BudgetWindow {
  return { start: start.toISOString(), fleet: emptyCounter(), agents: {} };
}

export class BudgetMeters {
  private state: BudgetMetersState;
  private saveTimer: NodeJS.Timeout | undefined;
  private dirty = false;

  constructor(
    private readonly file: string | null,
    private readonly opts: { now?: () => Date; resetHourUtc?: number } = {},
  ) {
    this.state = this.read();
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private read(): BudgetMetersState {
    const now = this.now();
    const fallback: BudgetMetersState = {
      version: 1,
      day: freshWindow(dayStart(now, this.opts.resetHourUtc ?? 0)),
      hour: freshWindow(hourStart(now)),
      paused: {},
      fleetPaused: null,
    };
    if (!this.file) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as BudgetMetersState;
      if (parsed?.version !== 1 || !parsed.day || !parsed.hour) {
        return fallback;
      }
      return { ...fallback, ...parsed, paused: parsed.paused ?? {} };
    } catch {
      return fallback;
    }
  }

  /** Reset windows whose period has passed; pauses tied to that window lift with it. */
  private roll(): void {
    const now = this.now();
    const day = dayStart(now, this.opts.resetHourUtc ?? 0);
    const hour = hourStart(now);
    let changed = false;
    if (new Date(this.state.day.start).getTime() !== day.getTime()) {
      this.state.day = freshWindow(day);
      this.liftPauses("day");
      changed = true;
    }
    if (new Date(this.state.hour.start).getTime() !== hour.getTime()) {
      this.state.hour = freshWindow(hour);
      this.liftPauses("hour");
      changed = true;
    }
    if (changed) {
      this.scheduleSave();
    }
  }

  private liftPauses(window: "day" | "hour"): void {
    for (const [agent, pause] of Object.entries(this.state.paused)) {
      if (pause.window === window) {
        delete this.state.paused[agent];
      }
    }
    if (this.state.fleetPaused?.window === window) {
      this.state.fleetPaused = null;
    }
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (!this.file || this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.flush();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  /** Write now (tests, shutdown). */
  flush(): void {
    if (!this.file || !this.dirty) {
      return;
    }
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
      fs.renameSync(tmp, this.file);
    } catch {
      // Best effort; the in-memory meters stay authoritative for this process.
    }
  }

  private counter(window: BudgetWindow, agent: string): Counter {
    let c = window.agents[agent];
    if (!c) {
      c = emptyCounter();
      window.agents[agent] = c;
    }
    return c;
  }

  record(agent: string, usage: BudgetUsage): void {
    this.roll();
    const add = (c: Counter) => {
      c.tokens += usage.tokens ?? 0;
      c.cost += usage.cost ?? 0;
      c.toolCalls += usage.toolCalls ?? 0;
      c.jobs += usage.jobs ?? 0;
    };
    add(this.state.day.fleet);
    add(this.counter(this.state.day, agent));
    add(this.state.hour.fleet);
    add(this.counter(this.state.hour, agent));
    this.scheduleSave();
  }

  /**
   * Breaches of `limits` for `agent` (scope agent) or the fleet (agent omitted). A breach is
   * reported when the counter is already at or over the limit, so the call that would exceed
   * it is the one refused.
   */
  breaches(params: {
    agent?: string;
    limits: BudgetLimits | undefined;
    scope: "fleet" | "agent";
  }): BudgetBreach[] {
    this.roll();
    const limits = params.limits;
    if (!limits) {
      return [];
    }
    const day =
      params.scope === "fleet"
        ? this.state.day.fleet
        : (this.state.day.agents[params.agent ?? ""] ?? emptyCounter());
    const hour =
      params.scope === "fleet"
        ? this.state.hour.fleet
        : (this.state.hour.agents[params.agent ?? ""] ?? emptyCounter());
    const action = limits.onBreach ?? "warn";
    const out: BudgetBreach[] = [];
    const base = { scope: params.scope, agent: params.agent, action };
    if (limits.tokensPerDay !== undefined && day.tokens >= limits.tokensPerDay) {
      out.push({ ...base, metric: "tokensPerDay", limit: limits.tokensPerDay, used: day.tokens });
    }
    if (limits.costPerDay !== undefined && day.cost >= limits.costPerDay) {
      out.push({ ...base, metric: "costPerDay", limit: limits.costPerDay, used: day.cost });
    }
    if (limits.toolCallsPerHour !== undefined && hour.toolCalls >= limits.toolCallsPerHour) {
      out.push({
        ...base,
        metric: "toolCallsPerHour",
        limit: limits.toolCallsPerHour,
        used: hour.toolCalls,
      });
    }
    return out;
  }

  pause(agent: string | null, rule: string, window: "day" | "hour"): void {
    this.roll();
    const entry = { since: this.now().toISOString(), rule, window };
    if (agent === null) {
      this.state.fleetPaused = entry;
    } else {
      this.state.paused[agent] = entry;
    }
    this.scheduleSave();
  }

  /** Returns the pause rule when `agent` (or the fleet) is paused. */
  pausedBy(agent: string): string | null {
    this.roll();
    return this.state.fleetPaused?.rule ?? this.state.paused[agent]?.rule ?? null;
  }

  /**
   * Lift a pause. The counter of the window that paused the agent (or fleet) is zeroed too:
   * a release is an operator granting headroom, not a no-op that re-pauses on the next call.
   */
  release(agent?: string): boolean {
    this.roll();
    let changed = false;
    const zero = (window: "day" | "hour", who: string | null) => {
      const w = this.state[window];
      if (who === null) {
        w.fleet = emptyCounter();
      } else {
        w.agents[who] = emptyCounter();
      }
    };
    if (!agent) {
      changed = Boolean(this.state.fleetPaused) || Object.keys(this.state.paused).length > 0;
      if (this.state.fleetPaused) {
        zero(this.state.fleetPaused.window, null);
      }
      for (const [who, pause] of Object.entries(this.state.paused)) {
        zero(pause.window, who);
      }
      this.state.fleetPaused = null;
      this.state.paused = {};
    } else if (this.state.paused[agent]) {
      zero(this.state.paused[agent].window, agent);
      delete this.state.paused[agent];
      changed = true;
    }
    if (changed) {
      this.scheduleSave();
    }
    return changed;
  }

  /** Zero every counter (operator action, audited by the caller). */
  reset(): void {
    const now = this.now();
    this.state.day = freshWindow(dayStart(now, this.opts.resetHourUtc ?? 0));
    this.state.hour = freshWindow(hourStart(now));
    this.state.paused = {};
    this.state.fleetPaused = null;
    this.scheduleSave();
  }

  snapshot(): BudgetMetersState {
    this.roll();
    return structuredClone(this.state);
  }
}
