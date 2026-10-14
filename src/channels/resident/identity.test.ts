import { describe, expect, test } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import { hasConfiguredIdentities, resolveChannelIdentity, roleAtLeast } from "./identity.js";

const cfg = {
  channels: {
    line: {
      identities: { U123: "owner", "line:U456": "attach" },
      accounts: { work: { identities: { U789: "admin" } } },
    },
    slack: {},
  },
} as unknown as KoLoConfig;

describe("channel identities (M14a)", () => {
  test("maps sender ids to roles, case-insensitively, with channel prefixes", () => {
    expect(resolveChannelIdentity({ cfg, channel: "line", candidates: ["u123"] })?.role).toBe(
      "owner",
    );
    expect(resolveChannelIdentity({ cfg, channel: "line", candidates: ["U456"] })?.role).toBe(
      "attach",
    );
    expect(resolveChannelIdentity({ cfg, channel: "line", candidates: ["line:U123"] })?.role).toBe(
      "owner",
    );
    expect(
      resolveChannelIdentity({ cfg, channel: "line", accountId: "work", candidates: ["U789"] })
        ?.role,
    ).toBe("admin");
  });

  test("unknown senders get no role when identities are configured, even if the channel authorized them", () => {
    expect(
      resolveChannelIdentity({
        cfg,
        channel: "line",
        candidates: ["U000"],
        commandAuthorized: true,
      }),
    ).toBeNull();
  });

  test("without identities the channel authorization stands in for owner", () => {
    expect(hasConfiguredIdentities(cfg, "slack")).toBe(false);
    expect(
      resolveChannelIdentity({ cfg, channel: "slack", candidates: ["X"], commandAuthorized: true }),
    ).toEqual({ role: "owner", source: "channel" });
    expect(
      resolveChannelIdentity({
        cfg,
        channel: "slack",
        candidates: ["X"],
        commandAuthorized: false,
      }),
    ).toBeNull();
  });

  test("roles are ordered", () => {
    expect(roleAtLeast("owner", "admin")).toBe(true);
    expect(roleAtLeast("attach", "admin")).toBe(false);
    expect(roleAtLeast(null, "attach")).toBe(false);
  });
});
