import type { AssistantMessage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { type AgentEventPayload, onAgentEvent } from "../infra/agent-events.js";
import { subscribeEmbeddedPiSession } from "./pi-embedded-subscribe.js";
import {
  createReasoningTracker,
  type ReasoningEventData,
} from "./pi-embedded-subscribe.reasoning.js";

type Handler = (evt: unknown) => void;

function subscribe(runId: string) {
  let handler: Handler | undefined;
  const session = {
    subscribe: (fn: Handler) => {
      handler = fn;
      return () => {};
    },
  };
  subscribeEmbeddedPiSession({
    session: session as unknown as Parameters<typeof subscribeEmbeddedPiSession>[0]["session"],
    runId,
  });
  return (evt: unknown) => handler?.(evt);
}

const stops: Array<() => void> = [];
function collect(runId: string) {
  const events: AgentEventPayload[] = [];
  stops.push(
    onAgentEvent((evt) => {
      if (evt.runId === runId) {
        events.push(evt);
      }
    }),
  );
  return events;
}

afterEach(() => {
  for (const stop of stops.splice(0)) {
    stop();
  }
});

describe("createReasoningTracker", () => {
  it("emits deltas, one end with the duration, and restarts after reset", () => {
    let now = 1_000;
    const out: ReasoningEventData[] = [];
    const tracker = createReasoningTracker(
      (d) => out.push(d),
      () => now,
    );
    tracker.update("Let me");
    now += 500;
    tracker.update("Let me think");
    tracker.update("Let me think"); // unchanged: nothing
    now += 1_500;
    tracker.end();
    tracker.end(); // once
    expect(out).toEqual([
      { phase: "delta", text: "Let me", delta: "Let me", startedAt: 1_000 },
      { phase: "delta", text: "Let me think", delta: " think", startedAt: 1_000 },
      { phase: "end", text: "Let me think", startedAt: 1_000, durationMs: 2_000 },
    ]);
    tracker.reset();
    tracker.end(); // nothing to end
    expect(out).toHaveLength(3);
    expect(tracker.text).toBe("");
  });
});

describe("subscribeEmbeddedPiSession reasoning stream", () => {
  it("streams native thinking blocks live, before the answer text", () => {
    const events = collect("run-native");
    const send = subscribe("run-native");
    const partial = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "" }],
    } as unknown as AssistantMessage;
    send({ type: "message_start", message: { role: "assistant", content: [] } });
    (partial.content[0] as { thinking: string }).thinking = "Check the";
    send({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "thinking_delta", delta: "Check the", partial },
    });
    (partial.content[0] as { thinking: string }).thinking = "Check the config first.";
    send({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "thinking_delta", delta: " config first.", partial },
    });
    send({
      type: "message_update",
      message: partial,
      assistantMessageEvent: { type: "text_delta", delta: "The port is 18789." },
    });

    const streams = events.map(
      (e) => `${e.stream}:${typeof e.data.phase === "string" ? e.data.phase : ""}`,
    );
    expect(streams).toEqual(["reasoning:delta", "reasoning:delta", "reasoning:end", "assistant:"]);
    expect(events[1]?.data.text).toBe("Check the config first.");
    expect(events[3]?.data.text).toBe("The port is 18789.");
  });

  it("streams tagged reasoning from the text stream and keeps it out of the answer", () => {
    const events = collect("run-tagged");
    const send = subscribe("run-tagged");
    const msg = { role: "assistant", content: [] };
    send({ type: "message_start", message: msg });
    for (const delta of ["<think>Is the user", " asking about ports?", "</think>", "Yes: 18789."]) {
      send({
        type: "message_update",
        message: msg,
        assistantMessageEvent: { type: "text_delta", delta },
      });
    }
    const reasoning = events.filter((e) => e.stream === "reasoning");
    const answer = events.filter((e) => e.stream === "assistant");
    expect(reasoning.map((e) => e.data.text)).toEqual([
      "Is the user",
      "Is the user asking about ports?",
      "Is the user asking about ports?",
    ]);
    expect(reasoning.at(-1)?.data.phase).toBe("end");
    expect(answer.at(-1)?.data.text).toBe("Yes: 18789.");
    expect(String(answer.at(-1)?.data.text)).not.toContain("think");
  });
});
