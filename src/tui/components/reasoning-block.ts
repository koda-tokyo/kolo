import { type Component, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import {
  formatReasoningDuration,
  REASONING_THINKING_HEADER,
  reasoningDoneHeader,
  sanitizeReasoningText,
} from "../reasoning-format.js";
import { theme } from "../theme/theme.js";

/**
 * Reasoning shown above an answer (KoLo 2.0 reasoning view). While the model thinks the block is
 * expanded under a "Thinking" header with a spinner; once the answer starts (or the reasoning is
 * done) it shows "Thought for 12s" and, in the default collapsed layout, the first lines only.
 * One key (tui.keybinds.toggleReasoning, default ctrl+o) flips the latest block.
 *
 * The text is sanitised (no escape sequences or control characters) and wrapped to the width,
 * so whatever a model writes cannot move the cursor, recolour the diff view or break tool cards;
 * the block never grows past `maxLines`.
 */

export type ReasoningSnapshot = {
  text: string;
  state: "streaming" | "done";
  startedAt?: number;
  durationMs?: number;
  truncated?: boolean;
};

export type ReasoningLayout = "collapsed" | "expanded";

export const REASONING_COLLAPSED_LINES = 3;
export const REASONING_DEFAULT_MAX_LINES = 400;
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_MS = 80;
const INDENT = "  ";

export { formatReasoningDuration, sanitizeReasoningText };

export class ReasoningBlockComponent implements Component {
  private snapshot: ReasoningSnapshot = { text: "", state: "streaming" };
  private answerStarted = false;
  private layout: ReasoningLayout = "collapsed";
  private override: boolean | null = null;
  private readonly maxLines: number;
  private readonly toggleKeyLabel?: string;
  private readonly now: () => number;
  // Local timing, for a duration when the gateway sent none (older gateways).
  private seenAt: number | null = null;
  private settledAt: number | null = null;
  private cache: { text: string; width: number; lines: string[] } | null = null;

  constructor(
    opts: { maxLines?: number; toggleKeyLabel?: string; now?: () => number; live?: boolean } = {},
  ) {
    this.maxLines = Math.max(
      REASONING_COLLAPSED_LINES,
      opts.maxLines ?? REASONING_DEFAULT_MAX_LINES,
    );
    this.toggleKeyLabel = opts.toggleKeyLabel;
    this.now = opts.now ?? Date.now;
    if (opts.live !== false) {
      this.seenAt = this.now();
    }
  }

  setSnapshot(snapshot: ReasoningSnapshot) {
    const text = sanitizeReasoningText(snapshot.text);
    // A later snapshot without timing (a final from the record) keeps what the stream reported.
    this.snapshot = {
      ...snapshot,
      text,
      startedAt: snapshot.startedAt ?? this.snapshot.startedAt,
      durationMs: snapshot.durationMs ?? this.snapshot.durationMs,
    };
    if (snapshot.state === "done") {
      this.settle();
    }
  }

  getSnapshot(): ReasoningSnapshot {
    return { ...this.snapshot };
  }

  /** The answer text below this block began: the reasoning is over even without an end event. */
  setAnswerStarted(started: boolean) {
    this.answerStarted = started;
    if (started) {
      this.settle();
    }
  }

  setLayout(layout: ReasoningLayout) {
    this.layout = layout;
  }

  /** Flip this block between its expanded and collapsed view (the toggle key). */
  toggle() {
    this.override = !this.isExpanded();
  }

  isStreaming(): boolean {
    return this.snapshot.state === "streaming" && !this.answerStarted;
  }

  isExpanded(): boolean {
    if (this.override !== null) {
      return this.override;
    }
    if (this.isStreaming()) {
      return true;
    }
    return this.layout === "expanded";
  }

  hasText(): boolean {
    return this.snapshot.text.length > 0;
  }

  invalidate() {
    this.cache = null;
  }

  render(width: number): string[] {
    if (!this.snapshot.text || width < 8) {
      return [];
    }
    const inner = Math.max(1, width - INDENT.length - 1);
    const lines = this.wrapped(inner);
    const expanded = this.isExpanded();
    const style = (s: string) => theme.italic(theme.reasoning(s));
    const out: string[] = [` ${this.header(lines.length, expanded)}`];

    let shown: string[];
    let note: string | null = null;
    if (!expanded) {
      shown = lines.slice(0, REASONING_COLLAPSED_LINES);
      const more = lines.length - shown.length;
      note = more > 0 ? `… ${more} more line${more === 1 ? "" : "s"}` : null;
    } else if (lines.length <= this.maxLines) {
      shown = lines;
    } else if (this.isStreaming()) {
      // Live: follow the newest reasoning, like a terminal log.
      shown = lines.slice(lines.length - this.maxLines);
      const earlier = lines.length - shown.length;
      out.push(` ${INDENT}${theme.dim(`… ${earlier} earlier lines`)}`);
    } else {
      shown = lines.slice(0, this.maxLines);
      note = `… ${lines.length - shown.length} more lines`;
    }
    for (const line of shown) {
      out.push(` ${INDENT}${style(line)}`);
    }
    if (note) {
      out.push(` ${INDENT}${theme.dim(note)}`);
    }
    if (this.snapshot.truncated && (!note || expanded)) {
      out.push(` ${INDENT}${theme.dim("(reasoning shortened by the gateway)")}`);
    }
    return out;
  }

  private header(lineCount: number, expanded: boolean): string {
    let title: string;
    if (this.isStreaming()) {
      const frame =
        SPINNER_FRAMES[Math.floor(this.now() / SPINNER_FRAME_MS) % SPINNER_FRAMES.length];
      title = `${theme.accentSoft(frame ?? "")} ${theme.italic(theme.reasoning(REASONING_THINKING_HEADER))}`;
    } else {
      const ms = this.durationMs();
      title = theme.italic(theme.reasoning(reasoningDoneHeader(ms)));
    }
    if (!this.toggleKeyLabel || this.isStreaming()) {
      return title;
    }
    if (!expanded && lineCount > REASONING_COLLAPSED_LINES) {
      return `${title} ${theme.dim(`(${this.toggleKeyLabel} to expand)`)}`;
    }
    if (expanded && lineCount > REASONING_COLLAPSED_LINES) {
      return `${title} ${theme.dim(`(${this.toggleKeyLabel} to collapse)`)}`;
    }
    return title;
  }

  private durationMs(): number | null {
    if (typeof this.snapshot.durationMs === "number") {
      return this.snapshot.durationMs;
    }
    if (this.seenAt !== null && this.settledAt !== null) {
      return Math.max(0, this.settledAt - this.seenAt);
    }
    return null;
  }

  private settle() {
    if (this.settledAt === null && this.seenAt !== null) {
      this.settledAt = this.now();
    }
  }

  private wrapped(width: number): string[] {
    const text = this.snapshot.text;
    if (this.cache && this.cache.text === text && this.cache.width === width) {
      return this.cache.lines;
    }
    const lines: string[] = [];
    for (const raw of text.split("\n")) {
      if (!raw.trim()) {
        // Keep paragraph breaks, but never more than one blank line in a row.
        if (lines.length > 0 && lines[lines.length - 1] !== "") {
          lines.push("");
        }
        continue;
      }
      lines.push(...wrapTextWithAnsi(raw, width));
    }
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    this.cache = { text, width, lines };
    return lines;
  }
}
