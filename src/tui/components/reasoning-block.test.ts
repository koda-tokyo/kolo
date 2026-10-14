import { describe, expect, it } from "vitest";
import { AssistantMessageComponent } from "./assistant-message.js";
import { ChatLog } from "./chat-log.js";
import {
  formatReasoningDuration,
  ReasoningBlockComponent,
  sanitizeReasoningText,
} from "./reasoning-block.js";
import { UserMessageComponent } from "./user-message.js";

// oxlint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (lines: string[]) => lines.map((l) => l.replace(ANSI, "").trimEnd());

const REASONING = [
  "The user asks which port the gateway listens on.",
  "The config sets gateway.port, so read kolo.json first.",
  "If it is missing, the default applies.",
  "The default is 18789.",
  "Answer with the port and where it comes from.",
].join("\n");

function block(opts: { now?: number; maxLines?: number } = {}) {
  let now = opts.now ?? 0;
  const b = new ReasoningBlockComponent({
    toggleKeyLabel: "ctrl+o",
    maxLines: opts.maxLines,
    now: () => now,
  });
  return { b, advance: (ms: number) => (now += ms) };
}

describe("ReasoningBlockComponent", () => {
  it("streams expanded under a Thinking header with a spinner", () => {
    const { b } = block();
    b.setSnapshot({ text: REASONING, state: "streaming", startedAt: 0 });
    expect(plain(b.render(80))).toMatchInlineSnapshot(`
      [
        " ⠋ Thinking",
        "   The user asks which port the gateway listens on.",
        "   The config sets gateway.port, so read kolo.json first.",
        "   If it is missing, the default applies.",
        "   The default is 18789.",
        "   Answer with the port and where it comes from.",
      ]
    `);
  });

  it("collapses to the first three lines once done, with the duration", () => {
    const { b } = block();
    b.setSnapshot({ text: REASONING, state: "streaming", startedAt: 0 });
    b.setSnapshot({ text: REASONING, state: "done", startedAt: 0, durationMs: 12_400 });
    b.setAnswerStarted(true);
    expect(plain(b.render(80))).toMatchInlineSnapshot(`
      [
        " Thought for 12s (ctrl+o to expand)",
        "   The user asks which port the gateway listens on.",
        "   The config sets gateway.port, so read kolo.json first.",
        "   If it is missing, the default applies.",
        "   … 2 more lines",
      ]
    `);
  });

  it("expands and collapses again with the toggle", () => {
    const { b } = block();
    b.setSnapshot({ text: REASONING, state: "done", durationMs: 3_000 });
    b.toggle();
    expect(b.isExpanded()).toBe(true);
    expect(plain(b.render(80))).toMatchInlineSnapshot(`
      [
        " Thought for 3s (ctrl+o to collapse)",
        "   The user asks which port the gateway listens on.",
        "   The config sets gateway.port, so read kolo.json first.",
        "   If it is missing, the default applies.",
        "   The default is 18789.",
        "   Answer with the port and where it comes from.",
      ]
    `);
    b.toggle();
    expect(b.isExpanded()).toBe(false);
    expect(plain(b.render(80))).toHaveLength(5);
  });

  it("takes the duration from local timing when the gateway sent none", () => {
    const { b, advance } = block({ now: 5_000 });
    b.setSnapshot({ text: "short thought", state: "streaming" });
    advance(4_000);
    b.setAnswerStarted(true);
    expect(plain(b.render(60))[0]).toBe(" Thought for 4s");
  });

  it("is bounded by maxLines, following the newest lines while streaming", () => {
    const many = Array.from({ length: 50 }, (_, i) => `step ${i + 1}`).join("\n");
    const { b } = block({ maxLines: 10 });
    b.setSnapshot({ text: many, state: "streaming" });
    const live = plain(b.render(60));
    expect(live[1]).toBe("   … 40 earlier lines");
    expect(live.at(-1)).toBe("   step 50");
    expect(live).toHaveLength(12);
    b.setSnapshot({ text: many, state: "done", durationMs: 1_000 });
    b.toggle();
    const done = plain(b.render(60));
    expect(done.at(-1)).toBe("   … 40 more lines");
    expect(done).toHaveLength(12);
  });

  it("never lets escape sequences or long lines through", () => {
    const { b } = block();
    b.setSnapshot({
      text: `\u001b[2J\u001b[31mred\u001b[0m and \u001b]8;;http://x\u0007link\u001b]8;;\u0007 ${"x".repeat(200)}`,
      state: "streaming",
    });
    const lines = b.render(40);
    for (const line of lines.slice(1)) {
      expect(line.replace(ANSI, "")).not.toContain("\u001b");
      expect(line.replace(ANSI, "").length).toBeLessThanOrEqual(40);
    }
    expect(sanitizeReasoningText("a\tb\r\nc\u0000")).toBe("a  b\nc");
  });

  it("formats durations", () => {
    expect(formatReasoningDuration(200)).toBe("1s");
    expect(formatReasoningDuration(12_400)).toBe("12s");
    expect(formatReasoningDuration(65_000)).toBe("1m 5s");
    expect(formatReasoningDuration(120_000)).toBe("2m");
  });
});

describe("AssistantMessageComponent with reasoning", () => {
  it("hides the block when reasoning is off and keeps the answer", () => {
    const m = new AssistantMessageComponent(
      "Port 18789.",
      { text: REASONING, state: "done", durationMs: 2_000 },
      { visible: true, layout: "collapsed" },
    );
    expect(plain(m.render(80)).join("\n")).toContain("Thought for 2s");
    m.setReasoningVisible(false);
    expect(plain(m.render(80))).toEqual(["", " Port 18789."]);
  });

  it("renders nothing for a message with neither answer nor visible reasoning", () => {
    const m = new AssistantMessageComponent(
      "",
      { text: "hidden", state: "done" },
      {
        visible: false,
        layout: "collapsed",
      },
    );
    expect(m.render(80)).toEqual([]);
  });
});

describe("a turn in the chat log", () => {
  it("shows reasoning above the answer: live, then collapsed with the duration", () => {
    let now = 0;
    const log = new ChatLog();
    log.setReasoningOptions({
      visible: true,
      layout: "collapsed",
      toggleKeyLabel: "ctrl+o",
      now: () => now,
    });
    log.addChild(new UserMessageComponent("Which port does the gateway use?"));
    log.updateAssistant("", "run-1", { text: REASONING, state: "streaming", startedAt: 0 });
    const thinking = plain(log.render(72));
    now = 12_000;
    log.updateAssistant("It listens on **18789**, the default.", "run-1", {
      text: REASONING,
      state: "done",
      startedAt: 0,
      durationMs: 12_000,
    });
    log.finalizeAssistant("It listens on **18789**, the default.", "run-1", null);
    const answered = plain(log.render(72));
    expect(log.toggleLatestReasoning()).toBe(true);
    const expanded = plain(log.render(72));
    log.dispose();
    expect({ thinking, answered, expanded }).toMatchInlineSnapshot(`
      {
        "answered": [
          "",
          "",
          " Which port does the gateway use?",
          "",
          "",
          " Thought for 12s (ctrl+o to expand)",
          "   The user asks which port the gateway listens on.",
          "   The config sets gateway.port, so read kolo.json first.",
          "   If it is missing, the default applies.",
          "   … 2 more lines",
          "",
          " It listens on 18789, the default.",
        ],
        "expanded": [
          "",
          "",
          " Which port does the gateway use?",
          "",
          "",
          " Thought for 12s (ctrl+o to collapse)",
          "   The user asks which port the gateway listens on.",
          "   The config sets gateway.port, so read kolo.json first.",
          "   If it is missing, the default applies.",
          "   The default is 18789.",
          "   Answer with the port and where it comes from.",
          "",
          " It listens on 18789, the default.",
        ],
        "thinking": [
          "",
          "",
          " Which port does the gateway use?",
          "",
          "",
          " ⠋ Thinking",
          "   The user asks which port the gateway listens on.",
          "   The config sets gateway.port, so read kolo.json first.",
          "   If it is missing, the default applies.",
          "   The default is 18789.",
          "   Answer with the port and where it comes from.",
        ],
      }
    `);
  });
});
