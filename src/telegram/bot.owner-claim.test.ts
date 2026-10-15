// M16: `/start KOLO-…` from the deep link printed by `kurahi connect telegram` binds the sender as
// owner through the real Telegram handler (fake Bot API), before the pairing gate.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInboundDedupe } from "../auto-reply/reply/inbound-dedupe.js";
import { issueOwnerCode, listOwnerBindings } from "../channels/resident/owner-binding.js";
import { createTelegramBot } from "./bot.js";

const { koloHome } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/kolo-tg-owner-${Math.random().toString(16).slice(2)}`;
  process.env.KOLO_HOME = dir;
  process.env.KOLO_STATE_DIR = dir;
  delete process.env.KOLO_CONFIG_PATH;
  return { koloHome: dir };
});

const { sessionStorePath } = vi.hoisted(() => ({
  sessionStorePath: `/tmp/kolo-telegram-${Math.random().toString(16).slice(2)}.json`,
}));

const { loadWebMedia } = vi.hoisted(() => ({
  loadWebMedia: vi.fn(),
}));

vi.mock("../web/media.js", () => ({
  loadWebMedia,
}));

const { loadConfig } = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
}));
vi.mock("../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/config.js")>();
  return {
    ...actual,
    loadConfig,
  };
});

vi.mock("../config/sessions.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/sessions.js")>();
  return {
    ...actual,
    resolveStorePath: vi.fn((storePath) => storePath ?? sessionStorePath),
  };
});

const { readChannelAllowFromStore, upsertChannelPairingRequest, addChannelAllowFromStoreEntry } =
  vi.hoisted(() => ({
    readChannelAllowFromStore: vi.fn(async () => [] as string[]),
    upsertChannelPairingRequest: vi.fn(async () => ({
      code: "PAIRCODE",
      created: true,
    })),
    addChannelAllowFromStoreEntry: vi.fn(async () => ({ changed: true, allowFrom: [] })),
  }));

vi.mock("../pairing/pairing-store.js", () => ({
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
  addChannelAllowFromStoreEntry,
}));

const useSpy = vi.fn();
const middlewareUseSpy = vi.fn();
const onSpy = vi.fn();
const stopSpy = vi.fn();
const commandSpy = vi.fn();
const botCtorSpy = vi.fn();
const answerCallbackQuerySpy = vi.fn(async () => undefined);
const sendChatActionSpy = vi.fn();
const setMessageReactionSpy = vi.fn(async () => undefined);
const setMyCommandsSpy = vi.fn(async () => undefined);
const sendMessageSpy = vi.fn(async () => ({ message_id: 77 }));
const sendAnimationSpy = vi.fn(async () => ({ message_id: 78 }));
const sendPhotoSpy = vi.fn(async () => ({ message_id: 79 }));
type ApiStub = {
  config: { use: (arg: unknown) => void };
  answerCallbackQuery: typeof answerCallbackQuerySpy;
  sendChatAction: typeof sendChatActionSpy;
  setMessageReaction: typeof setMessageReactionSpy;
  setMyCommands: typeof setMyCommandsSpy;
  sendMessage: typeof sendMessageSpy;
  sendAnimation: typeof sendAnimationSpy;
  sendPhoto: typeof sendPhotoSpy;
};
const apiStub: ApiStub = {
  config: { use: useSpy },
  answerCallbackQuery: answerCallbackQuerySpy,
  sendChatAction: sendChatActionSpy,
  setMessageReaction: setMessageReactionSpy,
  setMyCommands: setMyCommandsSpy,
  sendMessage: sendMessageSpy,
  sendAnimation: sendAnimationSpy,
  sendPhoto: sendPhotoSpy,
};

vi.mock("grammy", () => ({
  Bot: class {
    api = apiStub;
    use = middlewareUseSpy;
    on = onSpy;
    stop = stopSpy;
    command = commandSpy;
    catch = vi.fn();
    constructor(
      public token: string,
      public options?: { client?: { fetch?: typeof fetch } },
    ) {
      botCtorSpy(token, options);
    }
  },
  InputFile: class {},
  webhookCallback: vi.fn(),
}));

const sequentializeMiddleware = vi.fn();
const sequentializeSpy = vi.fn(() => sequentializeMiddleware);
let _sequentializeKey: ((ctx: unknown) => string) | undefined;
vi.mock("@grammyjs/runner", () => ({
  sequentialize: (keyFn: (ctx: unknown) => string) => {
    _sequentializeKey = keyFn;
    return sequentializeSpy();
  },
}));

const throttlerSpy = vi.fn(() => "throttler");

vi.mock("@grammyjs/transformer-throttler", () => ({
  apiThrottler: () => throttlerSpy(),
}));

vi.mock("../auto-reply/reply.js", () => {
  const replySpy = vi.fn(async (_ctx, opts) => {
    await opts?.onReplyStart?.();
    return undefined;
  });
  return { getReplyFromConfig: replySpy, __replySpy: replySpy };
});

let replyModule: typeof import("../auto-reply/reply.js");

const getOnHandler = (event: string) => {
  const handler = onSpy.mock.calls.find((call) => call[0] === event)?.[1];
  if (!handler) {
    throw new Error(`Missing handler for event: ${event}`);
  }
  return handler as (ctx: Record<string, unknown>) => Promise<void>;
};

describe("telegram owner claim (M16)", () => {
  beforeAll(async () => {
    replyModule = await import("../auto-reply/reply.js");
    fs.mkdirSync(koloHome, { recursive: true });
  });
  afterAll(() => {
    fs.rmSync(koloHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetInboundDedupe();
    onSpy.mockReset();
    sendMessageSpy.mockClear();
    upsertChannelPairingRequest.mockClear();
    addChannelAllowFromStoreEntry.mockClear();
    loadConfig.mockReturnValue({
      channels: { telegram: { dmPolicy: "pairing" } },
    });
  });

  const dm = (text: string, messageId: number) => ({
    message: {
      chat: { id: 4242, type: "private" },
      from: { id: 4242, username: "alice" },
      text,
      date: 1736380800,
      message_id: messageId,
    },
    me: { username: "ops_bot" },
    getFile: async () => ({ download: async () => new Uint8Array() }),
  });

  it("binds the sender of /start <code> as owner and answers before the pairing gate", async () => {
    const replySpy = replyModule.__replySpy as unknown as ReturnType<typeof vi.fn>;
    replySpy.mockReset();
    const { code } = issueOwnerCode({ channel: "telegram" });
    createTelegramBot({ token: "tok" });
    const handler = getOnHandler("message");

    await handler(dm(`/start ${code}`, 1));

    expect(upsertChannelPairingRequest).not.toHaveBeenCalled();
    expect(replySpy).not.toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    expect(sendMessageSpy.mock.calls[0][0]).toBe(4242);
    expect(String(sendMessageSpy.mock.calls[0][1])).toContain("owner");
    expect(addChannelAllowFromStoreEntry).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "telegram", entry: "4242" }),
    );
    const written = JSON.parse(fs.readFileSync(path.join(koloHome, "kolo.json"), "utf8"));
    expect(written.channels.telegram.identities).toEqual({ "4242": "owner" });
    expect(listOwnerBindings()).toMatchObject([
      { channel: "telegram", senderId: "4242", via: "code" },
    ]);
  });

  it("an ordinary first message from a stranger still gets the pairing reply", async () => {
    createTelegramBot({ token: "tok" });
    const handler = getOnHandler("message");
    await handler(dm("hello", 2));
    expect(upsertChannelPairingRequest).toHaveBeenCalledTimes(1);
  });
});
