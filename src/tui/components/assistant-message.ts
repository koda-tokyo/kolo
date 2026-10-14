import { Container, Markdown } from "@mariozechner/pi-tui";
import { markdownTheme, theme } from "../theme/theme.js";
import {
  ReasoningBlockComponent,
  type ReasoningLayout,
  type ReasoningSnapshot,
} from "./reasoning-block.js";

export type AssistantReasoningOptions = {
  /** Reasoning blocks are shown (`/reasoning on`) or hidden (`/reasoning off`). */
  visible: boolean;
  layout: ReasoningLayout;
  maxLines?: number;
  toggleKeyLabel?: string;
  /** False for messages loaded from history: no local timing for the duration. */
  live?: boolean;
  now?: () => number;
};

/** One assistant message: an optional reasoning block above the answer text. */
export class AssistantMessageComponent extends Container {
  private body: Markdown;
  private text: string;
  private reasoning: ReasoningBlockComponent | null = null;
  private reasoningOptions: AssistantReasoningOptions;

  constructor(
    text: string,
    reasoning?: ReasoningSnapshot | null,
    options: AssistantReasoningOptions = { visible: true, layout: "collapsed" },
  ) {
    super();
    this.text = text;
    this.reasoningOptions = options;
    this.body = new Markdown(text, 1, 0, markdownTheme, {
      color: (line) => theme.fg(line),
    });
    this.addChild(this.body);
    if (reasoning) {
      this.setReasoning(reasoning);
    }
  }

  setText(text: string) {
    this.text = text;
    this.body.setText(text);
    this.reasoning?.setAnswerStarted(text.trim().length > 0);
  }

  getText(): string {
    return this.text;
  }

  setReasoning(snapshot: ReasoningSnapshot | null) {
    if (!snapshot || !snapshot.text.trim()) {
      return;
    }
    if (!this.reasoning) {
      this.reasoning = new ReasoningBlockComponent({
        maxLines: this.reasoningOptions.maxLines,
        toggleKeyLabel: this.reasoningOptions.toggleKeyLabel,
        live: this.reasoningOptions.live,
        now: this.reasoningOptions.now,
      });
      this.reasoning.setLayout(this.reasoningOptions.layout);
      this.reasoning.setAnswerStarted(this.text.trim().length > 0);
    }
    this.reasoning.setSnapshot(snapshot);
  }

  getReasoning(): ReasoningBlockComponent | null {
    return this.reasoning;
  }

  setReasoningVisible(visible: boolean) {
    this.reasoningOptions = { ...this.reasoningOptions, visible };
  }

  setReasoningLayout(layout: ReasoningLayout) {
    this.reasoningOptions = { ...this.reasoningOptions, layout };
    this.reasoning?.setLayout(layout);
  }

  override invalidate() {
    super.invalidate();
    this.reasoning?.invalidate();
  }

  override render(width: number): string[] {
    const reasoningLines =
      this.reasoning && this.reasoningOptions.visible ? this.reasoning.render(width) : [];
    const bodyLines = this.text.trim() ? this.body.render(width) : [];
    if (reasoningLines.length === 0 && bodyLines.length === 0) {
      return [];
    }
    const out: string[] = [""];
    out.push(...reasoningLines);
    if (reasoningLines.length > 0 && bodyLines.length > 0) {
      out.push("");
    }
    out.push(...bodyLines);
    return out;
  }
}
