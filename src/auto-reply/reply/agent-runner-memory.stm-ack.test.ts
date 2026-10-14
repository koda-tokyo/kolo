import { describe, expect, it } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import { resolveStmWriteAckEnabled } from "./agent-runner-memory.js";

const cfgWith = (stmWriteAck?: { enabled?: boolean; skipSessionKeys?: string[] }) =>
  ({ agents: { defaults: { stmWriteAck } } }) as unknown as KoLoConfig;

describe("post-turn STM acknowledgement gate", () => {
  it("runs by default", () => {
    expect(resolveStmWriteAckEnabled(cfgWith(undefined), "agent:orion:owner")).toBe(true);
    expect(resolveStmWriteAckEnabled({} as KoLoConfig, "agent:orion:owner")).toBe(true);
  });

  it("can be switched off entirely", () => {
    expect(resolveStmWriteAckEnabled(cfgWith({ enabled: false }), "agent:orion:main")).toBe(false);
  });

  it("skips sessions matching a glob and keeps the others", () => {
    const cfg = cfgWith({ skipSessionKeys: ["agent:*:owner", "agent:orion:tui-canary-*"] });
    expect(resolveStmWriteAckEnabled(cfg, "agent:orion:owner")).toBe(false);
    expect(resolveStmWriteAckEnabled(cfg, "agent:iris:owner")).toBe(false);
    expect(resolveStmWriteAckEnabled(cfg, "agent:orion:tui-canary-x-1")).toBe(false);
    expect(resolveStmWriteAckEnabled(cfg, "agent:orion:main")).toBe(true);
    expect(resolveStmWriteAckEnabled(cfg, undefined)).toBe(true);
  });

  it("treats regex characters in a pattern literally", () => {
    const cfg = cfgWith({ skipSessionKeys: ["agent:orion:a.b"] });
    expect(resolveStmWriteAckEnabled(cfg, "agent:orion:a.b")).toBe(false);
    expect(resolveStmWriteAckEnabled(cfg, "agent:orion:aXb")).toBe(true);
  });
});
