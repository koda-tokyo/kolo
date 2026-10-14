import { describe, expect, it, vi } from "vitest";
import type { ReasoningSnapshot } from "./components/reasoning-block.js";
import type { TuiStateAccess } from "./tui-types.js";
import { createEventHandlers } from "./tui-event-handlers.js";

const makeState = (): TuiStateAccess =>
  ({
    agentDefaultId: "ops-bot",
    sessionMainKey: "agent:ops-bot:main",
    sessionScope: "global",
    agents: [],
    currentAgentId: "ops-bot",
    currentSessionKey: "agent:ops-bot:main",
    currentSessionId: "s1",
    activeChatRunId: null,
    historyLoaded: true,
    sessionInfo: {},
    initialSessionApplied: true,
    isConnected: true,
    autoMessageSent: false,
    toolsExpanded: false,
    showThinking: true,
    reasoningLayout: "collapsed",
    connectionStatus: "connected",
    activityStatus: "idle",
    statusTimeout: null,
    lastCtrlCAt: 0,
  }) as TuiStateAccess;

type Shown = { text: string; reasoning: ReasoningSnapshot | null | undefined; final: boolean };

function setup() {
  const shown = new Map<string, Shown>();
  const order: string[] = [];
  const put =
    (final: boolean) =>
    (text: string, key = "default", reasoning?: ReasoningSnapshot | null) => {
      if (!shown.has(key)) {
        order.push(key);
      }
      const prev = shown.get(key);
      shown.set(key, { text, reasoning: reasoning ?? prev?.reasoning, final });
    };
  const chatLog = {
    startTool: vi.fn((id: string) => order.push(`tool:${id}`)),
    updateToolResult: vi.fn(),
    addSystem: vi.fn(),
    updateAssistant: vi.fn(put(false)),
    finalizeAssistant: vi.fn(put(true)),
    insertAssistantBefore: vi.fn(),
  };
  const activity: string[] = [];
  const h = createEventHandlers({
    // oxlint-disable-next-line typescript/no-explicit-any
    chatLog: chatLog as any,
    // oxlint-disable-next-line typescript/no-explicit-any
    tui: { requestRender: vi.fn() } as any,
    state: makeState(),
    setActivityStatus: (s) => activity.push(s),
  });
  const chat = (
    state: string,
    text: string,
    reasoning?: { text: string; state: string; startedAt: number; durationMs?: number },
  ) =>
    h.handleChatEvent({
      runId: "r1",
      sessionKey: "agent:ops-bot:main",
      state,
      message: { role: "assistant", content: [{ type: "text", text }] },
      reasoning,
    });
  const tool = (id: string) =>
    h.handleAgentEvent({
      runId: "r1",
      stream: "tool",
      data: { phase: "start", toolCallId: id, name: "read" },
    });
  return { shown, order, chat, tool, activity, chatLog };
}

describe("tui reasoning stream", () => {
  it("shows reasoning before the answer in the same bubble, then marks it done", () => {
    const t = setup();
    t.chat("delta", "", { text: "Check the config", state: "streaming", startedAt: 1 });
    expect(t.shown.get("r1")).toMatchObject({
      text: "",
      reasoning: { text: "Check the config", state: "streaming" },
    });
    expect(t.activity.at(-1)).toBe("thinking");
    t.chat("delta", "Port 18789.", {
      text: "Check the config",
      state: "done",
      startedAt: 1,
      durationMs: 4_000,
    });
    t.chat("final", "Port 18789.", {
      text: "Check the config",
      state: "done",
      startedAt: 1,
      durationMs: 4_000,
    });
    expect(t.order).toEqual(["r1"]);
    expect(t.shown.get("r1")).toMatchObject({
      text: "Port 18789.",
      final: true,
      reasoning: { state: "done", durationMs: 4_000 },
    });
  });

  it("gives the next message's reasoning its own bubble after a tool", () => {
    const t = setup();
    t.chat("delta", "", { text: "Need the file", state: "done", startedAt: 1, durationMs: 10 });
    t.tool("c1");
    t.chat("delta", "", { text: "The file says 18789", state: "streaming", startedAt: 2 });
    t.chat("final", "It is 18789.", {
      text: "The file says 18789",
      state: "done",
      startedAt: 2,
      durationMs: 20,
    });
    expect(t.order).toEqual(["r1", "tool:c1", "r1#1"]);
    expect(t.shown.get("r1")).toMatchObject({ text: "", final: true });
    expect(t.shown.get("r1")?.reasoning?.text).toBe("Need the file");
    expect(t.shown.get("r1#1")).toMatchObject({ text: "It is 18789.", final: true });
    expect(t.shown.get("r1#1")?.reasoning?.text).toBe("The file says 18789");
  });

  it("starts a new bubble when a new message thinks after an answer without a tool", () => {
    const t = setup();
    t.chat("delta", "First answer.");
    t.chat("delta", "", { text: "Second thoughts", state: "streaming", startedAt: 5 });
    expect(t.order).toEqual(["r1", "r1#1"]);
    expect(t.shown.get("r1")).toMatchObject({ text: "First answer.", final: true });
  });

  it("splits <think> tags out of the text of tag-emitting models", () => {
    const t = setup();
    t.chat("delta", "<think>Is it the port");
    t.chat("final", "<think>Is it the port?</think>Yes, 18789.");
    expect(t.shown.get("r1")).toMatchObject({ text: "Yes, 18789.", final: true });
    expect(t.shown.get("r1")?.reasoning?.text).toBe("Is it the port?");
  });
});
