import { describe, expect, it } from "vitest";
import { compareKoLoVersions } from "./version.js";

describe("compareKoLoVersions", () => {
  it("orders product versions and revisions", () => {
    expect(compareKoLoVersions("2.0.0", "2.0.1")).toBe(-1);
    expect(compareKoLoVersions("2.0.0-2", "2.0.0-1")).toBe(1);
    expect(compareKoLoVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("treats calendar versions as older than product versions", () => {
    expect(compareKoLoVersions("2.0.0", "2026.2.1-kolo.1")).toBe(1);
    expect(compareKoLoVersions("2026.2.1-kolo.1", "2.0.0")).toBe(-1);
  });

  it("orders calendar versions among themselves", () => {
    expect(compareKoLoVersions("2026.2.1", "2026.10.16")).toBe(-1);
  });

  it("returns null when either side does not parse", () => {
    expect(compareKoLoVersions("x", "2.0.0")).toBeNull();
  });
});
