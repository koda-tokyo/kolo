import { describe, it, expect } from "vitest";

describe("dist-integrity module", () => {
  it("exists and exports verifyDistIntegrity", async () => {
    const mod = await import("../../src/infra/dist-integrity.js");
    expect(mod.verifyDistIntegrity).toBeDefined();
    expect(typeof mod.verifyDistIntegrity).toBe("function");
  });
});
