// `kolo gateway --force`: free the gateway port without lsof/fuser or a shell.
// The only pids ever signalled are the ones recorded in this identity's gateway lock files
// (see src/infra/port-probe.ts); an unknown process holding the port is reported, not killed.
import {
  isPidAlive,
  pidListensOnPort,
  probePort,
  readGatewayLockOwners,
} from "../infra/port-probe.js";
import { sleep } from "../utils.js";

export type PortProcess = { pid: number; command?: string };

export type ForceFreePortResult = {
  killed: PortProcess[];
  waitedMs: number;
  escalatedToSigkill: boolean;
};

export type ForceFreePortOptions = {
  /** Total wait budget across signals. */
  timeoutMs?: number;
  /** Poll interval for re-probing the port. */
  intervalMs?: number;
  /** How long to wait after SIGTERM before escalating to SIGKILL. */
  sigtermTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

/** Gateway pids from the lock files that (as far as the OS lets us verify) hold `port`. */
export function listPortListeners(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): PortProcess[] {
  const out: PortProcess[] = [];
  for (const owner of readGatewayLockOwners(env)) {
    if (owner.pid === process.pid || !isPidAlive(owner.pid)) {
      continue;
    }
    if (owner.port !== undefined && owner.port !== port) {
      continue;
    }
    if (pidListensOnPort(owner.pid, port) === false) {
      continue;
    }
    out.push({ pid: owner.pid, command: `gateway (${owner.lockPath})` });
  }
  return out;
}

function signalAll(procs: PortProcess[], signal: NodeJS.Signals) {
  for (const proc of procs) {
    try {
      process.kill(proc.pid, signal);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        continue;
      }
      throw new Error(`failed to signal pid ${proc.pid}: ${String(err)}`, { cause: err });
    }
  }
}

export async function forceFreePort(
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PortProcess[]> {
  if ((await probePort(port)) === "free") {
    return [];
  }
  const owners = listPortListeners(port, env);
  if (owners.length === 0) {
    throw new Error(
      `port ${port} is in use by a process that no KoLo gateway lock names; refusing to kill it. ` +
        `Identify it with your OS tools (ss -ltnp, netstat -ano, Resource Monitor) or pick another --port.`,
    );
  }
  signalAll(owners, "SIGTERM");
  return owners;
}

async function waitFree(port: number, budgetMs: number, intervalMs: number): Promise<number> {
  let waited = 0;
  while (waited < budgetMs) {
    if ((await probePort(port, { timeoutMs: Math.min(intervalMs, 250) })) === "free") {
      return waited;
    }
    await sleep(intervalMs);
    waited += intervalMs;
  }
  return (await probePort(port)) === "free" ? waited : -1;
}

export async function forceFreePortAndWait(
  port: number,
  opts: ForceFreePortOptions = {},
): Promise<ForceFreePortResult> {
  const timeoutMs = Math.max(opts.timeoutMs ?? 1500, 0);
  const intervalMs = Math.max(opts.intervalMs ?? 100, 1);
  const sigtermTimeoutMs = Math.min(Math.max(opts.sigtermTimeoutMs ?? 600, 0), timeoutMs);

  const killed = await forceFreePort(port, opts.env);
  if (killed.length === 0) {
    return { killed, waitedMs: 0, escalatedToSigkill: false };
  }

  const afterTerm = await waitFree(port, sigtermTimeoutMs, intervalMs);
  if (afterTerm >= 0) {
    return { killed, waitedMs: afterTerm, escalatedToSigkill: false };
  }
  let waitedMs = sigtermTimeoutMs;

  signalAll(
    killed.filter((p) => isPidAlive(p.pid)),
    "SIGKILL",
  );
  const afterKill = await waitFree(port, Math.max(timeoutMs - waitedMs, intervalMs), intervalMs);
  if (afterKill >= 0) {
    return { killed, waitedMs: waitedMs + afterKill, escalatedToSigkill: true };
  }
  waitedMs = timeoutMs;
  throw new Error(
    `port ${port} still in use after --force (signalled ${killed.map((p) => p.pid).join(", ")}; waited ${waitedMs}ms)`,
  );
}
