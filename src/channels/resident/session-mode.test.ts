import { describe, expect, test } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";
import { dmScopeForSessionMode, resolveChannelSessionMode } from "./session-mode.js";

const base = (): KoLoConfig =>
  ({ agents: { list: [{ id: "alice", default: true }] } }) as unknown as KoLoConfig;

describe("channel session mode (M14a)", () => {
  test("absent key keeps the legacy dmScope rules", () => {
    expect(resolveChannelSessionMode(base(), "line")).toBeNull();
    expect(dmScopeForSessionMode(null, undefined)).toBe("main");
    expect(dmScopeForSessionMode(null, "per-peer")).toBe("per-peer");
    const route = resolveAgentRoute({
      cfg: base(),
      channel: "line",
      peer: { kind: "dm", id: "U1" },
    });
    expect(route.sessionKey).toBe("agent:alice:main");
  });

  test("per-conversation isolates DMs per channel peer and groups per group", () => {
    const cfg = { ...base(), channels: { sessionMode: "per-conversation" } } as KoLoConfig;
    const dm = resolveAgentRoute({ cfg, channel: "line", peer: { kind: "dm", id: "U1" } });
    expect(dm.sessionKey).toBe("agent:alice:line:dm:u1");
    const other = resolveAgentRoute({ cfg, channel: "slack", peer: { kind: "dm", id: "U1" } });
    expect(other.sessionKey).not.toBe(dm.sessionKey);
    const group = resolveAgentRoute({
      cfg,
      channel: "line",
      peer: { kind: "group", id: "G9" },
    });
    expect(group.sessionKey).toBe("agent:alice:line:group:g9");
    expect(dmScopeForSessionMode("per-conversation", "per-account-channel-peer")).toBe(
      "per-account-channel-peer",
    );
  });

  test("shared sends every conversation to the main session", () => {
    const cfg = { ...base(), channels: { sessionMode: "shared" } } as KoLoConfig;
    const dm = resolveAgentRoute({ cfg, channel: "line", peer: { kind: "dm", id: "U1" } });
    const group = resolveAgentRoute({ cfg, channel: "slack", peer: { kind: "group", id: "C2" } });
    expect(dm.sessionKey).toBe("agent:alice:main");
    expect(group.sessionKey).toBe("agent:alice:main");
    expect(dm.mainSessionKey).toBe("agent:alice:main");
  });

  test("a webhook account overrides the global mode", () => {
    const cfg = {
      ...base(),
      channels: {
        sessionMode: "shared",
        webhook: { accounts: { ops: { sessionMode: "per-conversation" } } },
      },
    } as unknown as KoLoConfig;
    expect(resolveChannelSessionMode(cfg, "webhook", "ops")).toBe("per-conversation");
    expect(resolveChannelSessionMode(cfg, "webhook", "default")).toBe("shared");
    expect(resolveChannelSessionMode(cfg, "line")).toBe("shared");
  });
});
