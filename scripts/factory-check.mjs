#!/usr/bin/env node
// Factory conformance gate (KoLo 2.0, M15): runs the end-to-end test in
// src/factory/factory.e2e.test.ts against a throwaway gateway (built dist/entry.js) and a fake
// KIP engine: one card created through the API, run, followed over the WebSocket, its job and
// signed evidence read back, the Kanban page served, an illegal move refused, a manual move
// audited, and the board read through the CLI.
//
//   pnpm factory:check
//
// Honours KOLO_SMOKE_HOME (must end in ".kolo-test") and KOLO_SMOKE_PORT like scripts/smoke-gateway.mjs.
// Exits 0 on PASS; 1 otherwise. No network, no model, no API key. Needs `pnpm build` first.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(ROOT, "dist", "entry.js"))) {
  console.log("FACTORY FAIL dist/entry.js missing; run `pnpm build` first");
  process.exit(1);
}
const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const res = spawnSync(
  process.execPath,
  [vitest, "run", "src/factory/factory.e2e.test.ts", "--config", "vitest.e2e.config.ts"],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, NO_COLOR: "1" } },
);
const ok = res.status === 0;
console.log(`FACTORY ${ok ? "PASS" : "FAIL"} (vitest exit ${res.status ?? 1})`);
process.exit(ok ? 0 : 1);
