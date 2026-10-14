import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { KoLoConfig } from "../config/config.js";
import { wrapToolWithLspDiagnostics } from "./diagnostics-wrapper.js";
import { LspManager } from "./manager.js";
import { createLspTools, hoverText } from "./tools.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/lsp/fake-lsp-server.mjs",
);

const fakeConfig = (): KoLoConfig => ({
  lsp: {
    servers: {
      fake: { command: process.execPath, args: [FIXTURE], extensions: ["fake"] },
    },
    maxDiagnosticsChars: 500,
    diagnosticsTimeoutMs: 3000,
  },
});

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");

describe("lsp tools", () => {
  let root: string;
  let manager: LspManager | null = null;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-lsp-tools-"));
  });

  afterEach(async () => {
    await manager?.stopAll();
    manager = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("exposes the four tools", () => {
    const names = createLspTools({ config: fakeConfig(), workspaceDir: root }).map((t) => t.name);
    expect(names).toEqual(["lsp_diagnostics", "lsp_definition", "lsp_references", "lsp_hover"]);
  });

  test("answer with one line when disabled, unmatched or not installed", async () => {
    const disabled = createLspTools({
      config: { lsp: { enabled: false } },
      workspaceDir: root,
      manager: new LspManager({ config: { lsp: { enabled: false } } }),
    });
    const res = await disabled[0].execute("c1", { path: "a.ts" }, undefined, () => {});
    expect(textOf(res)).toBe("language server integration is disabled (lsp.enabled is false).");

    manager = new LspManager({ config: fakeConfig() });
    const tools = createLspTools({ config: fakeConfig(), workspaceDir: root, manager });
    const none = await tools[0].execute("c2", { path: "a.unknown" }, undefined, () => {});
    expect(textOf(none)).toMatch(/no language server is configured/);

    const absentManager = new LspManager({
      config: { lsp: { servers: { fake: { command: "kolo-no-such-ls", extensions: ["fake"] } } } },
    });
    const absent = createLspTools({ workspaceDir: root, manager: absentManager });
    const miss = await absent[0].execute("c3", { path: "a.fake" }, undefined, () => {});
    expect(textOf(miss)).toMatch(/kolo-no-such-ls is not installed/);
  });

  test("diagnostics, definition, references and hover through the fake server", async () => {
    manager = new LspManager({ config: fakeConfig() });
    const tools = createLspTools({ config: fakeConfig(), workspaceDir: root, manager });
    const [diagnostics, definition, references, hover] = tools;
    fs.writeFileSync(path.join(root, "a.fake"), "x\nERR y\n");

    const d = await diagnostics.execute("d", { path: "a.fake" }, undefined, () => {});
    expect(textOf(d)).toBe(`${path.join(root, "a.fake")}:2:1 error fake error at line 2`);

    const def = await definition.execute(
      "e",
      { path: "a.fake", line: 1, character: 1 },
      undefined,
      () => {},
    );
    expect((def.details as { locations: unknown[] }).locations).toEqual([
      { path: path.join(root, "a.fake"), line: 1, character: 1 },
    ]);

    const refs = await references.execute(
      "r",
      { path: "a.fake", line: 1, character: 1 },
      undefined,
      () => {},
    );
    expect((refs.details as { locations: unknown[] }).locations).toHaveLength(2);

    const h = await hover.execute(
      "h",
      { path: "a.fake", line: 1, character: 1 },
      undefined,
      () => {},
    );
    expect(textOf(h)).toBe("fake hover");
  });

  test("hoverText flattens the LSP content shapes", () => {
    expect(hoverText("plain")).toBe("plain");
    expect(hoverText({ kind: "markdown", value: " v " })).toBe("v");
    expect(hoverText([{ language: "ts", value: "a" }, "b"])).toBe("a\nb");
    expect(hoverText(null)).toBe("");
  });

  test("wrapToolWithLspDiagnostics appends diagnostics after an edit and stays quiet otherwise", async () => {
    manager = new LspManager({ config: fakeConfig() });
    const file = path.join(root, "w.fake");
    const fakeWrite = {
      name: "write",
      label: "write",
      description: "",
      parameters: {},
      execute: async (_id: string, params: Record<string, unknown>) => {
        fs.writeFileSync(path.resolve(root, String(params.path)), String(params.content));
        return { content: [{ type: "text" as const, text: "written" }], details: {} };
      },
    };
    const wrapped = wrapToolWithLspDiagnostics(fakeWrite, {
      config: fakeConfig(),
      workspaceDir: root,
      manager,
    });
    const withError = await wrapped.execute(
      "w1",
      { path: "w.fake", content: "ok\nERR\n" },
      undefined,
      () => {},
    );
    expect(withError.content).toHaveLength(2);
    expect(textOf(withError)).toBe(
      `written\ndiagnostics (fake):\n${file}:2:1 error fake error at line 2`,
    );

    const clean = await wrapped.execute(
      "w2",
      { path: "w.fake", content: "fine\n" },
      undefined,
      () => {},
    );
    expect(clean.content).toHaveLength(1);

    const other = await wrapped.execute(
      "w3",
      { path: "w.other", content: "ERR\n" },
      undefined,
      () => {},
    );
    expect(other.content).toHaveLength(1);

    const untouched = wrapToolWithLspDiagnostics(
      { ...fakeWrite, name: "read" },
      { config: fakeConfig(), workspaceDir: root, manager },
    );
    expect(untouched).toBe(untouched);
    expect(wrapToolWithLspDiagnostics(fakeWrite, { config: { lsp: { enabled: false } } })).toBe(
      fakeWrite,
    );
  });

  test("apply_patch results use the summary file list", async () => {
    manager = new LspManager({ config: fakeConfig() });
    const fakePatch = {
      name: "apply_patch",
      label: "apply_patch",
      description: "",
      parameters: {},
      execute: async () => {
        fs.writeFileSync(path.join(root, "p.fake"), "ERR\n");
        return {
          content: [{ type: "text" as const, text: "patched" }],
          details: { summary: { added: ["p.fake"], modified: [], deleted: [] } },
        };
      },
    };
    const wrapped = wrapToolWithLspDiagnostics(fakePatch, {
      config: fakeConfig(),
      workspaceDir: root,
      manager,
    });
    const res = await wrapped.execute("p1", { input: "" }, undefined, () => {});
    expect(textOf(res)).toContain("diagnostics (fake):");
  });
});
