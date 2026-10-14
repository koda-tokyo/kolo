import { describe, expect, it, vi } from "vitest";

const spy = vi.hoisted(() => ({ calls: [] as Array<[number, number]> }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    timingSafeEqual: (a: Buffer, b: Buffer) => {
      spy.calls.push([a.length, b.length]);
      return actual.timingSafeEqual(a, b);
    },
  };
});

const { safeEqualSecret } = await import("./secure-compare.js");

describe("safeEqualSecret", () => {
  it("matches equal secrets and rejects different ones", () => {
    expect(safeEqualSecret("abc", "abc")).toBe(true);
    expect(safeEqualSecret("abc", "abd")).toBe(false);
    expect(safeEqualSecret("abc", "abcd")).toBe(false);
    expect(safeEqualSecret("", "x")).toBe(false);
  });

  it("always runs timingSafeEqual on equal-length (hashed) buffers", () => {
    spy.calls.length = 0;
    safeEqualSecret("short", "a-much-longer-secret-value");
    expect(spy.calls).toEqual([[32, 32]]);
  });
});
