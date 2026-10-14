import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import {
  initSiblingChatDb,
  insertMessage,
  getConversationHistory,
  markAsRead,
  getMessageByRunId,
  getUndeliveredMessages,
  markAsDelivered,
} from "./sibling-chat-db.js";

describe("sibling-chat-db", () => {
  let dbPath: string;
  let db: ReturnType<typeof initSiblingChatDb>;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `sibling-chat-test-${randomUUID()}.db`);
    db = initSiblingChatDb(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  test("inserts and retrieves a message", () => {
    const runId = randomUUID();
    const row = insertMessage(db, {
      runId,
      from: "nova",
      to: "orion",
      text: "Hey Orion, check the gateway config",
    });

    expect(row.id).toBeDefined();
    expect(row.runId).toBe(runId);
    expect(row.from).toBe("nova");
    expect(row.to).toBe("orion");
    expect(row.seq).toBe(1);
    expect(row.text).toBe("Hey Orion, check the gateway config");
    expect(row.deliveredAt).toBeDefined();
    expect(row.readAt).toBeNull();
  });

  test("sequence numbers are per-conversation and monotonic", () => {
    const runId1 = randomUUID();
    const runId2 = randomUUID();
    const runId3 = randomUUID();

    insertMessage(db, { runId: runId1, from: "nova", to: "orion", text: "msg 1" });
    insertMessage(db, { runId: runId2, from: "orion", to: "nova", text: "msg 2" });
    insertMessage(db, { runId: runId3, from: "nova", to: "orion", text: "msg 3" });

    const history = getConversationHistory(db, "nova", "orion", 10);
    expect(history.messages.length).toBe(3);
    expect(history.messages[0].seq).toBe(1);
    expect(history.messages[1].seq).toBe(2);
    expect(history.messages[2].seq).toBe(3);
    expect(history.hasMore).toBe(false);
  });

  test("getConversationHistory returns paginated results", () => {
    // Insert 15 messages
    for (let i = 0; i < 15; i++) {
      insertMessage(db, {
        runId: randomUUID(),
        from: "atlas",
        to: "iris",
        text: `message ${i + 1}`,
      });
    }

    const page1 = getConversationHistory(db, "atlas", "iris", 10);
    expect(page1.messages.length).toBe(10);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    const page2 = getConversationHistory(db, "atlas", "iris", 10, page1.nextCursor);
    expect(page2.messages.length).toBe(5);
    expect(page2.hasMore).toBe(false);
  });

  test("getConversationHistory pages by seq, not by timestamp", () => {
    // Messages written in the same millisecond share a timestamp; a timestamp cursor
    // would drop the ones equal to the boundary.
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    vi.useFakeTimers({ now: fixed, toFake: ["Date"] });
    try {
      for (let i = 0; i < 7; i++) {
        insertMessage(db, { runId: randomUUID(), from: "atlas", to: "iris", text: `m${i}` });
      }
    } finally {
      vi.useRealTimers();
    }
    const page1 = getConversationHistory(db, "atlas", "iris", 3);
    expect(page1.messages.map((m) => m.seq)).toEqual([5, 6, 7]);
    expect(page1.nextCursor).toBe("5");
    const page2 = getConversationHistory(db, "atlas", "iris", 3, page1.nextCursor);
    expect(page2.messages.map((m) => m.seq)).toEqual([2, 3, 4]);
    const page3 = getConversationHistory(db, "atlas", "iris", 3, page2.nextCursor);
    expect(page3.messages.map((m) => m.seq)).toEqual([1]);
    expect(page3.hasMore).toBe(false);
    // A legacy ISO cursor still works as a timestamp bound.
    const legacy = getConversationHistory(db, "atlas", "iris", 10, "2026-01-01T00:00:00.001Z");
    expect(legacy.messages.length).toBe(7);
  });

  test("markAsRead updates read_at", () => {
    const runId = randomUUID();
    const row = insertMessage(db, {
      runId,
      from: "orion",
      to: "nova",
      text: "unread message",
    });

    // The message is inserted with deliveredAt set. For testing markAsRead,
    // we directly update the row to simulate an undelivered state, then mark as read.
    db.prepare(`UPDATE sibling_messages SET delivered_at = NULL WHERE run_id = ?`).run(runId);

    const undelivered = getUndeliveredMessages(db, "nova");
    const beforeCount = undelivered.filter((m) => m.runId === runId && m.readAt === null).length;
    expect(beforeCount).toBe(1);

    const changes = markAsRead(db, "orion");
    expect(changes).toBeGreaterThanOrEqual(1);

    const msg = getMessageByRunId(db, runId);
    expect(msg).toBeDefined();
    expect(msg!.readAt).toBeDefined();
  });

  test("getMessageByRunId finds message by idempotency key", () => {
    const runId = randomUUID();
    insertMessage(db, {
      runId,
      from: "nova",
      to: "atlas",
      text: "dedup test",
    });

    const found = getMessageByRunId(db, runId);
    expect(found).toBeDefined();
    expect(found!.text).toBe("dedup test");

    const notFound = getMessageByRunId(db, "nonexistent");
    expect(notFound).toBeUndefined();
  });

  test("getUndeliveredMessages returns only undelivered messages", () => {
    const runId1 = randomUUID();
    const runId2 = randomUUID();

    insertMessage(db, { runId: runId1, from: "iris", to: "nova", text: "undelivered 1" });
    insertMessage(db, { runId: runId2, from: "iris", to: "nova", text: "undelivered 2" });

    // Simulate undelivered state
    db.prepare(`UPDATE sibling_messages SET delivered_at = NULL WHERE run_id = ?`).run(runId1);
    db.prepare(`UPDATE sibling_messages SET delivered_at = NULL WHERE run_id = ?`).run(runId2);

    const undelivered = getUndeliveredMessages(db, "nova");
    const hiroMsgs = undelivered.filter((m) => m.from === "iris");
    expect(hiroMsgs.length).toBe(2);

    // Mark one as delivered
    markAsDelivered(db, runId1);

    const undelivered2 = getUndeliveredMessages(db, "nova");
    const hiroMsgs2 = undelivered2.filter((m) => m.from === "iris");
    expect(hiroMsgs2.length).toBe(1);
    expect(hiroMsgs2[0].runId).toBe(runId2);
  });

  test("markAsDelivered updates delivered_at", () => {
    const runId = randomUUID();
    insertMessage(db, {
      runId,
      from: "juno",
      to: "nova",
      text: "test delivery",
    });

    const before = getMessageByRunId(db, runId);
    expect(before!.deliveredAt).toBeDefined(); // set on insert

    const result = markAsDelivered(db, runId);
    expect(result).toBe(true);

    const after = getMessageByRunId(db, runId);
    expect(after!.deliveredAt).toBeDefined();
  });

  test("idempotency: duplicate runId is rejected by DB unique constraint", () => {
    const runId = randomUUID();
    insertMessage(db, {
      runId,
      from: "nova",
      to: "orion",
      text: "first",
    });

    expect(() => {
      insertMessage(db, {
        runId,
        from: "nova",
        to: "orion",
        text: "duplicate",
      });
    }).toThrow();
  });
});
