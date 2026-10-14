#!/usr/bin/env node
// Drift check (M4a): regenerates the OpenAPI document to a temp file and fails when it differs
// from the committed openapi/kolo-gateway.openapi.json.
//   node --import tsx scripts/openapi-check.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderSpec, SPEC_PATH } from "./openapi-gen.mjs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-openapi-"));
const tmp = path.join(tmpDir, "kolo-gateway.openapi.json");
try {
  fs.writeFileSync(tmp, renderSpec());
  const fresh = fs.readFileSync(tmp, "utf8");
  const committed = fs.existsSync(SPEC_PATH) ? fs.readFileSync(SPEC_PATH, "utf8") : "";
  if (fresh !== committed) {
    const a = committed.split("\n");
    const b = fresh.split("\n");
    let line = 0;
    while (line < Math.max(a.length, b.length) && a[line] === b[line]) {
      line++;
    }
    console.error(
      `openapi drift: ${path.relative(process.cwd(), SPEC_PATH)} differs from the route registry ` +
        `(first difference at line ${line + 1}).\n` +
        `  committed: ${(a[line] ?? "<eof>").slice(0, 200)}\n` +
        `  generated: ${(b[line] ?? "<eof>").slice(0, 200)}\n` +
        "Run `pnpm openapi:gen` and commit the result.",
    );
    process.exitCode = 1;
  } else {
    console.log("openapi: committed spec matches the route registry");
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
