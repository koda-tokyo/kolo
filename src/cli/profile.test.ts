import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultKoloHome } from "../config/kolo-home.js";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs(["node", "KoLo", "gateway", "--dev", "--allow-unconfigured"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "KoLo", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "KoLo", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "KoLo", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "KoLo", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "KoLo", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "KoLo", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "KoLo", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "KoLo", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    // Per-OS default root plus the profile suffix (~/.kolo-dev, %LOCALAPPDATA%\KoLo-dev).
    const expectedStateDir = `${defaultKoloHome({ env: {}, homedir: () => "/home/peter" })}-dev`;
    expect(env.KOLO_PROFILE).toBe("dev");
    expect(env.KOLO_STATE_DIR).toBe(expectedStateDir);
    expect(env.KOLO_CONFIG_PATH).toBe(path.join(expectedStateDir, "kolo.json"));
    expect(env.KOLO_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      KOLO_STATE_DIR: "/custom",
      KOLO_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.KOLO_STATE_DIR).toBe("/custom");
    expect(env.KOLO_GATEWAY_PORT).toBe("19099");
    expect(env.KOLO_CONFIG_PATH).toBe(path.join("/custom", "kolo.json"));
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("kurahi doctor --fix", {})).toBe("kurahi doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("kurahi doctor --fix", { KOLO_PROFILE: "default" })).toBe(
      "kurahi doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("kurahi doctor --fix", { KOLO_PROFILE: "Default" })).toBe(
      "kurahi doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("kurahi doctor --fix", { KOLO_PROFILE: "bad profile" })).toBe(
      "kurahi doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(formatCliCommand("kurahi --profile work doctor --fix", { KOLO_PROFILE: "work" })).toBe(
      "kurahi --profile work doctor --fix",
    );
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("kurahi --dev doctor", { KOLO_PROFILE: "dev" })).toBe(
      "kurahi --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("kurahi doctor --fix", { KOLO_PROFILE: "work" })).toBe(
      "kurahi --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("kurahi doctor --fix", { KOLO_PROFILE: "  jbKoLo  " })).toBe(
      "kurahi --profile jbKoLo doctor --fix",
    );
  });

  it("handles command with no args after KoLo", () => {
    expect(formatCliCommand("KoLo", { KOLO_PROFILE: "test" })).toBe("kurahi --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm kurahi doctor", { KOLO_PROFILE: "work" })).toBe(
      "pnpm kurahi --profile work doctor",
    );
  });
});
