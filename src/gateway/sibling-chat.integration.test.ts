import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { GatewayRequestContext } from "./server-methods/types.js";
import { resolveSiblingInboxDir } from "../config/sibling-paths.js";
import { siblingHandlers, resetSiblingDb, setSiblingDb } from "./server-methods/sibling.js";
import {
  initSiblingChatDb,
  getConversationHistory,
  getMessageByRunId,
  getUndeliveredMessages,
  markAsDelivered,
} from "./sibling-chat-db.js";

function makeMockContext(dbPath: string): GatewayRequestContext {
  const db = initSiblingChatDb(dbPath);
  setSiblingDb(db, dbPath);
  return {
    broadcast: vi.fn(),
    nodeSendToAllSubscribed: vi.fn(),
    logGateway: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    } as any,
    cronStorePath: dbPath,
    dedupe: new Map(),
  } as unknown as GatewayRequestContext;
}

function makeMockClient(siblingId: string) {
  return {
    connect: {
      client: {
        id: `${siblingId}-tui`,
        displayName: `${siblingId} TUI`,
        version: "1.0.0",
        platform: "linux",
        mode: "tui",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
    },
  };
}

describe("sibling chat full-stack integration", () => {
  let dbPath: string;
  let context: GatewayRequestContext;
  let respond: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sibling-integration-${randomUUID()}.db`);
    context = makeMockContext(dbPath);
    respond = vi.fn();
  });

  afterEach(() => {
    resetSiblingDb();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
    // Clean up file inbox
    const inboxDir = path.join(resolveSiblingInboxDir("orion"), "sibling-chat");
    try {
      if (fs.existsSync(inboxDir)) {
        fs.readdirSync(inboxDir).forEach((f) => {
          if (f.startsWith("from_makoto_")) {
            fs.unlinkSync(path.join(inboxDir, f));
          }
        });
      }
    } catch {
      // ignore
    }
  });

  test("full flow: send → broadcast → history → read", async () => {
    const runId = randomUUID();

    // 1. Send message
    const sendHandler = siblingHandlers["sibling.send"];
    await sendHandler!({
      req: {
        type: "req",
        id: "1",
        method: "sibling.send",
        params: { to: "orion", text: "Hey Orion, check the gateway config", idempotencyKey: runId },
      },
      params: { to: "orion", text: "Hey Orion, check the gateway config", idempotencyKey: runId },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, runId, seq: 1 }),
    );

    // 2. Verify broadcast
    expect(context.broadcast).toHaveBeenCalledWith(
      "sibling",
      expect.objectContaining({
        type: "message",
        from: "nova",
        text: "Hey Orion, check the gateway config",
        seq: 1,
      }),
    );

    // 3. Verify file inbox was written
    const inboxDir = path.join(resolveSiblingInboxDir("orion"), "sibling-chat");
    const files = fs.readdirSync(inboxDir);
    const matchingFiles = files.filter((f) => f.includes(runId.slice(0, 8)));
    expect(matchingFiles.length).toBe(1);

    // 4. Verify history
    const historyHandler = siblingHandlers["sibling.history"];
    respond.mockClear();
    await historyHandler!({
      req: {
        type: "req",
        id: "2",
        method: "sibling.history",
        params: { with: "orion", limit: 10 },
      },
      params: { with: "orion", limit: 10 },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            from: "nova",
            text: "Hey Orion, check the gateway config",
            seq: 1,
          }),
        ]),
        hasMore: false,
      }),
    );

    // 5. Mark as read
    const readHandler = siblingHandlers["sibling.read"];
    respond.mockClear();
    await readHandler!({
      req: { type: "req", id: "3", method: "sibling.read", params: { with: "orion", upToSeq: 1 } },
      params: { with: "orion", upToSeq: 1 },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, markedRead: expect.any(Number) }),
    );
  });

  test("subscribe delivers backlog of undelivered messages", async () => {
    const runId = randomUUID();

    // Send a message
    const sendHandler = siblingHandlers["sibling.send"];
    await sendHandler!({
      req: {
        type: "req",
        id: "1",
        method: "sibling.send",
        params: { to: "atlas", text: "Atlas, need review", idempotencyKey: runId },
      },
      params: { to: "atlas", text: "Atlas, need review", idempotencyKey: runId },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    // Simulate undelivered state (message was written but not delivered to recipient)
    // The subscribe handler should pick it up
    const subHandler = siblingHandlers["sibling.subscribe"];
    respond.mockClear();
    await subHandler!({
      req: { type: "req", id: "2", method: "sibling.subscribe", params: { from: "atlas" } },
      params: { from: "atlas" },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        subscribed: true,
        subscriber: "nova",
        filterFrom: "atlas",
      }),
    );
  });

  test("rate limiting kicks in after 30 messages per minute", async () => {
    const sendHandler = siblingHandlers["sibling.send"];

    // Send 30 messages (should all succeed)
    for (let i = 0; i < 30; i++) {
      respond.mockClear();
      await sendHandler!({
        req: {
          type: "req",
          id: `rate-${i}`,
          method: "sibling.send",
          params: { to: "orion", text: `msg ${i}`, idempotencyKey: randomUUID() },
        },
        params: { to: "orion", text: `msg ${i}`, idempotencyKey: `rate-${i}` },
        client: makeMockClient("nova"),
        isWebchatConnect: vi.fn(),
        respond,
        context,
      });
      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }));
    }

    // 31st message should be rate limited
    respond.mockClear();
    await sendHandler!({
      req: {
        type: "req",
        id: "rate-30",
        method: "sibling.send",
        params: { to: "orion", text: "msg 30", idempotencyKey: randomUUID() },
      },
      params: { to: "orion", text: "msg 30", idempotencyKey: "rate-30" },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: "rate limit exceeded",
      }),
    );
  });

  test("dedup prevents double delivery on retry", async () => {
    const runId = randomUUID();
    const sendHandler = siblingHandlers["sibling.send"];

    // First send
    await sendHandler!({
      req: {
        type: "req",
        id: "1",
        method: "sibling.send",
        params: { to: "orion", text: "dedup test", idempotencyKey: runId },
      },
      params: { to: "orion", text: "dedup test", idempotencyKey: runId },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledTimes(1);

    // Retry with same idempotency key
    respond.mockClear();
    await sendHandler!({
      req: {
        type: "req",
        id: "2",
        method: "sibling.send",
        params: { to: "orion", text: "dedup test", idempotencyKey: runId },
      },
      params: { to: "orion", text: "dedup test", idempotencyKey: runId },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.any(Object),
      undefined,
      expect.objectContaining({ cached: true }),
    );
  });

  test("conversation history is bidirectional", async () => {
    const runId1 = randomUUID();
    const runId2 = randomUUID();
    const runId3 = randomUUID();
    const sendHandler = siblingHandlers["sibling.send"];

    // Nova → Orion
    await sendHandler!({
      req: {
        type: "req",
        id: "1",
        method: "sibling.send",
        params: { to: "orion", text: "Hello from Nova", idempotencyKey: runId1 },
      },
      params: { to: "orion", text: "Hello from Nova", idempotencyKey: runId1 },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    // Orion → Nova (simulate by using orion client)
    respond.mockClear();
    await sendHandler!({
      req: {
        type: "req",
        id: "2",
        method: "sibling.send",
        params: { to: "nova", text: "Hello from Orion", idempotencyKey: runId2 },
      },
      params: { to: "nova", text: "Hello from Orion", idempotencyKey: runId2 },
      client: makeMockClient("orion"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    // Nova → Orion again
    respond.mockClear();
    await sendHandler!({
      req: {
        type: "req",
        id: "3",
        method: "sibling.send",
        params: { to: "orion", text: "How's the gateway?", idempotencyKey: runId3 },
      },
      params: { to: "orion", text: "How's the gateway?", idempotencyKey: runId3 },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    // Check history from Nova's perspective
    const historyHandler = siblingHandlers["sibling.history"];
    respond.mockClear();
    await historyHandler!({
      req: {
        type: "req",
        id: "4",
        method: "sibling.history",
        params: { with: "orion", limit: 10 },
      },
      params: { with: "orion", limit: 10 },
      client: makeMockClient("nova"),
      isWebchatConnect: vi.fn(),
      respond,
      context,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ from: "nova", text: "Hello from Nova" }),
          expect.objectContaining({ from: "orion", text: "Hello from Orion" }),
          expect.objectContaining({ from: "nova", text: "How's the gateway?" }),
        ]),
      }),
    );
    expect((respond.mock.calls[0][1] as any).messages.length).toBe(3);
  });
});
