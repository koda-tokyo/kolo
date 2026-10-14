import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { koloTmpDir } from "../config/kolo-home.js";

/**
 * `/editor` (KoLo 2.0, M10): open the current prompt in `$VISUAL` or `$EDITOR` through a temp
 * file, then put the edited text back into the prompt. The terminal UI is released while the
 * editor runs and restored afterwards. On Windows without either variable, `notepad` is used.
 */

export type EditorCommand = { command: string; source: "VISUAL" | "EDITOR" | "platform" };

export function resolveEditorCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): EditorCommand | null {
  const visual = env.VISUAL?.trim();
  if (visual) {
    return { command: visual, source: "VISUAL" };
  }
  const editor = env.EDITOR?.trim();
  if (editor) {
    return { command: editor, source: "EDITOR" };
  }
  if (platform === "win32") {
    return { command: "notepad", source: "platform" };
  }
  return null;
}

export type ExternalEditorDeps = {
  /** Release the terminal, run `fn`, restore the terminal. */
  withTerminalReleased: <T>(fn: () => Promise<T>) => Promise<T>;
  spawnCommand?: typeof spawn;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  tmpDir?: string;
  now?: () => number;
};

export type ExternalEditorResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; error: string };

function quote(filePath: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `"${filePath}"` : `'${filePath.replace(/'/g, `'\\''`)}'`;
}

export async function editInExternalEditor(
  initial: string,
  deps: ExternalEditorDeps,
): Promise<ExternalEditorResult> {
  const env = deps.env ?? process.env;
  const platform = deps.platform ?? process.platform;
  const resolved = resolveEditorCommand(env, platform);
  if (!resolved) {
    return { ok: false, error: "no editor configured. Set VISUAL or EDITOR and try again" };
  }
  const tmpDir = deps.tmpDir ?? koloTmpDir();
  await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 });
  const file = path.join(tmpDir, `prompt-${(deps.now ?? Date.now)()}-${process.pid}.md`);
  await fs.writeFile(file, initial, { encoding: "utf8", mode: 0o600 });
  const spawnCommand = deps.spawnCommand ?? spawn;
  try {
    const exit = await deps.withTerminalReleased(
      () =>
        new Promise<{ code: number | null; error?: string }>((resolve) => {
          const child = spawnCommand(`${resolved.command} ${quote(file, platform)}`, {
            shell: true,
            stdio: "inherit",
            env,
          });
          child.on("error", (err) => resolve({ code: null, error: String(err) }));
          child.on("close", (code) => resolve({ code }));
        }),
    );
    if (exit.error) {
      return { ok: false, error: `editor failed to start (${exit.error})` };
    }
    if (exit.code !== 0) {
      return { ok: false, error: `editor exited with code ${exit.code ?? "?"}; prompt unchanged` };
    }
    const text = (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n").replace(/\n$/, "");
    return { ok: true, text, changed: text !== initial };
  } finally {
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
}
