#!/usr/bin/env node
// Writes openapi/kolo-gateway.openapi.json from the gateway route registry (M4a).
//   node --import tsx scripts/openapi-gen.mjs [--out <file>]
// Also copies it to dist/kolo-gateway.openapi.json when dist/ exists (build output).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStaticGatewayOpenApi, serializeOpenApi } from "../src/gateway/openapi-static.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SPEC_PATH = path.join(ROOT, "openapi", "kolo-gateway.openapi.json");

export function renderSpec() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return serializeOpenApi(buildStaticGatewayOpenApi(pkg.version));
}

function main(argv) {
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? path.resolve(argv[outIdx + 1] ?? "") : SPEC_PATH;
  const body = renderSpec();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  const distDir = path.join(ROOT, "dist");
  if (outIdx < 0 && fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, "kolo-gateway.openapi.json"), body);
  }
  const doc = JSON.parse(body);
  let ops = 0;
  for (const item of Object.values(doc.paths)) {
    ops += Object.keys(item).length;
  }
  console.log(
    `wrote ${path.relative(ROOT, out)} (${ops} operations, ${doc["x-kolo-undocumented-routes"].length} undocumented mounts)`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
