// Minimal, dependency-free glob expansion for `integrity.paths` (KoLo 2.0, M2b).
//
// Supported: `*`, `?`, `**` (any depth), `[abc]`, `{a,b}` brace alternatives, `~/` prefix,
// a leading `!` to exclude. Relative patterns resolve against KOLO_HOME. A literal directory
// registers every file below it. Symlinked directories are not followed; the walk is bounded.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_FILES = 20_000;
const MAX_DEPTH = 16;

export type ExpandOptions = {
  /** Base for relative patterns (KOLO_HOME). */
  baseDir: string;
  homedir?: () => string;
};

export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) {
    return [pattern];
  }
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const inner = pattern.slice(open + 1, i);
        const parts: string[] = [];
        let d = 0;
        let start = 0;
        for (let j = 0; j < inner.length; j++) {
          if (inner[j] === "{") {
            d++;
          } else if (inner[j] === "}") {
            d--;
          } else if (inner[j] === "," && d === 0) {
            parts.push(inner.slice(start, j));
            start = j + 1;
          }
        }
        parts.push(inner.slice(start));
        const head = pattern.slice(0, open);
        const tail = pattern.slice(i + 1);
        return parts.flatMap((p) => expandBraces(`${head}${p}${tail}`));
      }
    }
  }
  return [pattern]; // unbalanced: treat literally
}

const hasMagic = (segment: string) => /[*?[]/.test(segment);

function segmentToRegex(segment: string): string {
  let out = "";
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "[") {
      const close = segment.indexOf("]", i + 1);
      if (close < 0) {
        out += "\\[";
      } else {
        let cls = segment.slice(i + 1, close).replace(/\\/g, "\\\\");
        if (cls.startsWith("!")) {
          cls = `^${cls.slice(1)}`;
        }
        out += `[${cls}]`;
        i = close;
      }
    } else {
      out += ch.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  return out;
}

/** Regex for a `/`-separated relative glob (no braces). */
export function globToRegExp(relGlob: string): RegExp {
  const segments = relGlob.split("/").filter((s) => s.length > 0);
  let re = "";
  segments.forEach((seg, idx) => {
    const last = idx === segments.length - 1;
    if (seg === "**") {
      re += last ? ".*" : "(?:[^/]*/)*";
    } else {
      re += segmentToRegex(seg) + (last ? "" : "/");
    }
  });
  return new RegExp(`^${re}$`);
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function resolvePatternPath(pattern: string, opts: ExpandOptions): string {
  const homedir = opts.homedir ?? os.homedir;
  const trimmed = pattern.trim();
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(homedir(), trimmed.slice(1));
  }
  return path.isAbsolute(trimmed) ? trimmed : path.join(opts.baseDir, trimmed);
}

function walkFiles(root: string, onFile: (abs: string) => boolean): void {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth < MAX_DEPTH) {
          stack.push({ dir: abs, depth: depth + 1 });
        }
      } else if (ent.isFile() || ent.isSymbolicLink()) {
        if (ent.isSymbolicLink()) {
          try {
            if (!fs.statSync(abs).isFile()) {
              continue;
            }
          } catch {
            continue;
          }
        }
        if (!onFile(abs)) {
          return;
        }
      }
    }
  }
}

function expandOne(absPattern: string, out: Set<string>): void {
  const posix = toPosix(absPattern);
  const segments = posix.split("/");
  const firstMagic = segments.findIndex(hasMagic);
  if (firstMagic < 0) {
    let st: fs.Stats;
    try {
      st = fs.statSync(absPattern);
    } catch {
      return;
    }
    if (st.isFile()) {
      out.add(path.resolve(absPattern));
    } else if (st.isDirectory()) {
      walkFiles(absPattern, (f) => {
        out.add(path.resolve(f));
        return out.size < MAX_FILES;
      });
    }
    return;
  }
  const base = segments.slice(0, firstMagic).join("/") || "/";
  const rest = segments.slice(firstMagic).join("/");
  const re = globToRegExp(rest);
  const baseNative = path.resolve(base);
  walkFiles(baseNative, (f) => {
    const rel = toPosix(path.relative(baseNative, f));
    if (re.test(rel)) {
      out.add(path.resolve(f));
    }
    return out.size < MAX_FILES;
  });
}

/** Expand patterns to a sorted list of absolute file paths (excludes applied last). */
export function expandIntegrityPatterns(patterns: string[], opts: ExpandOptions): string[] {
  const include = new Set<string>();
  const excludes: RegExp[] = [];
  for (const raw of patterns) {
    const p = raw.trim();
    if (!p) {
      continue;
    }
    const negate = p.startsWith("!");
    const body = negate ? p.slice(1) : p;
    for (const alt of expandBraces(body)) {
      const abs = resolvePatternPath(alt, opts);
      if (negate) {
        excludes.push(globToRegExp(toPosix(path.resolve(abs)).replace(/^\//, "")));
      } else {
        expandOne(abs, include);
      }
    }
  }
  return [...include]
    .filter((f) => !excludes.some((re) => re.test(toPosix(f).replace(/^\//, ""))))
    .toSorted();
}
