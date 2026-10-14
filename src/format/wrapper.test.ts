import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import type { FormatRunResult } from "./runner.js";
import { formatRunLine, wrapToolWithFormatter } from "./wrapper.js";

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((c) => c.text ?? "").join("\n");

function fakeTool(name = "write"): AnyAgentTool {
  return {
    name,
    label: name,
    description: "",
    parameters: {} as never,
    execute: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "wrote" }] }),
  } as unknown as AnyAgentTool;
}

const ok = (over: Partial<FormatRunResult> = {}): FormatRunResult => ({
  ok: true,
  language: "python",
  command: "ruff",
  durationMs: 12,
  timedOut: false,
  changed: true,
  output: "",
  exitCode: 0,
  ...over,
});

describe("wrapToolWithFormatter", () => {
  test("appends one line per formatted file after the edit result", async () => {
    const runner = vi.fn().mockResolvedValue(ok());
    const tool = wrapToolWithFormatter(fakeTool(), {
      workspaceDir: "/w",
      runner,
      detect: (cmd) => (cmd === "ruff" ? "/bin/ruff" : undefined),
    });
    const result = await tool.execute!(
      "1",
      { path: "src/a.py", content: "x" },
      undefined,
      undefined,
    );
    expect(textOf(result)).toBe(`wrote\nformatted (ruff): ${path.resolve("/w/src/a.py")}`);
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({ argv: ["ruff", "format", path.resolve("/w/src/a.py")] }),
      path.resolve("/w/src/a.py"),
      { timeoutMs: 10_000, maxOutputChars: 2000 },
    );
  });

  test("leaves the result alone when no formatter is on PATH, for other tools, or when disabled", async () => {
    const runner = vi.fn();
    const none = () => undefined;
    const absent = wrapToolWithFormatter(fakeTool(), { workspaceDir: "/w", runner, detect: none });
    expect(textOf(await absent.execute!("1", { path: "a.py" }, undefined, undefined))).toBe(
      "wrote",
    );
    const read = fakeTool("read");
    expect(wrapToolWithFormatter(read, { runner })).toBe(read);
    const off = fakeTool();
    expect(
      wrapToolWithFormatter(off, { config: { format: { enabled: false } } as KoLoConfig, runner }),
    ).toBe(off);
    expect(runner).not.toHaveBeenCalled();
  });

  test("uses config timeouts and reports failures and timeouts without hiding the edit", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce(ok({ ok: false, exitCode: 2, output: "bad syntax\nmore" }))
      .mockResolvedValueOnce(ok({ ok: false, timedOut: true, durationMs: 300 }));
    const config = { format: { timeoutMs: 300, maxOutputChars: 500 } } as KoLoConfig;
    const original = fakeTool("apply_patch");
    (original.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: [{ type: "text", text: "patched" }],
      details: { summary: { added: ["a.py"], modified: ["b.py"], deleted: ["c.py"] } },
    });
    const wrapped = wrapToolWithFormatter(original, {
      config,
      workspaceDir: "/w",
      runner,
      detect: () => "/bin/ruff",
    });
    const result = await wrapped.execute!("1", { input: "patch" }, undefined, undefined);
    expect(textOf(result)).toBe(
      `patched\nformatter failed (ruff exit 2): ${path.resolve("/w/a.py")}\nbad syntax\nformatter timed out (ruff) after 300 ms: ${path.resolve("/w/b.py")}`,
    );
    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner.mock.calls[0][2]).toEqual({ timeoutMs: 300, maxOutputChars: 500 });
  });

  test("formatRunLine covers the quiet cases", () => {
    expect(formatRunLine(ok({ changed: false }), "/w/a.py")).toBe(
      "already formatted (ruff): /w/a.py",
    );
    expect(formatRunLine(ok({ ok: false, exitCode: null, output: "" }), "/w/a.py")).toBe(
      "formatter failed (ruff): /w/a.py",
    );
  });
});
