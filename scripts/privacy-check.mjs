#!/usr/bin/env node
// Privacy check: fails when a tracked (or staged) file mentions a private name or path.
//
// The blocked words are stored as truncated SHA-256 digests so that this script does not
// itself publish the list it guards. Matching is per word (runs of [A-Za-z0-9_], which is
// the same boundary rule as a case-insensitive `\b...\b` regex) plus two-word compounds
// joined by "-" or "/" (for example a hyphenated product id or a mount path).
//
// Exceptions live in `.privacy-allow` at the repository root, one per line:
//   <path> | <substring the line must contain, or *> | <reason>
// Lines starting with "#" are comments. The allowlist file itself is not scanned.
//
// Usage:
//   node scripts/privacy-check.mjs                 scan every tracked file
//   node scripts/privacy-check.mjs --staged        scan staged content only (pre-commit)
//   node scripts/privacy-check.mjs --root <dir>    scan another repository (tests)
//   node scripts/privacy-check.mjs --no-warnings   hide the vocabulary warnings
//   PRIVACY_CHECK_EXTRA_WORDS=a,b                  add plain-text words (tests, local use)
//
// Exit codes: 0 clean, 1 findings, 2 usage or git error.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BLOCKED = new Set([
  "f15c16b99f82d820",
  "e2324f665ae42249",
  "ebf7aae0484b3532",
  "cfc6ead42d2ca7f8",
  "9a73c98c98d492f1",
  "7797a2701fdb8aaa",
  "97c19548c6cfc354",
  "20ab77669b7eb32b",
  "7b85175b455060e3",
  "853dbc39c711e073",
  "a7e61091fcaa078f",
  "1ac09148e8118d83",
  "23e7045ec8221051",
  "a2dafa85f4a32d4a",
  "43223923f34aba16",
  "c82b7cc7a4f046cd",
]);

// One blocked word is also the name of a product (the headless engine). It is blocked only
// when it is used as a name: the all-caps acronym and the product ids below are allowed.
const PRODUCT_WORD = "7797a2701fdb8aaa";
const PRODUCT_AFTER = /^(?:[-_ ]?engine\b|\/)/i;
const PRODUCT_BEFORE = /(?:kolo-|koda-tokyo\/)$/i;

// Internal vocabulary that should not appear in public prose. Reported, never fatal.
const WARN_WORDS = new Set(["consciousness", "covenant", "covenants", "nyx", "sentience"]);
const WARN_SCOPE = (file) =>
  file.startsWith("docs/") || ["README.md", "LICENSING.md", "CLA.md"].includes(file);

const ALLOW_FILE = ".privacy-allow";
const MAX_BYTES = 8 * 1024 * 1024;

function digest(word) {
  return createHash("sha256").update(word).digest("hex").slice(0, 16);
}

function parseArgs(argv) {
  const opts = { staged: false, root: null, warnings: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--staged") {
      opts.staged = true;
    } else if (a === "--no-warnings") {
      opts.warnings = false;
    } else if (a === "--root") {
      opts.root = argv[++i];
    } else {
      console.error(`privacy-check: unknown argument ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function git(root, args, input) {
  const res = spawnSync("git", args, {
    cwd: root,
    input,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(`privacy-check: git ${args.join(" ")} failed: ${String(res.stderr).trim()}`);
    process.exit(2);
  }
  return res.stdout;
}

function loadAllow(root) {
  const file = path.join(root, ALLOW_FILE);
  if (!fs.existsSync(file)) {
    return [];
  }
  const rules = [];
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const parts = line.split(" | ");
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts.slice(2).join(" | ").trim()) {
      console.error(`privacy-check: bad ${ALLOW_FILE} line (want "path | match | reason"): ${line}`);
      process.exit(2);
    }
    rules.push({ path: parts[0].trim(), match: parts[1].trim() });
  }
  return rules;
}

function isAllowed(rules, file, text) {
  return rules.some((r) => r.path === file && (r.match === "*" || text.includes(r.match)));
}

export function scanText(text, extraWords = new Set()) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const tokens = [...line.matchAll(/[A-Za-z0-9_]+/g)];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i][0];
      const start = tokens[i].index;
      const end = start + tok.length;
      const lower = tok.toLowerCase();
      const h = digest(lower);
      if (BLOCKED.has(h) || extraWords.has(lower)) {
        const product =
          h === PRODUCT_WORD &&
          (tok === tok.toUpperCase() ||
            PRODUCT_AFTER.test(line.slice(end)) ||
            PRODUCT_BEFORE.test(line.slice(0, start)));
        if (!product) {
          hits.push({ line: n + 1, word: tok, text: line, kind: "error" });
          continue;
        }
      }
      const next = tokens[i + 1];
      const sep = line[end];
      if (next && next.index === end + 1 && (sep === "-" || sep === "/")) {
        const pair = `${lower}${sep}${next[0].toLowerCase()}`;
        if (BLOCKED.has(digest(pair))) {
          hits.push({ line: n + 1, word: `${tok}${sep}${next[0]}`, text: line, kind: "error" });
        }
      }
      if (WARN_WORDS.has(lower)) {
        hits.push({ line: n + 1, word: tok, text: line, kind: "warning" });
      }
    }
  }
  return hits;
}

function readTracked(root) {
  const out = git(root, ["ls-files", "-z", "--cached"]);
  return String(out)
    .split("\0")
    .filter(Boolean)
    .map((file) => ({
      file,
      read: () => {
        const abs = path.join(root, file);
        let st;
        try {
          st = fs.lstatSync(abs);
        } catch {
          return null;
        }
        if (!st.isFile() || st.size > MAX_BYTES) {
          return null;
        }
        return fs.readFileSync(abs);
      },
    }));
}

function readStaged(root) {
  const out = git(root, ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]);
  return String(out)
    .split("\0")
    .filter(Boolean)
    .map((file) => ({
      file,
      read: () => {
        const mode = String(git(root, ["ls-files", "-s", "--", file])).split(" ")[0];
        if (mode !== "100644" && mode !== "100755") {
          return null;
        }
        const buf = git(root, ["show", `:${file}`]);
        return buf.length > MAX_BYTES ? null : buf;
      },
    }));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = path.resolve(
    opts.root ?? String(git(process.cwd(), ["rev-parse", "--show-toplevel"])).trim(),
  );
  const extra = new Set(
    (process.env.PRIVACY_CHECK_EXTRA_WORDS ?? "")
      .split(",")
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean),
  );
  const rules = loadAllow(root);
  const files = opts.staged ? readStaged(root) : readTracked(root);

  let errors = 0;
  let warnings = 0;
  let scanned = 0;
  for (const { file, read } of files) {
    if (file === ALLOW_FILE) {
      continue;
    }
    const buf = read();
    if (!buf || buf.subarray(0, 8000).includes(0)) {
      continue;
    }
    scanned++;
    for (const hit of scanText(buf.toString("utf8"), extra)) {
      if (hit.kind === "warning") {
        if (opts.warnings && WARN_SCOPE(file)) {
          warnings++;
          console.log(`warning: ${file}:${hit.line}: internal vocabulary "${hit.word}"`);
        }
        continue;
      }
      if (isAllowed(rules, file, hit.text)) {
        continue;
      }
      errors++;
      console.log(`${file}:${hit.line}: private name "${hit.word}"`);
    }
  }

  const scope = opts.staged ? "staged" : "tracked";
  if (errors > 0) {
    console.log(
      `privacy-check: ${errors} finding(s) in ${scanned} ${scope} file(s). ` +
        `Replace the name, or add a "path | match | reason" line to ${ALLOW_FILE} for legal text.`,
    );
    process.exit(1);
  }
  console.log(
    `privacy-check: clean (${scanned} ${scope} file(s)` +
      (warnings ? `, ${warnings} vocabulary warning(s)` : "") +
      ").",
  );
}

if (process.argv[1]?.endsWith("privacy-check.mjs")) {
  main();
}
