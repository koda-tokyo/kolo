import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fileUri, LspClient } from "./client.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/lsp/fake-lsp-server.mjs",
);

describe("LspClient against the fake server", () => {
  let root: string;
  let client: LspClient | null = null;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-lsp-"));
  });

  afterEach(async () => {
    await client?.stop();
    client = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("initialize, diagnostics, definition, references, hover, shutdown", async () => {
    client = new LspClient({
      command: process.execPath,
      args: [FIXTURE],
      rootDir: root,
      requestTimeoutMs: 5000,
    });
    await client.start();
    expect(client.alive).toBe(true);

    const file = path.join(root, "a.fake");
    const uri = fileUri(file);
    const waiter = client.waitForDiagnostics(uri, 3000);
    client.syncDocument(file, "ok\nERR here\n", "fake");
    const diagnostics = await waiter;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.range.start.line).toBe(1);
    expect(client.currentDiagnostics(uri)).toHaveLength(1);

    const second = client.waitForDiagnostics(uri, 3000);
    client.syncDocument(file, "clean\n", "fake");
    expect(await second).toEqual([]);

    const defs = await client.definition(file, { line: 0, character: 0 });
    expect(defs).toHaveLength(1);
    expect(defs[0]?.uri).toBe(uri);
    const refs = await client.references(file, { line: 0, character: 0 });
    expect(refs).toHaveLength(2);
    const hover = await client.hover(file, { line: 0, character: 0 });
    expect(hover?.contents).toEqual({ kind: "markdown", value: "fake hover" });

    await client.stop();
    expect(client.alive).toBe(false);
  });

  test("requests time out and unknown methods reject", async () => {
    client = new LspClient({
      command: process.execPath,
      args: [FIXTURE],
      rootDir: root,
      requestTimeoutMs: 5000,
    });
    await client.start();
    await expect(client.request("no/such", {})).rejects.toThrow(/unknown method/);
    await expect(client.waitForDiagnostics("file:///nowhere", 50)).rejects.toThrow(/timed out/);
  });
});
