import type { MessageEvent, PostbackEvent } from "@line/bot-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KoLoConfig } from "../config/config.js";
import type { ResolvedLineAccount } from "./types.js";
import { buildLineMessageContext, buildLinePostbackContext } from "./bot-message-context.js";

describe("buildLineMessageContext", () => {
  let tmpDir: string;
  let storePath: string;
  let cfg: KoLoConfig;
  const account: ResolvedLineAccount = {
    accountId: "default",
    enabled: true,
    channelAccessToken: "token",
    channelSecret: "secret",
    tokenSource: "config",
    config: {},
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-line-context-"));
    storePath = path.join(tmpDir, "sessions.json");
    cfg = { session: { store: storePath } };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  });

  it("routes group message replies to the group id", async () => {
    const event = {
      type: "message",
      message: { id: "1", type: "text", text: "hello" },
      replyToken: "reply-token",
      timestamp: Date.now(),
      source: { type: "group", groupId: "group-1", userId: "user-1" },
      mode: "active",
      webhookEventId: "evt-1",
      deliveryContext: { isRedelivery: false },
    } as MessageEvent;

    const context = await buildLineMessageContext({
      event,
      allMedia: [],
      cfg,
      account,
    });

    expect(context.ctxPayload.OriginatingTo).toBe("line:group:group-1");
    expect(context.ctxPayload.To).toBe("line:group:group-1");
  });

  it("routes group postback replies to the group id", async () => {
    const event = {
      type: "postback",
      postback: { data: "action=select" },
      replyToken: "reply-token",
      timestamp: Date.now(),
      source: { type: "group", groupId: "group-2", userId: "user-2" },
      mode: "active",
      webhookEventId: "evt-2",
      deliveryContext: { isRedelivery: false },
    } as PostbackEvent;

    const context = await buildLinePostbackContext({
      event,
      cfg,
      account,
    });

    expect(context?.ctxPayload.OriginatingTo).toBe("line:group:group-2");
    expect(context?.ctxPayload.To).toBe("line:group:group-2");
  });

  it("routes an inbound DM into routeToSession while preserving LINE reply context", async () => {
    const event = {
      type: "message",
      message: { id: "10", type: "text", text: "hi iris" },
      replyToken: "reply-token",
      timestamp: Date.now(),
      source: { type: "user", userId: "user-owner" },
      mode: "active",
      webhookEventId: "evt-10",
      deliveryContext: { isRedelivery: false },
    } as MessageEvent;

    const routedAccount: ResolvedLineAccount = {
      ...account,
      config: { routeToSession: "agent:iris:main" },
    };

    const context = await buildLineMessageContext({
      event,
      allMedia: [],
      cfg,
      account: routedAccount,
    });

    // Inbound DM lands in the shared session the agent watches in their TUI...
    expect(context.ctxPayload.SessionKey).toBe("agent:iris:main");
    // ...and the reply still routes back out via LINE to the originating user.
    expect(context.ctxPayload.OriginatingChannel).toBe("line");
    expect(context.ctxPayload.OriginatingTo).toBe("line:user-owner");
  });

  it("routes group messages into the shared session and replies back to the group", async () => {
    const event = {
      type: "message",
      message: { id: "11", type: "text", text: "group chatter" },
      replyToken: "reply-token",
      timestamp: Date.now(),
      source: { type: "group", groupId: "group-3", userId: "user-3" },
      mode: "active",
      webhookEventId: "evt-11",
      deliveryContext: { isRedelivery: false },
    } as MessageEvent;

    const routedAccount: ResolvedLineAccount = {
      ...account,
      config: { routeToSession: "agent:iris:main" },
    };

    const context = await buildLineMessageContext({
      event,
      allMedia: [],
      cfg,
      account: routedAccount,
    });

    // Group messages route into the shared agent session so the agent sees them live
    // (otherwise they key to "group:<id>" which the gateway has no session for).
    expect(context.ctxPayload.SessionKey).toBe("agent:iris:main");
    // ...and the reply routes back out to the GROUP, not a DM.
    expect(context.ctxPayload.OriginatingChannel).toBe("line");
    expect(context.ctxPayload.OriginatingTo).toBe("line:group:group-3");
  });
});
