import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditInput } from "../audit/index.js";
import {
  createBundleManifest,
  parseBundleTarget,
  writeBundleSums,
} from "../packaging/bundle-manifest.js";
import { resolveBundleInfo } from "./bundle.js";
import {
  ChecksumMismatchError,
  renderWindowsApplyScript,
  resolveBundleUpdateChannel,
  runBundleUpdate,
  selectBundleAssets,
  type FetchLike,
  type GitHubRelease,
} from "./update-bundle.js";

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-update-bundle-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const target = parseBundleTarget("linux-x64");

function makeBundle(dir: string, version: string): void {
  fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.mkdirSync(path.join(dir, "node", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bin", "kolo"), `#!/bin/sh\necho ${version}\n`);
  fs.writeFileSync(
    path.join(dir, "lib", "package.json"),
    JSON.stringify({ name: "kolo", version }),
  );
  fs.writeFileSync(path.join(dir, "node", "bin", "node"), `node-${version}`);
  fs.writeFileSync(path.join(dir, "LICENSE"), "license");
  const manifest = createBundleManifest({
    version,
    target,
    nodeVersion: "22.18.0",
    nodeSha256: null,
    commit: null,
    builtAt: "2026-10-16T00:00:00.000Z",
    extensions: { included: [], omitted: {} },
    pruned: [],
    fileCount: 4,
  });
  fs.writeFileSync(path.join(dir, "bundle-manifest.json"), JSON.stringify(manifest));
  writeBundleSums(dir);
}

async function makeRelease(version: string): Promise<{
  release: GitHubRelease;
  files: Map<string, Buffer>;
  bundleDirName: string;
}> {
  const work = tmpDir();
  const bundleDirName = `kolo-${version}-linux-x64`;
  makeBundle(path.join(work, bundleDirName), version);
  const archiveName = `${bundleDirName}.tar.gz`;
  const archivePath = path.join(work, archiveName);
  await tar.c({ gzip: true, file: archivePath, cwd: work, portable: true }, [bundleDirName]);
  const archive = fs.readFileSync(archivePath);
  const sha = createHash("sha256").update(archive).digest("hex");
  const sums = Buffer.from(`${sha}  ${archiveName}\n`);
  const base = "https://downloads.example/";
  const release: GitHubRelease = {
    tag_name: `v${version}`,
    html_url: `https://github.example/releases/v${version}`,
    published_at: "2026-10-16T00:00:00Z",
    assets: [
      { name: archiveName, browser_download_url: `${base}${archiveName}` },
      { name: "SHA256SUMS.txt", browser_download_url: `${base}SHA256SUMS.txt` },
      { name: "kolo-x-win32-x64.zip", browser_download_url: `${base}other.zip` },
    ],
  };
  const files = new Map<string, Buffer>([
    [`${base}${archiveName}`, archive],
    [`${base}SHA256SUMS.txt`, sums],
  ]);
  return { release, files, bundleDirName };
}

function fakeFetch(params: {
  release: GitHubRelease | null;
  files: Map<string, Buffer>;
  calls?: string[];
}): FetchLike {
  return async (url) => {
    params.calls?.push(url);
    if (url.endsWith("/releases/latest")) {
      if (!params.release) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify(params.release), { status: 200 });
    }
    if (url.includes("/releases?")) {
      return new Response(JSON.stringify(params.release ? [params.release] : []), { status: 200 });
    }
    const body = params.files.get(url);
    if (!body) {
      return new Response("missing", { status: 404 });
    }
    return new Response(new Uint8Array(body), { status: 200 });
  };
}

function installedBundle(version: string) {
  const root = path.join(tmpDir(), "kolo");
  makeBundle(root, version);
  const bundle = resolveBundleInfo({ KOLO_BUNDLE_ROOT: root }, "file:///nowhere/x.js");
  if (!bundle) {
    throw new Error("bundle not detected");
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "bundle-manifest.json"), "utf8"));
  return { root, bundle, manifest };
}

describe("resolveBundleUpdateChannel", () => {
  it("prefers the flag, then the env, then config, then stable", () => {
    expect(resolveBundleUpdateChannel({ env: {} })).toBe("stable");
    expect(resolveBundleUpdateChannel({ env: {}, configChannel: "beta" })).toBe("nightly");
    expect(
      resolveBundleUpdateChannel({ env: { KOLO_UPDATE_CHANNEL: "stable" }, configChannel: "dev" }),
    ).toBe("stable");
    expect(resolveBundleUpdateChannel({ env: { KOLO_UPDATE_CHANNEL: "nightly" } })).toBe("nightly");
    expect(
      resolveBundleUpdateChannel({ flag: "stable", env: { KOLO_UPDATE_CHANNEL: "nightly" } }),
    ).toBe("stable");
    expect(resolveBundleUpdateChannel({ env: { KOLO_UPDATE_CHANNEL: "bogus" } })).toBe("stable");
  });
});

describe("selectBundleAssets", () => {
  it("picks the archive and sums for the target", async () => {
    const { release } = await makeRelease("2026.10.17");
    const picked = selectBundleAssets(release, target);
    expect(picked.version).toBe("2026.10.17");
    expect(picked.archive.name).toBe("kolo-2026.10.17-linux-x64.tar.gz");
    expect(picked.sums?.name).toBe("SHA256SUMS.txt");
    expect(() => selectBundleAssets(release, parseBundleTarget("darwin-arm64"))).toThrow(
      /no bundle for darwin-arm64/,
    );
  });
});

describe("runBundleUpdate", () => {
  it("--check reports availability without downloading", async () => {
    const { bundle, manifest } = installedBundle("2026.10.16");
    const { release, files } = await makeRelease("2026.10.17");
    const calls: string[] = [];
    const audits: AuditInput[] = [];
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: "2026.10.16",
      channel: "stable",
      checkOnly: true,
      repo: "koda-tokyo/kurahi",
      apiBase: "https://api.example",
      fetchImpl: fakeFetch({ release, files, calls }),
      platform: "linux",
      env: {},
      audit: (i) => audits.push(i),
    });
    expect(out.available).toBe(true);
    expect(out.latestVersion).toBe("2026.10.17");
    expect(out.performed).toBe(false);
    expect(calls).toEqual(["https://api.example/repos/koda-tokyo/kurahi/releases/latest"]);
    expect(audits.map((a) => a.action)).toEqual(["update.check"]);
    expect(fs.existsSync(path.join(bundle.root, ".update"))).toBe(false);
  });

  it("reports up to date and does nothing when the release is not newer", async () => {
    const { bundle, manifest } = installedBundle("2026.10.17");
    const { release, files } = await makeRelease("2026.10.17");
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: "2026.10.17",
      channel: "stable",
      apiBase: "https://api.example",
      repo: "x/y",
      fetchImpl: fakeFetch({ release, files }),
      platform: "linux",
      env: {},
      audit: () => {},
    });
    expect(out.available).toBe(false);
    expect(out.performed).toBe(false);
  });

  it("treats 2.0.0 as an update for a calendar-versioned install", async () => {
    const { bundle, manifest } = installedBundle("2026.2.1-kolo.1");
    const { release, files } = await makeRelease("2.0.0");
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: "2026.2.1-kolo.1",
      channel: "stable",
      checkOnly: true,
      apiBase: "https://api.example",
      repo: "x/y",
      fetchImpl: fakeFetch({ release, files }),
      platform: "linux",
      env: {},
      audit: () => {},
    });
    expect(out.available).toBe(true);
    expect(out.latestVersion).toBe("2.0.0");
  });

  it("returns no release when the repo has none", async () => {
    const { bundle, manifest } = installedBundle("2026.10.17");
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: "2026.10.17",
      channel: "stable",
      apiBase: "https://api.example",
      repo: "x/y",
      fetchImpl: fakeFetch({ release: null, files: new Map() }),
      platform: "linux",
      env: {},
      audit: () => {},
    });
    expect(out.latestVersion).toBeNull();
    expect(out.available).toBe(false);
  });

  it("downloads, verifies and swaps the bundle on POSIX, keeping the previous one", async () => {
    const { root, bundle, manifest } = installedBundle("2026.10.16");
    const { release, files } = await makeRelease("2026.10.17");
    const audits: AuditInput[] = [];
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: "2026.10.16",
      channel: "stable",
      apiBase: "https://api.example",
      repo: "x/y",
      fetchImpl: fakeFetch({ release, files }),
      platform: "linux",
      env: {},
      audit: (i) => audits.push(i),
    });
    expect(out.performed).toBe(true);
    expect(out.apply?.mode).toBe("applied");
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "lib", "package.json"), "utf8")).version,
    ).toBe("2026.10.17");
    expect(fs.readFileSync(path.join(root, "node", "bin", "node"), "utf8")).toBe("node-2026.10.17");
    expect(
      JSON.parse(fs.readFileSync(path.join(root, ".previous", "lib", "package.json"), "utf8"))
        .version,
    ).toBe("2026.10.16");
    expect(fs.existsSync(path.join(root, ".update", "extract"))).toBe(false);
    expect(
      fs.existsSync(path.join(root, ".update", "download", "kolo-2026.10.17-linux-x64.tar.gz")),
    ).toBe(false);
    expect(audits.map((a) => a.action)).toEqual([
      "update.check",
      "update.download",
      "update.apply",
    ]);
    const apply = audits.at(-1)?.detail as { from: string; to: string; sha256: string };
    expect(apply.from).toBe("2026.10.16");
    expect(apply.to).toBe("2026.10.17");
    expect(apply.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a checksum mismatch and leaves the install untouched", async () => {
    const { root, bundle, manifest } = installedBundle("2026.10.16");
    const { release, files } = await makeRelease("2026.10.17");
    const sumsUrl = "https://downloads.example/SHA256SUMS.txt";
    files.set(sumsUrl, Buffer.from(`${"0".repeat(64)}  kolo-2026.10.17-linux-x64.tar.gz\n`));
    const audits: AuditInput[] = [];
    await expect(
      runBundleUpdate({
        bundle,
        manifest,
        currentVersion: "2026.10.16",
        channel: "stable",
        apiBase: "https://api.example",
        repo: "x/y",
        fetchImpl: fakeFetch({ release, files }),
        platform: "linux",
        env: {},
        audit: (i) => audits.push(i),
      }),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "lib", "package.json"), "utf8")).version,
    ).toBe("2026.10.16");
    expect(fs.existsSync(path.join(root, ".previous"))).toBe(false);
    expect(fs.readdirSync(path.join(root, ".update", "download"))).toEqual(["SHA256SUMS.txt"]);
    const refused = audits.find((a) => a.action === "update.refused");
    expect(refused?.outcome).toBe("denied");
    expect((refused?.detail as { reason?: string } | undefined)?.reason).toBe("checksum_mismatch");
  });

  it("refuses a release without SHA256SUMS.txt", async () => {
    const { bundle, manifest } = installedBundle("2026.10.16");
    const { release, files } = await makeRelease("2026.10.17");
    release.assets = release.assets.filter((a) => a.name !== "SHA256SUMS.txt");
    const audits: AuditInput[] = [];
    await expect(
      runBundleUpdate({
        bundle,
        manifest,
        currentVersion: "2026.10.16",
        channel: "stable",
        apiBase: "https://api.example",
        repo: "x/y",
        fetchImpl: fakeFetch({ release, files }),
        platform: "linux",
        env: {},
        audit: (i) => audits.push(i),
      }),
    ).rejects.toThrow(/refusing/);
    expect(audits.some((a) => a.action === "update.refused")).toBe(true);
  });

  it("refuses a bundle whose own SHA256SUMS do not match", async () => {
    const { root, bundle, manifest } = installedBundle("2026.10.16");
    // Build a release whose archive is internally tampered (sums written before the edit).
    const work = tmpDir();
    const dirName = "kolo-2026.10.17-linux-x64";
    makeBundle(path.join(work, dirName), "2026.10.17");
    fs.writeFileSync(
      path.join(work, dirName, "lib", "package.json"),
      JSON.stringify({ version: "2026.10.17", evil: true }),
    );
    const archivePath = path.join(work, `${dirName}.tar.gz`);
    await tar.c({ gzip: true, file: archivePath, cwd: work, portable: true }, [dirName]);
    const archive = fs.readFileSync(archivePath);
    const sha = createHash("sha256").update(archive).digest("hex");
    const release: GitHubRelease = {
      tag_name: "v2026.10.17",
      assets: [
        { name: `${dirName}.tar.gz`, browser_download_url: "https://d.example/a.tar.gz" },
        { name: "SHA256SUMS.txt", browser_download_url: "https://d.example/sums" },
      ],
    };
    const files = new Map<string, Buffer>([
      ["https://d.example/a.tar.gz", archive],
      ["https://d.example/sums", Buffer.from(`${sha}  ${dirName}.tar.gz\n`)],
    ]);
    await expect(
      runBundleUpdate({
        bundle,
        manifest,
        currentVersion: "2026.10.16",
        channel: "stable",
        apiBase: "https://api.example",
        repo: "x/y",
        fetchImpl: fakeFetch({ release, files }),
        platform: "linux",
        env: {},
        audit: () => {},
      }),
    ).rejects.toThrow(/fails its SHA256SUMS/);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "lib", "package.json"), "utf8")).version,
    ).toBe("2026.10.16");
  });

  it("stages on Windows and writes the apply script for the launcher", async () => {
    const { root, bundle, manifest } = installedBundle("2026.10.16");
    const { release, files } = await makeRelease("2026.10.17");
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: "2026.10.16",
      channel: "nightly",
      apiBase: "https://api.example",
      repo: "x/y",
      fetchImpl: fakeFetch({ release, files }),
      platform: "win32",
      env: {},
      audit: () => {},
    });
    expect(out.performed).toBe(true);
    expect(out.apply?.mode).toBe("staged");
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "lib", "package.json"), "utf8")).version,
    ).toBe("2026.10.16");
    const pending = JSON.parse(fs.readFileSync(path.join(root, ".update", "pending.json"), "utf8"));
    expect(pending.version).toBe("2026.10.17");
    expect(fs.existsSync(path.join(root, ".update", "staged", "bundle-manifest.json"))).toBe(true);
    const script = fs.readFileSync(path.join(root, ".update", "apply.cmd"), "utf8");
    expect(script).toBe(renderWindowsApplyScript());
    expect(script).toContain('move "%ROOT%\\lib" "%ROOT%\\.previous\\lib"');
    expect(script).toContain('move "%STAGED%\\node" "%ROOT%\\node"');
    expect(script).toContain("kolo.cmd.new");
    expect(script).not.toContain('move "%ROOT%\\bin"');
    expect(script).toContain(":locked");
  });
});
