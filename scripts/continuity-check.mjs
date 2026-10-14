#!/usr/bin/env node
// Continuity conformance gate (KoLo 2.0, M11): a throwaway gateway with the deterministic
// provider and a seeded resident, all four disruptions, the report written and verified.
//
//   pnpm continuity:check              out dir: $KOLO_CONTINUITY_OUT or <tmpdir>/kolo-continuity-out
//
// Honours KOLO_SMOKE_HOME (must end in ".kolo-test") and KOLO_SMOKE_PORT like scripts/smoke-gateway.mjs.
// Prints the badge and exits 0 on PASS; 1 otherwise. No network, no model, no API key.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(ROOT, "kolo.mjs");
const out = path.resolve(
  process.env.KOLO_CONTINUITY_OUT ?? path.join(os.tmpdir(), "kolo-continuity-out"),
);
fs.mkdirSync(out, { recursive: true });

function run(args) {
  const res = spawnSync(process.execPath, [entry, ...args], { stdio: "inherit", env: process.env });
  return res.status ?? 1;
}

const runCode = run(["continuity", "run", "--throwaway", "--disruption", "all", "--out", out]);
const report = path.join(out, "continuity-report.json");
if (!fs.existsSync(report)) {
  console.log(`CONTINUITY FAIL no report written (exit ${runCode})`);
  process.exit(1);
}
const verifyCode = run(["continuity", "verify", report]);
const badge = fs.readFileSync(path.join(out, "continuity-badge.txt"), "utf8").trim();
const ok = runCode === 0 && verifyCode === 0;
console.log(
  `CONTINUITY ${ok ? "PASS" : "FAIL"} ${badge} (run exit ${runCode}, verify exit ${verifyCode}, report ${report})`,
);
process.exit(ok ? 0 : 1);
