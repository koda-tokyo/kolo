import { Container, Text } from "@mariozechner/pi-tui";
import { diffStatsFromLines, type UnifiedDiff } from "../diff.js";
import { theme } from "../theme/theme.js";

export const DIFF_VIEW_MAX_LINES = 200;

export function colourDiffLine(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return theme.bold(theme.dim(line));
  }
  if (line.startsWith("@@") || line.startsWith("*** ")) {
    return theme.diffHunk(line);
  }
  if (line.startsWith("+")) {
    return theme.diffAdded(line);
  }
  if (line.startsWith("-")) {
    return theme.diffRemoved(line);
  }
  return theme.diffContext(line);
}

export function formatDiffSummary(diff: UnifiedDiff): string {
  const stats = diff.stats ?? diffStatsFromLines(diff.lines);
  const suffix = stats.truncated ? " (truncated)" : "";
  return `+${stats.added} -${stats.removed} in ${diff.path}${suffix}`;
}

/** Render diff lines with a hard cap; the view never grows past DIFF_VIEW_MAX_LINES. */
export function renderDiffLines(diff: UnifiedDiff, maxLines = DIFF_VIEW_MAX_LINES): string[] {
  const out = diff.lines.slice(0, maxLines).map(colourDiffLine);
  const more = diff.lines.length - maxLines;
  if (more > 0) {
    out.push(theme.dim(`… ${more} more lines`));
  }
  return out;
}

/**
 * Collapsible unified diff. Collapsed: one summary line (`+N -M in path`). Expanded: the
 * header, hunks and coloured lines, capped at DIFF_VIEW_MAX_LINES.
 */
export class DiffViewComponent extends Container {
  private summary: Text;
  private body: Text;
  private diff: UnifiedDiff;
  private expanded = false;

  constructor(diff: UnifiedDiff) {
    super();
    this.diff = diff;
    this.summary = new Text("", 0, 0);
    this.body = new Text("", 0, 0);
    this.addChild(this.summary);
    this.addChild(this.body);
    this.refresh();
  }

  setDiff(diff: UnifiedDiff) {
    this.diff = diff;
    this.refresh();
  }

  setExpanded(expanded: boolean) {
    if (this.expanded === expanded) {
      return;
    }
    this.expanded = expanded;
    this.refresh();
  }

  isExpanded() {
    return this.expanded;
  }

  private refresh() {
    const marker = this.expanded ? "-" : "+";
    this.summary.setText(
      theme.dim(`[${marker}] diff `) + theme.accentSoft(formatDiffSummary(this.diff)),
    );
    this.body.setText(this.expanded ? renderDiffLines(this.diff).join("\n") : "");
  }
}
