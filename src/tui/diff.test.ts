import { describe, expect, it } from "vitest";
import { buildUnifiedDiff, DIFF_MAX_LINES, diffFromToolCall, isFileEditTool } from "./diff.js";

describe("buildUnifiedDiff", () => {
  it("produces a header and one hunk for a local change", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const after = ["a", "b", "c", "D", "e", "f", "g", "h"].join("\n");
    const diff = buildUnifiedDiff(before, after, "x.txt");
    expect(diff.lines[0]).toBe("--- a/x.txt");
    expect(diff.lines[1]).toBe("+++ b/x.txt");
    expect(diff.lines[2]).toBe("@@ -1,7 +1,7 @@");
    expect(diff.lines).toContain("-d");
    expect(diff.lines).toContain("+D");
    expect(diff.stats).toEqual({ added: 1, removed: 1, truncated: false });
  });

  it("splits distant changes into separate hunks", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    const changed = [...lines];
    changed[2] = "changed 2";
    changed[30] = "changed 30";
    const diff = buildUnifiedDiff(lines.join("\n"), changed.join("\n"), "f");
    expect(diff.lines.filter((l) => l.startsWith("@@")).length).toBe(2);
    expect(diff.stats.added).toBe(2);
    expect(diff.stats.removed).toBe(2);
  });

  it("marks all lines added for a new file and reports no hunks when equal", () => {
    const added = buildUnifiedDiff("", "one\ntwo\n", "new.txt");
    expect(added.stats).toEqual({ added: 2, removed: 0, truncated: false });
    expect(added.lines).toContain("+one");
    const same = buildUnifiedDiff("x\n", "x\n", "same.txt");
    expect(same.lines).toHaveLength(2);
    expect(same.stats.added + same.stats.removed).toBe(0);
  });

  it("bounds the input", () => {
    const big = Array.from({ length: DIFF_MAX_LINES + 500 }, (_, i) => `l${i}`).join("\n");
    const diff = buildUnifiedDiff(big, `${big}\nextra`, "big");
    expect(diff.stats.truncated).toBe(true);
    expect(diff.lines.at(-1)).toContain("truncated");
  });
});

describe("diffFromToolCall", () => {
  it("handles edit with either argument naming", () => {
    const a = diffFromToolCall("edit", { path: "a.ts", oldText: "x", newText: "y" });
    const b = diffFromToolCall("edit", { file_path: "a.ts", old_string: "x", new_string: "y" });
    expect(a?.lines).toEqual(b?.lines);
    expect(a?.lines).toContain("-x");
    expect(a?.lines).toContain("+y");
  });

  it("shows write as an all-added file and apply_patch as the patch text", () => {
    const w = diffFromToolCall("write", { path: "w.md", content: "hello\n" });
    expect(w?.stats.added).toBe(1);
    const patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch";
    const p = diffFromToolCall("apply_patch", { input: patch });
    expect(p?.path).toBe("src/a.ts");
    expect(p?.stats).toEqual({ added: 1, removed: 1, truncated: false });
  });

  it("returns null for other tools or missing arguments", () => {
    expect(diffFromToolCall("read", { path: "a" })).toBeNull();
    expect(diffFromToolCall("edit", {})).toBeNull();
    expect(isFileEditTool("exec")).toBe(false);
    expect(isFileEditTool("apply_patch")).toBe(true);
  });
});
