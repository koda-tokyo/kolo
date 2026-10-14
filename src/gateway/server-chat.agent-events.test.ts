import { describe, expect, it, vi } from "vitest";
import { createAgentEventHandler, createChatRunState } from "./server-chat.js";

describe("agent event handler", () => {
  it("emits chat delta for assistant text-only events", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const broadcast = vi.fn();
    const nodeSendToSession = vi.fn();
    const agentRunSeq = new Map<string, number>();
    const chatRunState = createChatRunState();
    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });

    const handler = createAgentEventHandler({
      broadcast,
      nodeSendToSession,
      agentRunSeq,
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
    });

    handler({
      runId: "run-1",
      seq: 1,
      stream: "assistant",
      ts: Date.now(),
      data: { text: "Hello world" },
    });

    const chatCalls = broadcast.mock.calls.filter(([event]) => event === "chat");
    expect(chatCalls).toHaveLength(1);
    const payload = chatCalls[0]?.[1] as {
      state?: string;
      message?: { content?: Array<{ text?: string }> };
    };
    expect(payload.state).toBe("delta");
    expect(payload.message?.content?.[0]?.text).toBe("Hello world");
    const sessionChatCalls = nodeSendToSession.mock.calls.filter(([, event]) => event === "chat");
    expect(sessionChatCalls).toHaveLength(1);
    nowSpy.mockRestore();
  });

  it("flushes a throttled message tail before the next assistant message starts", () => {
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const broadcast = vi.fn();
    const chatRunState = createChatRunState();
    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });
    const handler = createAgentEventHandler({
      broadcast,
      nodeSendToSession: vi.fn(),
      agentRunSeq: new Map<string, number>(),
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
    });
    const say = (seq: number, text: string) =>
      handler({ runId: "run-1", seq, stream: "assistant", ts: now, data: { text } });

    say(1, "Let me check");
    now += 50; // inside the 150 ms throttle: not sent
    say(2, "Let me check the gateway.");
    now += 50; // next message starts while the tail above is still unsent
    say(3, "Gateway healthy");

    const texts = broadcast.mock.calls
      .filter(([event]) => event === "chat")
      .map(
        ([, p]) =>
          (p as { message?: { content?: Array<{ text?: string }> } }).message?.content?.[0]?.text,
      );
    expect(texts).toEqual(["Let me check", "Let me check the gateway."]);
    nowSpy.mockRestore();
  });

  it("flushes a throttled message tail when a tool starts, even with tool events hidden", () => {
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const broadcast = vi.fn();
    const chatRunState = createChatRunState();
    chatRunState.registry.add("run-1", { sessionKey: "session-1", clientRunId: "client-1" });
    const handler = createAgentEventHandler({
      broadcast,
      nodeSendToSession: vi.fn(),
      agentRunSeq: new Map<string, number>(),
      chatRunState,
      resolveSessionKeyForRun: () => undefined,
      clearAgentRunContext: vi.fn(),
    });
    handler({ runId: "run-1", seq: 1, stream: "assistant", ts: now, data: { text: "Let me" } });
    now += 40; // throttled
    handler({
      runId: "run-1",
      seq: 2,
      stream: "assistant",
      ts: now,
      data: { text: "Let me look." },
    });
    now += 10;
    handler({
      runId: "run-1",
      seq: 3,
      stream: "tool",
      ts: now,
      data: { phase: "start", name: "exec", toolCallId: "t1" },
    });
    const texts = broadcast.mock.calls
      .filter(([event]) => event === "chat")
      .map(
        ([, p]) =>
          (p as { message?: { content?: Array<{ text?: string }> } }).message?.content?.[0]?.text,
      );
    expect(texts).toEqual(["Let me", "Let me look."]);
    nowSpy.mockRestore();
  });
});
