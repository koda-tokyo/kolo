import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandFileMentions, parseFileMentions } from "./file-mentions.js";

describe("parseFileMentions", () => {
  it("finds bare and quoted references once each, trimming punctuation", () => {
    expect(parseFileMentions('look at @src/a.ts, @"my file.md" and @src/a.ts.')).toEqual([
      { token: "@src/a.ts", path: "src/a.ts" },
      { token: '@"my file.md"', path: "my file.md" },
    ]);
    expect(parseFileMentions("mail me at alice@example.com")).toEqual([]);
    expect(parseFileMentions("(@README)")).toEqual([{ token: "@README", path: "README" }]);
  });
});

describe("expandFileMentions", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-mentions-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(path.join(dir, "notes.md"), "# notes\n```\nfenced\n```\n");
    fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0, 1, 2, 3]));
    fs.writeFileSync(path.join(dir, "big.txt"), "x".repeat(100));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("appends readable files as fenced blocks and leaves the typed line first", async () => {
    const result = await expandFileMentions("explain @src/a.ts and @notes.md please", { cwd: dir });
    expect(result.attached).toEqual([
      { path: path.join("src", "a.ts"), bytes: 20 },
      { path: "notes.md", bytes: 23 },
    ]);
    expect(result.message.startsWith("explain @src/a.ts and @notes.md please\n\nFile: ")).toBe(
      true,
    );
    expect(result.message).toContain("```\nexport const a = 1;\n```");
    expect(result.message).toContain("````\n# notes"); // nested fence gets a longer fence
    expect(result.skipped).toEqual([]);
  });

  it("skips binary, large and over-budget files and ignores non-files", async () => {
    const result = await expandFileMentions("@bin.dat @big.txt @src @nothere @src/a.ts", {
      cwd: dir,
      maxFileBytes: 50,
      maxTotalBytes: 10,
    });
    expect(result.skipped).toEqual([
      { path: "bin.dat", reason: "binary" },
      { path: "big.txt", reason: "too-large" },
      { path: "src/a.ts", reason: "budget" },
    ]);
    expect(result.attached).toEqual([]);
    expect(result.message).toBe("@bin.dat @big.txt @src @nothere @src/a.ts");
    const capped = await expandFileMentions("@src/a.ts @notes.md", { cwd: dir, maxFiles: 1 });
    expect(capped.attached).toHaveLength(1);
    expect(capped.skipped).toEqual([{ path: "notes.md", reason: "budget" }]);
  });
});
