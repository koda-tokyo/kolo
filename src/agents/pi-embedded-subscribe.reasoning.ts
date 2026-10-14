// Live reasoning stream (KoLo 2.0 reasoning view). Providers expose reasoning either as native
// thinking blocks (`thinking_start` / `thinking_delta` / `thinking_end`) or as `<think>` tags
// inside the text stream. Both end up here as "the reasoning text of the current assistant
// message so far", and leave the run as `reasoning` agent events:
//
//   { phase: "delta", text, delta, startedAt }        while it grows
//   { phase: "end", text, startedAt, durationMs }     once, when the answer or a tool call begins
//
// The gateway decides who may see it (`agents.*.reasoning.expose`, policy) and redacts it; this
// module only tracks and emits. Nothing here runs at import time.

export type ReasoningEventData = {
  phase: "delta" | "end";
  text: string;
  delta?: string;
  startedAt: number;
  durationMs?: number;
};

export type ReasoningTracker = {
  /** Full reasoning text of the current message; emits a delta when it changed. */
  update: (text: string) => void;
  /** The reasoning of the current message is complete (answer text or a tool call began). */
  end: () => void;
  /** A new assistant message begins. */
  reset: () => void;
  /** Reasoning text of the current message so far. */
  readonly text: string;
};

export function createReasoningTracker(
  emit: (data: ReasoningEventData) => void,
  now: () => number = Date.now,
): ReasoningTracker {
  let text = "";
  let startedAt: number | null = null;
  let ended = false;

  return {
    update(next: string) {
      const trimmed = next.trim();
      if (!trimmed || trimmed === text) {
        return;
      }
      if (startedAt === null) {
        startedAt = now();
      }
      const delta = trimmed.startsWith(text) ? trimmed.slice(text.length) : trimmed;
      text = trimmed;
      // Reasoning that resumes after an end (interleaved thinking) streams again.
      ended = false;
      emit({ phase: "delta", text, delta, startedAt });
    },
    end() {
      if (ended || startedAt === null || !text) {
        return;
      }
      ended = true;
      emit({ phase: "end", text, startedAt, durationMs: Math.max(0, now() - startedAt) });
    },
    reset() {
      text = "";
      startedAt = null;
      ended = false;
    },
    get text() {
      return text;
    },
  };
}
