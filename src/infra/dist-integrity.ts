/**
 * KoLo — Dist Integrity Verification
 *
 * Verifies the SHA-256 manifest generated at build time against the current
 * dist/ directory. Called at gateway startup to catch corruption early.
 *
 * Non-fatal: logs warnings but allows startup to continue (let the process
 * fail naturally if dist is truly broken).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..", "..");
const distDir = join(rootDir, "dist");
const manifestPath = join(distDir, ".manifest.json");

interface DistManifest {
  version: string;
  commit: string;
  builtAt: string;
  files: Record<string, string>;
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
      if (entry.name === ".buildstamp" || entry.name === ".manifest.json") {
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

export async function verifyDistIntegrity(): Promise<{
  ok: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  if (!existsSync(manifestPath)) {
    // No manifest — likely a pre-freeze build. Skip silently.
    return { ok: true, issues: [] };
  }

  let manifest: DistManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    issues.push("corrupt manifest file");
    return { ok: false, issues };
  }

  const expectedFiles = manifest.files;
  const actualFiles = collectDistFiles();
  const actualPaths = new Set(actualFiles.map((f) => relative(distDir, f)));
  const expectedPaths = new Set(Object.keys(expectedFiles));

  // Check for missing files
  for (const relPath of expectedPaths) {
    if (!actualPaths.has(relPath)) {
      issues.push(`missing: ${relPath}`);
    }
  }

  // Check for corruption (hash mismatches)
  for (const [relPath, expectedHash] of Object.entries(expectedFiles)) {
    const fullPath = join(distDir, relPath);
    if (!existsSync(fullPath)) {
      continue; // already caught above
    }
    try {
      const actualHash = sha256File(fullPath);
      if (actualHash !== expectedHash) {
        issues.push(`corrupt: ${relPath}`);
      }
    } catch {
      issues.push(`unreadable: ${relPath}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}
