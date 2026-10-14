import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editInExternalEditor, resolveEditorCommand } from "./external-editor.js";

describe("resolveEditorCommand", () => {
  it("prefers VISUAL, then EDITOR, then notepad on Windows, else nothing", () => {
    expect(resolveEditorCommand({ VISUAL: "code --wait", EDITOR: "vi" }, "linux")).toEqual({
      command: "code --wait",
      source: "VISUAL",
    });
    expect(resolveEditorCommand({ EDITOR: "vi" }, "linux")).toEqual({
      command: "vi",
      source: "EDITOR",
    });
    expect(resolveEditorCommand({}, "win32")).toEqual({ command: "notepad", source: "platform" });
    expect(resolveEditorCommand({ VISUAL: "  " }, "linux")).toBeNull();
  });
});

function fakeSpawn(
  behaviour: (file: string) => { code: number | null; error?: string; write?: string },
) {
  const calls: string[] = [];
  const spawnCommand = vi.fn((command: string) => {
    calls.push(command);
    const child = new EventEmitter();
    const match = /'([^']+)'$/.exec(command);
    const file = match?.[1] ?? "";
    queueMicrotask(() => {
      const outcome = behaviour(file);
      if (outcome.write !== undefined) {
        fs.writeFileSync(file, outcome.write);
      }
      if (outcome.error) {
        child.emit("error", new Error(outcome.error));
      } else {
        child.emit("close", outcome.code);
      }
    });
    return child;
  });
  return { spawnCommand: spawnCommand as never, calls };
}

describe("editInExternalEditor", () => {
  let dir = "";
  const order: string[] = [];
  const withTerminalReleased = async <T>(fn: () => Promise<T>) => {
    order.push("release");
    try {
      return await fn();
    } finally {
      order.push("restore");
    }
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-editor-"));
    order.length = 0;
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes the prompt to a temp file, runs the editor with the terminal released, reads it back", async () => {
    const { spawnCommand, calls } = fakeSpawn((file) => {
      expect(fs.readFileSync(file, "utf8")).toBe("draft");
      return { code: 0, write: "edited\r\nline two\n" };
    });
    const result = await editInExternalEditor("draft", {
      withTerminalReleased,
      spawnCommand,
      env: { VISUAL: "myeditor --wait" },
      platform: "linux",
      tmpDir: dir,
      now: () => 42,
    });
    expect(result).toEqual({ ok: true, text: "edited\nline two", changed: true });
    expect(calls[0]).toMatch(/^myeditor --wait '.*prompt-42-\d+\.md'$/);
    expect(order).toEqual(["release", "restore"]);
    expect(fs.readdirSync(dir)).toEqual([]); // temp file removed
  });

  it("reports an unchanged prompt, a bad exit code, a missing editor and a spawn error", async () => {
    const same = await editInExternalEditor("x", {
      withTerminalReleased,
      spawnCommand: fakeSpawn(() => ({ code: 0 })).spawnCommand,
      env: { EDITOR: "ed" },
      platform: "linux",
      tmpDir: dir,
    });
    expect(same).toEqual({ ok: true, text: "x", changed: false });
    const failed = await editInExternalEditor("x", {
      withTerminalReleased,
      spawnCommand: fakeSpawn(() => ({ code: 3, write: "changed" })).spawnCommand,
      env: { EDITOR: "ed" },
      platform: "linux",
      tmpDir: dir,
    });
    expect(failed).toEqual({ ok: false, error: "editor exited with code 3; prompt unchanged" });
    const none = await editInExternalEditor("x", {
      withTerminalReleased,
      env: {},
      platform: "linux",
      tmpDir: dir,
    });
    expect(none.ok).toBe(false);
    expect(order).toEqual(["release", "restore", "release", "restore"]);
    const spawnError = await editInExternalEditor("x", {
      withTerminalReleased,
      spawnCommand: fakeSpawn(() => ({ code: null, error: "ENOENT" })).spawnCommand,
      env: { EDITOR: "ed" },
      platform: "linux",
      tmpDir: dir,
    });
    expect(spawnError).toEqual({ ok: false, error: "editor failed to start (Error: ENOENT)" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
