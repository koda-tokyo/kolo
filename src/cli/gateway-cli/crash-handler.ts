// Gateway crash handling (KoLo 2.0, M1a).
//
// An uncaught exception or unhandled rejection leaves the process in an
// unknown state. We record what happened, then exit non-zero so the OS service
// manager (systemd / launchd / Windows service) restarts a clean process.
// `KOLO_CRASH_KEEPALIVE=1` keeps the process alive for debugging only.

import fs from "node:fs";
import path from "node:path";
import { koloLogDir } from "../../config/kolo-home.js";
import {
  isAbortError,
  isCrashKeepaliveEnabled,
  isTransientNetworkError,
  isUnhandledRejectionHandled,
} from "../../infra/unhandled-rejections.js";
import { VERSION } from "../../version.js";

export type CrashKind = "uncaughtException" | "unhandledRejection";

export type CrashRecord = {
  type: CrashKind;
  message: string;
  name?: string;
  stack?: string;
  pid: number;
  version: string;
  uptimeSec: number;
  timestamp: string;
};

/** Hard upper bound between the crash and process exit. */
export const CRASH_EXIT_DEADLINE_MS = 2000;

export function buildCrashRecord(
  type: CrashKind,
  reason: unknown,
  now: Date = new Date(),
): CrashRecord {
  const err = reason instanceof Error ? reason : undefined;
  return {
    type,
    message: err ? err.message : safeString(reason),
    name: err?.name,
    stack: err?.stack,
    pid: process.pid,
    version: VERSION,
    uptimeSec: Math.round(process.uptime() * 1000) / 1000,
    timestamp: now.toISOString(),
  };
}

function safeString(value: unknown): string {
  try {
    return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}

/**
 * Write `<dir>/crash-<ts>.json` synchronously and fsync it, so the record
 * survives the exit that follows. Returns the path written.
 */
export function writeCrashRecord(record: CrashRecord, dir: string = koloLogDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = record.timestamp.replace(/[:.]/g, "-");
  const file = path.join(dir, `crash-${stamp}-${record.pid}.json`);
  const fd = fs.openSync(file, "w", 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(record, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

export type CrashHandlerDeps = {
  log: { error: (msg: string) => void };
  exit?: (code: number) => void;
  env?: NodeJS.ProcessEnv;
  logDir?: () => string;
  /** Flush hook (e.g. logger transports); awaited up to the deadline. */
  flush?: () => Promise<void> | void;
  /**
   * Rejections that are not crashes (registered handlers, AbortError during
   * shutdown, transient network errors). Same policy as the CLI-wide handler.
   */
  isBenignRejection?: (reason: unknown) => boolean;
};

export function isBenignRejection(reason: unknown): boolean {
  return (
    isUnhandledRejectionHandled(reason) || isAbortError(reason) || isTransientNetworkError(reason)
  );
}

export type CrashHandle = {
  handle: (type: CrashKind, reason: unknown) => void;
  dispose: () => void;
};

export function installGatewayCrashHandlers(deps: CrashHandlerDeps): CrashHandle {
  const env = deps.env ?? process.env;
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const keepalive = isCrashKeepaliveEnabled(env);
  let exiting = false;

  const benign = deps.isBenignRejection ?? isBenignRejection;

  const handle = (type: CrashKind, reason: unknown) => {
    if (type === "unhandledRejection" && benign(reason)) {
      return; // the CLI-wide handler logs these and keeps running
    }
    const record = buildCrashRecord(type, reason);
    deps.log.error(
      `${type === "uncaughtException" ? "UNCAUGHT EXCEPTION" : "UNHANDLED REJECTION"}: ` +
        `${record.message}\n${record.stack ?? ""}`,
    );
    try {
      const file = writeCrashRecord(record, deps.logDir ? deps.logDir() : koloLogDir());
      deps.log.error(`crash record written: ${file}`);
    } catch (err) {
      deps.log.error(`crash record write failed: ${String(err)}`);
    }
    if (keepalive) {
      deps.log.error("KOLO_CRASH_KEEPALIVE=1 — staying alive (debug only; state may be corrupt)");
      return;
    }
    if (exiting) {
      return;
    }
    exiting = true;
    // Exit after flushing, but never later than the deadline.
    const timer = setTimeout(() => exit(1), CRASH_EXIT_DEADLINE_MS);
    void Promise.resolve()
      .then(() => deps.flush?.())
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        exit(1);
      });
  };

  const onException = (error: Error) => handle("uncaughtException", error);
  const onRejection = (reason: unknown) => handle("unhandledRejection", reason);
  // Prepend: the CLI-wide handlers (run-main.ts) call process.exit(1)
  // synchronously, so ours must run first for the record to land on disk.
  process.prependListener("uncaughtException", onException);
  process.prependListener("unhandledRejection", onRejection);
  return {
    handle,
    dispose: () => {
      process.removeListener("uncaughtException", onException);
      process.removeListener("unhandledRejection", onRejection);
    },
  };
}
