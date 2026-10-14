import fs from "node:fs";
// End-to-end (KoLo 2.0, M14): a throwaway gateway (built dist/entry.js) with the deterministic
// provider and the generic webhook channel pointed at a local receiver. A message posted on the
// channel resolves to the resident's per-conversation session, is announced to an attached
// client as `channel.inbound`, is answered through the outbound pipe in chunks, is listed as a
// session and a job, and a repeated message id is ignored. `pnpm channels:check` runs this file;
// it needs no network beyond loopback and no model credentials.
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ProbeClient, waitFor } from "../../continuity-suite/client.js";
import { startFakeProvider } from "../../continuity-suite/fake-provider.js";
import { resolveGatewayEntry, ThrowawayGateway } from "../../continuity-suite/throwaway.js";
import { PROTOCOL_VERSION } from "../../gateway/protocol/index.js";

const hasDist = (() => {
  try {
    resolveGatewayEntry();
    return true;
  } catch {
    return false;
  }
})();

type OutboundPost = {
  to: string;
  text: string;
  chunk: number;
  chunks: number;
  dedupeKey: string;
  sessionKey: string;
  kind: string;
};

type InboundResponse = {
  ok: boolean;
  sessionKey: string;
  agentId: string;
  conversationId: string;
  queuedFinal: boolean;
  replies: Array<{ kind: string; text: string }>;
  outbound: string;
  error?: string;
};

/** Collects broadcast events of one name over a connected socket. */
function listenEvents(baseUrl: string, token: string, event: string) {
  const events: unknown[] = [];
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws"));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "req",
          id: "connect",
          method: "connect",
          params: {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: { id: "kolo-probe", version: "m14", platform: process.platform, mode: "probe" },
            auth: { token },
          },
        }),
      );
    });
    socket.addEventListener("message", (ev) => {
      const frame = JSON.parse(String(ev.data)) as {
        type?: string;
        id?: string;
        ok?: boolean;
        event?: string;
        payload?: unknown;
      };
      if (frame.type === "res" && frame.id === "connect") {
        clearTimeout(timer);
        if (frame.ok) {
          resolve();
        } else {
          reject(new Error("ws connect rejected"));
        }
      }
      if (frame.type === "event" && frame.event === event) {
        events.push(frame.payload);
      }
    });
    socket.addEventListener("error", () => reject(new Error("ws error")));
  });
  return { events, ready, close: () => socket.close() };
}

describe.skipIf(!hasDist)("channel-native resident end to end", () => {
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let gw: ThrowawayGateway;
  let client: ProbeClient;
  let receiver: http.Server;
  const posts: OutboundPost[] = [];
  let listener: ReturnType<typeof listenEvents>;
  /** The receiver refuses this many posts with 503 before accepting again (retry probe). */
  let refuse = 0;
  let refused = 0;

  beforeAll(async () => {
    provider = await startFakeProvider();
    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        if (refuse > 0) {
          refuse -= 1;
          refused += 1;
          res.statusCode = 503;
          res.end("{}");
          return;
        }
        posts.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as OutboundPost);
        res.statusCode = 200;
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
    const addr = receiver.address();
    const receiverUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/out`;
    const home =
      process.env.KOLO_SMOKE_HOME?.trim() ||
      fs.mkdtempSync(path.join(os.tmpdir(), "kolo-chan-e2e-"));
    const port = process.env.KOLO_SMOKE_PORT
      ? Number.parseInt(process.env.KOLO_SMOKE_PORT, 10)
      : undefined;
    gw = await ThrowawayGateway.create({
      home,
      port,
      providerBaseUrl: provider.baseUrl,
      logName: "channels-gateway.log",
      extraConfig: {
        channels: {
          sessionMode: "per-conversation",
          locale: "en",
          webhook: {
            outboundUrl: receiverUrl,
            textChunkLimit: 48,
            identities: { bob: "owner", carol: "attach" },
          },
        },
      },
    });
    await gw.start();
    client = new ProbeClient(gw.baseUrl, gw.token);
    listener = listenEvents(gw.baseUrl, gw.token, "channel.inbound");
    await listener.ready;
  }, 120_000);

  afterAll(async () => {
    listener?.close();
    await gw?.destroy();
    await provider?.close();
    await new Promise<void>((resolve) => receiver?.close(() => resolve()));
  });

  test(
    "a webhook message lands in the resident's session, is announced, answered in chunks and listed",
    { timeout: 120_000 },
    async () => {
      const res = await client.post<InboundResponse>(
        "/api/channels/webhook/default/inbound",
        { from: "bob", name: "Bob", text: "Channel probe: say hello", messageId: "m-1" },
        { timeoutMs: 90_000 },
      );
      expect(res.status, res.text.slice(0, 300)).toBe(200);
      const body = res.body;
      expect(body.ok).toBe(true);
      expect(body.agentId).toBe(gw.agentId);
      expect(body.sessionKey).toBe(`agent:${gw.agentId}:webhook:dm:bob`);
      expect(body.outbound).toBe("posted");
      expect(body.queuedFinal).toBe(true);
      expect(body.replies.length).toBeGreaterThan(0);

      await waitFor(async () => posts.length >= body.replies.length, {
        timeoutMs: 15_000,
        intervalMs: 100,
        what: "outbound posts to reach the receiver",
      });
      expect(posts.length).toBe(body.replies.length);
      expect(posts.every((p) => p.text.length <= 48)).toBe(true);
      expect(posts.every((p) => p.to === "bob" && p.sessionKey === body.sessionKey)).toBe(true);
      expect(new Set(posts.map((p) => p.dedupeKey)).size).toBe(posts.length);
      const final = posts.filter((p) => p.kind === "final");
      expect(final.length).toBeGreaterThan(0);
      expect(final.at(-1)?.chunk).toBe(final.at(-1)?.chunks);

      // The person's side reached the attached client, with channel and sender metadata.
      await waitFor(async () => listener.events.length >= 1, {
        timeoutMs: 10_000,
        intervalMs: 100,
        what: "channel.inbound event",
      });
      expect(listener.events[0]).toMatchObject({
        channel: "webhook",
        sessionKey: body.sessionKey,
        agentId: gw.agentId,
        messageId: "m-1",
        sender: { id: "bob", name: "Bob", role: "owner" },
        text: "Channel probe: say hello",
      });

      // Discoverable like any session, and recorded as a job.
      const sessions = await client.get<{ sessions?: Array<{ key: string }> }>(
        `/api/sessions?agent=${gw.agentId}&limit=50`,
      );
      expect(sessions.status).toBe(200);
      expect((sessions.body.sessions ?? []).map((s) => s.key)).toContain(body.sessionKey);
      const jobs = await client.get<{ jobs?: Array<{ sessionKey: string; status: string }> }>(
        "/api/jobs?limit=50",
      );
      const job = (jobs.body.jobs ?? []).find((j) => j.sessionKey === body.sessionKey);
      expect(job?.status).toBe("succeeded");
    },
  );

  test(
    "conversation commands answer from the channel with the sender's role",
    { timeout: 60_000 },
    async () => {
      const send = async (from: string, text: string, messageId: string) =>
        await client.post<InboundResponse>(
          "/api/channels/webhook/default/inbound",
          { from, text, messageId },
          { timeoutMs: 60_000 },
        );
      // Replies are chunked at the test's 48-character limit; compare the joined text.
      const textOf = (res: { body: InboundResponse }) =>
        res.body.replies
          .map((r) => r.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      const help = await send("bob", "/help", "c-1");
      expect(help.status).toBe(200);
      expect(textOf(help)).toContain("Your role here: owner.");
      const status = await send("bob", "/status", "c-2");
      const statusText = textOf(status);
      expect(statusText).toContain(`resident ${gw.agentId}`);
      expect(statusText).toContain("conversation active");
      const jobs = await send("bob", "/jobs", "c-3");
      const jobsText = textOf(jobs);
      expect(jobsText).toContain("Recent jobs:");
      const jobId = /([0-9a-f]{8})\s+succeeded/.exec(jobsText)?.[1] ?? "";
      expect(jobId.length).toBeGreaterThan(0);
      const evidence = await send("bob", `/evidence ${jobId}`, "c-4");
      const evidenceText = textOf(evidence);
      expect(evidenceText).toContain("status succeeded");
      expect(evidenceText).toContain("signed yes");
      // carol may read but not act; eve is nobody.
      const denied = await send("carol", "/pause", "c-5");
      expect(textOf(denied)).toBe("You are not allowed to run /pause here.");
      const nobody = await send("eve", "/status", "c-6");
      expect(textOf(nobody)).toBe("This sender is not configured for commands on this channel.");
      // pause drops the next message with a one-time notice, resume restores it.
      const paused = await send("bob", "/pause", "c-7");
      expect(textOf(paused)).toContain("Paused.");
      const dropped = await send("bob", "Channel probe: anyone there", "c-8");
      expect(textOf(dropped)).toBe("This conversation is paused. Send /resume to continue.");
      const silent = await send("bob", "Channel probe: still there", "c-9");
      expect(silent.body.replies).toEqual([]);
      const resumed = await send("bob", "/resume", "c-10");
      expect(textOf(resumed)).toBe("Resumed.");
      const back = await send("bob", "Channel probe: say hello again", "c-11");
      expect(back.body.queuedFinal).toBe(true);
      expect(back.body.replies.some((r) => r.kind === "final")).toBe(true);
    },
  );

  test(
    "a failed outbound post is retried with backoff and the delivery status shows it",
    { timeout: 90_000 },
    async () => {
      const before = posts.length;
      refuse = 2;
      const res = await client.post<InboundResponse>(
        "/api/channels/webhook/default/inbound",
        { from: "bob", text: "/status", messageId: "r-1" },
        { timeoutMs: 60_000 },
      );
      expect(res.status).toBe(200);
      expect(res.body.replies.length).toBeGreaterThan(0);
      expect(refused).toBe(2);
      await waitFor(async () => posts.length >= before + res.body.replies.length, {
        timeoutMs: 15_000,
        intervalMs: 100,
        what: "retried posts to land",
      });
      expect(posts.length).toBe(before + res.body.replies.length);

      const status = await client.get<{
        ok: boolean;
        channels: Record<string, { sent: number; retried: number; deadLettered: number }>;
        policy: string;
        deadLetterFiles: unknown[];
      }>("/api/channels/status");
      expect(status.status).toBe(200);
      expect(status.body.policy).toBe("human-triggered");
      expect(status.body.channels.webhook.retried).toBeGreaterThanOrEqual(2);
      expect(status.body.channels.webhook.deadLettered).toBe(0);
      // `sent` counts payload jobs; a job posts one or more chunks.
      expect(status.body.channels.webhook.sent).toBeGreaterThanOrEqual(1);
      expect(status.body.channels.webhook.sent).toBeLessThanOrEqual(posts.length);
      expect(status.body.deadLetterFiles).toEqual([]);

      const ws = await client.ws("channels.status", {});
      expect(ws.ok).toBe(true);
      const delivery = (
        ws.payload as { delivery?: { channels?: Record<string, { sent: number }> } }
      ).delivery;
      expect(delivery?.channels?.webhook.sent).toBe(status.body.channels.webhook.sent);
    },
  );

  test("a repeated provider message id is ignored", { timeout: 60_000 }, async () => {
    const before = posts.length;
    const res = await client.post<InboundResponse>(
      "/api/channels/webhook/default/inbound",
      { from: "bob", text: "Channel probe: say hello", messageId: "m-1" },
      { timeoutMs: 60_000 },
    );
    expect(res.status).toBe(200);
    expect(res.body.queuedFinal).toBe(false);
    expect(res.body.replies).toEqual([]);
    await new Promise((r) => setTimeout(r, 500));
    expect(posts.length).toBe(before);
  });

  test("bad input and unknown accounts are refused", { timeout: 30_000 }, async () => {
    const bad = await client.post<InboundResponse>("/api/channels/webhook/default/inbound", {
      text: "no sender",
    });
    expect(bad.status).toBe(400);
    const missing = await client.post<InboundResponse>("/api/channels/webhook/nope/inbound", {
      from: "bob",
      text: "x",
    });
    expect(missing.status).toBe(404);
    const noauth = await client.post<InboundResponse>(
      "/api/channels/webhook/default/inbound",
      { from: "bob", text: "x" },
      { token: null },
    );
    expect(noauth.status).toBe(401);
  });
});
