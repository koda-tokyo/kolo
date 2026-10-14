import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundleArchiveName,
  bundleDirName,
  bundleLauncherRelPath,
  bundleNodeRelPath,
  createBundleManifest,
  formatSha256Sums,
  hostBundleTarget,
  listBundleFiles,
  nodeDistFileName,
  parseBundleManifest,
  parseBundleTarget,
  parseSha256Sums,
  readBundleManifest,
  verifyBundleSums,
  writeBundleSums,
} from "./bundle-manifest.js";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bundle-manifest-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bundle naming", () => {
  it("parses and formats targets", () => {
    expect(parseBundleTarget("linux-x64")).toEqual({ os: "linux", arch: "x64" });
    expect(parseBundleTarget("darwin-arm64")).toEqual({ os: "darwin", arch: "arm64" });
    expect(parseBundleTarget("win32-x64")).toEqual({ os: "win32", arch: "x64" });
    expect(() => parseBundleTarget("freebsd-x64")).toThrow(/unsupported/);
    expect(() => parseBundleTarget("linux-ia32")).toThrow(/unsupported/);
  });

  it("derives archive and launcher names per os", () => {
    const linux = parseBundleTarget("linux-x64");
    const win = parseBundleTarget("win32-x64");
    expect(bundleDirName("2026.10.16", linux)).toBe("kolo-2026.10.16-linux-x64");
    expect(bundleArchiveName("2026.10.16", linux)).toBe("kolo-2026.10.16-linux-x64.tar.gz");
    expect(bundleArchiveName("2026.10.16", win)).toBe("kolo-2026.10.16-win32-x64.zip");
    expect(bundleLauncherRelPath("linux")).toBe("bin/kolo");
    expect(bundleLauncherRelPath("win32")).toBe("bin/kolo.cmd");
    expect(bundleNodeRelPath("darwin")).toBe("node/bin/node");
    expect(bundleNodeRelPath("win32")).toBe("node/node.exe");
  });

  it("maps targets onto nodejs.org file names", () => {
    expect(nodeDistFileName("22.18.0", parseBundleTarget("linux-x64"))).toBe(
      "node-v22.18.0-linux-x64.tar.gz",
    );
    expect(nodeDistFileName("v22.18.0", parseBundleTarget("darwin-arm64"))).toBe(
      "node-v22.18.0-darwin-arm64.tar.gz",
    );
    expect(nodeDistFileName("22.18.0", parseBundleTarget("win32-x64"))).toBe(
      "node-v22.18.0-win-x64.zip",
    );
  });

  it("resolves the host target", () => {
    expect(hostBundleTarget("linux", "x64")).toEqual({ os: "linux", arch: "x64" });
    expect(() => hostBundleTarget("aix", "ppc64")).toThrow(/unsupported/);
  });
});

describe("SHA256SUMS", () => {
  it("round-trips sums text", () => {
    const text = formatSha256Sums([
      ["lib/b.js", "b".repeat(64)],
      ["lib/a.js", "a".repeat(64)],
    ]);
    expect(text).toBe(`${"a".repeat(64)}  lib/a.js\n${"b".repeat(64)}  lib/b.js\n`);
    const parsed = parseSha256Sums(`# comment\n${text}\n${"c".repeat(64)} *bin/kolo\nbad line\n`);
    expect(parsed.get("lib/a.js")).toBe("a".repeat(64));
    expect(parsed.get("bin/kolo")).toBe("c".repeat(64));
    expect(parsed.size).toBe(3);
  });

  it("writes and verifies a bundle, and detects tampering", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.writeFileSync(path.join(root, "lib", "kolo.mjs"), "console.log(1)\n");
    fs.writeFileSync(path.join(root, "LICENSE"), "license\n");
    const sums = writeBundleSums(root);
    expect(Array.from(sums.keys())).toEqual(["LICENSE", "lib/kolo.mjs"]);
    expect(listBundleFiles(root)).toEqual(["LICENSE", "SHA256SUMS", "lib/kolo.mjs"]);

    expect(verifyBundleSums(root)).toEqual({
      ok: true,
      checked: 2,
      missing: [],
      mismatched: [],
      extra: [],
    });

    fs.writeFileSync(path.join(root, "lib", "kolo.mjs"), "console.log(2)\n");
    fs.rmSync(path.join(root, "LICENSE"));
    fs.writeFileSync(path.join(root, "extra.txt"), "x");
    const result = verifyBundleSums(root);
    expect(result.ok).toBe(false);
    expect(result.mismatched).toEqual(["lib/kolo.mjs"]);
    expect(result.missing).toEqual(["LICENSE"]);
    expect(result.extra).toEqual(["extra.txt"]);
  });
});

describe("bundle manifest", () => {
  it("creates, serialises and parses a manifest", () => {
    const manifest = createBundleManifest({
      version: "2026.10.16",
      target: parseBundleTarget("darwin-arm64"),
      nodeVersion: "22.18.0",
      nodeSha256: "f".repeat(64),
      commit: "abc123",
      builtAt: "2026-10-16T00:00:00.000Z",
      extensions: { included: ["telegram"], omitted: { "memory-lancedb": "native dependency" } },
      pruned: ["node-llama-cpp"],
      fileCount: 12,
    });
    expect(manifest.launcher).toBe("bin/kolo");
    expect(manifest.entry).toBe("lib/kolo.mjs");
    const parsed = parseBundleManifest(JSON.stringify(manifest));
    expect(parsed).toEqual(manifest);

    const root = tmpDir();
    fs.writeFileSync(path.join(root, "bundle-manifest.json"), JSON.stringify(manifest));
    expect(readBundleManifest(root)?.version).toBe("2026.10.16");
    expect(readBundleManifest(path.join(root, "missing"))).toBeNull();
  });

  it("rejects manifests from another schema or product", () => {
    expect(() => parseBundleManifest(JSON.stringify({ schema: 99, name: "kolo" }))).toThrow(
      /schema/,
    );
    expect(() =>
      parseBundleManifest(JSON.stringify({ schema: 1, name: "other", version: "1" })),
    ).toThrow(/not kolo/);
    expect(() =>
      parseBundleManifest(
        JSON.stringify({ schema: 1, name: "kolo", version: "1", os: "linux", arch: "x64" }),
      ),
    ).toThrow(/node\.version/);
  });
});
