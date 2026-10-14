/**
 * Minimal unified diff for the TUI (line based, O(n*m) LCS bounded by MAX_LINES).
 * Inputs beyond the bound are compared on their first MAX_LINES lines and marked truncated.
 */
export const DIFF_MAX_LINES = 2000;
export const DIFF_CONTEXT = 3;

export type DiffStats = { added: number; removed: number; truncated: boolean };

export type UnifiedDiff = {
  path: string;
  lines: string[];
  stats: DiffStats;
};

type Op = { kind: " " | "+" | "-"; text: string; oldLine: number; newLine: number };

function splitLines(text: string): string[] {
  if (text === "") {
    return [];
  }
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // Trim common prefix/suffix first: edits are usually local and this keeps the table small.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) {
    start++;
  }
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const subA = a.slice(start, endA);
  const subB = b.slice(start, endB);
  const rows = subA.length;
  const cols = subB.length;
  const table = new Uint32Array((rows + 1) * (cols + 1));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i * (cols + 1) + j] =
        subA[i] === subB[j]
          ? table[(i + 1) * (cols + 1) + j + 1] + 1
          : Math.max(table[(i + 1) * (cols + 1) + j], table[i * (cols + 1) + j + 1]);
    }
  }
  const ops: Op[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let k = 0; k < start; k++) {
    ops.push({ kind: " ", text: a[k], oldLine: oldLine++, newLine: newLine++ });
  }
  let i = 0;
  let j = 0;
  while (i < rows || j < cols) {
    if (i < rows && j < cols && subA[i] === subB[j]) {
      ops.push({ kind: " ", text: subA[i], oldLine: oldLine++, newLine: newLine++ });
      i++;
      j++;
    } else if (
      j < cols &&
      (i >= rows || table[(i + 1) * (cols + 1) + j] <= table[i * (cols + 1) + j + 1])
    ) {
      ops.push({ kind: "+", text: subB[j], oldLine, newLine: newLine++ });
      j++;
    } else {
      ops.push({ kind: "-", text: subA[i], oldLine: oldLine++, newLine });
      i++;
    }
  }
  for (let k = endA; k < n; k++) {
    ops.push({ kind: " ", text: a[k], oldLine: oldLine++, newLine: newLine++ });
  }
  return ops;
}

/** Build a unified diff between two texts. Lines carry no colour; the view applies it. */
export function buildUnifiedDiff(before: string, after: string, path: string): UnifiedDiff {
  let a = splitLines(before);
  let b = splitLines(after);
  const truncated = a.length > DIFF_MAX_LINES || b.length > DIFF_MAX_LINES;
  if (truncated) {
    a = a.slice(0, DIFF_MAX_LINES);
    b = b.slice(0, DIFF_MAX_LINES);
  }
  const ops = lcsOps(a, b);
  const stats: DiffStats = { added: 0, removed: 0, truncated };
  for (const op of ops) {
    if (op.kind === "+") {
      stats.added++;
    } else if (op.kind === "-") {
      stats.removed++;
    }
  }
  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  if (stats.added === 0 && stats.removed === 0) {
    if (truncated) {
      lines.push(`… input truncated to the first ${DIFF_MAX_LINES} lines`);
    }
    return { path, lines, stats };
  }
  // Group changes into hunks with DIFF_CONTEXT lines of context.
  const changeIdx = ops.map((op, idx) => (op.kind === " " ? -1 : idx)).filter((v) => v >= 0);
  let hunkStart = Math.max(0, changeIdx[0] - DIFF_CONTEXT);
  let hunkEnd = Math.min(ops.length, changeIdx[0] + DIFF_CONTEXT + 1);
  const hunks: Array<[number, number]> = [];
  for (const idx of changeIdx.slice(1)) {
    if (idx - DIFF_CONTEXT <= hunkEnd) {
      hunkEnd = Math.min(ops.length, idx + DIFF_CONTEXT + 1);
    } else {
      hunks.push([hunkStart, hunkEnd]);
      hunkStart = Math.max(0, idx - DIFF_CONTEXT);
      hunkEnd = Math.min(ops.length, idx + DIFF_CONTEXT + 1);
    }
  }
  hunks.push([hunkStart, hunkEnd]);
  for (const [from, to] of hunks) {
    const slice = ops.slice(from, to);
    const oldCount = slice.filter((op) => op.kind !== "+").length;
    const newCount = slice.filter((op) => op.kind !== "-").length;
    const oldStart = slice.find((op) => op.kind !== "+")?.oldLine ?? slice[0].oldLine;
    const newStart = slice.find((op) => op.kind !== "-")?.newLine ?? slice[0].newLine;
    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      lines.push(`${op.kind}${op.text}`);
    }
  }
  if (truncated) {
    lines.push(`… input truncated to the first ${DIFF_MAX_LINES} lines`);
  }
  return { path, lines, stats };
}

export function diffStatsFromLines(lines: string[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      added++;
    } else if (line.startsWith("-")) {
      removed++;
    }
  }
  return { added, removed, truncated: false };
}

/**
 * Derive a diff from a file-edit tool call. Returns null for tools that do not edit files or
 * when the arguments carry nothing to show.
 */
export function diffFromToolCall(toolName: string, args: unknown): UnifiedDiff | null {
  const name = toolName.trim().toLowerCase();
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const key of keys) {
      const value = a[key];
      if (typeof value === "string") {
        return value;
      }
    }
    return undefined;
  };
  const path = str("path", "file_path", "filePath", "file") ?? "";
  if (name === "edit" || name === "str_replace_based_edit_tool") {
    const oldText = str("oldText", "old_string", "old_str");
    const newText = str("newText", "new_string", "new_str");
    if (oldText === undefined && newText === undefined) {
      return null;
    }
    return buildUnifiedDiff(oldText ?? "", newText ?? "", path || "(file)");
  }
  if (name === "write") {
    const content = str("content", "text", "file_text");
    if (content === undefined) {
      return null;
    }
    return buildUnifiedDiff("", content, path || "(file)");
  }
  if (name === "apply_patch") {
    const input = str("input", "patch");
    if (!input) {
      return null;
    }
    const lines = input.split("\n");
    const target = lines.find((l) => /^\*\*\* (Add|Update|Delete) File: /.test(l));
    const patchPath = target ? target.replace(/^\*\*\* \w+ File: /, "") : "(patch)";
    return { path: patchPath, lines, stats: diffStatsFromLines(lines) };
  }
  return null;
}

export function isFileEditTool(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  return (
    name === "edit" ||
    name === "write" ||
    name === "apply_patch" ||
    name === "str_replace_based_edit_tool"
  );
}
