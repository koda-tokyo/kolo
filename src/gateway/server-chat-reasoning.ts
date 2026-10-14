// Live reasoning on the chat stream (KoLo 2.0 reasoning view): who may see it, and what leaves
// the gateway. Reasoning arrives as `reasoning` agent events (src/agents/pi-embedded-subscribe.
// reasoning.ts) and goes out as the `reasoning` field of `chat` delta/final events, redacted with
// the log redaction patterns and bounded. Nothing here runs at import time.
import type { KoLoConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { resolveSessionAgentId } from "../agents/agent-scope.js";
import { redactSensitiveText } from "../logging/redact.js";
import { getPolicyEngine } from "../policy/engine.js";

/** Bytes of reasoning text a chat event carries; the head is kept and `truncated` is set. */
export const MAX_CHAT_REASONING_CHARS = 64 * 1024;

export type ChatReasoningPayload = {
  text: string;
  state: "streaming" | "done";
  startedAt: number;
  durationMs?: number;
  truncated?: boolean;
};

/**
 * Whether reasoning of a session's runs is streamed to its clients. Most restrictive wins:
 * the session's `reasoningView: "off"`, the agent's `agents.list[].reasoning.expose`, else
 * `agents.defaults.reasoning.expose` (default true), and an enforced policy
 * `agents[<glob>].reasoning.expose: false`.
 */
export function resolveReasoningExposure(params: {
  cfg: KoLoConfig;
  sessionKey: string;
  entry?: Pick<SessionEntry, "reasoningView">;
  policyExposure?: (agentId: string) => false | undefined;
}): boolean {
  if (params.entry?.reasoningView === "off") {
    return false;
  }
  const agentId = resolveSessionAgentId({ sessionKey: params.sessionKey, config: params.cfg });
  const agent = params.cfg.agents?.list?.find((a) => a.id === agentId);
  const configured = agent?.reasoning?.expose ?? params.cfg.agents?.defaults?.reasoning?.expose;
  if (configured === false) {
    return false;
  }
  const policyExposure =
    params.policyExposure ?? ((id: string) => getPolicyEngine().reasoningExposure(id));
  try {
    if (policyExposure(agentId) === false) {
      return false;
    }
  } catch {
    // A policy that cannot be read does not widen exposure; the config decision stands.
  }
  return true;
}

/**
 * Redacted, bounded reasoning text for a chat event: the built-in secret patterns always (even
 * with `logging.redactSensitive: "off"`), then the operator's `logging.redactPatterns` if any.
 */
export function redactReasoningForClients(
  text: string,
  extraPatterns?: string[],
): { text: string; truncated: boolean } {
  const truncated = text.length > MAX_CHAT_REASONING_CHARS;
  const head = truncated ? text.slice(0, MAX_CHAT_REASONING_CHARS) : text;
  let redacted = redactSensitiveText(head, { mode: "tools" });
  if (extraPatterns?.length) {
    redacted = redactSensitiveText(redacted, { mode: "tools", patterns: extraPatterns });
  }
  return { text: redacted, truncated };
}

/**
 * Thinking blocks of stored assistant messages for `chat.history`: dropped when the session may
 * not see reasoning, otherwise redacted like the live stream. Other messages pass unchanged.
 */
export function prepareHistoryReasoning(
  messages: unknown[],
  exposed: boolean,
  extraPatterns?: string[],
): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object") {
      return message;
    }
    const record = message as Record<string, unknown>;
    if (record.role !== "assistant" || !Array.isArray(record.content)) {
      return message;
    }
    const content = record.content as unknown[];
    if (!content.some((b) => (b as { type?: unknown } | null)?.type === "thinking")) {
      return message;
    }
    const next: unknown[] = [];
    for (const block of content) {
      const rec = block as Record<string, unknown> | null;
      if (rec?.type !== "thinking") {
        next.push(block);
        continue;
      }
      if (!exposed) {
        continue;
      }
      const thinking = typeof rec.thinking === "string" ? rec.thinking : "";
      next.push({ ...rec, thinking: redactReasoningForClients(thinking, extraPatterns).text });
    }
    return { ...record, content: next };
  });
}
