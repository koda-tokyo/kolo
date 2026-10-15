import { describe, expect, it } from "vitest";
import { classifyPortListener } from "./ports-format.js";

describe("classifyPortListener after the Kurahi rename", () => {
  it("recognises the gateway by either command name", () => {
    expect(classifyPortListener({ pid: 1, command: "node (kurahi gateway lock)" }, 18789)).toBe(
      "gateway",
    );
    expect(
      classifyPortListener({ pid: 1, command: "node /opt/kolo/lib/kolo.mjs gateway" }, 18789),
    ).toBe("gateway");
  });
});
