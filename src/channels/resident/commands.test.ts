import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { KoLoConfig } from "../../config/config.js";
import type { ResidentInbound } from "./ingress.js";
import { __resetJobsForTest, completeJob, startJob } from "../../agents/jobs.js";
import {
  __resetChannelApprovalsForTest,
  setChannelApprovalResolver,
  trackChannelApproval,
} from "./approvals.js";
import { handleResidentCommand, parseResidentCommand } from "./commands.js";
import { residentGate } from "./ingress.js";
import { __resetPauseForTest } from "./pause.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

let home = "";
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cmd-"));
  for (const k of ["KOLO_HOME", "KOLO_STATE_DIR"]) {
    saved[k] = process.env[k];
    process.env[k] = home;
  }
  __resetJobsForTest({ keepLoaded: true });
  __resetPauseForTest();
  __resetChannelApprovalsForTest();
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

// The channel carries identities so the resident `/status` and `/help` take over from the
// built-in channel commands (see commands.ts).
const cfg = {
  agents: { list: [{ id: "alice", default: true }] },
  channels: { line: { identities: { U1: "owner" } } },
} as unknown as KoLoConfig;

function inboundOf(
  text: string,
  role: "owner" | "admin" | "attach" | null,
  over: Partial<ResidentInbound> = {},
): ResidentInbound {
  return {
    channel: "line",
    accountId: "default",
    sessionKey: "agent:alice:line:dm:u1",
    agentId: "alice",
    identity: role ? { role, source: "configured" } : null,
    locale: "en",
    messageId: "m1",
    senderId: "U1",
    senderName: "Alice",
    conversationId: "U1",
    text,
    attachments: [],
    notes: [],
    ...over,
  };
}

describe("resident commands (M14b)", () => {
  test("parses commands, colon forms and approval keywords; ignores other text", () => {
    expect(parseResidentCommand("/status")).toMatchObject({ name: "status", args: [] });
    expect(parseResidentCommand("/cancel: abc")).toMatchObject({ name: "cancel", args: ["abc"] });
    expect(parseResidentCommand("/evidence abc\nmore")).toMatchObject({ name: "evidence" });
    expect(parseResidentCommand("approve j-1")).toMatchObject({
      name: "approve",
      args: ["j-1", "allow-once"],
    });
    expect(parseResidentCommand("/approve j-1 allow-always")).toMatchObject({
      args: ["j-1", "allow-always"],
    });
    expect(parseResidentCommand("Deny j-1")).toMatchObject({ name: "deny", args: ["j-1", "deny"] });
    expect(parseResidentCommand("/new")).toBeNull();
    expect(parseResidentCommand("hello")).toBeNull();
  });

  test("permission matrix: attach reads, admin acts, unknown senders are refused", async () => {
    const help = await handleResidentCommand({ inbound: inboundOf("/help", "attach"), cfg });
    expect(help?.outcome).toBe("ok");
    expect(help?.reply).toContain("/status");
    expect(help?.reply).toContain("Your role here: attach.");
    const cancel = await handleResidentCommand({ inbound: inboundOf("/cancel x", "attach"), cfg });
    expect(cancel).toMatchObject({ outcome: "denied" });
    expect(cancel?.reply).toBe("You are not allowed to run /cancel here.");
    const nobody = await handleResidentCommand({ inbound: inboundOf("/status", null), cfg });
    expect(nobody?.outcome).toBe("denied");
    const japanese = await handleResidentCommand({
      inbound: inboundOf("/pause", "attach", { locale: "ja" }),
      cfg,
    });
    expect(japanese?.reply).toBe("/pause を実行する権限がありません。");
    expect(
      await handleResidentCommand({ inbound: inboundOf("plain text", "owner"), cfg }),
    ).toBeNull();
  });

  test("/status, /jobs, /cancel and /evidence read the jobs registry", async () => {
    const running = startJob({ agent: "alice", sessionKey: "agent:alice:main" });
    const done = startJob({ agent: "alice", sessionKey: "agent:alice:main" });
    completeJob(done.id, { status: "succeeded" });
    startJob({ agent: "bob", sessionKey: "agent:bob:main" });

    const status = await handleResidentCommand({ inbound: inboundOf("/status", "attach"), cfg });
    expect(status?.reply).toContain("resident alice");
    expect(status?.reply).toContain("jobs running 0, queued 1");
    expect(status?.reply).toContain("conversation active");

    const jobs = await handleResidentCommand({ inbound: inboundOf("/jobs", "attach"), cfg });
    expect(jobs?.reply.split("\n")).toHaveLength(3);
    expect(jobs?.reply).not.toContain("bob");

    const missing = await handleResidentCommand({ inbound: inboundOf("/cancel", "admin"), cfg });
    expect(missing?.reply).toBe("Usage: /cancel <id>");
    const cancelled = await handleResidentCommand({
      inbound: inboundOf(`/cancel ${running.id.slice(0, 8)}`, "admin"),
      cfg,
    });
    expect(cancelled?.reply).toBe(`Job ${running.id.slice(0, 8)} cancelled.`);
    const again = await handleResidentCommand({
      inbound: inboundOf(`/cancel ${running.id}`, "owner", { locale: "pt" }),
      cfg,
    });
    expect(again?.reply).toBe(`O job ${running.id.slice(0, 8)} já terminou (cancelled).`);

    const ev = await handleResidentCommand({
      inbound: inboundOf(`/evidence ${done.id}`, "attach"),
      cfg,
    });
    expect(ev?.reply).toBe(`No evidence recorded for job ${done.id}.`);
  });

  test("/pause drops messages with a one-time notice until /resume; commands still work", async () => {
    const pause = await handleResidentCommand({ inbound: inboundOf("/pause", "admin"), cfg });
    expect(pause?.reply).toContain("Paused.");
    expect(
      (await handleResidentCommand({ inbound: inboundOf("/pause", "admin"), cfg }))?.reply,
    ).toBe("Already paused.");
    const first = await residentGate({ inbound: inboundOf("hello", "attach"), cfg });
    expect(first?.reply).toBe("This conversation is paused. Send /resume to continue.");
    const second = await residentGate({ inbound: inboundOf("hello again", "attach"), cfg });
    expect(second?.reply).toBe("");
    const status = await residentGate({ inbound: inboundOf("/status", "attach"), cfg });
    expect(status?.reply).toContain("conversation paused");
    const resume = await residentGate({ inbound: inboundOf("/resume", "owner"), cfg });
    expect(resume?.reply).toBe("Resumed.");
    expect(await residentGate({ inbound: inboundOf("hello", "attach"), cfg })).toBeNull();
    expect((await residentGate({ inbound: inboundOf("/resume", "owner"), cfg }))?.reply).toBe(
      "Not paused.",
    );
  });

  test("approve/deny resolve a tracked ask through the registered resolver", async () => {
    const resolver = vi.fn(async () => true);
    setChannelApprovalResolver(resolver);
    trackChannelApproval({
      id: "ap-1",
      kind: "exec",
      summary: "command ls",
      createdAtMs: 0,
      expiresAtMs: Date.now() + 60_000,
    });
    const unknown = await handleResidentCommand({
      inbound: inboundOf("approve nope", "admin"),
      cfg,
    });
    expect(unknown?.reply).toBe("No pending approval with id nope.");
    const refused = await handleResidentCommand({
      inbound: inboundOf("approve ap-1", "attach"),
      cfg,
    });
    expect(refused?.outcome).toBe("denied");
    expect(resolver).not.toHaveBeenCalled();
    const listed = await handleResidentCommand({
      inbound: inboundOf("approve ap-1 allow-always", null, { senderId: "ops-bot" }),
      cfg: {
        ...cfg,
        channels: { ...cfg.channels, approvals: { identities: ["OPS-BOT"] } },
      } as KoLoConfig,
    });
    expect(listed?.reply).toBe("Approval ap-1: allowed always (by Alice).");
    expect(resolver).toHaveBeenCalledWith("ap-1", "allow-always", "line:ops-bot");
    const gone = await handleResidentCommand({ inbound: inboundOf("deny ap-1", "owner"), cfg });
    expect(gone?.outcome).toBe("error");
  });
});

describe("resident commands without identities (M14b)", () => {
  test("/status and /help fall through to the built-in channel commands; new names stay ours", async () => {
    const plain = { agents: { list: [{ id: "alice", default: true }] } } as unknown as KoLoConfig;
    expect(
      await handleResidentCommand({ inbound: inboundOf("/status", "owner"), cfg: plain }),
    ).toBeNull();
    expect(
      await handleResidentCommand({ inbound: inboundOf("/help", "owner"), cfg: plain }),
    ).toBeNull();
    const jobs = await handleResidentCommand({ inbound: inboundOf("/jobs", "owner"), cfg: plain });
    expect(jobs?.reply).toBe("No jobs yet.");
  });
});
