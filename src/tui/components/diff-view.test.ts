import { describe, expect, it } from "vitest";
import { stripAnsi } from "../../terminal/ansi.js";
import { buildUnifiedDiff } from "../diff.js";
import {
  DIFF_VIEW_MAX_LINES,
  DiffViewComponent,
  formatDiffSummary,
  renderDiffLines,
} from "./diff-view.js";
import { ToolExecutionComponent } from "./tool-execution.js";

const strip = (s: string) => stripAnsi(s);

describe("diff view", () => {
  it("collapses to a summary and expands to hunks", () => {
    const diff = buildUnifiedDiff("a\nb\n", "a\nc\n", "f.txt");
    expect(formatDiffSummary(diff)).toBe("+1 -1 in f.txt");
    const view = new DiffViewComponent(diff);
    const collapsed = view.render(80).map(strip).filter(Boolean);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toContain("[+] diff +1 -1 in f.txt");
    view.setExpanded(true);
    const expanded = view.render(80).map(strip);
    expect(expanded.some((l) => l.startsWith("-b"))).toBe(true);
    expect(expanded.some((l) => l.startsWith("+c"))).toBe(true);
    expect(expanded.some((l) => l.startsWith("@@"))).toBe(true);
  });

  it("caps the rendered lines", () => {
    const many = Array.from({ length: DIFF_VIEW_MAX_LINES + 50 }, (_, i) => `l${i}`).join("\n");
    const diff = buildUnifiedDiff("", many, "big");
    const lines = renderDiffLines(diff).map(strip);
    expect(lines).toHaveLength(DIFF_VIEW_MAX_LINES + 1);
    expect(lines.at(-1)).toContain("more lines");
  });

  it("is attached to file-edit tool cells and removed when disabled", () => {
    const tool = new ToolExecutionComponent("edit", { path: "x.ts", oldText: "1", newText: "2" });
    expect(tool.getDiff()?.stats.added).toBe(1);
    expect(tool.render(80).map(strip).join("\n")).toContain("+1 -1 in x.ts");
    tool.setDiffEnabled(false);
    expect(tool.getDiff()).toBeNull();
    expect(tool.render(80).map(strip).join("\n")).not.toContain("+1 -1 in x.ts");
    const other = new ToolExecutionComponent("read", { path: "x.ts" });
    expect(other.getDiff()).toBeNull();
    // Tool titles carry no emoji.
    expect(/\p{Extended_Pictographic}/u.test(strip(tool.render(80).join("\n")))).toBe(false);
  });
});
