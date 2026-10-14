import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareSemverStrings, resolveNpmChannelTag } from "./update-check.js";

describe("resolveNpmChannelTag", () => {
  let versionByTag: Record<string, string | null>;

  beforeEach(() => {
    versionByTag = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const tag = decodeURIComponent(url.split("/").pop() ?? "");
        const version = versionByTag[tag] ?? null;
        return {
          ok: version != null,
          status: version != null ? 200 : 404,
          json: async () => ({ version }),
        } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to latest when beta is older", async () => {
    versionByTag.beta = "1.0.0-beta.1";
    versionByTag.latest = "1.0.1-1";

    const resolved = await resolveNpmChannelTag({ channel: "beta", timeoutMs: 1000 });

    expect(resolved).toEqual({ tag: "latest", version: "1.0.1-1" });
  });

  it("keeps beta when beta is not older", async () => {
    versionByTag.beta = "1.0.2-beta.1";
    versionByTag.latest = "1.0.1-1";

    const resolved = await resolveNpmChannelTag({ channel: "beta", timeoutMs: 1000 });

    expect(resolved).toEqual({ tag: "beta", version: "1.0.2-beta.1" });
  });
});

describe("compareSemverStrings", () => {
  it("orders semantic versions numerically", () => {
    expect(compareSemverStrings("2.0.0", "2.0.1")).toBe(-1);
    expect(compareSemverStrings("2.1.0", "2.0.9")).toBe(1);
    expect(compareSemverStrings("3.0.0", "3.0.0")).toBe(0);
  });

  it("ranks calendar versions below any product version", () => {
    expect(compareSemverStrings("2026.2.1-kolo.1", "2.0.0")).toBe(-1);
    expect(compareSemverStrings("2.0.0", "2026.2.1-kolo.1")).toBe(1);
    expect(compareSemverStrings("2026.10.17", "3.4.5")).toBe(-1);
  });

  it("still orders calendar versions among themselves", () => {
    expect(compareSemverStrings("2026.2.1", "2026.10.16")).toBe(-1);
    expect(compareSemverStrings("2026.10.17", "2026.10.16")).toBe(1);
  });

  it("returns null for unparseable input", () => {
    expect(compareSemverStrings("nope", "2.0.0")).toBeNull();
    expect(compareSemverStrings(null, "2.0.0")).toBeNull();
  });
});
