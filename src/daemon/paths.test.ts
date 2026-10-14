import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".kolo"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", KOLO_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".kolo-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", KOLO_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".kolo"));
  });

  it("uses KOLO_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", KOLO_STATE_DIR: "/var/lib/KoLo" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/KoLo"));
  });

  it("expands ~ in KOLO_STATE_DIR", () => {
    const env = { HOME: "/Users/test", KOLO_STATE_DIR: "~/kolo-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/kolo-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { KOLO_STATE_DIR: "C:\\State\\KoLo" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\KoLo");
  });
});
