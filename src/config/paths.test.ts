import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultKoloHome } from "./kolo-home.js";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers KOLO_OAUTH_DIR over KOLO_STATE_DIR", () => {
    const env = {
      KOLO_OAUTH_DIR: "/custom/oauth",
      KOLO_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from KOLO_STATE_DIR when unset", () => {
    const env = {
      KOLO_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses KOLO_STATE_DIR when set", () => {
    const env = {
      KOLO_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("keeps config candidates inside an explicit KOLO_HOME", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates(
      { KOLO_HOME: "/isolated/home" } as NodeJS.ProcessEnv,
      () => home,
    );
    expect(candidates[0]).toBe(path.resolve("/isolated/home", "kolo.json"));
    expect(candidates.some((c) => c.startsWith(path.join(home, ".kolo")))).toBe(false);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    // The per-OS default root comes first (~/.kolo, or <home>/AppData/Local/KoLo on Windows
    // when the given env has no LOCALAPPDATA), then the legacy dirs.
    const defaultDir = defaultKoloHome({ env: {} as NodeJS.ProcessEnv, homedir: () => home });
    const expected = [
      path.join(defaultDir, "kolo.json"),
      path.join(defaultDir, "clawdbot.json"),
      path.join(defaultDir, "moltbot.json"),
      path.join(defaultDir, "moldbot.json"),
      path.join(home, ".clawdbot", "kolo.json"),
      path.join(home, ".clawdbot", "clawdbot.json"),
      path.join(home, ".clawdbot", "moltbot.json"),
      path.join(home, ".clawdbot", "moldbot.json"),
      path.join(home, ".moltbot", "kolo.json"),
      path.join(home, ".moltbot", "clawdbot.json"),
      path.join(home, ".moltbot", "moltbot.json"),
      path.join(home, ".moltbot", "moldbot.json"),
      path.join(home, ".moldbot", "kolo.json"),
      path.join(home, ".moldbot", "clawdbot.json"),
      path.join(home, ".moldbot", "moltbot.json"),
      path.join(home, ".moldbot", "moldbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.kolo when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-state-"));
    try {
      const newDir = path.join(root, ".kolo");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-config-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousHomeDrive = process.env.HOMEDRIVE;
    const previousHomePath = process.env.HOMEPATH;
    const previousLocalAppData = process.env.LOCALAPPDATA;
    const previousKoLoConfig = process.env.KOLO_CONFIG_PATH;
    const previousKoLoState = process.env.KOLO_STATE_DIR;
    try {
      const legacyDir = path.join(root, ".kolo");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "kolo.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      process.env.HOME = root;
      if (process.platform === "win32") {
        process.env.USERPROFILE = root;
        const parsed = path.win32.parse(root);
        process.env.HOMEDRIVE = parsed.root.replace(/\\$/, "");
        process.env.HOMEPATH = root.slice(parsed.root.length - 1);
        // The per-OS default root is %LOCALAPPDATA%\KoLo; keep it under the temp root so the
        // legacy ~/.kolo/kolo.json written above is the only existing config.
        process.env.LOCALAPPDATA = path.join(root, "AppData", "Local");
      }
      delete process.env.KOLO_CONFIG_PATH;
      delete process.env.KOLO_STATE_DIR;

      vi.resetModules();
      const { CONFIG_PATH } = await import("./paths.js");
      expect(CONFIG_PATH).toBe(legacyPath);
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      if (previousUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = previousUserProfile;
      }
      if (previousHomeDrive === undefined) {
        delete process.env.HOMEDRIVE;
      } else {
        process.env.HOMEDRIVE = previousHomeDrive;
      }
      if (previousHomePath === undefined) {
        delete process.env.HOMEPATH;
      } else {
        process.env.HOMEPATH = previousHomePath;
      }
      if (previousLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previousLocalAppData;
      }
      if (previousKoLoConfig === undefined) {
        delete process.env.KOLO_CONFIG_PATH;
      } else {
        process.env.KOLO_CONFIG_PATH = previousKoLoConfig;
      }
      if (previousKoLoConfig === undefined) {
        delete process.env.KOLO_CONFIG_PATH;
      } else {
        process.env.KOLO_CONFIG_PATH = previousKoLoConfig;
      }
      if (previousKoLoState === undefined) {
        delete process.env.KOLO_STATE_DIR;
      } else {
        process.env.KOLO_STATE_DIR = previousKoLoState;
      }
      if (previousKoLoState === undefined) {
        delete process.env.KOLO_STATE_DIR;
      } else {
        process.env.KOLO_STATE_DIR = previousKoLoState;
      }
      await fs.rm(root, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-config-override-"));
    try {
      const legacyDir = path.join(root, ".kolo");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "kolo.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { KOLO_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "kolo.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
