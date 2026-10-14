import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KoLoConfig } from "../config/config.js";

const sessionState = vi.hoisted(() => ({
  cfg: {} as Record<string, unknown>,
  entry: undefined as Record<string, unknown> | undefined,
  policyExposure: undefined as false | undefined,
}));

vi.mock("./session-utils.js", () => ({
  loadSessionEntry: () => ({ cfg: sessionState.cfg, entry: sessionState.entry }),
}));
vi.mock("../policy/engine.js", () => ({
  getPolicyEngine: () => ({ reasoningExposure: () => sessionState.policyExposure }),
}));

const { createAgentEventHandler, createChatRunState } = await import("./server-chat.js");
const { prepareHistoryReasoning, resolveReasoningExposure, MAX_CHAT_REASONING_CHARS } =
  await import("./server-chat-reasoning.js");

type ChatPayload = {
  state: string;
  message?: { content?: Array<{ type?: string; text?: string }> };
  reasoning?: { text: string; state: string; startedAt: number; durationMs?: number };
};

function setup() {
  let now = 10_000;
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  const broadcast = vi.fn();
  const chatRunState = createChatRunState();
  chatRunState.registry.add("run-1", { sessionKey: "agent:main:main", clientRunId: "client-1" });
  const handler = createAgentEventHandler({
    broadcast,
    nodeSendToSession: vi.fn(),
    agentRunSeq: new Map<string, number>(),
    chatRunState,
    resolveSessionKeyForRun: () => undefined,
    clearAgentRunContext: vi.fn(),
  });
  let seq = 0;
  const emit = (stream: string, data: Record<string, unknown>) =>
    handler({ runId: "run-1", seq: ++seq, stream, ts: now, data });
  const chats = () =>
    broadcast.mock.calls.filter(([event]) => event === "chat").map(([, p]) => p as ChatPayload);
  const agents = () =>
    broadcast.mock.calls
      .filter(([event]) => event === "agent")
      .map(([, p]) => p as { stream: string });
  return {
    emit,
    chats,
    agents,
    advance: (ms: number) => {
      now += ms;
    },
    restore: () => nowSpy.mockRestore(),
  };
}

beforeEach(() => {
  sessionState.cfg = {};
  sessionState.entry = undefined;
  sessionState.policyExposure = undefined;
});

describe("chat stream reasoning", () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it("streams redacted reasoning deltas live, before the answer and the final", () => {
    const t = setup();
    restore = t.restore;
    t.emit("lifecycle", { phase: "start" });
    t.emit("reasoning", { phase: "delta", text: "Check the", startedAt: 10_000 });
    t.advance(200);
    t.emit("reasoning", {
      phase: "delta",
      text: "Check the token sk-abcdefghijklmnopqrstuvwx first",
      startedAt: 10_000,
    });
    t.advance(1_800);
    t.emit("reasoning", {
      phase: "end",
      text: "Check the token sk-abcdefghijklmnopqrstuvwx first",
      startedAt: 10_000,
      durationMs: 2_000,
    });
    t.emit("assistant", { text: "Done." });
    t.advance(200);
    t.emit("lifecycle", { phase: "end" });

    const chats = t.chats();
    expect(chats.map((c) => `${c.state}:${c.reasoning?.state ?? "-"}`)).toEqual([
      "delta:streaming",
      "delta:streaming",
      "delta:done",
      "final:done",
    ]);
    // Reasoning arrived before any answer text and before the final.
    expect(chats[0]?.message?.content?.[0]?.text).toBe("");
    expect(chats[0]?.reasoning?.text).toBe("Check the");
    expect(chats[2]?.reasoning?.durationMs).toBe(2_000);
    // Secrets never leave the gateway, in any event.
    for (const c of chats) {
      expect(c.reasoning?.text ?? "").not.toContain("sk-abcdefghijklmnopqrstuvwx");
    }
    expect(chats[1]?.reasoning?.text).toContain("sk-abc");
    const final = chats.at(-1);
    expect(final?.message?.content?.[0]?.text).toBe("Done.");
    expect(final?.reasoning?.durationMs).toBe(2_000);
    // The raw agent event is never broadcast.
    expect(t.agents().some((a) => a.stream === "reasoning")).toBe(false);
  });

  it("sends nothing when agents.defaults.reasoning.expose is false", () => {
    sessionState.cfg = { agents: { defaults: { reasoning: { expose: false } } } };
    const t = setup();
    restore = t.restore;
    t.emit("reasoning", { phase: "delta", text: "secret plan", startedAt: 10_000 });
    t.emit("reasoning", { phase: "end", text: "secret plan", startedAt: 10_000, durationMs: 5 });
    t.emit("assistant", { text: "Answer" });
    t.emit("lifecycle", { phase: "end" });
    const chats = t.chats();
    expect(chats.length).toBeGreaterThan(0);
    expect(chats.every((c) => c.reasoning === undefined)).toBe(true);
    expect(JSON.stringify(chats)).not.toContain("secret plan");
  });

  it("honours a policy that forbids exposure and a session view of off", () => {
    sessionState.policyExposure = false;
    const t = setup();
    restore = t.restore;
    t.emit("reasoning", { phase: "end", text: "hidden", startedAt: 10_000, durationMs: 5 });
    t.emit("lifecycle", { phase: "end" });
    expect(JSON.stringify(t.chats())).not.toContain("hidden");
  });

  it("does not carry one message's reasoning over to the next message after a tool", () => {
    const t = setup();
    restore = t.restore;
    t.emit("reasoning", { phase: "end", text: "Need the file", startedAt: 10_000, durationMs: 3 });
    t.emit("tool", { phase: "start", name: "read", toolCallId: "c1" });
    t.advance(500);
    t.emit("assistant", { text: "The file says hello." });
    t.advance(500);
    t.emit("lifecycle", { phase: "end" });
    const chats = t.chats();
    const final = chats.at(-1);
    expect(final?.state).toBe("final");
    expect(final?.reasoning).toBeUndefined();
    expect(
      chats.find((c) => c.message?.content?.[0]?.text === "The file says hello.")?.reasoning,
    ).toBeUndefined();
  });
});

describe("resolveReasoningExposure", () => {
  const base = (cfg: Record<string, unknown>, entry?: Record<string, unknown>) =>
    resolveReasoningExposure({
      cfg: cfg as KoLoConfig,
      sessionKey: "agent:ops-bot:main",
      entry: entry as never,
      policyExposure: () => undefined,
    });

  it("defaults to exposed", () => {
    expect(base({})).toBe(true);
  });

  it("lets the agent entry override the defaults", () => {
    const cfg = {
      agents: {
        defaults: { reasoning: { expose: false } },
        list: [{ id: "ops-bot", reasoning: { expose: true } }],
      },
    };
    expect(base(cfg)).toBe(true);
    expect(base({ agents: { list: [{ id: "ops-bot", reasoning: { expose: false } }] } })).toBe(
      false,
    );
  });

  it("hides reasoning for a session whose view is off", () => {
    expect(base({}, { reasoningView: "off" })).toBe(false);
    expect(base({}, { reasoningView: "expanded" })).toBe(true);
  });

  it("lets the policy restrict but not widen", () => {
    expect(
      resolveReasoningExposure({
        cfg: {} as KoLoConfig,
        sessionKey: "agent:ops-bot:main",
        policyExposure: () => false,
      }),
    ).toBe(false);
  });
});

describe("prepareHistoryReasoning", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "use Bearer abcdefghijklmnopqrstuvwxyz0123" },
        { type: "text", text: "hello" },
      ],
    },
  ];

  it("redacts thinking blocks when exposed", () => {
    const out = prepareHistoryReasoning(messages, true) as typeof messages;
    const thinking = (out[1].content[0] as { thinking: string }).thinking;
    expect(thinking).not.toContain("abcdefghijklmnopqrstuvwxyz0123");
    expect(out[1]?.content[1]).toEqual({ type: "text", text: "hello" });
    expect(out[0]).toBe(messages[0]);
  });

  it("drops thinking blocks when not exposed", () => {
    const out = prepareHistoryReasoning(messages, false) as typeof messages;
    expect(out[1]?.content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("bounds what a chat event carries", () => {
    expect(MAX_CHAT_REASONING_CHARS).toBeGreaterThan(1024);
  });
});
