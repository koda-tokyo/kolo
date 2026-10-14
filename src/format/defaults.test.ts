import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  FORMAT_DEFAULTS,
  formatterForFile,
  resolveFormatters,
  splitCommandLine,
} from "./defaults.js";

describe("format defaults", () => {
  test("ships candidates for the documented languages", () => {
    expect(Object.keys(FORMAT_DEFAULTS).toSorted()).toEqual([
      "css",
      "go",
      "html",
      "javascript",
      "json",
      "markdown",
      "python",
      "rust",
      "typescript",
      "yaml",
    ]);
    const python = resolveFormatters({}).find((f) => f.language === "python");
    expect(python?.candidates.map((c) => c.argv[0])).toEqual(["ruff", "black"]);
  });

  test("splitCommandLine honours quotes", () => {
    expect(splitCommandLine(`prettier --write "{file}"`)).toEqual([
      "prettier",
      "--write",
      "{file}",
    ]);
    expect(splitCommandLine(`'my fmt' -i {file}`)).toEqual(["my fmt", "-i", "{file}"]);
    expect(splitCommandLine("  a   b ")).toEqual(["a", "b"]);
  });

  test("config overrides, adds and disables languages; {file} is appended when absent", () => {
    const formatters = resolveFormatters({
      format: {
        onEdit: { python: "yapf -i", go: false, sql: `sqlfmt "{file}"` },
      },
    });
    const python = formatters.find((f) => f.language === "python");
    expect(python?.source).toBe("config");
    expect(python?.candidates).toEqual([{ argv: ["yapf", "-i", "{file}"] }]);
    expect(python?.extensions).toEqual(["py", "pyi"]);
    expect(formatters.find((f) => f.language === "go")).toBeUndefined();
    const sql = formatters.find((f) => f.language === "sql");
    expect(sql?.extensions).toEqual(["sql"]);
    expect(sql?.candidates).toEqual([{ argv: ["sqlfmt", "{file}"] }]);
    expect(resolveFormatters({ format: { enabled: false } })).toEqual([]);
  });
});

describe("formatterForFile", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-format-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("picks the first candidate on PATH, honouring root markers, and caches detection", () => {
    const formatters = resolveFormatters({});
    const calls: string[] = [];
    const detect = (command: string) => {
      calls.push(command);
      return command === "prettier" || command === "biome" ? `/bin/${command}` : undefined;
    };
    const cache = new Map<string, string | undefined>();
    const file = path.join(dir, "a.ts");
    // No biome.json above the file: biome is skipped without even being detected.
    const prettier = formatterForFile(formatters, file, { detect, cache });
    expect(prettier?.argv).toEqual(["prettier", "--write", file]);
    expect(prettier?.commandPath).toBe("/bin/prettier");
    expect(calls).toEqual(["prettier"]);
    fs.writeFileSync(path.join(dir, "biome.json"), "{}");
    const biome = formatterForFile(formatters, file, { detect, cache });
    expect(biome?.argv[0]).toBe("biome");
    expect(biome?.language).toBe("typescript");
    // Second lookup for prettier hits the cache.
    formatterForFile(formatters, path.join(dir, "b.md"), { detect, cache });
    expect(calls).toEqual(["prettier", "biome"]);
  });

  test("absent commands and unknown extensions yield nothing", () => {
    const formatters = resolveFormatters({});
    const none = () => undefined;
    expect(formatterForFile(formatters, path.join(dir, "a.py"), { detect: none })).toBeUndefined();
    expect(
      formatterForFile(formatters, path.join(dir, "README"), { detect: none }),
    ).toBeUndefined();
    expect(formatterForFile(formatters, path.join(dir, "x.unknownext"))).toBeUndefined();
  });
});
