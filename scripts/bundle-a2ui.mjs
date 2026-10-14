#!/usr/bin/env node
// Bundle the A2UI canvas renderer into src/canvas-host/a2ui/a2ui.bundle.js.
//
// Node port of the former scripts/bundle-a2ui.sh: no bash, no PATH lookups, no shell,
// so it runs the same on Linux, macOS and Windows. Steps:
//   1. Skip when the vendored sources are absent (Docker builds exclude vendor/ and apps/).
//   2. Hash package.json, pnpm-lock.yaml and both source trees; skip when unchanged.
//   3. Compile the lit renderer with tsc (run via process.execPath, not a .bin shim).
//   4. Bundle with the rolldown JS API using the app's rolldown.config.mjs.
//   5. Write the new hash.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HASH_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/.bundle.hash");
const OUTPUT_FILE = path.join(ROOT_DIR, "src/canvas-host/a2ui/a2ui.bundle.js");
const A2UI_RENDERER_DIR = path.join(ROOT_DIR, "vendor/a2ui/renderers/lit");
const A2UI_APP_DIR = path.join(ROOT_DIR, "apps/shared/KoLoKit/Tools/CanvasA2UI");

function fail(err) {
  console.error(String(err instanceof Error ? (err.stack ?? err.message) : err));
  console.error("A2UI bundling failed. Re-run with: pnpm canvas:a2ui:bundle");
  console.error("If this persists, verify pnpm deps and try again.");
  process.exit(1);
}

async function walk(entryPath, files) {
  const st = await fs.stat(entryPath);
  if (st.isDirectory()) {
    for (const entry of await fs.readdir(entryPath)) {
      await walk(path.join(entryPath, entry), files);
    }
    return;
  }
  files.push(entryPath);
}

const normalize = (p) => p.split(path.sep).join("/");

/** Same algorithm as the old shell script, so existing .bundle.hash values stay valid. */
export async function computeA2uiHash(inputs, rootDir = ROOT_DIR) {
  const files = [];
  for (const input of inputs) {
    await walk(input, files);
  }
  files.sort((a, b) => normalize(a).localeCompare(normalize(b)));
  const hash = createHash("sha256");
  for (const filePath of files) {
    hash.update(normalize(path.relative(rootDir, filePath)));
    hash.update("\0");
    hash.update(await fs.readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function runTsc(tsconfigPath) {
  const require = createRequire(path.join(ROOT_DIR, "package.json"));
  const tscBin = path.join(path.dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const res = spawnSync(process.execPath, [tscBin, "-p", tsconfigPath], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    throw new Error(`tsc exited with code ${res.status}`);
  }
}

async function runRolldown(configPath) {
  const require = createRequire(path.join(ROOT_DIR, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("rolldown")).href);
  const mod = await import(pathToFileURL(configPath).href);
  let config = mod.default ?? mod;
  if (typeof config === "function") {
    config = await config({});
  }
  for (const entry of Array.isArray(config) ? config : [config]) {
    await build(entry);
  }
}

async function main() {
  if (!existsSync(A2UI_RENDERER_DIR) || !existsSync(A2UI_APP_DIR)) {
    console.log("A2UI sources missing; keeping prebuilt bundle.");
    return;
  }

  const currentHash = await computeA2uiHash([
    path.join(ROOT_DIR, "package.json"),
    path.join(ROOT_DIR, "pnpm-lock.yaml"),
    A2UI_RENDERER_DIR,
    A2UI_APP_DIR,
  ]);
  if (existsSync(HASH_FILE) && existsSync(OUTPUT_FILE)) {
    const previousHash = (await fs.readFile(HASH_FILE, "utf8")).trim();
    if (previousHash === currentHash) {
      console.log("A2UI bundle up to date; skipping.");
      return;
    }
  }

  runTsc(path.join(A2UI_RENDERER_DIR, "tsconfig.json"));
  await runRolldown(path.join(A2UI_APP_DIR, "rolldown.config.mjs"));
  await fs.writeFile(HASH_FILE, `${currentHash}\n`, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(fail);
}
