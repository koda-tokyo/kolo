/**
 * KoLo — Protocol Divergence Tracker
 *
 * Compares the TypeScript protocol schema (source of truth) against the
 * generated Swift models and reports any divergence. This catches cases where
 * someone edits the Swift models by hand but forgets to regenerate, or vice versa.
 *
 * Usage:
 *   node --import tsx scripts/protocol-divergence.ts check    # CI gate
 *   node --import tsx scripts/protocol-divergence.ts report   # human-readable report
 *   node --import tsx scripts/protocol-divergence.ts snapshot # save baseline snapshot
 *
 * Exit code 0 = no divergence. Exit code 1 = divergence detected.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(import.meta.url), "..", "..");
const distSchemaPath = join(rootDir, "dist", "protocol.schema.json");
const swiftModelPaths = [
  join(rootDir, "apps", "macos", "Sources", "KoLoProtocol", "GatewayModels.swift"),
  join(rootDir, "apps", "shared", "KoLoKit", "Sources", "KoLoProtocol", "GatewayModels.swift"),
];
const snapshotDir = join(rootDir, ".kolo", "protocol-snapshots");
const snapshotPath = join(snapshotDir, "baseline.json");

interface ProtocolSnapshot {
  schemaHash: string;
  swiftHashes: Record<string, string>;
  capturedAt: string;
}

interface DivergenceReport {
  ok: boolean;
  issues: string[];
  schemaPresent: boolean;
  swiftFilesChecked: number;
  snapshotExists: boolean;
  snapshotMatch: boolean;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function readIfExists(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf-8");
}

function loadSnapshot(): ProtocolSnapshot | null {
  if (!existsSync(snapshotPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf-8"));
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot: ProtocolSnapshot): void {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
}

function buildCurrentSnapshot(): ProtocolSnapshot {
  const schemaContent = readFileSync(distSchemaPath, "utf-8");
  const swiftHashes: Record<string, string> = {};

  for (const swiftPath of swiftModelPaths) {
    const content = readIfExists(swiftPath);
    if (content !== null) {
      // Keys are repo-relative so the baseline is portable across checkouts.
      swiftHashes[relative(rootDir, swiftPath)] = sha256(content);
    }
  }

  return {
    schemaHash: sha256(schemaContent),
    swiftHashes,
    capturedAt: new Date().toISOString(),
  };
}

function cmdCheck(): number {
  // CI gate: fails if schema exists but swift files are out of sync.
  if (!existsSync(distSchemaPath)) {
    process.stderr.write("[protocol-divergence] SKIP: dist/protocol.schema.json not found (run pnpm build first)\n");
    return 0;
  }

  const issues: string[] = [];

  // Check that at least one Swift model file exists
  const existingSwift = swiftModelPaths.filter((p) => existsSync(p));
  if (existingSwift.length === 0) {
    process.stderr.write("[protocol-divergence] WARN: No GatewayModels.swift found in expected locations\n");
  }

  // Compare schema hash against snapshot
  const snapshot = loadSnapshot();
  if (snapshot) {
    const currentSchema = sha256(readFileSync(distSchemaPath, "utf-8"));
    if (snapshot.schemaHash !== currentSchema) {
      issues.push("Schema changed since last snapshot — regeneration required");
    }

    // Check Swift files against snapshot
    for (const [swiftPath, expectedHash] of Object.entries(snapshot.swiftHashes)) {
      const content = readIfExists(join(rootDir, swiftPath));
      if (content === null) {
        issues.push(`Swift model file missing: ${swiftPath}`);
      } else if (sha256(content) !== expectedHash) {
        issues.push(`Swift model file modified: ${swiftPath}`);
      }
    }
  }

  if (issues.length > 0) {
    process.stderr.write("[protocol-divergence] DIVERGENCE DETECTED:\n");
    for (const issue of issues) {
      process.stderr.write(`  ✗ ${issue}\n`);
    }
    process.stderr.write("\nRun: pnpm protocol:gen && pnpm protocol:gen:swift && node --import tsx scripts/protocol-divergence.ts snapshot\n");
    return 1;
  }

  process.stderr.write("[protocol-divergence] OK — no divergence detected\n");
  return 0;
}

function cmdReport(): number {
  const report: DivergenceReport = {
    ok: true,
    issues: [],
    schemaPresent: existsSync(distSchemaPath),
    swiftFilesChecked: 0,
    snapshotExists: false,
    snapshotMatch: true,
  };

  if (!report.schemaPresent) {
    report.issues.push("dist/protocol.schema.json not found");
    report.ok = false;
  }

  const snapshot = loadSnapshot();
  report.snapshotExists = snapshot !== null;

  if (snapshot && report.schemaPresent) {
    const currentSchemaHash = sha256(readFileSync(distSchemaPath, "utf-8"));
    if (snapshot.schemaHash !== currentSchemaHash) {
      report.issues.push("Schema diverged from snapshot");
      report.snapshotMatch = false;
      report.ok = false;
    }

    for (const swiftPath of swiftModelPaths) {
      const content = readIfExists(swiftPath);
      if (content !== null) {
        report.swiftFilesChecked++;
        const currentHash = sha256(content);
        const expectedHash = snapshot.swiftHashes[relative(rootDir, swiftPath)];

        if (expectedHash && currentHash !== expectedHash) {
          report.issues.push(`Swift file modified: ${swiftPath}`);
          report.ok = false;
        }
      }
    }
  }

  // Print report
  console.log("=== Protocol Divergence Report ===");
  console.log(`Schema present: ${report.schemaPresent ? "yes" : "no"}`);
  console.log(`Swift files checked: ${report.swiftFilesChecked}`);
  console.log(`Snapshot exists: ${report.snapshotExists ? "yes" : "no"}`);
  console.log(`Snapshot matches: ${report.snapshotMatch ? "yes" : "no"}`);

  if (report.issues.length > 0) {
    console.log("\nDivergences:");
    for (const issue of report.issues) {
      console.log(`  ✗ ${issue}`);
    }
  } else {
    console.log("\nNo divergence detected ✓");
  }

  return report.ok ? 0 : 1;
}

function cmdSnapshot(): number {
  if (!existsSync(distSchemaPath)) {
    process.stderr.write("[protocol-divergence] ERROR: dist/protocol.schema.json not found. Run pnpm build first.\n");
    return 1;
  }

  const snapshot = buildCurrentSnapshot();
  saveSnapshot(snapshot);
  process.stderr.write(`[protocol-divergence] Snapshot saved: ${Object.keys(snapshot.swiftHashes).length} Swift files\n`);
  return 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? "check";

if (command === "check") {
  process.exit(cmdCheck());
} else if (command === "report") {
  process.exit(cmdReport());
} else if (command === "snapshot") {
  process.exit(cmdSnapshot());
} else {
  process.stderr.write("Usage: protocol-divergence.ts [check|report|snapshot]\n");
  process.exit(1);
}
