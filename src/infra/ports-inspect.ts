// Port diagnostics (who holds the gateway port?) without lsof/netstat/ps or a shell (M1d).
//
// status:    Node port probe (connect + exclusive bind), see port-probe.ts.
// listeners: only processes we can name without shelling out — the pids recorded in this
//            identity's gateway lock files. On Linux each pid is verified against /proc (it must
//            own a listening socket on the port) and its command line is read from
//            /proc/<pid>/cmdline. Anything else holding the port is reported as an unknown holder.
import fs from "node:fs";
import type { PortListener, PortUsage, PortUsageStatus } from "./ports-types.js";
import {
  isPidAlive,
  pidListensOnPort,
  probePort,
  readGatewayLockOwners,
  type GatewayLockOwner,
} from "./port-probe.js";
import { buildPortHints } from "./ports-format.js";

function readProcText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Linux: argv and executable name from /proc. Other OSes: undefined (no shell-out). */
function describePid(pid: number): Pick<PortListener, "command" | "commandLine"> {
  if (process.platform !== "linux") {
    return {};
  }
  const cmdline = readProcText(`/proc/${pid}/cmdline`)
    ?.split("\0")
    .filter(Boolean)
    .join(" ")
    .trim();
  const comm = readProcText(`/proc/${pid}/comm`)?.trim();
  return {
    ...(comm ? { command: comm } : {}),
    ...(cmdline ? { commandLine: cmdline } : {}),
  };
}

/** Lock owners that are alive, recorded for this port (or no port), and (Linux) own a listener. */
function lockOwnersOnPort(port: number, env: NodeJS.ProcessEnv): GatewayLockOwner[] {
  return readGatewayLockOwners(env).filter((owner) => {
    if (owner.port !== undefined && owner.port !== port) {
      return false;
    }
    if (!isPidAlive(owner.pid)) {
      return false;
    }
    // null = cannot verify on this OS; keep it (the lock names it as the gateway holder).
    return pidListensOnPort(owner.pid, port) !== false;
  });
}

export async function inspectPortUsage(
  port: number,
  opts: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<PortUsage> {
  const env = opts.env ?? process.env;
  let status: PortUsageStatus;
  const errors: string[] = [];
  try {
    status = await probePort(port, { timeoutMs: opts.timeoutMs });
  } catch (err) {
    status = "unknown";
    errors.push(String(err));
  }

  const listeners: PortListener[] =
    status === "busy"
      ? lockOwnersOnPort(port, env).map((owner) => {
          const described = describePid(owner.pid);
          // The lock file is our own gateway's lease: label it so classification is reliable.
          return {
            pid: owner.pid,
            ...described,
            command: described.command
              ? `${described.command} (kolo gateway lock)`
              : "kolo gateway",
          };
        })
      : [];

  const hints = buildPortHints(listeners, port);
  if (status === "busy" && listeners.length === 0) {
    hints.push(
      "Port is in use by an unknown holder (not the KoLo gateway for this state root). " +
        "Stop that process or choose another port with --port.",
    );
  }
  return {
    port,
    status,
    listeners,
    hints,
    errors: errors.length > 0 ? errors : undefined,
  };
}
