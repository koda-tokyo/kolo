import { describe, expect, it } from "vitest";
import { splitTaggedReasoning } from "./tui-formatters.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";

const text = (t: string) => ({ role: "assistant", content: [{ type: "text", text: t }] });

describe("TuiStreamAssembler", () => {
  it("keeps thinking blocks apart from the answer, whatever order they arrive in", () => {
    const assembler = new TuiStreamAssembler();
    const first = assembler.ingestDelta("run-1", text("Hello"));
    expect(first).toEqual({ content: "Hello", reasoning: null });

    const second = assembler.ingestDelta("run-1", {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Brain" }],
    });
    expect(second?.content).toBe("Hello");
    expect(second?.reasoning?.text).toBe("Brain");
    // The answer already started, so the reasoning is complete.
    expect(second?.reasoning?.state).toBe("done");
  });

  it("takes the gateway's reasoning field, streaming before any answer text", () => {
    const assembler = new TuiStreamAssembler();
    const view = assembler.ingestDelta("run-2", text(""), {
      text: "Which port?",
      state: "streaming",
      startedAt: 1_000,
    });
    expect(view).toEqual({
      content: "",
      reasoning: { text: "Which port?", state: "streaming", startedAt: 1_000 },
    });
    const done = assembler.ingestDelta("run-2", text("18789"), {
      text: "Which port?",
      state: "done",
      startedAt: 1_000,
      durationMs: 1_200,
    });
    expect(done?.content).toBe("18789");
    expect(done?.reasoning).toMatchObject({ state: "done", durationMs: 1_200 });
    // A final without reasoning keeps what was streamed, marked done.
    const final = assembler.finalize("run-2", text("18789"));
    expect(final.reasoning).toMatchObject({
      text: "Which port?",
      state: "done",
      durationMs: 1_200,
    });
  });

  it("separates <think> tags of tag-emitting models from the answer", () => {
    const assembler = new TuiStreamAssembler();
    const open = assembler.ingestDelta("run-t", text("<think>Is it the gateway"));
    expect(open).toEqual({
      content: "",
      reasoning: { text: "Is it the gateway", state: "streaming" },
    });
    const answered = assembler.ingestDelta(
      "run-t",
      text("<think>Is it the gateway port?</think>It is 18789."),
    );
    expect(answered?.content).toBe("It is 18789.");
    expect(answered?.reasoning).toMatchObject({ text: "Is it the gateway port?", state: "done" });
  });

  it("falls back to streamed text on an empty final payload", () => {
    const assembler = new TuiStreamAssembler();
    assembler.ingestDelta("run-3", text("Streamed"));
    const final = assembler.finalize("run-3", { role: "assistant", content: [] });
    expect(final).toEqual({ content: "Streamed", reasoning: null });
  });

  it("returns null when nothing changed", () => {
    const assembler = new TuiStreamAssembler();
    expect(assembler.ingestDelta("run-4", text("Repeat"))).not.toBeNull();
    expect(assembler.ingestDelta("run-4", text("Repeat"))).toBeNull();
  });
});

describe("splitTaggedReasoning", () => {
  it("handles every tag spelling, several blocks and plain text", () => {
    expect(splitTaggedReasoning("plain answer")).toEqual({
      content: "plain answer",
      reasoning: "",
    });
    expect(splitTaggedReasoning("<thinking>one</thinking>A <thought>two</thought>B")).toEqual({
      content: "A B",
      reasoning: "one\ntwo",
    });
    expect(splitTaggedReasoning("<antthinking>still going")).toEqual({
      content: "",
      reasoning: "still going",
    });
  });
});
