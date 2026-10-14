import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runFormatter } from "./runner.js";

const FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/format/fake-formatter.mjs",
);

const selection = (extra: string[] = []) => ({
  language: "fake",
  argv: [process.execPath, FIXTURE, ...extra, "{file}"],
  commandPath: process.execPath,
});

describe("runFormatter", () => {
  let dir = "";
  let file = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-format-run-"));
    file = path.join(dir, "a.fake");
    fs.writeFileSync(file, "a   b\n\n c ");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const withFile = (extra: string[] = []) => {
    const base = selection(extra);
    return { ...base, argv: base.argv.map((a) => (a === "{file}" ? file : a)) };
  };

  test("reports a changed file on success and an unchanged one on a no-op", async () => {
    const run = await runFormatter(withFile(), file, { timeoutMs: 5000, maxOutputChars: 200 });
    expect(run.ok).toBe(true);
    expect(run.changed).toBe(true);
    expect(run.exitCode).toBe(0);
    expect(run.output).toBe("done");
    expect(fs.readFileSync(file, "utf8")).toBe("a b c\n");
    const again = await runFormatter(withFile(["--noop"]), file, {
      timeoutMs: 5000,
      maxOutputChars: 200,
    });
    expect(again.ok).toBe(true);
    expect(again.changed).toBe(false);
  });

  test("captures a failure with its output, bounded", async () => {
    const run = await runFormatter(withFile(["--fail"]), file, {
      timeoutMs: 5000,
      maxOutputChars: 20,
    });
    expect(run.ok).toBe(false);
    expect(run.exitCode).toBe(2);
    expect(run.output).toBe("fake-formatter: synt");
    expect(run.changed).toBe(false);
  });

  test("stops a formatter that exceeds the time limit", async () => {
    const run = await runFormatter(withFile(["--sleep", "5000"]), file, {
      timeoutMs: 200,
      maxOutputChars: 200,
    });
    expect(run.ok).toBe(false);
    expect(run.timedOut).toBe(true);
    expect(run.durationMs).toBeLessThan(4000);
  });

  test("a command that cannot start is a failure, not a throw", async () => {
    const run = await runFormatter(
      { language: "x", argv: ["/no/such/formatter", file], commandPath: "/no/such/formatter" },
      file,
      { timeoutMs: 1000, maxOutputChars: 200 },
    );
    expect(run.ok).toBe(false);
    expect(run.output).toContain("ENOENT");
  });
});
