/**
 * Service install from a prebuilt bundle (M8): the service must run on the bundled Node, and
 * the macOS LaunchAgent plist must carry that path. launchctl is a fake on PATH (as in
 * launchd.test.ts), so this runs on every OS.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBundleInfo } from "../infra/bundle.js";
import { installLaunchAgent, resolveLaunchAgentPlistPath } from "./launchd.js";
import { resolvePreferredNodePath } from "./runtime-paths.js";

const tmpDirs: string[] = [];
async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-bundle-service-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of tmpDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function fakeBundle(): Promise<string> {
  const root = path.join(await tmpDir(), "kolo-2026.10.16-darwin-arm64");
  await fs.mkdir(path.join(root, "lib", "dist"), { recursive: true });
  await fs.mkdir(path.join(root, "node", "bin"), { recursive: true });
  await fs.writeFile(
    path.join(root, "lib", "package.json"),
    '{"name":"kolo","version":"2026.10.16"}',
  );
  await fs.writeFile(
    path.join(root, "bundle-manifest.json"),
    JSON.stringify({
      schema: 1,
      name: "kolo",
      version: "2026.10.16",
      os: "darwin",
      arch: "arm64",
      node: { version: "22.18.0" },
    }),
  );
  await fs.writeFile(path.join(root, "node", "bin", "node"), "fake");
  return root;
}

describe("bundle detection", () => {
  it("detects a bundle from KOLO_BUNDLE_ROOT and from the module location", async () => {
    const root = await fakeBundle();
    expect(resolveBundleInfo({ KOLO_BUNDLE_ROOT: root }, "file:///elsewhere/x.js")).toEqual({
      root,
      libDir: path.join(root, "lib"),
    });
    const moduleUrl = `file://${path.join(root, "lib", "dist", "infra", "bundle.js")}`;
    expect(resolveBundleInfo({}, moduleUrl)?.root).toBe(root);
    expect(
      resolveBundleInfo({ KOLO_BUNDLE_ROOT: path.join(root, "missing") }, "file:///elsewhere/x.js"),
    ).toBeNull();
    expect(resolveBundleInfo({}, "file:///elsewhere/x.js")).toBeNull();
  });
});

describe("service node path in a bundle", () => {
  it("prefers the running (bundled) runtime over a system Node", async () => {
    const root = await fakeBundle();
    const preferred = await resolvePreferredNodePath({
      env: { KOLO_BUNDLE_ROOT: root, PATH: "/usr/local/bin:/usr/bin" },
      runtime: "node",
      platform: "darwin",
    });
    expect(preferred).toBe(process.execPath);
  });

  it("ignores the bundle rule for non-node runtimes", async () => {
    const root = await fakeBundle();
    const preferred = await resolvePreferredNodePath({
      env: { KOLO_BUNDLE_ROOT: root },
      runtime: "bun",
      platform: "darwin",
    });
    expect(preferred).toBeUndefined();
  });
});

describe("macOS LaunchAgent from a bundle (fake launchctl)", () => {
  it("writes the plist at ~/Library/LaunchAgents with the bundled node and bootstraps it", async () => {
    const root = await fakeBundle();
    const tmp = await tmpDir();
    const binDir = path.join(tmp, "bin");
    const home = path.join(tmp, "home");
    const logPath = path.join(tmp, "launchctl.log");
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    const stubJs = path.join(binDir, "launchctl.js");
    await fs.writeFile(
      stubJs,
      [
        'import fs from "node:fs";',
        "const args = process.argv.slice(2);",
        'fs.appendFileSync(process.env.KOLO_TEST_LAUNCHCTL_LOG, JSON.stringify(args) + "\\n");',
        "process.exit(0);",
        "",
      ].join("\n"),
    );
    if (process.platform === "win32") {
      await fs.writeFile(
        path.join(binDir, "launchctl.cmd"),
        `@echo off\r\nnode "%~dp0\\launchctl.js" %*\r\n`,
      );
    } else {
      const sh = path.join(binDir, "launchctl");
      await fs.writeFile(sh, `#!/bin/sh\nexec node "$(dirname "$0")/launchctl.js" "$@"\n`);
      await fs.chmod(sh, 0o755);
    }
    const originalPath = process.env.PATH;
    const originalLog = process.env.KOLO_TEST_LAUNCHCTL_LOG;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    process.env.KOLO_TEST_LAUNCHCTL_LOG = logPath;
    try {
      const env = { HOME: home, KOLO_PROFILE: "default", KOLO_BUNDLE_ROOT: root };
      const nodePath = path.join(root, "node", "bin", "node");
      const entry = path.join(root, "lib", "dist", "entry.js");
      const stdout = new PassThrough();
      stdout.resume();
      const { plistPath } = await installLaunchAgent({
        env,
        stdout,
        programArguments: [nodePath, entry, "gateway", "--port", "18789"],
        workingDirectory: path.join(root, "lib"),
        environment: {
          KOLO_HOME: path.join(home, ".kolo"),
          KOLO_BUNDLE_ROOT: root,
          KOLO_SERVICE_VERSION: "2026.10.16",
        },
      });
      expect(plistPath).toBe(resolveLaunchAgentPlistPath(env));
      expect(path.normalize(plistPath)).toBe(
        path.join(home, "Library", "LaunchAgents", "ai.kolo.gateway.plist"),
      );
      const plist = await fs.readFile(plistPath, "utf8");
      expect(plist).toContain(`<string>${nodePath}</string>`);
      expect(plist).toContain(`<string>${entry}</string>`);
      expect(plist).toContain("<key>RunAtLoad</key>");
      expect(plist).toContain("<key>KeepAlive</key>");
      expect(plist).toContain("KOLO_BUNDLE_ROOT");
      const calls = (await fs.readFile(logPath, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      const domain = typeof process.getuid === "function" ? `gui/${process.getuid()}` : "gui/501";
      expect(calls).toContainEqual(["bootstrap", domain, plistPath]);
      expect(calls).toContainEqual(["kickstart", "-k", `${domain}/ai.kolo.gateway`]);
    } finally {
      process.env.PATH = originalPath;
      if (originalLog === undefined) {
        delete process.env.KOLO_TEST_LAUNCHCTL_LOG;
      } else {
        process.env.KOLO_TEST_LAUNCHCTL_LOG = originalLog;
      }
    }
  });
});
