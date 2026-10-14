import { describe, expect, it } from "vitest";
import { createRenderScheduler } from "./render-scheduler.js";
import { createEventHandlers } from "./tui-event-handlers.js";

describe("render scheduler", () => {
  it("renders at once when idle and coalesces while busy", async () => {
    let renders = 0;
    const scheduler = createRenderScheduler({ requestRender: () => renders++ }, { intervalMs: 20 });
    scheduler.request();
    expect(renders).toBe(1);
    for (let i = 0; i < 100; i++) {
      scheduler.request();
    }
    expect(renders).toBe(1); // one trailing draw is scheduled, not 100
    await new Promise((r) => setTimeout(r, 40));
    expect(renders).toBe(2);
    scheduler.stop();
  });

  it("keeps a fake stream of 2000 deltas far below one render per delta", async () => {
    let renders = 0;
    const tui = { requestRender: () => renders++ } as never;
    const scheduler = createRenderScheduler({ requestRender: () => renders++ }, { intervalMs: 33 });
    const texts: string[] = [];
    const chatLog = {
      updateAssistant: (text: string) => texts.push(text),
      finalizeAssistant: () => {},
      addSystem: () => {},
      startTool: () => {},
      updateToolResult: () => {},
      insertAssistantBefore: () => {},
    } as never;
    const state = {
      currentSessionKey: "agent:main:main",
      activeChatRunId: "run-1",
      showThinking: false,
      runSteps: 0,
    } as never;
    const { handleChatEvent } = createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus: () => {},
      render: scheduler,
    });
    const started = Date.now();
    const deltas = 2000;
    let text = "";
    for (let i = 0; i < deltas; i++) {
      text += "x";
      handleChatEvent({
        runId: "run-1",
        sessionKey: "agent:main:main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text }] },
      });
    }
    const elapsedMs = Date.now() - started;
    await new Promise((r) => setTimeout(r, 50));
    const budget = Math.ceil(elapsedMs / 33) + 3;
    // The screen still received every delta; only the draws were coalesced.
    expect(texts).toHaveLength(deltas);
    expect(renders).toBeLessThanOrEqual(budget);
    expect(renders).toBeLessThan(deltas / 10);
    process.stdout.write(
      `fake stream: ${deltas} deltas in ${elapsedMs}ms -> ${renders} renders (budget ${budget})\n`,
    );
    scheduler.stop();
  });
});
