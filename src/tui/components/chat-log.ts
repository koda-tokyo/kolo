import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import type { ReasoningLayout, ReasoningSnapshot } from "./reasoning-block.js";
import { theme } from "../theme/theme.js";
import { type AssistantReasoningOptions, AssistantMessageComponent } from "./assistant-message.js";

const SPINNER_TICK_MS = 80;
import { ToolExecutionComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";

export class ChatLog extends Container {
  private toolById = new Map<string, ToolExecutionComponent>();
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  private toolsExpanded = false;
  private diffsEnabled = true;
  private reasoningOptions: AssistantReasoningOptions = { visible: true, layout: "collapsed" };
  private assistants: AssistantMessageComponent[] = [];
  private requestRender: (() => void) | null = null;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;

  clearAll() {
    this.clear();
    this.toolById.clear();
    this.streamingRuns.clear();
    this.assistants = [];
    this.syncSpinner();
  }

  /** How the reasoning spinner asks for a redraw; without it the spinner only moves on deltas. */
  setRenderRequester(request: (() => void) | null) {
    this.requestRender = request;
  }

  setReasoningOptions(options: Partial<AssistantReasoningOptions>) {
    this.reasoningOptions = { ...this.reasoningOptions, ...options };
    for (const message of this.assistants) {
      message.setReasoningVisible(this.reasoningOptions.visible);
      message.setReasoningLayout(this.reasoningOptions.layout);
    }
  }

  setReasoningVisible(visible: boolean) {
    this.setReasoningOptions({ visible });
  }

  setReasoningLayout(layout: ReasoningLayout) {
    this.setReasoningOptions({ layout });
  }

  /** Expand or collapse the newest reasoning block on screen. False when there is none. */
  toggleLatestReasoning(): boolean {
    for (let i = this.assistants.length - 1; i >= 0; i -= 1) {
      const block = this.assistants[i]?.getReasoning();
      if (block?.hasText()) {
        block.toggle();
        return true;
      }
    }
    return false;
  }

  private createAssistant(
    text: string,
    reasoning?: ReasoningSnapshot | null,
    opts: { live?: boolean } = {},
  ) {
    const component = new AssistantMessageComponent(text, reasoning, {
      ...this.reasoningOptions,
      live: opts.live ?? true,
    });
    this.assistants.push(component);
    return component;
  }

  // The spinner of a streaming reasoning block needs redraws between deltas. One unref'ed timer,
  // alive only while some block is streaming.
  private syncSpinner() {
    const streaming =
      this.reasoningOptions.visible &&
      [...this.streamingRuns.values()].some((m) => m.getReasoning()?.isStreaming());
    if (streaming && !this.spinnerTimer && this.requestRender) {
      this.spinnerTimer = setInterval(() => this.requestRender?.(), SPINNER_TICK_MS);
      this.spinnerTimer.unref?.();
    } else if (!streaming && this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  dispose() {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
  }

  addSystem(text: string) {
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.system(text), 1, 0));
  }

  addUser(text: string) {
    this.addChild(new UserMessageComponent(text));
  }

  private resolveRunId(runId?: string) {
    return runId ?? "default";
  }

  startAssistant(text: string, runId?: string, reasoning?: ReasoningSnapshot | null) {
    const component = this.createAssistant(text, reasoning);
    this.streamingRuns.set(this.resolveRunId(runId), component);
    this.addChild(component);
    this.syncSpinner();
    return component;
  }

  updateAssistant(text: string, runId?: string, reasoning?: ReasoningSnapshot | null) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      this.startAssistant(text, runId, reasoning);
      return;
    }
    existing.setReasoning(reasoning ?? null);
    existing.setText(text);
    this.syncSpinner();
  }

  finalizeAssistant(
    text: string,
    runId?: string,
    reasoning?: ReasoningSnapshot | null,
    opts: { live?: boolean } = {},
  ) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    const settled = reasoning ? { ...reasoning, state: "done" as const } : null;
    if (existing) {
      const block = existing.getReasoning();
      if (settled) {
        existing.setReasoning(settled);
      } else if (block) {
        // The final carried no reasoning (older gateway): what streamed is complete now.
        block.setSnapshot({ ...block.getSnapshot(), state: "done" });
      }
      existing.setText(text);
      this.streamingRuns.delete(effectiveRunId);
      this.syncSpinner();
      return;
    }
    this.addChild(this.createAssistant(text, settled, { live: opts.live ?? false }));
  }

  // A finished assistant message that belongs ABOVE a tool cell already on screen: the record
  // had text the stream never delivered (throttled), so it is filled in at its true position.
  insertAssistantBefore(text: string, toolCallId: string, reasoning?: ReasoningSnapshot | null) {
    const component = this.createAssistant(
      text,
      reasoning ? { ...reasoning, state: "done" } : null,
      { live: false },
    );
    const tool = this.toolById.get(toolCallId);
    const index = tool ? this.children.indexOf(tool) : -1;
    if (index < 0) {
      this.addChild(component);
      return;
    }
    this.children.splice(index, 0, component);
  }

  startTool(toolCallId: string, toolName: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (existing) {
      existing.setArgs(args);
      return existing;
    }
    const component = new ToolExecutionComponent(toolName, args);
    component.setExpanded(this.toolsExpanded);
    component.setDiffEnabled(this.diffsEnabled);
    this.toolById.set(toolCallId, component);
    this.addChild(component);
    return component;
  }

  updateToolArgs(toolCallId: string, args: unknown) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    existing.setArgs(args);
  }

  updateToolResult(
    toolCallId: string,
    result: unknown,
    opts?: { isError?: boolean; partial?: boolean },
  ) {
    const existing = this.toolById.get(toolCallId);
    if (!existing) {
      return;
    }
    if (opts?.partial) {
      existing.setPartialResult(result as Record<string, unknown>);
      return;
    }
    existing.setResult(result as Record<string, unknown>, {
      isError: opts?.isError,
    });
  }

  setDiffsEnabled(enabled: boolean) {
    this.diffsEnabled = enabled;
    for (const tool of this.toolById.values()) {
      tool.setDiffEnabled(enabled);
    }
  }

  setToolsExpanded(expanded: boolean) {
    this.toolsExpanded = expanded;
    for (const tool of this.toolById.values()) {
      tool.setExpanded(expanded);
    }
  }
}
