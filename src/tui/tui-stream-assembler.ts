import type { ReasoningSnapshot } from "./components/reasoning-block.js";
import {
  type ChatReasoningField,
  resolveFinalAssistantText,
  splitAssistantMessage,
} from "./tui-formatters.js";

/** What one assistant message looks like so far: the answer and, separately, its reasoning. */
export type AssembledMessage = {
  content: string;
  reasoning: ReasoningSnapshot | null;
};

type RunStreamState = {
  contentText: string;
  reasoning: ReasoningSnapshot | null;
};

/**
 * Accumulates the cumulative deltas of one assistant message per run key. Reasoning is kept
 * apart from the answer whatever its source: the gateway's `reasoning` field, thinking blocks,
 * or `<think>` tags inside the text of tag-emitting models.
 */
export class TuiStreamAssembler {
  private runs = new Map<string, RunStreamState>();

  private getOrCreateRun(runId: string): RunStreamState {
    let state = this.runs.get(runId);
    if (!state) {
      state = { contentText: "", reasoning: null };
      this.runs.set(runId, state);
    }
    return state;
  }

  private update(state: RunStreamState, message: unknown, field?: ChatReasoningField | null) {
    const { content, reasoning } = splitAssistantMessage(message, field);
    if (content) {
      state.contentText = content;
    }
    if (reasoning) {
      state.reasoning = {
        ...reasoning,
        // A delta without explicit state: reasoning is streaming until the answer starts.
        state:
          field?.state === "done" || field?.state === "streaming"
            ? reasoning.state
            : state.contentText
              ? "done"
              : "streaming",
        startedAt: reasoning.startedAt ?? state.reasoning?.startedAt,
        durationMs: reasoning.durationMs ?? state.reasoning?.durationMs,
      };
    }
  }

  /** Returns the message so far, or null when nothing visible changed. */
  ingestDelta(
    runId: string,
    message: unknown,
    field?: ChatReasoningField | null,
  ): AssembledMessage | null {
    const state = this.getOrCreateRun(runId);
    const before = JSON.stringify(state);
    this.update(state, message, field);
    if (JSON.stringify(state) === before) {
      return null;
    }
    if (!state.contentText && !state.reasoning) {
      return null;
    }
    return { content: state.contentText, reasoning: state.reasoning };
  }

  finalize(runId: string, message: unknown, field?: ChatReasoningField | null): AssembledMessage {
    const state = this.getOrCreateRun(runId);
    const streamedText = state.contentText;
    this.update(state, message, field);
    const content = resolveFinalAssistantText({
      finalText: state.contentText,
      streamedText,
    });
    const reasoning = state.reasoning ? { ...state.reasoning, state: "done" as const } : null;
    this.runs.delete(runId);
    return { content, reasoning };
  }

  /** Reasoning of a run key, if any (for a commit that has no new message to read). */
  peekReasoning(runId: string): ReasoningSnapshot | null {
    return this.runs.get(runId)?.reasoning ?? null;
  }

  drop(runId: string) {
    this.runs.delete(runId);
  }
}
