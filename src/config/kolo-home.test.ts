import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultKoloHome,
  koloLogDir,
  koloRunDir,
  koloSecretsDir,
  koloTmpDir,
  resolveKoloHome,
  resolveSharedKoloHome,
  resolveSiblingStateDir,
  resolveSiblingWorkspaceDir,
} from "./kolo-home.js";

const home = () => "/u/alice";
const none = () => false;

describe("resolveKoloHome precedence", () => {
  it("prefers KOLO_HOME over KOLO_STATE_DIR", () => {
    const env = { KOLO_HOME: "/srv/kolo", KOLO_STATE_DIR: "/legacy/state" };
    expect(resolveKoloHome({ env, platform: "linux", homedir: home, exists: none })).toBe(
      "/srv/kolo",
    );
  });

  it("falls back to KOLO_STATE_DIR (legacy alias)", () => {
    const env = { KOLO_STATE_DIR: "/legacy/state" };
    expect(resolveKoloHome({ env, platform: "linux", homedir: home, exists: none })).toBe(
      "/legacy/state",
    );
  });

  it("expands ~ in overrides", () => {
    const env = { KOLO_HOME: "~/.kolo-test" };
    expect(resolveKoloHome({ env, platform: "linux", homedir: home, exists: none })).toBe(
      "/u/alice/.kolo-test",
    );
  });

  it("ignores blank overrides", () => {
    const env = { KOLO_HOME: "  ", KOLO_STATE_DIR: "" };
    expect(resolveKoloHome({ env, platform: "linux", homedir: home, exists: none })).toBe(
      "/u/alice/.kolo",
    );
  });
});

describe("per-OS defaults", () => {
  it("linux → ~/.kolo", () => {
    expect(defaultKoloHome({ env: {}, platform: "linux", homedir: home })).toBe("/u/alice/.kolo");
  });

  it("macOS → ~/.kolo", () => {
    expect(defaultKoloHome({ env: {}, platform: "darwin", homedir: () => "/Users/alice" })).toBe(
      "/Users/alice/.kolo",
    );
  });

  it("windows → %LOCALAPPDATA%\\KoLo", () => {
    const env = { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" };
    expect(defaultKoloHome({ env, platform: "win32", homedir: () => "C:\\Users\\alice" })).toBe(
      "C:\\Users\\alice\\AppData\\Local\\KoLo",
    );
  });

  it("windows without LOCALAPPDATA → <home>\\AppData\\Local\\KoLo", () => {
    expect(defaultKoloHome({ env: {}, platform: "win32", homedir: () => "C:\\Users\\alice" })).toBe(
      "C:\\Users\\alice\\AppData\\Local\\KoLo",
    );
  });

  it("windows keeps an existing legacy ~/.kolo when the new default is absent", () => {
    const legacy = "C:\\Users\\alice\\.kolo";
    const resolved = resolveKoloHome({
      env: { LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
      platform: "win32",
      homedir: () => "C:\\Users\\alice",
      exists: (p) => p === legacy,
    });
    expect(resolved).toBe(legacy);
  });

  it("uses the default when nothing exists yet", () => {
    expect(resolveKoloHome({ env: {}, platform: "linux", homedir: home, exists: none })).toBe(
      "/u/alice/.kolo",
    );
  });
});

describe("derived dirs", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = undefined;
    }
  });

  it("logs/run/tmp live under the root", () => {
    expect(koloLogDir("/r")).toBe(path.join("/r", "logs"));
    expect(koloRunDir("/r")).toBe(path.join("/r", "run"));
    expect(koloTmpDir("/r")).toBe(path.join("/r", "tmp"));
  });

  it("secrets dir is created 0700", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-home-"));
    const dir = koloSecretsDir(tmp);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    }
  });
});

describe("shared root and siblings", () => {
  it("shared root is KOLO_HOME when KOLO_HOME is set (nothing outside the state root)", () => {
    const env = { KOLO_HOME: "/u/alice/.kolo-iris" };
    expect(resolveSharedKoloHome({ env, platform: "linux", homedir: home, exists: none })).toBe(
      "/u/alice/.kolo-iris",
    );
    expect(
      resolveSharedKoloHome({
        env: { KOLO_HOME: "D:\\kolo-ops", LOCALAPPDATA: "C:\\Users\\alice\\AppData\\Local" },
        platform: "win32",
        homedir: () => "C:\\Users\\alice",
        exists: none,
      }),
    ).toBe("D:\\kolo-ops");
  });

  it("shared root is the per-OS default without KOLO_HOME", () => {
    expect(resolveSharedKoloHome({ env: {}, platform: "linux", homedir: home, exists: none })).toBe(
      "/u/alice/.kolo",
    );
  });

  it("KOLO_SHARED_HOME wins", () => {
    const env = { KOLO_SHARED_HOME: "/family", KOLO_HOME: "/x" };
    expect(resolveSharedKoloHome({ env, platform: "linux", homedir: home })).toBe("/family");
  });

  it("sibling workspace: config workspaceDir → stateDir → shared fallback", () => {
    const opts = { env: {}, platform: "linux" as const, homedir: home, exists: none };
    expect(
      resolveSiblingWorkspaceDir("iris", [{ id: "iris", workspaceDir: "/w/iris" }], opts),
    ).toBe("/w/iris");
    expect(resolveSiblingWorkspaceDir("iris", [{ id: "Iris", stateDir: "/s/iris" }], opts)).toBe(
      path.join("/s/iris", "workspace-iris"),
    );
    expect(resolveSiblingWorkspaceDir("iris", undefined, opts)).toBe(
      path.join("/u/alice/.kolo", "workspace-iris"),
    );
  });

  it("sibling state dir: config stateDir, else legacy <home>/../.kolo-<id>", () => {
    const opts = { env: {}, platform: "linux" as const, homedir: home, exists: none };
    expect(resolveSiblingStateDir("orion", [{ id: "orion", stateDir: "/s/orion" }], opts)).toBe(
      "/s/orion",
    );
    expect(resolveSiblingStateDir("orion", [], opts)).toBe("/u/alice/.kolo-orion");
  });
});
