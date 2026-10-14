/**
 * Proactive triggers (KoLo 2.0, M7). Off by default; dry-run by default when on.
 *
 * Rules are declared in config. Each rule fires on a schedule (`every` interval or a 5-field
 * `cron`) when its `condition` holds (file freshness/existence, hour window, weekday, a signal
 * value such as the circadian phase), at most once per `cooldown`. Firing means one system event
 * for the rule's session (the next agent turn sees it) plus an audit row. With `dryRun: true`
 * nothing is sent: the rule is evaluated and `proactive.dry_run` is audited, so a new rule set
 * can be watched for a day before it talks to anyone. Last-fired times persist in
 * `<stateDir>/proactive/state.json`, so a gateway restart does not re-fire everything.
 */
import fs from "node:fs";
import path from "node:path";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

export type Rule = {
  id: string;
  enabled: boolean;
  everyMs: number | null;
  cron: string | null;
  cooldownMs: number;
  message: string;
  sessionKey: string;
  condition: RuleCondition | null;
};

export type RuleCondition = {
  fileExists?: string;
  fileMissing?: string;
  fileOlderThan?: { path: string; minutes: number };
  fileNewerThan?: { path: string; minutes: number };
  hoursBetween?: [number, number];
  weekdays?: number[];
  signalEquals?: { name: string; path?: string; value: unknown };
};

export type TriggersConfig = { dryRun: boolean; tickMs: number; rules: Rule[] };

const UNITS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "15m", "2h", "1d", "90s", "250ms"; plain numbers are milliseconds. */
export function parseDuration(input: unknown): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? input : null;
  }
  if (typeof input !== "string") {
    return null;
  }
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(input);
  if (!m) {
    return null;
  }
  return Math.round(Number(m[1]) * UNITS[(m[2] ?? "ms").toLowerCase()]!);
}

function cronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!m) {
      return null;
    }
    const step = m[3] ? Number(m[3]) : 1;
    let lo = m[1] === "*" ? min : Number(m[1]);
    let hi = m[2] ? Number(m[2]) : m[1] === "*" ? max : lo;
    if (step <= 0 || lo < min || hi > max || lo > hi) {
      return null;
    }
    for (let v = lo; v <= hi; v += step) {
      out.add(v);
    }
  }
  return out;
}

/** 5-field cron (minute hour dom month dow; dow 0/7 = Sunday). Pure, minute resolution. */
export function cronMatches(expr: string, local: { minute: number; hour: number; day: number; month: number; weekday: number }): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return false;
  }
  const minute = cronField(fields[0]!, 0, 59);
  const hour = cronField(fields[1]!, 0, 23);
  const dom = cronField(fields[2]!, 1, 31);
  const month = cronField(fields[3]!, 1, 12);
  const dow = cronField(fields[4]!, 0, 7);
  if (!minute || !hour || !dom || !month || !dow) {
    return false;
  }
  const weekday = local.weekday % 7; // 7 → 0 (Sunday)
  return (
    minute.has(local.minute) &&
    hour.has(local.hour) &&
    dom.has(local.day) &&
    month.has(local.month) &&
    (dow.has(weekday) || (weekday === 0 && dow.has(7)))
  );
}

export function resolveTriggersConfig(raw: Record<string, unknown> | undefined): { config: TriggersConfig; problems: string[] } {
  const cfg = raw ?? {};
  const problems: string[] = [];
  const rules: Rule[] = [];
  const seen = new Set<string>();
  for (const [index, item] of (Array.isArray(cfg.rules) ? cfg.rules : []).entries()) {
    const r = (item ?? {}) as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!id || seen.has(id)) {
      problems.push(`rule #${index}: ${id ? `duplicate id ${id}` : "missing id"}`);
      continue;
    }
    seen.add(id);
    const everyMs = r.every === undefined ? null : parseDuration(r.every);
    if (r.every !== undefined && everyMs === null) {
      problems.push(`rule ${id}: invalid every "${String(r.every)}"`);
      continue;
    }
    const cron = typeof r.cron === "string" ? r.cron.trim() : null;
    if (cron && cron.split(/\s+/).length !== 5) {
      problems.push(`rule ${id}: cron needs 5 fields`);
      continue;
    }
    if (!everyMs && !cron) {
      problems.push(`rule ${id}: needs every or cron`);
      continue;
    }
    const cooldownMs = r.cooldown === undefined ? 0 : parseDuration(r.cooldown);
    if (cooldownMs === null) {
      problems.push(`rule ${id}: invalid cooldown`);
      continue;
    }
    if (typeof r.message !== "string" || !r.message.trim() || typeof r.sessionKey !== "string" || !r.sessionKey.trim()) {
      problems.push(`rule ${id}: message and sessionKey are required`);
      continue;
    }
    rules.push({
      id,
      enabled: r.enabled !== false,
      everyMs: everyMs && everyMs > 0 ? everyMs : null,
      cron: cron || null,
      cooldownMs,
      message: r.message,
      sessionKey: r.sessionKey,
      condition: r.condition && typeof r.condition === "object" ? (r.condition as RuleCondition) : null,
    });
  }
  const tick = cfg.tickMs;
  return {
    config: {
      dryRun: cfg.dryRun !== false,
      tickMs: typeof tick === "number" && Number.isFinite(tick) ? Math.max(1_000, Math.floor(tick)) : 30_000,
      rules,
    },
    problems,
  };
}

export type RuleState = Record<string, { lastFiredAt?: number; lastCronMinute?: string }>;

export type Probe = {
  fileMtime: (p: string) => number | null;
  signal: (name: string) => unknown;
  local: (now: number) => { minute: number; hour: number; day: number; month: number; weekday: number; minuteKey: string };
};

function pick(value: unknown, dotted?: string): unknown {
  if (!dotted) {
    return value;
  }
  let cur: unknown = value;
  for (const key of dotted.split(".")) {
    if (cur && typeof cur === "object" && key in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Pure: does the rule's condition hold now? */
export function conditionHolds(cond: RuleCondition | null, now: number, probe: Probe, resolve: (p: string) => string): boolean {
  if (!cond) {
    return true;
  }
  if (cond.fileExists && probe.fileMtime(resolve(cond.fileExists)) === null) {
    return false;
  }
  if (cond.fileMissing && probe.fileMtime(resolve(cond.fileMissing)) !== null) {
    return false;
  }
  if (cond.fileOlderThan) {
    const m = probe.fileMtime(resolve(cond.fileOlderThan.path));
    if (m === null || now - m < cond.fileOlderThan.minutes * 60_000) {
      return false;
    }
  }
  if (cond.fileNewerThan) {
    const m = probe.fileMtime(resolve(cond.fileNewerThan.path));
    if (m === null || now - m > cond.fileNewerThan.minutes * 60_000) {
      return false;
    }
  }
  const local = probe.local(now);
  if (cond.hoursBetween) {
    const [a, b] = cond.hoursBetween;
    const inside = a <= b ? local.hour >= a && local.hour < b : local.hour >= a || local.hour < b;
    if (!inside) {
      return false;
    }
  }
  if (cond.weekdays && !cond.weekdays.includes(local.weekday)) {
    return false;
  }
  if (cond.signalEquals) {
    const actual = pick(probe.signal(cond.signalEquals.name), cond.signalEquals.path);
    if (JSON.stringify(actual) !== JSON.stringify(cond.signalEquals.value)) {
      return false;
    }
  }
  return true;
}

/** Pure: which rules fire at `now`, and the state after. */
export function evaluateRules(
  rules: Rule[],
  state: RuleState,
  now: number,
  probe: Probe,
  resolve: (p: string) => string,
): { fired: Rule[]; state: RuleState } {
  const next: RuleState = { ...state };
  const fired: Rule[] = [];
  const local = probe.local(now);
  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }
    const st = { ...(next[rule.id] ?? {}) };
    let due = false;
    if (rule.everyMs) {
      due = st.lastFiredAt === undefined || now - st.lastFiredAt >= rule.everyMs;
    }
    if (!due && rule.cron && st.lastCronMinute !== local.minuteKey && cronMatches(rule.cron, local)) {
      due = true;
    }
    if (rule.cron) {
      // A cron minute is tried once, whether or not the condition held.
      if (cronMatches(rule.cron, local)) {
        st.lastCronMinute = local.minuteKey;
      }
    }
    if (!due) {
      next[rule.id] = st;
      continue;
    }
    if (rule.cooldownMs > 0 && st.lastFiredAt !== undefined && now - st.lastFiredAt < rule.cooldownMs) {
      next[rule.id] = st;
      continue;
    }
    if (!conditionHolds(rule.condition, now, probe, resolve)) {
      next[rule.id] = st;
      continue;
    }
    st.lastFiredAt = now;
    next[rule.id] = st;
    fired.push(rule);
  }
  return { fired, state: next };
}

export function localParts(now: number, timezone?: string): ReturnType<Probe["local"]> {
  const d = new Date(now);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    minute: "2-digit",
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    weekday: "short",
  });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const days: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const hour = Number(p.hour) % 24;
  return {
    minute: Number(p.minute),
    hour,
    day: Number(p.day),
    month: Number(p.month),
    weekday: days[p.weekday] ?? 1,
    minuteKey: `${p.year}-${p.month}-${p.day}T${String(hour).padStart(2, "0")}:${p.minute}`,
  };
}

export function createTriggers(api: KoLoPluginApi, deps: Partial<Probe> & { now?: () => number } = {}) {
  const { config, problems } = resolveTriggersConfig(api.pluginConfig);
  const stateFile = path.join(api.paths.stateDir, "proactive", "state.json");
  const now = deps.now ?? Date.now;
  const timezone = (api.config as { agents?: { defaults?: { timezone?: string } } }).agents?.defaults?.timezone;
  const probe: Probe = {
    fileMtime:
      deps.fileMtime ??
      ((p) => {
        try {
          return fs.statSync(p).mtimeMs;
        } catch {
          return null;
        }
      }),
    signal: deps.signal ?? ((name) => api.signals.get(name)),
    local: deps.local ?? ((t) => localParts(t, timezone)),
  };
  const resolve = (p: string) => {
    const expanded = api.resolvePath(p);
    return path.isAbsolute(expanded) ? expanded : path.join(api.paths.stateDir, expanded);
  };
  let state: RuleState = {};
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as RuleState;
  } catch {
    state = {};
  }
  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
      fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    } catch (err) {
      api.logger.warn(`[proactive-triggers] could not persist ${stateFile}: ${String(err)}`);
    }
  };

  const tick = () => {
    const t = now();
    const result = evaluateRules(config.rules, state, t, probe, resolve);
    state = result.state;
    for (const rule of result.fired) {
      if (config.dryRun) {
        api.logger.info(`[proactive-triggers] (dry run) ${rule.id} → ${rule.sessionKey}`);
        api.audit({
          action: "proactive.dry_run",
          scope: rule.sessionKey,
          detail: { rule: rule.id, message: rule.message },
        });
        continue;
      }
      try {
        api.enqueueSystemEvent(rule.message, rule.sessionKey);
        api.logger.info(`[proactive-triggers] fired ${rule.id} → ${rule.sessionKey}`);
        api.audit({ action: "proactive.fired", scope: rule.sessionKey, detail: { rule: rule.id } });
      } catch (err) {
        api.audit({ action: "proactive.fired", outcome: "failed", scope: rule.sessionKey, detail: { rule: rule.id, error: String(err) } });
      }
    }
    if (result.fired.length > 0) {
      persist();
      api.signals.set("proactive.lastFired", { at: t, rules: result.fired.map((r) => r.id), dryRun: config.dryRun });
    }
    return result.fired.map((r) => r.id);
  };

  return { config, problems, tick, state: () => state, stateFile };
}

const proactiveTriggersPlugin = {
  id: "proactive-triggers",
  name: "Proactive Triggers",
  description: "Config-declared impulse rules that send system events to sessions (dry-run by default)",
  register(api: KoLoPluginApi) {
    const triggers = createTriggers(api);
    for (const problem of triggers.problems) {
      api.logger.warn(`[proactive-triggers] ${problem}`);
    }
    if (triggers.config.rules.length === 0) {
      api.logger.warn("[proactive-triggers] no valid rules configured");
    }
    api.registerService({
      id: "proactive-triggers",
      start: () => {
        api.logger.info(
          `[proactive-triggers] ${triggers.config.rules.length} rule(s), tick ${triggers.config.tickMs} ms${triggers.config.dryRun ? ", DRY RUN (set dryRun: false to deliver)" : ""}`,
        );
        api.lifecycle.setInterval(() => triggers.tick(), triggers.config.tickMs);
      },
    });
  },
};

export default proactiveTriggersPlugin;
