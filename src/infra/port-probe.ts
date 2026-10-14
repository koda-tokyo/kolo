// Port probing and `--force` port freeing without lsof/fuser/shell (Linux, macOS, Windows).
//
// probe:  try to bind the port (EADDRINUSE → busy) and try to connect to it (accepted → busy).
// force:  only kill pids recorded in this identity's gateway lock files; never pattern-match
//         process names. On Linux the pid is additionally checked against /proc to confirm it
//         owns a listening socket on the port.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { koloRunDir, resolveKoloHome } from "../config/kolo-home.js";

export type PortState = "free" | "busy";

function tryBind(port: number, host: string): Promise<PortState | "unsupported"> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        resolve("busy");
      } else {
        // e.g. EADDRNOTAVAIL when IPv6 loopback is disabled
        resolve("unsupported");
      }
    });
    server.listen({ port, host, exclusive: true }, () => {
      server.close(() => resolve("free"));
    });
  });
}

function tryConnect(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (accepted: boolean) => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** Is anything listening on the port (any loopback or wildcard address)? */
export async function probePort(
  port: number,
  opts: { timeoutMs?: number } = {},
): Promise<PortState> {
  const timeoutMs = opts.timeoutMs ?? 500;
  for (const host of ["127.0.0.1", "::1"]) {
    if (await tryConnect(port, host, timeoutMs)) {
      return "busy";
    }
  }
  // No wildcard bind on Windows: it can raise a firewall prompt. Loopback is enough there.
  const bindHosts = process.platform === "win32" ? ["127.0.0.1"] : ["0.0.0.0", "127.0.0.1", "::"];
  for (const host of bindHosts) {
    if ((await tryBind(port, host)) === "busy") {
      return "busy";
    }
  }
  return "free";
}

export type GatewayLockOwner = { pid: number; lockPath: string; port?: number };

function readLockOwner(lockPath: string): GatewayLockOwner | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      pid?: unknown;
      port?: unknown;
    };
    const pid = typeof parsed.pid === "number" ? parsed.pid : Number.NaN;
    if (!Number.isInteger(pid) || pid <= 0) {
      return null;
    }
    return { pid, lockPath, port: typeof parsed.port === "number" ? parsed.port : undefined };
  } catch {
    return null;
  }
}

/**
 * Lock files that name this identity's gateway pid: the gateway lease
 * `<KOLO_HOME>/run/gateway.lock` ({pid, port, ...}). The old tmpdir lock was removed in M1d.
 */
export function resolveGatewayLockPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = resolveKoloHome({ env });
  return [path.join(koloRunDir(home), "gateway.lock")];
}

export function readGatewayLockOwners(env: NodeJS.ProcessEnv = process.env): GatewayLockOwner[] {
  const seen = new Set<number>();
  const owners: GatewayLockOwner[] = [];
  for (const lockPath of resolveGatewayLockPaths(env)) {
    const owner = readLockOwner(lockPath);
    if (owner && !seen.has(owner.pid)) {
      seen.add(owner.pid);
      owners.push(owner);
    }
  }
  return owners;
}

/** Linux only: socket inodes listening on `port`, from /proc/net/tcp{,6}. */
function listeningInodes(port: number): Set<string> | null {
  const inodes = new Set<string>();
  let readAny = false;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
      readAny = true;
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const local = cols[1];
      // st 0A = TCP_LISTEN; column 9 is the inode.
      if (!local || cols[3] !== "0A") {
        continue;
      }
      const hexPort = local.split(":").pop() ?? "";
      if (Number.parseInt(hexPort, 16) === port && cols[9]) {
        inodes.add(cols[9]);
      }
    }
  }
  return readAny ? inodes : null;
}

/** true/false when it can be verified (Linux /proc), null when unknown (other OSes, no access). */
export function pidListensOnPort(pid: number, port: number): boolean | null {
  if (process.platform !== "linux") {
    return null;
  }
  const inodes = listeningInodes(port);
  if (!inodes) {
    return null;
  }
  let fds: string[];
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return null;
  }
  for (const fd of fds) {
    try {
      const target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
      const m = target.match(/^socket:\[(\d+)\]$/);
      if (m && inodes.has(m[1] ?? "")) {
        return true;
      }
    } catch {
      // fd closed meanwhile
    }
  }
  return false;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
