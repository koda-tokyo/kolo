import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FormatterSelection } from "./defaults.js";

export type FormatRunResult = {
  ok: boolean;
  language: string;
  command: string;
  durationMs: number;
  timedOut: boolean;
  /** True when the file's bytes differ after the run. */
  changed: boolean;
  /** Bounded stdout+stderr, trimmed; empty on a quiet success. */
  output: string;
  exitCode: number | null;
};

async function digest(filePath: string): Promise<string | null> {
  try {
    const data = await fs.readFile(filePath);
    return createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

/** Run one formatter on one file with a hard time limit; never throws. */
export async function runFormatter(
  selection: FormatterSelection,
  filePath: string,
  options: { timeoutMs: number; maxOutputChars: number; env?: NodeJS.ProcessEnv },
): Promise<FormatRunResult> {
  const startedAt = Date.now();
  const before = await digest(filePath);
  const [command, ...args] = selection.argv;
  const base = {
    language: selection.language,
    command: path.basename(command),
  };
  const outcome = await new Promise<{
    code: number | null;
    timedOut: boolean;
    output: string;
    error?: string;
  }>((resolve) => {
    let output = "";
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(selection.commandPath, args, {
        cwd: path.dirname(filePath),
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ code: null, timedOut: false, output: "", error: String(err) });
      return;
    }
    const collect = (chunk: Buffer) => {
      if (output.length < options.maxOutputChars * 2) {
        output += chunk.toString("utf8");
      }
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut, output, error: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output });
    });
  });
  const after = await digest(filePath);
  const text = (outcome.error ? `${outcome.output}\n${outcome.error}` : outcome.output)
    .trim()
    .slice(0, options.maxOutputChars);
  return {
    ...base,
    ok: !outcome.timedOut && outcome.code === 0 && !outcome.error,
    durationMs: Date.now() - startedAt,
    timedOut: outcome.timedOut,
    changed: before !== after,
    output: text,
    exitCode: outcome.code,
  };
}
