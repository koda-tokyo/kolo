#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env };
const cwd = process.cwd();
const compilerOverride = env.KOLO_TS_COMPILER ?? env.CLAWDBOT_TS_COMPILER;
const compiler = compilerOverride === "tsc" ? "tsc" : "tsgo";
const projectArgs = ["--project", "tsconfig.json"];

const distRoot = path.join(cwd, "dist");
const distEntry = path.join(distRoot, "/entry.js");
const buildStampPath = path.join(distRoot, ".buildstamp");
const manifestPath = path.join(distRoot, ".manifest.json");
const srcRoot = path.join(cwd, "src");
const configFiles = [path.join(cwd, "tsconfig.json"), path.join(cwd, "package.json")];

const statMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
};

const isExcludedSource = (filePath) => {
  const relativePath = path.relative(srcRoot, filePath);
  if (relativePath.startsWith("..")) {
    return false;
  }
  return (
    relativePath.endsWith(".test.ts") ||
    relativePath.endsWith(".test.tsx") ||
    relativePath.endsWith(`test-helpers.ts`)
  );
};

const findLatestMtime = (dirPath, shouldSkip) => {
  let latest = null;
  const queue = [dirPath];
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (shouldSkip?.(fullPath)) {
        continue;
      }
      const mtime = statMtime(fullPath);
      if (mtime == null) {
        continue;
      }
      if (latest == null || mtime > latest) {
        latest = mtime;
      }
    }
  }
  return latest;
};

const shouldBuild = () => {
  if (env.KOLO_FORCE_BUILD === "1") {
    return true;
  }
  const stampMtime = statMtime(buildStampPath);
  if (stampMtime == null) {
    return true;
  }
  if (statMtime(distEntry) == null) {
    return true;
  }

  for (const filePath of configFiles) {
    const mtime = statMtime(filePath);
    if (mtime != null && mtime > stampMtime) {
      return true;
    }
  }

  const srcMtime = findLatestMtime(srcRoot, isExcludedSource);
  if (srcMtime != null && srcMtime > stampMtime) {
    return true;
  }
  return false;
};

const logRunner = (message) => {
  if (env.KOLO_RUNNER_LOG === "0") {
    return;
  }
  process.stderr.write(`[kolo] ${message}\n`);
};

const verifyDistIntegrity = () => {
  // If no manifest exists, skip (first run after build, or pre-freeze dist).
  if (!fs.existsSync(manifestPath)) {
    return;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const expectedFiles = manifest.files;
    let ok = true;
    const mismatches = [];

    for (const [relPath, expectedHash] of Object.entries(expectedFiles)) {
      const fullPath = path.join(distRoot, relPath);
      if (!fs.existsSync(fullPath)) {
        mismatches.push(`missing: ${relPath}`);
        ok = false;
        continue;
      }
      const content = fs.readFileSync(fullPath);
      const actualHash = createHash("sha256").update(content).digest("hex");
      if (actualHash !== expectedHash) {
        mismatches.push(`corrupt: ${relPath}`);
        ok = false;
      }
    }

    if (!ok) {
      logRunner(`DIST INTEGRITY FAILED — ${mismatches.length} issue(s):`);
      for (const m of mismatches.slice(0, 5)) {
        logRunner(`  ~ ${m}`);
      }
      if (mismatches.length > 5) {
        logRunner(`  ... and ${mismatches.length - 5} more`);
      }
      logRunner("Rebuild required. Run: pnpm build");
      // Non-fatal: allow startup to continue (let the process fail naturally).
    } else {
      const fileCount = Object.keys(expectedFiles).length;
      logRunner(`dist integrity OK (${fileCount} files verified)`);
    }
  } catch (err) {
    logRunner(`dist integrity check skipped: ${err?.message ?? "unknown error"}`);
  }
};

const runNode = () => {
  const nodeProcess = spawn(process.execPath, ["kolo.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });

  nodeProcess.on("exit", (exitCode, exitSignal) => {
    if (exitSignal) {
      process.exit(1);
    }
    process.exit(exitCode ?? 1);
  });
};

const writeBuildStamp = () => {
  try {
    fs.mkdirSync(distRoot, { recursive: true });
    fs.writeFileSync(buildStampPath, `${Date.now()}\n`);
  } catch (error) {
    // Best-effort stamp; still allow the runner to start.
    logRunner(`Failed to write build stamp: ${error?.message ?? "unknown error"}`);
  }
};

const generateManifest = () => {
  // Generates a SHA-256 manifest of all dist/ files for integrity verification.
  // Uses the shared dist-freeze.ts logic via direct inline to avoid tsx dependency.
  try {
    const buildInfoPath = path.join(distRoot, "build-info.json");
    let buildInfo = { version: "unknown", commit: "unknown", builtAt: new Date().toISOString() };
    if (fs.existsSync(buildInfoPath)) {
      buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf-8"));
    }

    const fileHashes = {};
    const queue = [distRoot];
    while (queue.length > 0) {
      const dir = queue.pop();
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.name === ".buildstamp" || entry.name === ".manifest.json") continue;
        if (entry.isDirectory()) {
          queue.push(fullPath);
        } else if (entry.isFile()) {
          const relPath = path.relative(distRoot, fullPath);
          const content = fs.readFileSync(fullPath);
          fileHashes[relPath] = createHash("sha256").update(content).digest("hex");
        }
      }
    }

    const manifest = {
      version: buildInfo.version,
      commit: buildInfo.commit,
      builtAt: buildInfo.builtAt,
      files: fileHashes,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    logRunner(`dist manifest generated: ${Object.keys(fileHashes).length} files`);
  } catch (error) {
    logRunner(`Failed to generate dist manifest: ${error?.message ?? "unknown error"}`);
  }
};

if (!shouldBuild()) {
  runNode();
} else {
  logRunner("Building TypeScript (dist is stale).");
  const pnpmArgs = ["exec", compiler, ...projectArgs];
  const buildCmd = process.platform === "win32" ? "cmd.exe" : "pnpm";
  const buildArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...pnpmArgs] : pnpmArgs;
  const build = spawn(buildCmd, buildArgs, {
    cwd,
    env,
    stdio: "inherit",
  });

  build.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
    writeBuildStamp();
    generateManifest();
    runNode();
  });
}
