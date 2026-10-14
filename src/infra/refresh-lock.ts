// Cross-process lock for credential refreshes. One file, created with O_EXCL, holding
// `<pid>:<timestamp>`. Release unlinks the file. A lock whose content is empty or unparseable,
// whose timestamp is older than the timeout, or whose owning pid no longer exists is stale and
// may be taken over. (Writing "" on release used to leave a file whose timestamp parsed as NaN,
// which is never older than the timeout: every later refresh in every process was blocked.)

import fs from "node:fs";
import path from "node:path";
import { koloRunDir } from "../config/kolo-home.js";

export const DEFAULT_REFRESH_LOCK_TIMEOUT_MS = 120_000;

export type RefreshLockOptions = {
  /** Age after which a live-looking lock is treated as abandoned. */
  timeoutMs?: number;
  now?: () => number;
  pid?: number;
  /** Injected for tests: whether a pid is alive. */
  isPidAlive?: (pid: number) => boolean;
};

/** `<KOLO_HOME>/run/<name>.lock` — the default lock location for a named refresh. */
export function defaultRefreshLockPath(name: string): string {
  return path.join(koloRunDir(), `${name}.lock`);
}

export function parseRefreshLock(content: string): { pid: number; timestamp: number } | null {
  const [pidRaw, tsRaw] = content.trim().split(":");
  const pid = Number.parseInt(pidRaw ?? "", 10);
  const timestamp = Number.parseInt(tsRaw ?? "", 10);
  if (!Number.isFinite(pid) || !Number.isFinite(timestamp) || pid <= 0 || timestamp <= 0) {
    return null;
  }
  return { pid, timestamp };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether the content of an existing lock file no longer protects anything. */
export function isRefreshLockStale(content: string, opts: RefreshLockOptions = {}): boolean {
  const parsed = parseRefreshLock(content);
  if (!parsed) {
    return true;
  }
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_REFRESH_LOCK_TIMEOUT_MS;
  if (now() - parsed.timestamp > timeoutMs) {
    return true;
  }
  const alive = opts.isPidAlive ?? pidAlive;
  return !alive(parsed.pid);
}

/**
 * Take the lock. Returns true when this process now holds it. Never throws: an unreadable lock
 * directory means "not acquired".
 */
export function acquireRefreshLock(lockPath: string, opts: RefreshLockOptions = {}): boolean {
  const now = opts.now ?? Date.now;
  const pid = opts.pid ?? process.pid;
  const payload = `${pid}:${now()}`;
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, payload, { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    // Exists (or cannot be created): decide whether the holder is gone.
  }
  let content: string;
  try {
    content = fs.readFileSync(lockPath, "utf8");
  } catch {
    return false;
  }
  if (!isRefreshLockStale(content, opts)) {
    return false;
  }
  try {
    fs.writeFileSync(lockPath, payload, { flag: "w", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** Release by unlinking; only the holder should call this. Best effort. */
export function releaseRefreshLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // Already gone or not ours to remove.
  }
}

/** Run `fn` under the lock; returns null when the lock is held elsewhere. */
export async function withRefreshLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: RefreshLockOptions = {},
): Promise<T | null> {
  if (!acquireRefreshLock(lockPath, opts)) {
    return null;
  }
  try {
    return await fn();
  } finally {
    releaseRefreshLock(lockPath);
  }
}
