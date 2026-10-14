import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { FinalizedMsgContext } from "../../auto-reply/templating.js";
import type { KoLoConfig } from "../../config/config.js";
import { onChannelInbound, resetChannelInboundListenersForTest } from "./inbound-bus.js";
import { applyResidentNotes, prepareResidentInbound } from "./ingress.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

let home = "";
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-ingress-"));
  env = { KOLO_HOME: home, KOLO_STATE_DIR: home };
});
afterEach(() => {
  resetChannelInboundListenersForTest();
  fs.rmSync(home, { recursive: true, force: true });
});

const cfg = {
  agents: { list: [{ id: "alice", default: true }] },
  channels: { line: { locale: "ja", identities: { U1: "admin" } } },
} as unknown as KoLoConfig;

function ctxOf(over: Partial<FinalizedMsgContext> = {}): FinalizedMsgContext {
  return {
    Body: "hello",
    RawBody: "hello",
    BodyForAgent: "hello",
    From: "line:U1",
    To: "line:U1",
    SessionKey: "agent:alice:line:dm:u1",
    Provider: "line",
    Surface: "line",
    OriginatingChannel: "line" as FinalizedMsgContext["OriginatingChannel"],
    OriginatingTo: "U1",
    SenderId: "U1",
    SenderName: "Alice",
    MessageSid: "msg-1",
    ChatType: "direct",
    CommandAuthorized: false,
    ...over,
  } as FinalizedMsgContext;
}

describe("resident ingress (M14a)", () => {
  test("resolves role and locale, announces the message and copies attachments", () => {
    const media = path.join(home, "photo.jpg");
    fs.writeFileSync(media, Buffer.alloc(10));
    const events: unknown[] = [];
    onChannelInbound((evt) => events.push(evt));
    const ctx = ctxOf({ MediaPaths: [media], MediaPath: media });
    const inbound = prepareResidentInbound({ ctx, cfg, env });
    expect(inbound).not.toBeNull();
    expect(inbound?.identity).toEqual({ role: "admin", source: "configured", matched: "u1" });
    expect(inbound?.locale).toBe("ja");
    expect(inbound?.agentId).toBe("alice");
    expect(inbound?.attachments).toHaveLength(1);
    expect(ctx.InboxPaths?.[0]).toContain(path.join("inbox", "line"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "line",
      sessionKey: "agent:alice:line:dm:u1",
      sender: { id: "U1", name: "Alice", role: "admin" },
      text: "hello",
      messageId: "msg-1",
    });
    applyResidentNotes(ctx, inbound!);
    expect(ctx.BodyForAgent).toContain("inbox ");
    expect(ctx.BodyForAgent).toContain("添付ファイル 1 件");
  });

  test("returns null without a channel and never throws on a missing file", () => {
    expect(
      prepareResidentInbound({
        ctx: ctxOf({ Provider: undefined, Surface: undefined, OriginatingChannel: undefined }),
        cfg,
        env,
      }),
    ).toBeNull();
    const inbound = prepareResidentInbound({
      ctx: ctxOf({ MediaPaths: [path.join(home, "nope.bin")] }),
      cfg,
      env,
    });
    expect(inbound?.attachments).toEqual([]);
    expect(inbound?.notes).toEqual([]);
  });

  test("channel authorization stands in for owner when no identities are configured", () => {
    const plain = { agents: cfg.agents } as KoLoConfig;
    const yes = prepareResidentInbound({
      ctx: ctxOf({ CommandAuthorized: true }),
      cfg: plain,
      env,
    });
    expect(yes?.identity?.role).toBe("owner");
    const no = prepareResidentInbound({ ctx: ctxOf(), cfg: plain, env });
    expect(no?.identity).toBeNull();
    expect(no?.locale).toBe("en");
  });
});
