// Gateway lease — one gateway per state root (KoLo 2.0, M1a).
//
// `<run>/gateway.lock` holds `{pid, port, startedAt, hostname, leaseId}`.
// Acquire = exclusive create (O_EXCL, "wx"). An existing lock is honoured
// unless it is stale:
//   - same host and the holder pid is dead (`process.kill(pid, 0)` → ESRCH), or
//   - the lock file heartbeat (mtime, refreshed every 15 s) is older than 60 s.
// A stale lock is reclaimed by an atomic rename-aside followed by a fresh
// exclusive create, so two contenders cannot both win.
// Node fs only: no flock(1), no lsof — works on Linux, macOS and Windows.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LEASE_FILENAME = "gateway.lock";
export const LEASE_HEARTBEAT_MS = 15_000;
export const LEASE_STALE_MS = 60_000;

export interface LeaseHolder {
  pid: number;
  hostname: string;
  startedAt: number;
  port?: number;
  leaseId?: string;
}

export type LeaseResult =
  | { ok: true; leaseId: string; staleCleaned?: boolean }
  | { ok: false; leaseId?: string; existing: { holder: LeaseHolder } };

export interface LeaseHeartbeat {
  start(): void;
  stop(): void;
}

export type LeaseManagerOptions = {
  /** Directory that holds the lock file (normally `<KOLO_HOME>/run`). */
  runtimeDir: string;
  generation: number;
  version?: string;
  port?: number;
  heartbeatMs?: number;
  staleMs?: number;
  /** Injectable for tests. */
  now?: () => number;
  isPidAlive?: (pid: number) => boolean;
  hostname?: () => string;
  onLost?: (holder: LeaseHolder | null) => void;
};

type LockFile = LeaseHolder & { version?: string; generation?: number };

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(file: string): { raw: string; holder: LockFile | null; mtimeMs: number } | null {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = fs.readFileSync(file, "utf8");
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockFile>;
    if (typeof parsed.pid === "number" && typeof parsed.hostname === "string") {
      return {
        raw,
        mtimeMs,
        holder: {
          pid: parsed.pid,
          hostname: parsed.hostname,
          startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
          port: typeof parsed.port === "number" ? parsed.port : undefined,
          leaseId: typeof parsed.leaseId === "string" ? parsed.leaseId : undefined,
          version: parsed.version,
          generation: parsed.generation,
        },
      };
    }
  } catch {
    // fall through: unparseable (possibly mid-write)
  }
  return { raw, mtimeMs, holder: null };
}

export class LeaseManager {
  public readonly leaseId: string;
  public readonly lockPath: string;
  private readonly runtimeDir: string;
  private readonly generation: number;
  private readonly version?: string;
  private readonly port?: number;
  private readonly heartbeatMs: number;
  private readonly staleMs: number;
  private readonly now: () => number;
  private readonly pidAlive: (pid: number) => boolean;
  private readonly host: () => string;
  private readonly onLost?: (holder: LeaseHolder | null) => void;
  private _held = false;
  private acquiredAt = 0;
  private heartbeat: LeaseHeartbeat | null = null;
  private readonly exitHook = () => this.releaseSync();

  constructor(opts: LeaseManagerOptions) {
    this.runtimeDir = opts.runtimeDir;
    this.generation = opts.generation;
    this.version = opts.version;
    this.port = opts.port;
    this.heartbeatMs = opts.heartbeatMs ?? LEASE_HEARTBEAT_MS;
    this.staleMs = opts.staleMs ?? LEASE_STALE_MS;
    this.now = opts.now ?? Date.now;
    this.pidAlive = opts.isPidAlive ?? isPidAlive;
    this.host = opts.hostname ?? os.hostname;
    this.onLost = opts.onLost;
    this.lockPath = path.join(this.runtimeDir, LEASE_FILENAME);
    this.leaseId = `lease-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  acquire(): LeaseResult {
    if (this._held) {
      return { ok: true, leaseId: this.leaseId };
    }
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    if (this.tryCreate()) {
      return this.markHeld(false);
    }
    const existing = readLock(this.lockPath);
    if (!existing) {
      // Holder released between our create and read; one more attempt.
      return this.tryCreate() ? this.markHeld(false) : this.refused(readLock(this.lockPath));
    }
    if (!this.isStale(existing)) {
      return this.refused(existing);
    }
    if (!this.reclaim(existing.raw)) {
      return this.refused(readLock(this.lockPath));
    }
    return this.tryCreate() ? this.markHeld(true) : this.refused(readLock(this.lockPath));
  }

  /** Refresh the heartbeat and confirm the lock is still ours. */
  renew(): LeaseResult {
    const current = readLock(this.lockPath);
    if (!this._held || current?.holder?.leaseId !== this.leaseId) {
      if (this._held) {
        this.lose(current?.holder ?? null);
      }
      return this.refused(current);
    }
    try {
      const t = new Date(this.now());
      fs.utimesSync(this.lockPath, t, t);
    } catch {
      // A transient failure is tolerated; staleness needs 60 s of them.
    }
    return { ok: true, leaseId: this.leaseId };
  }

  release(): void {
    this.stopHeartbeat();
    this.releaseSync();
  }

  startHeartbeat(): void {
    if (this.heartbeat) {
      return;
    }
    let timer: NodeJS.Timeout | null = null;
    this.heartbeat = {
      start: () => {
        timer = setInterval(() => {
          this.renew();
        }, this.heartbeatMs);
        timer.unref?.();
      },
      stop: () => {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
    };
    this.heartbeat.start();
  }

  stop(): void {
    this.release();
  }

  get isHeld(): boolean {
    return this._held;
  }

  get holdingMs(): number {
    return this._held ? Math.max(0, this.now() - this.acquiredAt) : 0;
  }

  /** Current lock-file holder, if any (for diagnostics). */
  readHolder(): LeaseHolder | null {
    return readLock(this.lockPath)?.holder ?? null;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private tryCreate(): boolean {
    let fd: number;
    try {
      fd = fs.openSync(this.lockPath, "wx", 0o644);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw err;
    }
    try {
      const body: LockFile = {
        pid: process.pid,
        port: this.port,
        startedAt: this.now(),
        hostname: this.host(),
        leaseId: this.leaseId,
        version: this.version,
        generation: this.generation,
      };
      fs.writeSync(fd, `${JSON.stringify(body)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  private isStale(lock: { holder: LockFile | null; mtimeMs: number }): boolean {
    const heartbeatAge = this.now() - lock.mtimeMs;
    if (heartbeatAge > this.staleMs) {
      return true;
    }
    const holder = lock.holder;
    if (!holder) {
      return false; // unparseable but fresh: probably mid-write; honour it
    }
    // pid liveness is only meaningful on the same host.
    return holder.hostname === this.host() && !this.pidAlive(holder.pid);
  }

  /**
   * Move the stale lock aside atomically. If what we moved is not what we
   * judged stale (another contender already replaced it), put it back.
   */
  private reclaim(expectedRaw: string): boolean {
    const aside = `${this.lockPath}.stale-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.renameSync(this.lockPath, aside);
    } catch (err) {
      // ENOENT: someone else reclaimed first; let tryCreate race for it.
      return (err as NodeJS.ErrnoException).code === "ENOENT";
    }
    let movedRaw = "";
    try {
      movedRaw = fs.readFileSync(aside, "utf8");
    } catch {
      // ignore
    }
    if (movedRaw !== expectedRaw) {
      try {
        fs.linkSync(aside, this.lockPath); // restore unless a newer lock exists
      } catch {
        // EEXIST: a newer lock already took its place
      }
      fs.rmSync(aside, { force: true });
      return false;
    }
    fs.rmSync(aside, { force: true });
    return true;
  }

  private markHeld(staleCleaned: boolean): LeaseResult {
    this._held = true;
    this.acquiredAt = this.now();
    process.once("exit", this.exitHook);
    return staleCleaned
      ? { ok: true, leaseId: this.leaseId, staleCleaned: true }
      : { ok: true, leaseId: this.leaseId };
  }

  private refused(lock: { holder: LockFile | null } | null): LeaseResult {
    const holder = lock?.holder ?? { pid: 0, hostname: "", startedAt: 0 };
    return { ok: false, existing: { holder } };
  }

  private lose(holder: LeaseHolder | null): void {
    this._held = false;
    this.stopHeartbeat();
    process.removeListener("exit", this.exitHook);
    this.onLost?.(holder);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      this.heartbeat.stop();
      this.heartbeat = null;
    }
  }

  /** Synchronous so it also runs from the process "exit" hook. */
  private releaseSync(): void {
    if (!this._held) {
      return;
    }
    this._held = false;
    process.removeListener("exit", this.exitHook);
    try {
      const current = readLock(this.lockPath);
      if (current?.holder?.leaseId === this.leaseId) {
        fs.rmSync(this.lockPath, { force: true });
      }
    } catch {
      // best-effort; a dead pid makes the lock stale anyway
    }
  }
}
