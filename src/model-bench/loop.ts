// One bench conversation: model turn → tool calls through the gated tool layer → tool results →
// next turn, until the model answers without tools, the turn cap is reached or the budget says
// stop. Usage, latency and every call are reported to the caller (evidence + budget meters).
import {
  type AssistantMessage,
  type Message,
  type Tool,
  type ToolResultMessage,
  validateToolArguments,
} from "@mariozechner/pi-ai";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { BenchModelClient } from "./client.js";
import type { SessionTrace, ToolCallTrace } from "./types.js";

export type TurnUsage = { input: number; output: number; total: number; latencyMs: number };

export type SessionHooks = {
  onTurn?: (message: AssistantMessage, usage: TurnUsage) => void;
  onToolStart?: (id: string, name: string, args: unknown) => void;
  onToolEnd?: (id: string, name: string, result: string, isError: boolean) => void;
  /** Checked after each turn; a reason stops the session. */
  shouldStop?: () => string | null;
};

export type SessionRun = {
  trace: SessionTrace;
  messages: Message[];
  latencyMs: number;
  stopped?: string;
};

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
}

function toolResultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | null)?.content;
  return Array.isArray(content)
    ? content.map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n")
    : "";
}

const MAX_RESULT_CHARS = 4000;

export async function runBenchSession(params: {
  client: BenchModelClient;
  systemPrompt: string;
  tools: AnyAgentTool[];
  messages: Message[];
  prompt: string;
  maxTurns: number;
  /** Calls of the session made by the gated tool layer (filled by the tool sink). */
  calls: ToolCallTrace[];
  hooks?: SessionHooks;
}): Promise<SessionRun> {
  const messages: Message[] = [
    ...params.messages,
    { role: "user", content: params.prompt, timestamp: Date.now() },
  ];
  const wireTools: Tool[] = params.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  const byName = new Map(params.tools.map((t) => [t.name, t]));
  const trace: SessionTrace = { finalText: "", toolCalls: params.calls, turns: 0 };
  let latencyMs = 0;
  for (let turn = 0; turn < params.maxTurns; turn++) {
    const t0 = Date.now();
    let message: AssistantMessage;
    try {
      message = await params.client.complete({
        systemPrompt: params.systemPrompt,
        messages,
        tools: wireTools,
      });
    } catch (err) {
      latencyMs += Date.now() - t0;
      trace.error = err instanceof Error ? err.message : String(err);
      return { trace, messages, latencyMs };
    }
    const elapsed = Date.now() - t0;
    latencyMs += elapsed;
    trace.turns += 1;
    const usage = message.usage ?? {
      input: 0,
      output: 0,
      totalTokens: 0,
    };
    params.hooks?.onTurn?.(message, {
      input: usage.input ?? 0,
      output: usage.output ?? 0,
      total: usage.totalTokens || (usage.input ?? 0) + (usage.output ?? 0),
      latencyMs: elapsed,
    });
    messages.push(message);
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      trace.error = message.errorMessage ?? message.stopReason;
      return { trace, messages, latencyMs };
    }
    const calls = message.content.filter(
      (c): c is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
        c.type === "toolCall",
    );
    const text = textOf(message);
    if (text) {
      trace.finalText = text;
    }
    if (calls.length === 0) {
      return { trace, messages, latencyMs };
    }
    for (const call of calls) {
      const tool = byName.get(call.name);
      let resultText = "";
      let isError = false;
      params.hooks?.onToolStart?.(call.id, call.name, call.arguments);
      if (!tool) {
        resultText = `Unknown tool "${call.name}".`;
        isError = true;
        params.calls.push({
          name: call.name,
          args: call.arguments ?? {},
          decision: "deny",
          ruleId: "unknown-tool",
          isError: true,
          result: resultText,
        });
      } else {
        let args: unknown;
        try {
          args = validateToolArguments(tool, call);
        } catch (err) {
          // Invalid arguments never reach the gated layer; record them here.
          resultText = err instanceof Error ? err.message : String(err);
          isError = true;
          params.calls.push({
            name: call.name,
            args: call.arguments ?? {},
            decision: "allow",
            ruleId: "validation",
            isError: true,
            result: resultText,
          });
        }
        if (!isError) {
          try {
            resultText = toolResultText(await tool.execute(call.id, args, undefined, undefined));
          } catch (err) {
            resultText = err instanceof Error ? err.message : String(err);
            isError = true;
          }
        }
      }
      params.hooks?.onToolEnd?.(call.id, call.name, resultText, isError);
      const toolResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text: resultText.slice(0, MAX_RESULT_CHARS) }],
        isError,
        timestamp: Date.now(),
      };
      messages.push(toolResult);
    }
    const stop = params.hooks?.shouldStop?.();
    if (stop) {
      return { trace, messages, latencyMs, stopped: stop };
    }
  }
  return { trace, messages, latencyMs };
}
