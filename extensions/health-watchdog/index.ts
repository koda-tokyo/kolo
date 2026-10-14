/**
 * Health watchdog (KoLo 2.0, M7). On by default.
 *
 * Every `intervalMs` it checks that the gateway lease (`<runDir>/gateway.lock`) is held by this
 * process and fresh, and that the gateway port accepts a TCP connection. After `failureThreshold`
 * consecutive failures it asks the supervisor to restart the gateway (once per
 * `restartCooldownMs`); after `escalateAfter` failures it escalates: an audit row and, when
 * configured, a system event to a session. Every state change is audited. Extra `targets`
 * (another port / lease file on this host) are checked the same way but only audited and
 * escalated, never restarted.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { KoLoPluginApi } from "KoLo/plugin-sdk";

export type WatchdogConfig = {
  intervalMs: number;
  failureThreshold: number;
  escalateAfter: number;
  restart: boolean;
  restartCooldownMs: number;
  leaseStaleMs: number;
  port?: number;
  probeTimeoutMs: number;
  escalation?: { sessionKey?: string; message?: string };
  targets: Array<{ id: string; host?: string; port?: number; leaseFile?: string }>;
};

export function resolveWatchdogConfig(raw: Record<string, unknown> | undefined): WatchdogConfig {
  const cfg = raw ?? {};
  const int = (key: string, fallback: number, min: number) => {
    const v = cfg[key];
    return typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
  };
  return {
    intervalMs: int("intervalMs", 60_000, 5_000),
    failureThreshold: int("failureThreshold", 3, 1),
    escalateAfter: int("escalateAfter", 6, 1),
    restart: cfg.restart !== false,
    restartCooldownMs: int("restartCooldownMs", 300_000, 10_000),
    leaseStaleMs: int("leaseStaleMs", 60_000, 5_000),
    port: typeof cfg.port === "number" ? cfg.port : undefined,
    probeTimeoutMs: int("probeTimeoutMs", 2_000, 100),
    escalation:
      cfg.escalation && typeof cfg.escalation === "object"
        ? (cfg.escalation as WatchdogConfig["escalation"])
        : undefined,
    targets: Array.isArray(cfg.targets) ? (cfg.targets as WatchdogConfig["targets"]) : [],
  };
}

export type LeaseObservation = {
  exists: boolean;
  mtimeMs?: number;
  holder?: { pid?: number; port?: number; leaseId?: string } | null;
};

export type HealthSample = {
  now: number;
  lease: LeaseObservation;
  /** Whether the lease holder pid is alive (undefined when there is no holder). */
  holderAlive?: boolean;
  selfPid: number;
  portOpen: boolean;
  port: number;
};

export type HealthVerdict = { ok: boolean; problems: string[] };

/** Pure: one sample → ok / list of problems. */
export function evaluateHealth(sample: HealthSample, cfg: WatchdogConfig): HealthVerdict {
  const problems: string[] = [];
  if (!sample.lease.exists) {
    problems.push("lease file missing");
  } else {
    const holderPid = sample.lease.holder?.pid;
    if (holderPid !== undefined && holderPid !== sample.selfPid) {
      problems.push(
        `lease held by another process (pid ${holderPid}${sample.holderAlive === false ? ", dead" : ""})`,
      );
    }
    if (
      typeof sample.lease.mtimeMs === "number" &&
      sample.now - sample.lease.mtimeMs > cfg.leaseStaleMs
    ) {
      problems.push(`lease heartbeat stale (${Math.round((sample.now - sample.lease.mtimeMs) / 1000)} s)`);
    }
  }
  if (!sample.portOpen) {
    problems.push(`port ${sample.port} not accepting connections`);
  }
  return { ok: problems.length === 0, problems };
}

export type WatchdogState = {
  failures: number;
  lastRestartAt: number | null;
  escalated: boolean;
  lastOk: boolean | null;
};

export const initialWatchdogState = (): WatchdogState => ({
  failures: 0,
  lastRestartAt: null,
  escalated: false,
  lastOk: null,
});

export type WatchdogAction = "recovered" | "failed" | "restart" | "escalate";

/** Pure: fold a verdict into the state and say what to do. */
export function stepWatchdog(
  state: WatchdogState,
  verdict: HealthVerdict,
  cfg: WatchdogConfig,
  now: number,
): { state: WatchdogState; actions: WatchdogAction[] } {
  const actions: WatchdogAction[] = [];
  if (verdict.ok) {
    const next: WatchdogState = { failures: 0, lastRestartAt: state.lastRestartAt, escalated: false, lastOk: true };
    if (state.lastOk === false) {
      actions.push("recovered");
    }
    return { state: next, actions };
  }
  const failures = state.failures + 1;
  const next: WatchdogState = { ...state, failures, lastOk: false };
  actions.push("failed");
  if (
    cfg.restart &&
    failures >= cfg.failureThreshold &&
    (state.lastRestartAt === null || now - state.lastRestartAt >= cfg.restartCooldownMs)
  ) {
    next.lastRestartAt = now;
    actions.push("restart");
  }
  if (failures >= cfg.escalateAfter && !state.escalated) {
    next.escalated = true;
    actions.push("escalate");
  }
  return { state: next, actions };
}

export function readLease(file: string, now: () => number = Date.now): LeaseObservation {
  try {
    const stat = fs.statSync(file);
    let holder: LeaseObservation["holder"] = null;
    try {
      holder = JSON.parse(fs.readFileSync(file, "utf-8")) as LeaseObservation["holder"];
    } catch {
      holder = null;
    }
    return { exists: true, mtimeMs: Math.min(stat.mtimeMs, now()), holder };
  } catch {
    return { exists: false };
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function probePort(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let done = false;
    const finish = (ok: boolean) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

type Probes = {
  readLease: (file: string) => LeaseObservation;
  pidAlive: (pid: number) => boolean;
  probePort: (port: number, host: string, timeoutMs: number) => Promise<boolean>;
  now: () => number;
  selfPid: number;
};

export function createWatchdog(api: KoLoPluginApi, probes: Partial<Probes> = {}) {
  const cfg = resolveWatchdogConfig(api.pluginConfig);
  const p: Probes = {
    readLease: probes.readLease ?? ((file) => readLease(file)),
    pidAlive: probes.pidAlive ?? pidAlive,
    probePort: probes.probePort ?? probePort,
    now: probes.now ?? Date.now,
    selfPid: probes.selfPid ?? process.pid,
  };
  const leaseFile = path.join(api.paths.runDir, "gateway.lock");
  const states = new Map<string, WatchdogState>();
  let ticking = false;

  const port = () => {
    if (cfg.port) {
      return cfg.port;
    }
    const fromConfig = api.config.gateway?.port;
    if (typeof fromConfig === "number") {
      return fromConfig;
    }
    const holder = p.readLease(leaseFile).holder;
    return typeof holder?.port === "number" ? holder.port : 18789;
  };

  const checkOne = async (
    id: string,
    target: { host: string; port: number; leaseFile: string | null; restartable: boolean },
  ) => {
    const now = p.now();
    const lease: LeaseObservation = target.leaseFile ? p.readLease(target.leaseFile) : { exists: true };
    const holderPid = lease.holder?.pid;
    const sample: HealthSample = {
      now,
      lease,
      holderAlive: typeof holderPid === "number" ? p.pidAlive(holderPid) : undefined,
      selfPid: target.restartable ? p.selfPid : (holderPid ?? p.selfPid),
      portOpen: await p.probePort(target.port, target.host, cfg.probeTimeoutMs),
      port: target.port,
    };
    const verdict = evaluateHealth(sample, cfg);
    const prev = states.get(id) ?? initialWatchdogState();
    const { state, actions } = stepWatchdog(prev, verdict, cfg, now);
    states.set(id, state);
    api.signals.set(`health.${id}`, { ok: verdict.ok, failures: state.failures, problems: verdict.problems, at: now });
    for (const action of actions) {
      if (action === "recovered") {
        api.logger.info(`[health-watchdog] ${id} recovered`);
        api.audit({ action: "health.recovered", detail: { target: id } });
      } else if (action === "failed") {
        api.logger.warn(`[health-watchdog] ${id} check failed (${state.failures}): ${verdict.problems.join("; ")}`);
        api.audit({
          action: "health.check",
          outcome: "failed",
          detail: { target: id, failures: state.failures, problems: verdict.problems },
        });
      } else if (action === "restart") {
        if (target.restartable) {
          const result = api.supervisor.restartGateway(`health-watchdog: ${verdict.problems.join("; ")}`);
          api.audit({
            action: "health.restart",
            outcome: result.ok ? "ok" : "failed",
            detail: { target: id, method: result.method, detail: result.detail, failures: state.failures },
          });
        }
      } else if (action === "escalate") {
        const message =
          cfg.escalation?.message ??
          `Health watchdog: ${id} failed ${state.failures} consecutive checks (${verdict.problems.join("; ")}).`;
        api.audit({
          action: "health.escalated",
          outcome: "failed",
          detail: { target: id, failures: state.failures, problems: verdict.problems, sessionKey: cfg.escalation?.sessionKey },
        });
        if (cfg.escalation?.sessionKey) {
          try {
            api.enqueueSystemEvent(message, cfg.escalation.sessionKey);
          } catch (err) {
            api.logger.warn(`[health-watchdog] escalation event failed: ${String(err)}`);
          }
        }
      }
    }
  };

  const tick = async () => {
    if (ticking || api.lifecycle.disposed) {
      return;
    }
    ticking = true;
    try {
      await checkOne("gateway", { host: "127.0.0.1", port: port(), leaseFile, restartable: true });
      for (const target of cfg.targets) {
        if (!target.port && !target.leaseFile) {
          continue;
        }
        await checkOne(target.id, {
          host: target.host ?? "127.0.0.1",
          port: target.port ?? 0,
          leaseFile: target.leaseFile ? api.resolvePath(target.leaseFile) : null,
          restartable: false,
        });
      }
    } catch (err) {
      api.logger.warn(`[health-watchdog] tick failed: ${String(err)}`);
    } finally {
      ticking = false;
    }
  };

  return { cfg, tick, states };
}

/** Registers the service; `probes` are injectable for tests. */
export function registerHealthWatchdog(api: KoLoPluginApi, probes: Partial<Probes> = {}) {
  const watchdog = createWatchdog(api, probes);
  api.registerService({
      id: "health-watchdog",
      start: () => {
        // First check only after one interval: the gateway's own listener comes up after plugins.
        api.lifecycle.setInterval(() => void watchdog.tick(), watchdog.cfg.intervalMs);
        api.logger.info(
          `[health-watchdog] watching lease + port every ${Math.round(watchdog.cfg.intervalMs / 1000)} s (restart ${watchdog.cfg.restart ? "on" : "off"}, threshold ${watchdog.cfg.failureThreshold}, escalate at ${watchdog.cfg.escalateAfter})`,
        );
      },
  });
  return watchdog;
}

const healthWatchdogPlugin = {
  id: "health-watchdog",
  name: "Health Watchdog",
  description: "Lease and listener liveness; supervisor restart and escalation after repeated failures",
  register(api: KoLoPluginApi) {
    registerHealthWatchdog(api);
  },
};

export default healthWatchdogPlugin;
