// Scripted model clients for tests and dry runs: a function decides each turn from the request.
// No network; usage numbers are whatever the script reports (default 100 in, 20 out).
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { BenchModelClient, BenchTurnRequest } from "./client.js";

export type FakeTurn = {
  text?: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  usage?: { input: number; output: number };
  error?: string;
};

export type FakeScript = (
  req: BenchTurnRequest,
  info: { firstPrompt: string; lastPrompt: string; toolResults: string[] },
) => FakeTurn;

function textOfUser(m: Message): string {
  if (m.role !== "user") {
    return "";
  }
  return typeof m.content === "string"
    ? m.content
    : m.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

export function createScriptedClient(params: {
  provider?: string;
  model?: string;
  script: FakeScript;
}): BenchModelClient & { calls: number } {
  let counter = 0;
  const client = {
    provider: params.provider ?? "fake",
    model: params.model ?? "scripted",
    calls: 0,
    complete: async (req: BenchTurnRequest): Promise<AssistantMessage> => {
      client.calls += 1;
      const users = req.messages.filter((m) => m.role === "user").map(textOfUser);
      // Tool results after the last user prompt belong to the current exchange.
      const lastUserIdx = req.messages.map((m) => m.role).lastIndexOf("user");
      const toolResults = req.messages
        .slice(lastUserIdx + 1)
        .filter((m) => m.role === "toolResult")
        .map((m) =>
          m.role === "toolResult"
            ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("")
            : "",
        );
      const turn = params.script(req, {
        firstPrompt: users[0] ?? "",
        lastPrompt: users[users.length - 1] ?? "",
        toolResults,
      });
      const input = turn.usage?.input ?? 100;
      const output = turn.usage?.output ?? 20;
      const content: AssistantMessage["content"] = [];
      if (turn.text) {
        content.push({ type: "text", text: turn.text });
      }
      for (const call of turn.toolCalls ?? []) {
        counter += 1;
        content.push({
          type: "toolCall",
          id: `call_${counter}`,
          name: call.name,
          arguments: call.args,
        });
      }
      return {
        role: "assistant",
        content,
        api: "openai-completions",
        provider: client.provider,
        model: client.model,
        usage: {
          input,
          output,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: input + output,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: turn.error ? "error" : (turn.toolCalls?.length ?? 0) > 0 ? "toolUse" : "stop",
        ...(turn.error ? { errorMessage: turn.error } : {}),
        timestamp: Date.now(),
      };
    },
  };
  return client;
}

/** A scripted client that answers every prompt with the same text and never calls tools. */
export function createEchoClient(
  text: string,
  usage?: FakeTurn["usage"],
): BenchModelClient & { calls: number } {
  return createScriptedClient({ script: () => ({ text, usage }) });
}
