import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { KoLoConfig } from "../config/config.js";
import { findProjectRoot, formatDiagnostics, LspManager } from "./manager.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/lsp/fake-lsp-server.mjs",
);

const fakeConfig = (extra: Record<string, unknown> = {}): Pick<KoLoConfig, "lsp"> => ({
  lsp: {
    servers: {
      fake: {
        command: process.execPath,
        args: [FIXTURE],
        extensions: ["fake"],
        rootMarkers: ["fake.root"],
      },
    },
    ...extra,
  },
});

describe("LspManager", () => {
  let root: string;
  let manager: LspManager | null = null;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-lsp-mgr-"));
  });

  afterEach(async () => {
    await manager?.stopAll();
    manager = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("availability is synchronous and explains why a file is not served", () => {
    manager = new LspManager({ config: fakeConfig() });
    expect(manager.availability(path.join(root, "x.unknown"))).toEqual({
      ok: false,
      reason: "no-server",
    });
    const absent = new LspManager({
      config: { lsp: { servers: { fake: { command: "kolo-no-such-ls", extensions: ["fake"] } } } },
    });
    expect(absent.availability(path.join(root, "x.fake"))).toMatchObject({
      ok: false,
      reason: "not-installed",
    });
    const disabled = new LspManager({ config: { lsp: { enabled: false } } });
    expect(disabled.availability(path.join(root, "x.ts"))).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  test("diagnosticsFor waits for the next publish and reuses one server", async () => {
    manager = new LspManager({ config: fakeConfig() });
    fs.writeFileSync(path.join(root, "fake.root"), "");
    const file = path.join(root, "src", "a.fake");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "ERR one\nfine\nERR two\n");
    const avail = manager.availability(file);
    expect(avail.ok && avail.rootDir).toBe(root);

    const first = await manager.diagnosticsFor(file, { timeoutMs: 3000 });
    expect(first.map((d) => d.range.start.line)).toEqual([0, 2]);

    fs.writeFileSync(file, "all good\n");
    const second = await manager.diagnosticsFor(file, { timeoutMs: 3000 });
    expect(second).toEqual([]);

    const defs = await manager.definition(file, { line: 0, character: 0 });
    expect(defs).toHaveLength(1);
    const hover = await manager.hover(file, { line: 0, character: 0 });
    expect(hover).not.toBeNull();
  });

  test("diagnosticsFor is bounded when the server never publishes", async () => {
    manager = new LspManager({
      config: fakeConfig(),
      env: { ...process.env, FAKE_LSP_SILENT: "1" },
    });
    const file = path.join(root, "b.fake");
    fs.writeFileSync(file, "ERR\n");
    const started = Date.now();
    const result = await manager.diagnosticsFor(file, { timeoutMs: 200 });
    expect(result).toEqual([]);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("formatDiagnostics is sorted, bounded and counts the rest", () => {
    const diags = Array.from({ length: 50 }, (_, i) => ({
      range: { start: { line: i, character: 2 }, end: { line: i, character: 3 } },
      severity: i % 2 === 0 ? 2 : 1,
      message: `problem   number ${i}`,
    }));
    const text = formatDiagnostics(diags, { filePath: "/w/a.ts", maxChars: 200 });
    expect(text.length).toBeLessThanOrEqual(220);
    const lines = text.split("\n");
    expect(lines[0]).toBe("/w/a.ts:2:3 error problem number 1");
    expect(lines.at(-1)).toMatch(/^… \d+ more$/);
  });

  test("findProjectRoot walks up to a marker", () => {
    fs.mkdirSync(path.join(root, "pkg", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, "pkg", "go.mod"), "");
    const file = path.join(root, "pkg", "deep", "x.go");
    expect(findProjectRoot(file, ["go.mod"])).toBe(path.join(root, "pkg"));
    expect(findProjectRoot(file, ["nope.marker"])).toBe(path.join(root, "pkg", "deep"));
  });
});
