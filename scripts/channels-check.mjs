#!/usr/bin/env node
// Channel conformance gate (KoLo 2.0, M14): runs the end-to-end test in
// src/channels/resident/channels.e2e.test.ts against a throwaway gateway (built dist/entry.js)
// with the deterministic provider and the generic webhook channel pointed at a local receiver:
// routing to the resident's session, attach visibility (channel.inbound), chunked replies,
// conversation commands with roles, retry with backoff, delivery status, inbound idempotency.
//
//   pnpm channels:check
//
// Honours KOLO_SMOKE_HOME (must end in ".kolo-test") and KOLO_SMOKE_PORT like scripts/smoke-gateway.mjs.
// Exits 0 on PASS; 1 otherwise. No network beyond loopback, no model, no API key. Needs `pnpm build` first.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!fs.existsSync(path.join(ROOT, "dist", "entry.js"))) {
  console.log("CHANNELS FAIL dist/entry.js missing; run `pnpm build` first");
  process.exit(1);
}
const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
const res = spawnSync(
  process.execPath,
  [vitest, "run", "src/channels/resident/channels.e2e.test.ts", "--config", "vitest.e2e.config.ts"],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, NO_COLOR: "1" } },
);
const ok = res.status === 0;
console.log(`CHANNELS ${ok ? "PASS" : "FAIL"} (vitest exit ${res.status ?? 1})`);
process.exit(ok ? 0 : 1);
