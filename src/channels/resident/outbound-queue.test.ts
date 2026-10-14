// Fake channel adapters, one per transport style, drive the outbound queue:
//   webhook    push over HTTP; the receiver fails a few times then accepts (retry + backoff)
//   long-poll  the integration polls an outbox; sends settle only when the poller drains
//   websocket  a connection that is down until "reconnect"; never reconnecting dead-letters
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ChannelOutboundQueue, readDeadLetters, resolveDeliveryLimits } from "./outbound-queue.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

let home = "";
let env: NodeJS.ProcessEnv;
const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-queue-"));
  env = { KOLO_HOME: home, KOLO_STATE_DIR: home };
  sleeps.length = 0;
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

/** Webhook style: push; the receiver returns 5xx `failures` times, then 200. */
function fakeWebhookChannel(failures: number) {
  const received: string[] = [];
  let remaining = failures;
  return {
    received,
    send: (text: string) => async () => {
      if (remaining > 0) {
        remaining -= 1;
        throw new Error("outbound 503");
      }
      received.push(text);
    },
  };
}

/** Long-poll style: sends land in an outbox; a poll cycle acknowledges them. */
function fakeLongPollChannel() {
  const outbox: Array<{ text: string; ack: () => void }> = [];
  const polled: string[] = [];
  return {
    outbox,
    polled,
    send: (text: string) => () =>
      new Promise<void>((resolve) => {
        outbox.push({ text, ack: resolve });
      }),
    poll: () => {
      for (const item of outbox.splice(0)) {
        polled.push(item.text);
        item.ack();
      }
    },
  };
}

/** Websocket style: a socket that is down until reconnect(). */
function fakeWebsocketChannel() {
  let connected = false;
  const frames: string[] = [];
  return {
    frames,
    reconnect: () => {
      connected = true;
    },
    send: (text: string) => async () => {
      if (!connected) {
        throw new Error("socket closed");
      }
      frames.push(text);
    },
  };
}

describe("outbound queue (M14c)", () => {
  test("webhook: retries with exponential backoff, then delivers once", async () => {
    const queue = new ChannelOutboundQueue({
      limits: { maxRetries: 4, backoffMs: 100, maxBackoffMs: 250 },
      env,
      sleep,
    });
    const ch = fakeWebhookChannel(3);
    const status = await queue.enqueue({
      channel: "webhook",
      to: "bob",
      dedupeKey: "webhook:default:m1:1",
      origin: "inbound",
      text: "hello",
      send: ch.send("hello"),
    });
    expect(status).toBe("sent");
    expect(ch.received).toEqual(["hello"]);
    expect(sleeps).toEqual([100, 200, 250]);
    const health = queue.snapshot().webhook;
    expect(health).toMatchObject({ sent: 1, retried: 3, deadLettered: 0, queued: 0, inFlight: 0 });
    expect(health.lastError).toBe("outbound 503");
    expect(health.lastSentAt).not.toBeNull();
  });

  test("long-poll: order is preserved per channel and duplicate keys are dropped", async () => {
    const queue = new ChannelOutboundQueue({ env, sleep });
    const ch = fakeLongPollChannel();
    const a = queue.enqueue({
      channel: "poll",
      to: "x",
      dedupeKey: "poll:x:m1:1",
      origin: "inbound",
      send: ch.send("one"),
    });
    const b = queue.enqueue({
      channel: "poll",
      to: "x",
      dedupeKey: "poll:x:m1:2",
      origin: "inbound",
      send: ch.send("two"),
    });
    const dup = await queue.enqueue({
      channel: "poll",
      to: "x",
      dedupeKey: "poll:x:m1:1",
      origin: "inbound",
      send: ch.send("one again"),
    });
    expect(dup).toBe("duplicate");
    // Only the first job is in flight until the poller drains it.
    await new Promise((r) => setTimeout(r, 0));
    expect(ch.outbox.map((o) => o.text)).toEqual(["one"]);
    expect(queue.snapshot().poll).toMatchObject({ queued: 1, inFlight: 1, duplicates: 1 });
    ch.poll();
    await a;
    await new Promise((r) => setTimeout(r, 0));
    ch.poll();
    await b;
    expect(ch.polled).toEqual(["one", "two"]);
    await queue.idle();
    expect(queue.snapshot().poll).toMatchObject({ queued: 0, inFlight: 0, sent: 2 });
  });

  test("websocket: a connection that never comes back dead-letters with a readable record", async () => {
    const queue = new ChannelOutboundQueue({
      limits: { maxRetries: 2, backoffMs: 10 },
      env,
      sleep,
    });
    const ch = fakeWebsocketChannel();
    const status = await queue.enqueue({
      channel: "Ws-Chat",
      accountId: "main",
      to: "room-1",
      dedupeKey: "ws:main:m9:1",
      origin: "inbound",
      text: "are you there",
      send: ch.send("are you there"),
    });
    expect(status).toBe("dead_letter");
    expect(ch.frames).toEqual([]);
    const records = readDeadLetters("ws-chat", env);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      channel: "ws-chat",
      accountId: "main",
      to: "room-1",
      dedupeKey: "ws:main:m9:1",
      origin: "inbound",
      attempts: 3,
      reason: "retries_exhausted",
      error: "socket closed",
      text: "are you there",
    });
    expect(queue.snapshot()["ws-chat"]).toMatchObject({ deadLettered: 1, retried: 2, sent: 0 });
    expect(queue.snapshot()["ws-chat"].deadLetterFile).toBe(
      path.join(home, "channels", "dead-letter", "ws-chat.jsonl"),
    );

    // After reconnect the next message goes through on the first try.
    ch.reconnect();
    const again = await queue.enqueue({
      channel: "ws-chat",
      to: "room-1",
      dedupeKey: "ws:main:m10:1",
      origin: "inbound",
      send: ch.send("back"),
    });
    expect(again).toBe("sent");
    expect(ch.frames).toEqual(["back"]);
  });

  test("policy: automated sends are refused under human-triggered and recorded", async () => {
    const queue = new ChannelOutboundQueue({ env, sleep });
    const ch = fakeWebhookChannel(0);
    const status = await queue.enqueue({
      channel: "webhook",
      to: "bob",
      dedupeKey: "webhook:default:auto:1",
      origin: "automated",
      text: "daily digest",
      send: ch.send("daily digest"),
    });
    expect(status).toBe("policy");
    expect(ch.received).toEqual([]);
    expect(readDeadLetters("webhook", env)[0]).toMatchObject({ reason: "policy", attempts: 0 });
    expect(queue.snapshot().webhook.policyDenied).toBe(1);

    const open = new ChannelOutboundQueue({ limits: { policy: "allow-automated" }, env, sleep });
    expect(
      await open.enqueue({
        channel: "webhook",
        to: "bob",
        dedupeKey: "webhook:default:auto:2",
        origin: "automated",
        send: ch.send("daily digest"),
      }),
    ).toBe("sent");
    expect(resolveDeliveryLimits().policy).toBe("human-triggered");
  });
});
