import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import { auditSafe } from "../../audit/audit-log.js";
import { resolveChannelIdentity } from "./identity.js";
import { ChannelOutboundQueue, resetOutboundQueueForTest } from "./outbound-queue.js";
import {
  bindChannelOwner,
  claimOwnerCode,
  extractOwnerCode,
  generateOwnerCode,
  handleOwnerClaimMessage,
  issueOwnerCode,
  listLiveOwnerCodes,
  listOwnerBindings,
  OWNER_CODE_TTL_MS,
  takeOwnerWelcome,
  unbindChannelOwner,
  type OwnerBindingDeps,
} from "./owner-binding.js";
import { ownerClaimHook } from "./owner-claim-hook.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

let home = "";
let env: NodeJS.ProcessEnv;
let cfg: KoLoConfig;
let allow: Map<string, Set<string>>;
let clock = 1_800_000_000_000;
let deps: OwnerBindingDeps;
const prevEnv = { ...process.env };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-owner-"));
  env = { KOLO_HOME: home, KOLO_STATE_DIR: home };
  process.env.KOLO_HOME = home;
  process.env.KOLO_STATE_DIR = home;
  cfg = { channels: { telegram: { botToken: "x", dmPolicy: "pairing" } } } as KoLoConfig;
  allow = new Map();
  clock = 1_800_000_000_000;
  deps = {
    env,
    now: () => clock,
    readConfig: async () => structuredClone(cfg),
    writeConfig: async (next) => {
      cfg = structuredClone(next);
    },
    addAllowFrom: async (channel, entry) => {
      const set = allow.get(channel) ?? new Set<string>();
      const had = set.has(entry);
      set.add(entry);
      allow.set(channel, set);
      return !had;
    },
    removeAllowFrom: async (channel, entry) => {
      allow.get(channel)?.delete(entry);
    },
  };
  vi.mocked(auditSafe).mockClear();
  resetOutboundQueueForTest(new ChannelOutboundQueue({ env, sleep: async () => {} }));
});

afterEach(() => {
  process.env = { ...prevEnv };
  resetOutboundQueueForTest(null);
  fs.rmSync(home, { recursive: true, force: true });
});

function audited(action: string) {
  return vi.mocked(auditSafe).mock.calls.filter(([entry]) => entry.action === action);
}

describe("owner codes (M16)", () => {
  test("format: KOLO- plus eight unambiguous characters; found inside /start and free text", () => {
    const code = generateOwnerCode();
    expect(code).toMatch(/^KOLO-[A-HJ-NP-Z2-9]{8}$/);
    expect(extractOwnerCode(`/start ${code}`)).toBe(code);
    expect(extractOwnerCode(`my code is ${code.toLowerCase()}.`)).toBe(code);
    expect(extractOwnerCode("hello there")).toBe(null);
    expect(extractOwnerCode("KOLO-ABC")).toBe(null);
  });

  test("one use, ten minutes, bound to its channel; only the hash is stored", () => {
    const { code, expiresAt } = issueOwnerCode({ channel: "telegram", env, now: () => clock });
    expect(expiresAt - clock).toBe(OWNER_CODE_TTL_MS);
    const raw = fs.readFileSync(path.join(home, "channels", "owner-codes.json"), "utf8");
    expect(raw).not.toContain(code);
    expect(
      (fs.statSync(path.join(home, "channels", "owner-codes.json")).mode & 0o777).toString(8),
    ).toBe("600");

    const wrongChannel = claimOwnerCode({ channel: "line", text: code, senderId: "u1", env });
    expect(wrongChannel).toEqual({ ok: false, reason: "invalid" });
    const first = claimOwnerCode({
      channel: "telegram",
      text: `/start ${code}`,
      senderId: "42",
      env,
      now: () => clock,
    });
    expect(first.ok).toBe(true);
    const again = claimOwnerCode({
      channel: "telegram",
      text: code,
      senderId: "43",
      env,
      now: () => clock,
    });
    expect(again).toEqual({ ok: false, reason: "used" });
  });

  test("an expired code is refused; a new code withdraws the previous one", () => {
    const old = issueOwnerCode({ channel: "telegram", env, now: () => clock });
    const fresh = issueOwnerCode({ channel: "telegram", env, now: () => clock });
    expect(
      claimOwnerCode({ channel: "telegram", text: old.code, senderId: "1", env, now: () => clock }),
    ).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(listLiveOwnerCodes("telegram", { env, now: () => clock })).toHaveLength(1);
    const late = () => clock + OWNER_CODE_TTL_MS + 1;
    expect(
      claimOwnerCode({ channel: "telegram", text: fresh.code, senderId: "1", env, now: late }),
    ).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});

describe("owner binding (M16)", () => {
  test("the first message with the code binds its sender as owner, audited", async () => {
    const { code } = issueOwnerCode({ channel: "telegram", env, now: () => clock });
    const result = await handleOwnerClaimMessage(
      { channel: "telegram", senderId: "4242", text: `/start ${code}` },
      deps,
    );
    expect(result).toEqual({ bound: true, reply: expect.stringContaining("owner") });
    expect(cfg.channels?.telegram?.identities).toEqual({ "4242": "owner" });
    expect(allow.get("telegram")?.has("4242")).toBe(true);
    expect(resolveChannelIdentity({ cfg, channel: "telegram", candidates: ["4242"] })?.role).toBe(
      "owner",
    );
    expect(audited("channel.owner_bound")).toHaveLength(1);
    expect(audited("channel.owner_bound")[0][0]).toMatchObject({
      identity: "4242",
      detail: { channel: "telegram", via: "code" },
    });
    // The same code a second time is answered, not bound again.
    const replay = await handleOwnerClaimMessage(
      { channel: "telegram", senderId: "999", text: `/start ${code}` },
      deps,
    );
    expect(replay?.bound).toBe(false);
    expect(cfg.channels?.telegram?.identities).toEqual({ "4242": "owner" });
  });

  test("unrelated text and unknown codes fall through to the normal pipeline", async () => {
    issueOwnerCode({ channel: "telegram", env, now: () => clock });
    expect(
      await handleOwnerClaimMessage({ channel: "telegram", senderId: "1", text: "hi" }, deps),
    ).toBe(null);
    expect(
      await handleOwnerClaimMessage(
        { channel: "telegram", senderId: "1", text: "KOLO-ABCDEFGH" },
        deps,
      ),
    ).toBe(null);
  });

  test("per-account binding writes accounts.<id>.identities", async () => {
    const binding = await bindChannelOwner(
      { channel: "line", accountId: "shop", senderId: "Uabc", via: "code" },
      deps,
    );
    expect(binding.accountId).toBe("shop");
    expect(
      (cfg.channels as Record<string, { accounts?: Record<string, { identities?: unknown }> }>).line
        ?.accounts?.shop?.identities,
    ).toEqual({ uabc: "owner" });
  });

  test("unbind removes exactly what the binding added and withdraws live codes", async () => {
    cfg = {
      channels: { telegram: { identities: { "77": "admin" } } },
    } as unknown as KoLoConfig;
    allow.set("telegram", new Set(["55"]));
    await bindChannelOwner({ channel: "telegram", senderId: "4242", via: "code" }, deps);
    issueOwnerCode({ channel: "telegram", env, now: () => clock });
    const res = await unbindChannelOwner({ channel: "telegram" }, deps);
    expect(res.removed.map((o) => o.senderId)).toEqual(["4242"]);
    expect(res.codesWithdrawn).toBe(1);
    expect(cfg.channels?.telegram?.identities).toEqual({ "77": "admin" });
    expect([...(allow.get("telegram") ?? [])]).toEqual(["55"]);
    expect(listOwnerBindings({ env })).toEqual([]);
    expect(audited("channel.owner_unbound")[0][0]).toMatchObject({
      detail: { channel: "telegram", owners: ["4242"], codesWithdrawn: 1 },
    });
  });

  test("a linked-device binding owes exactly one welcome on the owner's first message", async () => {
    await bindChannelOwner(
      {
        channel: "whatsapp",
        senderId: "+15555550100",
        via: "linked-device",
        welcomePending: true,
        skipAllowFrom: true,
      },
      deps,
    );
    expect(allow.get("whatsapp")).toBeUndefined();
    expect(takeOwnerWelcome({ channel: "whatsapp", candidates: ["+15555550199"], env })).toBe(
      false,
    );
    expect(
      takeOwnerWelcome({ channel: "whatsapp", candidates: [undefined, "+15555550100"], env }),
    ).toBe(true);
    expect(takeOwnerWelcome({ channel: "whatsapp", candidates: ["+15555550100"], env })).toBe(
      false,
    );
  });
});

describe("channel hook: claim answered through the outbound queue as a reply", () => {
  test("telegram-style fake adapter: /start with the code binds and replies once", async () => {
    const { code } = issueOwnerCode({ channel: "telegram", env, now: () => clock });
    const sent: Array<{ to: string; text: string }> = [];
    const handled = await ownerClaimHook(
      {
        cfg,
        channel: "telegram",
        senderId: "4242",
        text: `/start ${code}`,
        to: "4242",
        send: async (text) => {
          sent.push({ to: "4242", text });
        },
      },
      deps,
    );
    expect(handled).toBe(true);
    expect(sent).toHaveLength(1);
    expect(cfg.channels?.telegram?.identities).toEqual({ "4242": "owner" });
    // An ordinary message is not touched.
    expect(
      await ownerClaimHook(
        {
          cfg,
          channel: "telegram",
          senderId: "4242",
          text: "hello",
          to: "4242",
          send: async () => {},
        },
        deps,
      ),
    ).toBe(false);
  });

  test("the reply goes out even under replies-only, because it answers the claim", async () => {
    resetOutboundQueueForTest(
      new ChannelOutboundQueue({ env, sleep: async () => {}, limits: { policy: "replies-only" } }),
    );
    const { code } = issueOwnerCode({ channel: "line", env, now: () => clock });
    const sent: string[] = [];
    await ownerClaimHook(
      {
        cfg,
        channel: "line",
        senderId: "Uowner",
        text: code,
        to: "line:Uowner",
        send: async (text) => {
          sent.push(text);
        },
      },
      deps,
    );
    expect(sent).toHaveLength(1);
  });
});
