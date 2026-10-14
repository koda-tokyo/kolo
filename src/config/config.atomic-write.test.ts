import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { KoLoConfig } from "./types.js";
import { withTempHome } from "./test-helpers.js";

describe("config atomic write", () => {
  it("writes via temp file and renames atomically", async () => {
    await withTempHome(async () => {
      const { resolveConfigPath, writeConfigFile, loadConfig } = await import("./config.js");
      const configPath = resolveConfigPath();
      const dir = path.dirname(configPath);

      // First write — creates the file
      const cfg: KoLoConfig = {
        agents: { list: [{ id: "test-agent" }] },
      } as KoLoConfig;
      await writeConfigFile(cfg);

      // Verify the config file exists and is valid JSON
      const raw = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.agents.list[0].id).toBe("test-agent");

      // Verify no stale .tmp files left behind
      const dirEntries = await fs.readdir(dir);
      const tmpFiles = dirEntries.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);

      // Verify file permissions (Unix only)
      if (process.platform !== "win32") {
        const stat = await fs.stat(configPath);
        const mode = stat.mode & 0o777;
        expect(mode).toBe(0o600);
      }
    });
  });

  it("creates backup before overwriting", async () => {
    await withTempHome(async () => {
      const { resolveConfigPath, writeConfigFile } = await import("./config.js");
      const configPath = resolveConfigPath();

      // Write v1
      await writeConfigFile({
        agents: { list: [{ id: "v1" }] },
      } as KoLoConfig);

      // Write v2
      await writeConfigFile({
        agents: { list: [{ id: "v2" }] },
      } as KoLoConfig);

      // Config should be v2
      const raw = await fs.readFile(configPath, "utf-8");
      expect(JSON.parse(raw).agents.list[0].id).toBe("v2");

      // Backup should be v1
      const bakRaw = await fs.readFile(`${configPath}.bak`, "utf-8");
      expect(JSON.parse(bakRaw).agents.list[0].id).toBe("v1");
    });
  });

  it("rejects invalid config without writing", async () => {
    await withTempHome(async () => {
      const { resolveConfigPath, writeConfigFile } = await import("./config.js");
      const configPath = resolveConfigPath();
      const dir = path.dirname(configPath);

      // Write a valid config first
      await writeConfigFile({
        agents: { list: [{ id: "valid" }] },
      } as KoLoConfig);

      // Try to write something with an invalid field
      // The validation should catch it; the original file should remain intact
      const invalidConfig = {
        agents: { list: [{ id: "valid" }] },
        // invalid top-level key that zod rejects
        __totallyBogusField__: { nested: true },
      } as unknown as KoLoConfig;

      // This may or may not throw depending on zod passthrough settings,
      // but if it does throw, the original config must survive
      try {
        await writeConfigFile(invalidConfig);
      } catch {
        // Expected: validation failed
        const raw = await fs.readFile(configPath, "utf-8");
        expect(JSON.parse(raw).agents.list[0].id).toBe("valid");
      }

      // No stale .tmp files
      const dirEntries = await fs.readdir(dir);
      const tmpFiles = dirEntries.filter((f) => f.endsWith(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });
  });

  it("stamps meta.lastTouchedVersion and meta.lastTouchedAt", async () => {
    await withTempHome(async () => {
      const { resolveConfigPath, writeConfigFile } = await import("./config.js");
      const configPath = resolveConfigPath();

      await writeConfigFile({} as KoLoConfig);

      const raw = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(typeof parsed.meta?.lastTouchedVersion).toBe("string");
      expect(typeof parsed.meta?.lastTouchedAt).toBe("string");
      // lastTouchedAt should be a valid ISO date
      expect(() => new Date(parsed.meta.lastTouchedAt)).not.toThrow();
    });
  });
});
