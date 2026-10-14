import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import type { WebhookOutboundPost } from "./webhook-channel.js";
import { resetInboundDedupe } from "../../auto-reply/reply/inbound-dedupe.js";
import {
  handleWebhookInbound,
  isWebhookSenderAllowed,
  listWebhookAccountIds,
  resolveWebhookAccount,
  validateWebhookInbound,
} from "./webhook-channel.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

let home = "";
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-webhook-"));
  for (const k of ["KOLO_HOME", "KOLO_STATE_DIR", "KOLO_CONFIG_PATH"]) {
    saved[k] = process.env[k];
  }
  process.env.KOLO_HOME = home;
  process.env.KOLO_STATE_DIR = home;
  process.env.KOLO_CONFIG_PATH = path.join(home, "kolo.json");
  resetInboundDedupe();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  fs.rmSync(home, { recursive: true, force: true });
});

const cfg = {
  agents: { list: [{ id: "alice", default: true }] },
  channels: {
    sessionMode: "per-conversation",
    webhook: {
      outboundUrl: "http://127.0.0.1:1/out",
      textChunkLimit: 12,
      allowFrom: ["bob"],
      accounts: { ops: { allowFrom: [] } },
    },
  },
} as unknown as KoLoConfig;

describe("webhook channel (M14a)", () => {
  test("validates the inbound body", () => {
    expect(validateWebhookInbound(null)).toBe("body must be a JSON object");
    expect(validateWebhookInbound({})).toBe("from is required");
    expect(validateWebhookInbound({ from: "bob" })).toBe("text or attachments is required");
    expect(validateWebhookInbound({ from: "bob", attachments: [{ name: "x" }] })).toBe(
      "each attachment needs name and dataBase64",
    );
    const ok = validateWebhookInbound({ from: "bob", text: "hi", chatType: "group" });
    expect(ok).toMatchObject({ from: "bob", text: "hi", chatType: "group", attachments: [] });
  });

  test("accounts merge the root config and respect enabled/allowFrom", () => {
    expect(listWebhookAccountIds(cfg)).toEqual(["default", "ops"]);
    expect(resolveWebhookAccount(cfg, "ops")?.outboundUrl).toBe("http://127.0.0.1:1/out");
    expect(resolveWebhookAccount(cfg, "nope")).toBeNull();
    expect(isWebhookSenderAllowed(resolveWebhookAccount(cfg)!, "BOB")).toBe(true);
    expect(isWebhookSenderAllowed(resolveWebhookAccount(cfg)!, "eve")).toBe(false);
    expect(isWebhookSenderAllowed(resolveWebhookAccount(cfg, "ops")!, "eve")).toBe(true);
  });

  test("routes to a per-conversation session, chunks replies and ignores a repeated message id", async () => {
    const posts: WebhookOutboundPost[] = [];
    const run = async () =>
      await handleWebhookInbound({
        cfg,
        accountId: "default",
        body: {
          from: "bob",
          name: "Bob",
          text: "hello there",
          messageId: "m1",
          attachments: [{ name: "note.txt", dataBase64: Buffer.from("x").toString("base64") }],
        },
        deliver: async (post) => {
          posts.push(post);
        },
        replyResolver: async () => ({ text: "one two three four five six" }),
      });
    const first = await run();
    expect(first.sessionKey).toBe("agent:alice:webhook:dm:bob");
    expect(first.agentId).toBe("alice");
    expect(first.queuedFinal).toBe(true);
    expect(posts.length).toBeGreaterThan(1);
    expect(posts.every((p) => p.text.length <= 12)).toBe(true);
    expect(
      posts
        .map((p) => p.text)
        .join(" ")
        .replace(/\s+/g, " "),
    ).toBe("one two three four five six");
    expect(posts[0]).toMatchObject({
      channel: "webhook",
      account: "default",
      to: "bob",
      chunk: 1,
      chunks: posts.length,
      replyToMessageId: "m1",
      sessionKey: "agent:alice:webhook:dm:bob",
    });
    expect(new Set(posts.map((p) => p.dedupeKey)).size).toBe(posts.length);
    expect(fs.existsSync(path.join(home, "inbox", "webhook"))).toBe(true);
    const store = JSON.parse(
      fs.readFileSync(path.join(home, "agents", "alice", "sessions", "sessions.json"), "utf8"),
    ) as Record<string, { lastChannel?: string; lastTo?: string }>;
    expect(store["agent:alice:webhook:dm:bob"]).toMatchObject({ lastChannel: "webhook" });

    const before = posts.length;
    const second = await run();
    expect(second.queuedFinal).toBe(false);
    expect(posts.length).toBe(before);
  });
});
