import { execFile } from "node:child_process";

export type ExecResult = { code: number; stdout: string; stderr: string };
/** Run a binary with an argv array. Never a shell string, so it behaves the same on Windows. */
export type ServiceExec = (
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<ExecResult>;

const MAX_BUFFER = 4 * 1024 * 1024;

export const execService: ServiceExec = (cmd, args, opts) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        encoding: "utf8",
        timeout: opts?.timeoutMs ?? 30_000,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const e = err as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
        const code =
          typeof e.code === "number" ? e.code : e.code === "ENOENT" ? 127 : e.killed ? 124 : 1;
        resolve({ code, stdout: stdout ?? "", stderr: stderr || String(err.message) });
      },
    );
  });

/** Keep the last `maxBytes` of a string (UTF-8 aware enough for logs: cut on a line start). */
export function tailBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) {
    return text;
  }
  const cut = buf.subarray(buf.length - maxBytes).toString("utf8");
  const nl = cut.indexOf("\n");
  return nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
}
