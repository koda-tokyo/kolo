import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { KoLoConfig } from "../../config/config.js";
import type { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import { createExecApprovalForwarder } from "../../infra/exec-approval-forwarder.js";
import { createResidentApprovalForwarderDeps } from "./approval-bridge.js";
import {
  __resetChannelApprovalsForTest,
  buildApprovalAskPayload,
  getChannelApproval,
  listPendingChannelApprovals,
  parseApprovalReply,
  resolveChannelApproval,
  setChannelApprovalResolver,
  trackChannelApproval,
} from "./approvals.js";

vi.mock(import("../../audit/audit-log.js"), async (importOriginal) => ({
  ...(await importOriginal()),
  auditSafe: vi.fn(async () => null),
}));

beforeEach(() => {
  __resetChannelApprovalsForTest();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("channel approvals (M14b)", () => {
  test("builds a localized ask with approve/deny actions", () => {
    const ask = {
      id: "ap-9",
      kind: "exec" as const,
      summary: "command rm -rf build",
      createdAtMs: 0,
      expiresAtMs: 90_000,
    };
    const en = buildApprovalAskPayload(ask, "en", 0);
    expect(en.text).toContain("Approval needed (exec).");
    expect(en.text).toContain("Expires in 90 s.");
    expect(en.text).toContain("approve ap-9 or deny ap-9");
    expect(en.channelData?.actions).toEqual([
      { id: "approve", label: "Approve", value: "approve ap-9" },
      { id: "deny", label: "Deny", value: "deny ap-9" },
    ]);
    const ja = buildApprovalAskPayload(ask, "ja", 0);
    expect(ja.text).toContain("承認が必要です");
    const jaActions = ja.channelData?.actions as Array<{ label: string }>;
    expect(jaActions[1].label).toBe("拒否");
    const pt = buildApprovalAskPayload({ ...ask, expiresAtMs: 600_000 }, "pt", 0);
    expect(pt.text).toContain("Expira em 10 min.");
  });

  test("parses keyword replies", () => {
    expect(parseApprovalReply("approve a1")).toEqual({ id: "a1", decision: "allow-once" });
    expect(parseApprovalReply("/approve a1 allow-always")).toEqual({
      id: "a1",
      decision: "allow-always",
    });
    expect(parseApprovalReply("deny a1")).toEqual({ id: "a1", decision: "deny" });
    expect(parseApprovalReply("approve")).toBeNull();
    expect(parseApprovalReply("approved yesterday")).toBeNull();
  });

  test("resolution needs a tracked, unexpired ask and a resolver", async () => {
    const base = { decision: "allow-once" as const, resolvedBy: "line:U1", channel: "line" };
    expect(await resolveChannelApproval({ id: "x", ...base })).toEqual({
      ok: false,
      reason: "unknown",
    });
    trackChannelApproval({ id: "x", kind: "exec", summary: "", createdAtMs: 0, expiresAtMs: 10 });
    expect(await resolveChannelApproval({ id: "x", nowMs: 5, ...base })).toEqual({
      ok: false,
      reason: "no_resolver",
    });
    const resolver = vi.fn(() => true);
    setChannelApprovalResolver(resolver);
    expect(await resolveChannelApproval({ id: "x", nowMs: 5, ...base })).toEqual({
      ok: true,
      id: "x",
      decision: "allow-once",
    });
    expect(getChannelApproval("x")).toBeUndefined();
    trackChannelApproval({ id: "y", kind: "exec", summary: "", createdAtMs: 0, expiresAtMs: 10 });
    expect(await resolveChannelApproval({ id: "y", nowMs: 11, ...base })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(listPendingChannelApprovals(11)).toEqual([]);
  });

  test("forwarder round trip over a fake channel: ask, keyword answer, resolved notice, expiry", async () => {
    const sent: Array<{ channel: string; to: string; payload: ReplyPayload }> = [];
    const deliver = (async (params) => {
      for (const payload of params.payloads) {
        sent.push({ channel: params.channel, to: params.to, payload });
      }
      return [];
    }) as unknown as typeof deliverOutboundPayloads;
    const cfg = {
      channels: {
        approvals: { targets: [{ channel: "slack", to: "C-OPS" }] },
        slack: { locale: "pt" },
      },
    } as unknown as KoLoConfig;
    let now = 1_000;
    const forwarder = createExecApprovalForwarder(
      createResidentApprovalForwarderDeps({ getConfig: () => cfg, deliver, nowMs: () => now }),
    );
    const request = {
      id: "ap-1",
      request: { command: "ls -la", cwd: "/srv", agentId: "alice", sessionKey: "agent:alice:main" },
      createdAtMs: now,
      expiresAtMs: now + 30_000,
    };
    await forwarder.handleRequested(request);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "slack", to: "C-OPS" });
    expect(sent[0].payload.text).toContain("Aprovação necessária (exec).");
    expect(sent[0].payload.text).toContain("command ls -la\ncwd /srv\nagent alice");
    expect(sent[0].payload.channelData?.approvalId).toBe("ap-1");
    expect(getChannelApproval("ap-1")?.kind).toBe("exec");

    // The person answers on the channel; the gateway resolver resolves the manager.
    const resolver = vi.fn(async (id: string, decision: string, by: string) => {
      await forwarder.handleResolved({
        id,
        decision: decision as "allow-once",
        resolvedBy: by,
        ts: now,
      });
      return true;
    });
    setChannelApprovalResolver(resolver);
    const result = await resolveChannelApproval({
      id: "ap-1",
      decision: "allow-once",
      resolvedBy: "slack:U7",
      channel: "slack",
      nowMs: now,
    });
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[1].payload.text).toBe("Aprovação ap-1: permitido uma vez (por slack:U7).");
    expect(getChannelApproval("ap-1")).toBeUndefined();

    // A second ask that nobody answers expires and says so.
    await forwarder.handleRequested({ ...request, id: "ap-2", expiresAtMs: now + 5_000 });
    expect(getChannelApproval("ap-2")).toBeDefined();
    now += 6_000;
    await vi.advanceTimersByTimeAsync(5_100);
    expect(sent.at(-1)?.payload.text).toBe("A aprovação ap-2 expirou sem resposta.");
    expect(getChannelApproval("ap-2")).toBeUndefined();
    forwarder.stop();
  });

  test("without targets and without approvals.exec nothing is forwarded", async () => {
    const deliver = vi.fn(async () => []) as unknown as typeof deliverOutboundPayloads;
    const forwarder = createExecApprovalForwarder(
      createResidentApprovalForwarderDeps({ getConfig: () => ({}) as KoLoConfig, deliver }),
    );
    await forwarder.handleRequested({
      id: "z",
      request: { command: "ls" },
      createdAtMs: 0,
      expiresAtMs: 1000,
    });
    expect(deliver).not.toHaveBeenCalled();
    expect(getChannelApproval("z")).toBeUndefined();
  });
});
