// Service runner used where the OS supervisor cannot do it alone:
//   macOS   launchd has no EnvironmentFile; the runner loads `<KOLO_HOME>/env` and execs the gateway.
//   Windows Task Scheduler has no restart-on-exit; the runner adds a restart loop and a file log.
// Linux does not use it: systemd runs the gateway directly.
//
// Usage: node runner.js --env-file <f> [--pid-file <f>] [--log-file <f>]
//                       [--restart-loop] [--restart-sec N] -- <command> [args...]
//
// Kept dependency-free (node: builtins only) so it starts fast and cannot break with the app.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./env-file.js";

export type RunnerOptions = {
  envFile?: string;
  pidFile?: string;
  logFile?: string;
  restartLoop: boolean;
  restartSec: number;
  command: string[];
};

const LOG_ROTATE_BYTES = 10 * 1024 * 1024;
const STOP_GRACE_MS = 10_000;

export function parseRunnerArgs(argv: string[]): RunnerOptions {
  const opts: RunnerOptions = { restartLoop: false, restartSec: 3, command: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      opts.command = argv.slice(i + 1);
      break;
    }
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`runner: ${arg} needs a value`);
      }
      return value;
    };
    switch (arg) {
      case "--env-file":
        opts.envFile = next();
        break;
      case "--pid-file":
        opts.pidFile = next();
        break;
      case "--log-file":
        opts.logFile = next();
        break;
      case "--restart-loop":
        opts.restartLoop = true;
        break;
      case "--restart-sec":
        opts.restartSec = Math.max(0, Number.parseFloat(next()) || 0);
        break;
      default:
        throw new Error(`runner: unknown argument ${arg}`);
    }
  }
  if (opts.command.length === 0) {
    throw new Error("runner: missing command after --");
  }
  return opts;
}

function openLog(file: string): fs.WriteStream {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (fs.statSync(file).size > LOG_ROTATE_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
  } catch {
    // no log yet
  }
  return fs.createWriteStream(file, { flags: "a", mode: 0o600 });
}

function writePidFile(file: string, childPid: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { pid: childPid, runnerPid: process.pid, startedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
}

export async function runService(opts: RunnerOptions): Promise<number> {
  const env = { ...process.env, ...(opts.envFile ? readEnvFile(opts.envFile) : {}) };
  let stopping = false;
  let child: ChildProcess | null = null;
  let log: fs.WriteStream | null = null;

  const stamp = (msg: string) => {
    const line = `${new Date().toISOString()} [kolo-runner] ${msg}\n`;
    if (log) {
      log.write(line);
    } else {
      process.stderr.write(line);
    }
  };

  const onSignal = (signal: NodeJS.Signals) => {
    stopping = true;
    stamp(`received ${signal}; stopping gateway`);
    if (child?.pid) {
      child.kill("SIGTERM");
      const pid = child.pid;
      setTimeout(() => {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }, STOP_GRACE_MS).unref();
    }
  };
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"] as NodeJS.Signals[]) {
    try {
      process.on(sig, onSignal);
    } catch {
      // signal not supported on this platform
    }
  }

  const [cmd, ...args] = opts.command;
  for (;;) {
    if (opts.logFile) {
      log = openLog(opts.logFile);
    }
    const started = Date.now();
    child = spawn(cmd, args, {
      env,
      stdio: log ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
    });
    if (log) {
      child.stdout?.pipe(log, { end: false });
      child.stderr?.pipe(log, { end: false });
    }
    if (opts.pidFile && child.pid) {
      writePidFile(opts.pidFile, child.pid);
    }
    stamp(`started gateway pid ${child.pid ?? "?"}`);
    const code: number = await new Promise((resolve) => {
      child?.once("error", (err) => {
        stamp(`spawn failed: ${String(err)}`);
        resolve(127);
      });
      child?.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 128 : 1)));
    });
    stamp(`gateway exited code=${code} after ${Math.round((Date.now() - started) / 1000)}s`);
    if (opts.pidFile) {
      fs.rmSync(opts.pidFile, { force: true });
    }
    if (stopping || !opts.restartLoop) {
      log?.end();
      return stopping ? 0 : code;
    }
    await new Promise((r) => setTimeout(r, opts.restartSec * 1000));
    if (stopping) {
      log?.end();
      return 0;
    }
    log?.end();
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  let opts: RunnerOptions;
  try {
    opts = parseRunnerArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${String(err)}\n`);
    process.exit(2);
  }
  void runService(opts).then((code) => process.exit(code));
}
