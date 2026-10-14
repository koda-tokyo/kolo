import { describe, expect, it, vi } from "vitest";
import type { TuiStateAccess } from "./tui-types.js";
import { createEventHandlers } from "./tui-event-handlers.js";

// Reproduces Owner's report: "your terminal does not show all your messages at times".
// One run = text, tool call, more text. The gateway streams only the current message's text.
const makeState = (): TuiStateAccess =>
  ({
    agentDefaultId: "orion",
    sessionMainKey: "agent:orion:owner",
    sessionScope: "global",
    agents: [],
    currentAgentId: "orion",
    currentSessionKey: "agent:orion:owner",
    currentSessionId: "s1",
    activeChatRunId: null,
    historyLoaded: true,
    sessionInfo: {},
    initialSessionApplied: true,
    isConnected: true,
    autoMessageSent: false,
    toolsExpanded: false,
    showThinking: false,
    connectionStatus: "connected",
    activityStatus: "idle",
    statusTimeout: null,
    lastCtrlCAt: 0,
  }) as TuiStateAccess;

const msg = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] });

let record: unknown[] = [];

function setup() {
  record = [];
  const shown = new Map<string, string>();
  const order: string[] = [];
  const put = (text: string, key = "default") => {
    if (!shown.has(key)) {
      order.push(key);
    }
    shown.set(key, text);
  };
  const chatLog = {
    startTool: vi.fn((id: string) => order.push(`tool:${id}`)),
    updateToolResult: vi.fn(),
    addSystem: vi.fn(),
    updateAssistant: vi.fn(put),
    finalizeAssistant: vi.fn(put),
    insertAssistantBefore: vi.fn((text: string, toolCallId: string) => {
      const at = order.indexOf(`tool:${toolCallId}`);
      order.splice(at < 0 ? order.length : at, 0, `fill:${text}`);
    }),
  };
  const state = makeState();
  const reconcileHistory = vi.fn(async () => {});
  const h = createEventHandlers({
    // oxlint-disable-next-line typescript/no-explicit-any
    chatLog: chatLog as any,
    // oxlint-disable-next-line typescript/no-explicit-any
    tui: { requestRender: vi.fn() } as any,
    state,
    setActivityStatus: vi.fn(),
    reconcileHistory,
    fetchRecordMessages: async () => record,
  });
  const chat = (state_: string, text?: string) =>
    h.handleChatEvent({
      runId: "r1",
      sessionKey: "agent:orion:owner",
      state: state_,
      message: text === undefined ? undefined : msg(text),
    });
  const tool = (id: string) =>
    h.handleAgentEvent({
      runId: "r1",
      stream: "tool",
      data: { phase: "start", toolCallId: id, name: "exec" },
    });
  return { shown, order, chat, tool, h, chatLog, reconcileHistory, state };
}

describe("tui segments: several assistant messages in one run", () => {
  it("keeps the text written before a tool call, and shows the tool between the two texts", () => {
    const { shown, order, chat, tool } = setup();
    chat("delta", "Let me check the gateway.");
    tool("t1");
    chat("delta", "Gateway is healthy.");
    chat("final", "Gateway is healthy. All green.");
    expect([...shown.values()]).toEqual([
      "Let me check the gateway.",
      "Gateway is healthy. All green.",
    ]);
    expect(order).toEqual(["r1", "tool:t1", "r1#1"]);
  });

  it("keeps earlier messages when tool events are hidden (verbose off)", () => {
    const { shown, chat } = setup();
    chat("delta", "First I will look");
    chat("delta", "First I will look at the logs.");
    chat("delta", "Found it.");
    chat("final", "Found it. The cron had no backoff.");
    expect([...shown.values()]).toEqual([
      "First I will look at the logs.",
      "Found it. The cron had no backoff.",
    ]);
  });

  it("shows the last message even if all its deltas were throttled away", () => {
    const { shown, chat } = setup();
    chat("delta", "Working on it.");
    chat("final", "Done.");
    expect([...shown.values()]).toEqual(["Working on it.", "Done."]);
  });

  it("single-message runs behave exactly as before", () => {
    const { shown, order, chat } = setup();
    chat("delta", "Hello");
    chat("delta", "Hello Owner");
    chat("final", "Hello Owner");
    expect(order).toEqual(["r1"]);
    expect(shown.get("r1")).toBe("Hello Owner");
  });

  it("does not add an empty bubble when the final carries no text", () => {
    const { shown, chat, tool } = setup();
    chat("delta", "Checking.");
    tool("t1");
    chat("final");
    expect([...shown.values()]).toEqual(["Checking."]);
  });
});

describe("tui segments: empty finals", () => {
  it("a background run that ends silently adds nothing", () => {
    const { shown, chat } = setup();
    chat("final");
    expect(shown.size).toBe(0);
  });

  it("a run typed in this terminal that ends empty still says (no output)", async () => {
    const { noteLocallySentRun } = await import("./gateway-chat.js");
    noteLocallySentRun("r1");
    const { shown, chat } = setup();
    chat("final");
    expect([...shown.values()]).toEqual(["(no output)"]);
  });
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("tui segments: record fill and reconnect", () => {
  it("fills a message the throttle swallowed whole, above its tool cell", async () => {
    const t = setup();
    record = [
      { role: "user", content: [{ type: "text", text: "check the gateway" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "toolCall", id: "t1", name: "exec", arguments: {} },
        ],
      },
    ];
    // the run was typed here (active), nothing streamed for this message, then the tool starts
    t.state.activeChatRunId = "r1";
    t.tool("t1");
    await wait(200);
    expect(t.chatLog.insertAssistantBefore).toHaveBeenCalledWith("Let me look.", "t1", null);
    expect(t.order).toEqual(["fill:Let me look.", "tool:t1"]);
  });

  it("does not fill when the message before the tool did stream", async () => {
    const t = setup();
    record = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me look." },
          { type: "toolCall", id: "t1", name: "exec", arguments: {} },
        ],
      },
    ];
    t.chat("delta", "Let me look.");
    t.tool("t1");
    await wait(200);
    expect(t.chatLog.insertAssistantBefore).not.toHaveBeenCalled();
    expect(t.order).toEqual(["r1", "tool:t1"]);
  });

  it("does not fill a tool-only message", async () => {
    const t = setup();
    record = [{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "exec" }] }];
    t.tool("t1");
    await wait(200);
    expect(t.chatLog.insertAssistantBefore).not.toHaveBeenCalled();
  });

  it("after a reconnect the run's final resyncs the screen from the record", async () => {
    const t = setup();
    t.chat("delta", "The lighthouse");
    t.h.handleReconnect(); // socket cut; the screen was redrawn from the record meanwhile
    t.chat("delta", "The lighthouse keeper climbed");
    t.chat("final", "The lighthouse keeper climbed the stairs.");
    // the stream after the cut lands in a fresh bubble (the old one was cleared with the screen)
    expect(t.shown.get("r1")).toBe("The lighthouse keeper climbed the stairs.");
    await wait(400);
    expect(t.reconcileHistory).toHaveBeenCalledTimes(1);
  });

  it("a single-message run without a reconnect does not resync", async () => {
    const t = setup();
    t.chat("delta", "Hello");
    t.chat("final", "Hello there.");
    await wait(400);
    expect(t.reconcileHistory).not.toHaveBeenCalled();
  });
});

describe("tui segments: housekeeping runs", () => {
  it("a background run answering NO_REPLY leaves nothing on screen, not even its prefix", async () => {
    const t = setup();
    // a run this terminal did not start (r1 is marked local by earlier tests in this file)
    const bg = (state_: string, text: string) =>
      t.h.handleChatEvent({
        runId: "bg1",
        sessionKey: "agent:orion:owner",
        state: state_,
        message: msg(text),
      });
    bg("delta", "NO");
    bg("final", "NO_REPLY");
    expect(t.order).toEqual([]);
    expect(t.chatLog.addSystem).not.toHaveBeenCalled();
  });
});
