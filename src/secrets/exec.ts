import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type ExecResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type ExecSync = (
  command: string,
  args: string[],
  opts?: { input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
) => ExecResult;

/**
 * Synchronous exec without a shell. Secret values only ever travel via stdin or the child's
 * environment, never argv (argv is world-readable in the process table).
 */
export const defaultExecSync: ExecSync = (command, args, opts = {}) => {
  const res = spawnSync(command, args, {
    input: opts.input,
    env: opts.env ?? process.env,
    timeout: opts.timeoutMs ?? 10_000,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const timedOut = (res.error as { code?: string } | undefined)?.code === "ETIMEDOUT";
  return {
    status: res.error ? null : res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    timedOut,
  };
};

/** PATH lookup without spawning `which`. */
export function findOnPath(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":");
  const exts = platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of dirs) {
    if (!dir) {
      continue;
    }
    for (const ext of exts) {
      const candidate = path.join(dir, binary + ext);
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // keep looking
      }
    }
  }
  return null;
}
