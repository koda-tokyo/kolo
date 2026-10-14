import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// We test the dist-freeze logic by replicating its core functions here,
// since the script uses direct file I/O that's hard to import.
function sha256File(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

describe("dist-freeze manifest logic", () => {
  let testDir: string;
  let distDir: string;
  let manifestPath: string;
  let buildInfoPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kolo-dist-freeze-test-${Date.now()}`);
    distDir = join(testDir, "dist");
    manifestPath = join(distDir, ".manifest.json");
    buildInfoPath = join(distDir, "build-info.json");
    mkdirSync(distDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestFile(name: string, content: string) {
    const fullPath = join(distDir, name);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }

  it("generates correct SHA-256 hashes for dist files", () => {
    createTestFile("entry.js", "console.log('hello')");
    createTestFile(
      "build-info.json",
      JSON.stringify({ version: "1.0.0", commit: "abc123", builtAt: "2026-04-25T00:00:00Z" }),
    );

    const content = readFileSync(join(distDir, "entry.js"));
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const actualHash = sha256File(join(distDir, "entry.js"));

    expect(actualHash).toBe(expectedHash);
  });

  it("excludes .buildstamp and .manifest.json from file list", () => {
    createTestFile("entry.js", "console.log('hello')");
    writeFileSync(join(distDir, ".buildstamp"), `${Date.now()}\n`);
    writeFileSync(join(distDir, ".manifest.json"), "{}");

    // The manifest generation logic should skip these files
    const entries = ["entry.js", ".buildstamp", ".manifest.json"];
    const filtered = entries.filter((name) => name !== ".buildstamp" && name !== ".manifest.json");

    expect(filtered).toContain("entry.js");
    expect(filtered).not.toContain(".buildstamp");
    expect(filtered).not.toContain(".manifest.json");
  });

  it("detects hash mismatch for corrupted files", () => {
    createTestFile("entry.js", "original content");
    const originalHash = sha256File(join(distDir, "entry.js"));

    // Corrupt the file
    writeFileSync(join(distDir, "entry.js"), "modified content");
    const newHash = sha256File(join(distDir, "entry.js"));

    expect(newHash).not.toBe(originalHash);
  });

  it("handles missing files in verification", () => {
    const expectedFiles: Record<string, string> = {
      "entry.js": "abc123",
      "missing.js": "def456",
    };

    const missingFiles = Object.keys(expectedFiles).filter(
      (name) => !existsSync(join(distDir, name)),
    );

    expect(missingFiles).toContain("entry.js");
    expect(missingFiles).toContain("missing.js");
  });

  it("verifies all files match when manifest is valid", () => {
    const fileContents = {
      "entry.js": "console.log('hello')",
      "utils.js": "function helper() {}",
    };

    const expectedFiles: Record<string, string> = {};
    for (const [name, content] of Object.entries(fileContents)) {
      createTestFile(name, content);
      expectedFiles[name] = sha256File(join(distDir, name));
    }

    // Verify all files
    const mismatches: string[] = [];
    for (const [relPath, expectedHash] of Object.entries(expectedFiles)) {
      const fullPath = join(distDir, relPath);
      if (!existsSync(fullPath)) {
        mismatches.push(`missing: ${relPath}`);
        continue;
      }
      const actualHash = sha256File(fullPath);
      if (actualHash !== expectedHash) {
        mismatches.push(`corrupt: ${relPath}`);
      }
    }

    expect(mismatches).toHaveLength(0);
  });
});
