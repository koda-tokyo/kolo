import { describe, expect, it } from "vitest";
import { INIT_BIND_POLICIES, resolveInitBind } from "./init.js";

describe("kurahi init --bind", () => {
  it("accepts the five policies", () => {
    expect([...INIT_BIND_POLICIES]).toEqual(["loopback", "lan", "tailnet", "custom", "remote"]);
  });

  it("loopback stays loopback without remote serving", () => {
    expect(resolveInitBind("loopback")).toEqual({ bind: "loopback", remote: false });
  });

  it("remote is an alias of lan and enables remote serving", () => {
    expect(resolveInitBind("remote")).toEqual({ bind: "lan", remote: true });
    expect(resolveInitBind("lan")).toEqual({ bind: "lan", remote: true });
  });

  it("tailnet and custom keep their bind mode and enable remote serving", () => {
    expect(resolveInitBind("tailnet")).toEqual({ bind: "tailnet", remote: true });
    expect(resolveInitBind("custom")).toEqual({ bind: "custom", remote: true });
  });
});
