/**
 * KoLo — Dist Artifact Freeze
 *
 * Generates a SHA-256 manifest of all dist/ files after a successful build.
 * The manifest is stored at dist/.manifest.json and verified at runtime startup.
 *
 * Purpose: prevent dist-runtime corruption. When dist/ is partially built or
 * stale, the gateway could run on bad artifacts. This gives us:
 *   1. Post-build manifest generation (run after `pnpm build`)
 *   2. Pre-run integrity verification (run before `node dist/entry.js`)
 *   3. Atomic dist replacement signal (manifest only written after full build)
 *
 * Usage:
 *   node --import tsx scripts/dist-freeze.ts generate   # after build
 *   node --import tsx scripts/dist-freeze.ts verify     # before run
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(rootDir, "dist");
const manifestPath = join(distDir, ".manifest.json");

interface DistManifest {
  version: string;
  commit: string;
  builtAt: string;
  files: Record<string, string>; // relative path → sha256 hex
}

function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function collectDistFiles(): string[] {
  const files: string[] = [];
  const queue: string[] = [distDir];

  while (queue.length > 0) {
    const dir = queue.pop()!;
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip manifest itself, buildstamp, and hidden files except .manifest.json
      if (entry.name === ".buildstamp") {
        continue;
      }
      if (entry.name === ".manifest.json") {
        continue;
      }

      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function readBuildInfo(): { version: string; commit: string; builtAt: string } {
  const buildInfoPath = join(distDir, "build-info.json");
  if (!existsSync(buildInfoPath)) {
    return {
      version: "unknown",
      commit: "unknown",
      builtAt: new Date().toISOString(),
    };
  }
  return JSON.parse(readFileSync(buildInfoPath, "utf-8"));
}

function generateManifest(): DistManifest {
  const buildInfo = readBuildInfo();
  const files = collectDistFiles();

  const fileHashes: Record<string, string> = {};
  for (const filePath of files) {
    const relPath = relative(distDir, filePath);
    fileHashes[relPath] = sha256File(filePath);
  }

  return {
    version: buildInfo.version,
    commit: buildInfo.commit,
    builtAt: buildInfo.builtAt,
    files: fileHashes,
  };
}

function cmdGenerate(): number {
  if (!existsSync(distDir)) {
    process.stderr.write("dist/ directory not found. Run `pnpm build` first.\n");
    return 1;
  }

  process.stderr.write("[dist-freeze] Generating manifest...\n");
  const manifest = generateManifest();
  const fileCount = Object.keys(manifest.files).length;

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  process.stderr.write(
    `[dist-freeze] Manifest written: ${fileCount} files, version=${manifest.version}, commit=${manifest.commit ? manifest.commit.slice(0, 7) : "none"}\n`,
  );
  return 0;
}

function cmdVerify(): number {
  if (!existsSync(manifestPath)) {
    process.stderr.write(
      "[dist-freeze] WARN: No manifest found. Skipping integrity check (first run after build).\n",
    );
    return 0;
  }

  let manifest: DistManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    process.stderr.write("[dist-freeze] ERROR: Corrupt manifest file. Rebuild required.\n");
    return 1;
  }

  const expectedFiles = manifest.files;
  const actualFiles = collectDistFiles();
  const actualPaths = new Set(actualFiles.map((f) => relative(distDir, f)));
  const expectedPaths = new Set(Object.keys(expectedFiles));

  // Check for missing files
  const missingFiles = [...expectedPaths].filter((p) => !actualPaths.has(p));
  if (missingFiles.length > 0) {
    process.stderr.write(
      `[dist-freeze] ERROR: ${missingFiles.length} file(s) missing from dist/:\n`,
    );
    for (const f of missingFiles.slice(0, 10)) {
      process.stderr.write(`  - ${f}\n`);
    }
    if (missingFiles.length > 10) {
      process.stderr.write(`  ... and ${missingFiles.length - 10} more\n`);
    }
    process.stderr.write("[dist-freeze] Dist is incomplete. Run `pnpm build`.\n");
    return 1;
  }

  // Check for extra files (shouldn't happen in a clean build)
  const extraFiles = [...actualPaths].filter((p) => !expectedPaths.has(p));
  if (extraFiles.length > 0) {
    process.stderr.write(
      `[dist-freeze] WARN: ${extraFiles.length} unexpected file(s) in dist/:\n`,
    );
    for (const f of extraFiles.slice(0, 5)) {
      process.stderr.write(`  + ${f}\n`);
    }
  }

  // Verify checksums
  const mismatches: string[] = [];
  for (const [relPath, expectedHash] of Object.entries(expectedFiles)) {
    const fullPath = join(distDir, relPath);
    if (!existsSync(fullPath)) {
      continue; // already caught above
    }
    const actualHash = sha256File(fullPath);
    if (actualHash !== expectedHash) {
      mismatches.push(relPath);
    }
  }

  if (mismatches.length > 0) {
    process.stderr.write(
      `[dist-freeze] ERROR: ${mismatches.length} file(s) corrupted:\n`,
    );
    for (const f of mismatches.slice(0, 10)) {
      process.stderr.write(`  ~ ${f}\n`);
    }
    process.stderr.write("[dist-freeze] Dist integrity check FAILED. Rebuild required.\n");
    return 1;
  }

  process.stderr.write(
    `[dist-freeze] OK: ${Object.keys(expectedFiles).length} files verified (v${manifest.version}, ${manifest.commit ? manifest.commit.slice(0, 7) : "none"})\n`,
  );
  return 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? "verify";

if (command === "generate") {
  process.exit(cmdGenerate());
} else if (command === "verify") {
  process.exit(cmdVerify());
} else {
  process.stderr.write(`Usage: dist-freeze.ts [generate|verify]\n`);
  process.exit(1);
}
