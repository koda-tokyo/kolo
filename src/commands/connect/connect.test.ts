// `kolo connect` end to end against fake channel adapters: no network, no phone, no gateway.
// Each flow is driven the way a person would: secrets typed or piped, the QR printed, then the
// first message from the phone arrives through the same channel hook the gateway runs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import type { SecretStore } from "../../secrets/types.js";
import type { ConnectDeps, Prompter } from "./types.js";
import {
  ChannelOutboundQueue,
  resetOutboundQueueForTest,
} from "../../channels/resident/outbound-queue.js";
import { takeOwnerWelcome } from "../../channels/resident/owner-binding.js";
import { ownerClaimHook } from "../../channels/resident/owner-claim-hook.js";
import { isSecretRef } from "../../secrets/names.js";
import { pickLanIPv4, runConnect, runUnbind } from "./index.js";
import { renderQrText } from "./qr.js";
import { resolvePhoneDashboard } from "./web.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

const BOT_TOKEN = "123456:fake-bot-token-value";
const LINE_SECRET = "fake-line-channel-secret";
const LINE_TOKEN = "fake-line-access-token";

let home = "";
let cfg: KoLoConfig;
let stored: Map<string, string>;
let out: string[];
let errs: string[];
let exitCode: number | null;

function memoryStore(): SecretStore {
  return {
    backend: "file",
    location: "memory",
    get: (n) => stored.get(n),
    set: (n, v) => {
      stored.set(n, v);
    },
    delete: (n) => stored.delete(n),
    list: () => [...stored.keys()].toSorted(),
  };
}

function fakePrompter(secrets: string[]): Prompter {
  return {
    secret: async () => secrets.shift() ?? null,
    confirm: async () => true,
    select: async (_m, _o, initial) => initial ?? null,
  };
}

function makeDeps(over: Partial<ConnectDeps> = {}): ConnectDeps {
  const env = { KOLO_HOME: home, KOLO_STATE_DIR: home } as NodeJS.ProcessEnv;
  return {
    runtime: {
      log: (...a: unknown[]) => out.push(a.join(" ")),
      error: (...a: unknown[]) => errs.push(a.join(" ")),
      exit: (code: number) => {
        exitCode = code;
      },
    } as ConnectDeps["runtime"],
    readConfig: async () => structuredClone(cfg),
    writeConfig: async (next) => {
      cfg = structuredClone(next);
    },
    secrets: memoryStore,
    renderQr: renderQrText,
    env,
    now: Date.now,
    sleep: async () => {},
    probeGateway: async () => true,
    whatsappLink: async () => {
      throw new Error("not used");
    },
    telegramProbe: async (token) =>
      token === BOT_TOKEN
        ? { ok: true, username: "ops_bot" }
        : { ok: false, error: "Unauthorized" },
    lineProbe: async (token) =>
      token === LINE_TOKEN
        ? { ok: true, basicId: "@123abcde", displayName: "ops-bot" }
        : { ok: false, error: "401" },
    createInvitation: async ({ ttlMinutes }) => ({
      code: "kpi_fakeInvitationCode",
      id: "inv_1",
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
    }),
    lanAddress: () => "192.168.1.20",
    tailnetAddress: () => "100.64.0.7",
    ...over,
  };
}

/** The phone side: a first message through the channel hook the gateway runs. */
async function phoneSends(
  deps: ConnectDeps,
  channel: "telegram" | "line",
  senderId: string,
  text: string,
): Promise<string[]> {
  const replies: string[] = [];
  const handled = await ownerClaimHook(
    {
      cfg,
      channel,
      senderId,
      text,
      to: senderId,
      send: async (t) => {
        replies.push(t);
      },
    },
    { env: deps.env, readConfig: deps.readConfig, writeConfig: deps.writeConfig },
  );
  expect(handled).toBe(true);
  return replies;
}

const QR_BLOCKS = /[▀▄█]/;
const allOutput = () => [...out, ...errs].join("\n");

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-connect-"));
  cfg = { gateway: { bind: "loopback" } } as KoLoConfig;
  stored = new Map();
  out = [];
  errs = [];
  exitCode = null;
  resetOutboundQueueForTest(
    new ChannelOutboundQueue({ env: { KOLO_HOME: home }, sleep: async () => {} }),
  );
});

afterEach(() => {
  resetOutboundQueueForTest(null);
  fs.rmSync(home, { recursive: true, force: true });
});

describe("kolo connect telegram", () => {
  test("token to the secrets store, deep-link QR, first /start binds the owner", async () => {
    let deps = makeDeps({ prompter: fakePrompter([BOT_TOKEN]) });
    const result = await runConnect(deps, { channel: "telegram", wait: false });
    expect(result).toMatchObject({ ok: true, channel: "telegram" });
    expect(result.link).toMatch(/^https:\/\/t\.me\/ops_bot\?start=KOLO-[A-HJ-NP-Z2-9]{8}$/);
    expect(stored.get("channel.telegram.botToken")).toBe(BOT_TOKEN);
    expect(isSecretRef(cfg.channels?.telegram?.botToken)).toBe(true);
    expect(cfg.channels?.telegram?.enabled).toBe(true);
    // QR text rendered; the token never reaches the terminal.
    expect(out.join("\n")).toMatch(QR_BLOCKS);
    expect(out.join("\n")).toContain(renderQrText(result.link as string).split("\n")[1]);
    expect(allOutput()).not.toContain(BOT_TOKEN);

    const replies = await phoneSends(deps, "telegram", "4242", `/start ${result.code}`);
    expect(replies[0]).toContain("owner");
    expect(cfg.channels?.telegram?.identities).toEqual({ "4242": "owner" });

    // Interactive runs wait for that first message and report the owner.
    deps = makeDeps({
      prompter: fakePrompter([""]),
      sleep: async () => {
        const code = /start=(KOLO-[A-Z0-9]+)/.exec(out.join("\n").split("link").pop() ?? "")?.[1];
        if (code) {
          await phoneSends(deps, "telegram", "5151", `/start ${code}`);
        }
      },
    });
    out = [];
    const waited = await runConnect(deps, { channel: "telegram" });
    expect(waited.owner).toBe("5151");
    expect(out.join("\n")).toContain("telegram user 5151 bound");
  });

  test("non-interactive without a token is a usage error; a rejected token fails cleanly", async () => {
    const none = await runConnect(makeDeps(), { channel: "telegram" });
    expect(none).toMatchObject({ ok: false, exitCode: 2 });
    expect(none.message).toContain("--stdin");

    const bad = await runConnect(makeDeps({ readStdin: async () => "000:wrong\n" }), {
      channel: "telegram",
      stdin: true,
    });
    expect(bad).toMatchObject({ ok: false, exitCode: 1 });
    expect(stored.size).toBe(0);
    expect(allOutput()).not.toContain("000:wrong");
  });
});

describe("kolo connect line", () => {
  test("secrets from stdin, webhook guidance, add-friend QR, first message binds the owner", async () => {
    const deps = makeDeps({ readStdin: async () => `${LINE_SECRET}\n${LINE_TOKEN}\n` });
    const result = await runConnect(deps, { channel: "line", stdin: true, wait: false });
    expect(result).toMatchObject({ ok: true, link: "https://line.me/R/ti/p/%40123abcde" });
    expect(stored.get("channel.line.channelSecret")).toBe(LINE_SECRET);
    expect(stored.get("channel.line.channelAccessToken")).toBe(LINE_TOKEN);
    const line = cfg.channels?.line as Record<string, unknown>;
    expect(isSecretRef(line.channelSecret)).toBe(true);
    expect(isSecretRef(line.channelAccessToken)).toBe(true);
    const text = out.join("\n");
    expect(text).toMatch(QR_BLOCKS);
    expect(text).toContain("public HTTPS");
    expect(text).toContain("/line/webhook");
    expect(text).toContain("does not create one");
    expect(allOutput()).not.toContain(LINE_TOKEN);
    expect(allOutput()).not.toContain(LINE_SECRET);

    await phoneSends(deps, "line", "Uowner01", `${result.code}`);
    expect((cfg.channels?.line as { identities?: unknown } | undefined)?.identities).toEqual({
      uowner01: "owner",
    });
  });
});

describe("kolo connect whatsapp", () => {
  test("linked-device QR rendered, linked number bound as owner, welcome owed once", async () => {
    const deps = makeDeps({
      whatsappLink: async ({ onQr }) => {
        onQr("2@fake-pairing-ref,fake-key,fake-identity,fake-adv");
        onQr("2@fake-pairing-ref-2,fake-key,fake-identity,fake-adv");
        return { e164: "+15555550100", jid: "15555550100:1@s.whatsapp.net", alreadyLinked: false };
      },
    });
    const result = await runConnect(deps, { channel: "whatsapp" });
    expect(result).toMatchObject({ ok: true, owner: "+15555550100" });
    const text = out.join("\n");
    expect(text).toMatch(QR_BLOCKS);
    expect(text).toContain("The code refreshed");
    expect(text).toContain("Message yourself");
    expect(cfg.channels?.whatsapp?.identities).toEqual({ "+15555550100": "owner" });
    expect(
      takeOwnerWelcome({ channel: "whatsapp", candidates: ["+15555550100"], env: deps.env }),
    ).toBe(true);
    expect(
      takeOwnerWelcome({ channel: "whatsapp", candidates: ["+15555550100"], env: deps.env }),
    ).toBe(false);
  });

  test("a link that never completes is reported, nothing is bound", async () => {
    const deps = makeDeps({
      whatsappLink: async () => {
        throw new Error("QR expired");
      },
    });
    const result = await runConnect(deps, { channel: "whatsapp" });
    expect(result).toMatchObject({ ok: false, exitCode: 1 });
    expect(result.message).toContain("QR expired");
    expect(cfg.channels?.whatsapp).toBeUndefined();
  });
});

describe("kolo connect web", () => {
  test("loopback: not offered, with the reason and how to enable it", async () => {
    const result = await runConnect(makeDeps(), { channel: "web" });
    expect(result).toMatchObject({ ok: false, exitCode: 1 });
    expect(result.message).toContain("loopback");
    expect(result.message).toContain("--bind lan");
  });

  test("lan without TLS: refused, because phone browsers need HTTPS to keep the device key", () => {
    const where = resolvePhoneDashboard({ gateway: { bind: "lan" } } as KoLoConfig, {
      lanAddress: () => "192.168.1.20",
      tailnetAddress: () => undefined,
    });
    expect(where).toMatchObject({ ok: false, reason: "insecure" });
  });

  test("lan with TLS: one-shot attach invitation, QR of the dashboard URL with the code", async () => {
    cfg = {
      gateway: { bind: "lan", port: 18789, tls: { enabled: true }, remote: { enabled: true } },
    } as KoLoConfig;
    const calls: Array<{ ttlMinutes: number; label: string }> = [];
    const deps = makeDeps({
      createInvitation: async (input) => {
        calls.push(input);
        return { code: "kpi_fakeInvitationCode", id: "inv_1", expiresAt: "2026-10-14T00:10:00Z" };
      },
    });
    const result = await runConnect(deps, { channel: "web" });
    expect(result).toMatchObject({
      ok: true,
      link: "https://192.168.1.20:18789/#pair=kpi_fakeInvitationCode",
    });
    expect(calls).toEqual([{ ttlMinutes: 10, label: "phone browser" }]);
    expect(out.join("\n")).toMatch(QR_BLOCKS);
    expect(out.join("\n")).toContain("attach scope");
  });

  test("tailnet and custom binds use their own address", () => {
    const deps = { lanAddress: () => "192.168.1.20", tailnetAddress: () => "100.64.0.7" };
    expect(
      resolvePhoneDashboard(
        { gateway: { bind: "tailnet", tls: { enabled: true } } } as KoLoConfig,
        deps,
      ),
    ).toMatchObject({ ok: true, host: "100.64.0.7" });
    expect(
      resolvePhoneDashboard(
        {
          gateway: { bind: "custom", customBindHost: "10.0.0.5", tls: { enabled: true } },
        } as KoLoConfig,
        deps,
      ),
    ).toMatchObject({ ok: true, host: "10.0.0.5" });
  });
});

describe("unbind and the reply policy after binding", () => {
  test("kolo connect --unbind removes the owner; web has no binding to remove", async () => {
    const deps = makeDeps({ prompter: fakePrompter([BOT_TOKEN]) });
    const result = await runConnect(deps, { channel: "telegram", wait: false });
    await phoneSends(deps, "telegram", "4242", `/start ${result.code}`);
    const res = await runUnbind(deps, { channel: "telegram" });
    expect(res).toMatchObject({ ok: true, removed: ["4242"] });
    expect(cfg.channels?.telegram?.identities).toBeUndefined();
    expect(await runUnbind(deps, { channel: "web" })).toMatchObject({ ok: false, exitCode: 2 });
  });

  test("the bound owner's conversation gets replies; proactive automated sends are refused", async () => {
    const queue = new ChannelOutboundQueue({ env: { KOLO_HOME: home }, sleep: async () => {} });
    const sent: string[] = [];
    const reply = await queue.enqueue({
      channel: "telegram",
      to: "4242",
      dedupeKey: "telegram:default:r1",
      origin: "inbound",
      replyTo: { senderId: "4242", inboundAt: Date.now(), admitted: true },
      send: async () => {
        sent.push("answer");
      },
    });
    const proactive = await queue.enqueue({
      channel: "telegram",
      to: "4242",
      dedupeKey: "telegram:default:p1",
      origin: "automated",
      send: async () => {
        sent.push("unsolicited");
      },
    });
    expect([reply, proactive]).toEqual(["sent", "policy"]);
    expect(sent).toEqual(["answer"]);
  });
});

describe("helpers", () => {
  test("LAN address prefers a private IPv4 and skips loopback and tailnet ranges", () => {
    expect(
      pickLanIPv4({
        lo: [{ address: "127.0.0.1", family: "IPv4", internal: true } as os.NetworkInterfaceInfo],
        ts: [{ address: "100.64.0.7", family: "IPv4", internal: false } as os.NetworkInterfaceInfo],
        eth: [
          { address: "203.0.113.4", family: "IPv4", internal: false } as os.NetworkInterfaceInfo,
          { address: "192.168.1.20", family: "IPv4", internal: false } as os.NetworkInterfaceInfo,
        ],
      }),
    ).toBe("192.168.1.20");
  });

  test("exit code is never set by the flows themselves", () => {
    expect(exitCode).toBe(null);
  });
});
