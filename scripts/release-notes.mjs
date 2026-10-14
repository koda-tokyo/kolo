#!/usr/bin/env node
// Print the CHANGELOG.md section for a version (release notes body for the GitHub Release).
//
//   node scripts/release-notes.mjs <version|vVERSION> [--out <file>]
//
// Exit 1 when the entry is missing, so a release never ships with empty notes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractChangelogNotes } from "./release-prep.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const version = (args.find((a) => !a.startsWith("--")) ?? "").replace(/^v/, "");
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;

if (!version) {
  console.error("usage: release-notes.mjs <version> [--out <file>]");
  process.exit(1);
}
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const notes = extractChangelogNotes(changelog, version);
if (!notes) {
  console.error(`release-notes: CHANGELOG.md has no entry for ${version}`);
  process.exit(1);
}
const body = `${notes}\n\n---\nPrebuilt bundles: unpack, run \`bin/kolo --version\` (\`bin\\kolo.cmd\` on Windows). Verify with \`SHA256SUMS.txt\`. See docs/PACKAGING.md.\n`;
if (outFile) {
  fs.writeFileSync(outFile, body);
} else {
  process.stdout.write(body);
}
