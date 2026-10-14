import { normalizeVerboseLevel } from "../auto-reply/thinking.js";
import { loadConfig } from "../config/config.js";
import { type AgentEventPayload, getAgentRunContext } from "../infra/agent-events.js";
import { resolveHeartbeatVisibility } from "../infra/heartbeat-visibility.js";
import {
  type ChatReasoningPayload,
  redactReasoningForClients,
  resolveReasoningExposure,
} from "./server-chat-reasoning.js";
import { loadSessionEntry } from "./session-utils.js";
import { formatForLog } from "./ws-log.js";

/**
 * Check if webchat broadcasts should be suppressed for heartbeat runs.
 * Returns true if the run is a heartbeat and showOk is false.
 */
function shouldSuppressHeartbeatBroadcast(runId: string): boolean {
  const runContext = getAgentRunContext(runId);
  if (!runContext?.isHeartbeat) {
    return false;
  }

  try {
    const cfg = loadConfig();
    const visibility = resolveHeartbeatVisibility({ cfg, channel: "webchat" });
    return !visibility.showOk;
  } catch {
    // Default to suppressing if we can't load config
    return true;
  }
}

export type ChatRunEntry = {
  sessionKey: string;
  clientRunId: string;
};

export type ChatRunRegistry = {
  add: (sessionId: string, entry: ChatRunEntry) => void;
  peek: (sessionId: string) => ChatRunEntry | undefined;
  shift: (sessionId: string) => ChatRunEntry | undefined;
  remove: (sessionId: string, clientRunId: string, sessionKey?: string) => ChatRunEntry | undefined;
  clear: () => void;
};

export function createChatRunRegistry(): ChatRunRegistry {
  const chatRunSessions = new Map<string, ChatRunEntry[]>();

  const add = (sessionId: string, entry: ChatRunEntry) => {
    const queue = chatRunSessions.get(sessionId);
    if (queue) {
      queue.push(entry);
    } else {
      chatRunSessions.set(sessionId, [entry]);
    }
  };

  const peek = (sessionId: string) => chatRunSessions.get(sessionId)?.[0];

  const shift = (sessionId: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const entry = queue.shift();
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const remove = (sessionId: string, clientRunId: string, sessionKey?: string) => {
    const queue = chatRunSessions.get(sessionId);
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const idx = queue.findIndex(
      (entry) =>
        entry.clientRunId === clientRunId && (sessionKey ? entry.sessionKey === sessionKey : true),
    );
    if (idx < 0) {
      return undefined;
    }
    const [entry] = queue.splice(idx, 1);
    if (!queue.length) {
      chatRunSessions.delete(sessionId);
    }
    return entry;
  };

  const clear = () => {
    chatRunSessions.clear();
  };

  return { add, peek, shift, remove, clear };
}

export type ChatRunState = {
  registry: ChatRunRegistry;
  buffers: Map<string, string>;
  deltaSentAt: Map<string, number>;
  abortedRuns: Map<string, number>;
  clear: () => void;
};

export function createChatRunState(): ChatRunState {
  const registry = createChatRunRegistry();
  const buffers = new Map<string, string>();
  const deltaSentAt = new Map<string, number>();
  const abortedRuns = new Map<string, number>();

  const clear = () => {
    registry.clear();
    buffers.clear();
    deltaSentAt.clear();
    abortedRuns.clear();
  };

  return {
    registry,
    buffers,
    deltaSentAt,
    abortedRuns,
    clear,
  };
}

export type ChatEventBroadcast = (
  event: string,
  payload: unknown,
  opts?: { dropIfSlow?: boolean },
) => void;

export type NodeSendToSession = (sessionKey: string, event: string, payload: unknown) => void;

export type AgentEventHandlerOptions = {
  broadcast: ChatEventBroadcast;
  nodeSendToSession: NodeSendToSession;
  agentRunSeq: Map<string, number>;
  chatRunState: ChatRunState;
  resolveSessionKeyForRun: (runId: string) => string | undefined;
  clearAgentRunContext: (runId: string) => void;
};

export function createAgentEventHandler({
  broadcast,
  nodeSendToSession,
  agentRunSeq,
  chatRunState,
  resolveSessionKeyForRun,
  clearAgentRunContext,
}: AgentEventHandlerOptions) {
  // Last text actually sent per run, so a message boundary can flush throttled text first.
  const deltaSentText = new Map<string, string>();
  // Reasoning of the current assistant message per client run (raw; redacted when sent), and
  // whether the run's session may see reasoning at all (decided once per agent run).
  type RunReasoning = {
    raw: string;
    startedAt: number;
    durationMs?: number;
    done: boolean;
    sent: string;
    sentDone: boolean;
  };
  const reasoningRuns = new Map<string, RunReasoning>();
  const reasoningExposure = new Map<string, { exposed: boolean; patterns?: string[] }>();
  // Operator redaction patterns per client run, captured with the exposure decision.
  const reasoningPatterns = new Map<string, string[] | undefined>();

  const isReasoningExposed = (runId: string, clientRunId: string, sessionKey: string) => {
    let decision = reasoningExposure.get(runId);
    if (!decision) {
      decision = { exposed: true };
      try {
        const { cfg, entry } = loadSessionEntry(sessionKey);
        decision = {
          exposed: resolveReasoningExposure({ cfg, sessionKey, entry }),
          patterns: cfg.logging?.redactPatterns,
        };
      } catch {
        // The session store could not be read: fall back to the config default (exposed).
      }
      reasoningExposure.set(runId, decision);
    }
    reasoningPatterns.set(clientRunId, decision.patterns);
    return decision.exposed;
  };

  const reasoningPayload = (clientRunId: string): ChatReasoningPayload | undefined => {
    const current = reasoningRuns.get(clientRunId);
    if (!current?.raw) {
      return undefined;
    }
    current.sent = current.raw;
    current.sentDone = current.done;
    const { text, truncated } = redactReasoningForClients(
      current.raw,
      reasoningPatterns.get(clientRunId),
    );
    return {
      text,
      state: current.done ? "done" : "streaming",
      startedAt: current.startedAt,
      ...(current.durationMs !== undefined ? { durationMs: current.durationMs } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  };

  const sendChatDelta = (sessionKey: string, clientRunId: string, seq: number, text: string) => {
    const now = Date.now();
    chatRunState.deltaSentAt.set(clientRunId, now);
    deltaSentText.set(clientRunId, text);
    const reasoning = reasoningPayload(clientRunId);
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "delta" as const,
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        timestamp: now,
      },
      ...(reasoning ? { reasoning } : {}),
    };
    // Suppress webchat broadcast for heartbeat runs when showOk is false
    if (!shouldSuppressHeartbeatBroadcast(clientRunId)) {
      broadcast("chat", payload, { dropIfSlow: true });
    }
    nodeSendToSession(sessionKey, "chat", payload);
  };

  // Text the throttle is still holding for this run, if any, goes out now. Called at a message
  // boundary (tool start): a short message just before a tool call otherwise never reaches the
  // client until the run ends, because the next message replaces the buffer.
  const flushPendingDelta = (sessionKey: string, clientRunId: string, seq: number) => {
    const pending = chatRunState.buffers.get(clientRunId);
    const reasoning = reasoningRuns.get(clientRunId);
    const reasoningPending =
      reasoning && (reasoning.sent !== reasoning.raw || reasoning.sentDone !== reasoning.done);
    if ((pending && deltaSentText.get(clientRunId) !== pending) || reasoningPending) {
      sendChatDelta(sessionKey, clientRunId, seq, pending ?? "");
    }
  };

  // A `reasoning` agent event: the reasoning of the current assistant message so far.
  const emitChatReasoning = (
    sessionKey: string,
    clientRunId: string,
    seq: number,
    data: Record<string, unknown>,
  ) => {
    const text = typeof data.text === "string" ? data.text : "";
    if (!text) {
      return;
    }
    const startedAt = typeof data.startedAt === "number" ? data.startedAt : Date.now();
    const phase = data.phase === "end" ? "end" : "delta";
    const previous = reasoningRuns.get(clientRunId);
    if (!previous || previous.startedAt !== startedAt) {
      // A new assistant message is thinking. Whatever text the previous one still had in the
      // throttle goes out first; the new message's answer starts from an empty buffer.
      flushPendingDelta(sessionKey, clientRunId, seq);
      chatRunState.buffers.delete(clientRunId);
      deltaSentText.delete(clientRunId);
    }
    reasoningRuns.set(clientRunId, {
      raw: text,
      startedAt,
      durationMs: typeof data.durationMs === "number" ? data.durationMs : undefined,
      done: phase === "end",
      sent: previous && previous.startedAt === startedAt ? previous.sent : "",
      sentDone: previous && previous.startedAt === startedAt ? previous.sentDone : false,
    });
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
    // The end goes out at once so clients can show the duration before the answer streams.
    if (phase === "delta" && Date.now() - last < 150) {
      return;
    }
    sendChatDelta(sessionKey, clientRunId, seq, chatRunState.buffers.get(clientRunId) ?? "");
  };

  const emitChatDelta = (sessionKey: string, clientRunId: string, seq: number, text: string) => {
    const previous = chatRunState.buffers.get(clientRunId);
    if (previous && !text.startsWith(previous) && deltaSentText.get(clientRunId) !== previous) {
      // A new assistant message began while the previous one's tail was still throttled.
      // Send that tail now, or the client never sees the end of the previous message.
      sendChatDelta(sessionKey, clientRunId, seq, previous);
    }
    if (previous && !text.startsWith(previous)) {
      // A new message without reasoning of its own must not inherit the previous one's.
      reasoningRuns.delete(clientRunId);
    }
    chatRunState.buffers.set(clientRunId, text);
    const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
    if (Date.now() - last < 150) {
      return;
    }
    sendChatDelta(sessionKey, clientRunId, seq, text);
  };

  const emitChatFinal = (
    sessionKey: string,
    clientRunId: string,
    seq: number,
    jobState: "done" | "error",
    error?: unknown,
  ) => {
    const text = chatRunState.buffers.get(clientRunId)?.trim() ?? "";
    const pendingReasoning = reasoningRuns.get(clientRunId);
    if (pendingReasoning && !pendingReasoning.done) {
      pendingReasoning.done = true;
      pendingReasoning.durationMs ??= Math.max(0, Date.now() - pendingReasoning.startedAt);
    }
    const reasoning = jobState === "done" ? reasoningPayload(clientRunId) : undefined;
    chatRunState.buffers.delete(clientRunId);
    chatRunState.deltaSentAt.delete(clientRunId);
    deltaSentText.delete(clientRunId);
    reasoningRuns.delete(clientRunId);
    reasoningPatterns.delete(clientRunId);
    if (jobState === "done") {
      const payload = {
        runId: clientRunId,
        sessionKey,
        seq,
        state: "final" as const,
        message: text
          ? {
              role: "assistant",
              content: [{ type: "text", text }],
              timestamp: Date.now(),
            }
          : undefined,
        ...(reasoning ? { reasoning } : {}),
      };
      // Suppress webchat broadcast for heartbeat runs when showOk is false
      if (!shouldSuppressHeartbeatBroadcast(clientRunId)) {
        broadcast("chat", payload);
      }
      nodeSendToSession(sessionKey, "chat", payload);
      return;
    }
    const payload = {
      runId: clientRunId,
      sessionKey,
      seq,
      state: "error" as const,
      errorMessage: error ? formatForLog(error) : undefined,
    };
    broadcast("chat", payload);
    nodeSendToSession(sessionKey, "chat", payload);
  };

  const shouldEmitToolEvents = (runId: string, sessionKey?: string) => {
    const runContext = getAgentRunContext(runId);
    const runVerbose = normalizeVerboseLevel(runContext?.verboseLevel);
    if (runVerbose) {
      return runVerbose === "on";
    }
    if (!sessionKey) {
      return false;
    }
    try {
      const { cfg, entry } = loadSessionEntry(sessionKey);
      const sessionVerbose = normalizeVerboseLevel(entry?.verboseLevel);
      if (sessionVerbose) {
        return sessionVerbose === "on";
      }
      const defaultVerbose = normalizeVerboseLevel(cfg.agents?.defaults?.verboseDefault);
      return defaultVerbose === "on";
    } catch {
      return false;
    }
  };

  return (evt: AgentEventPayload) => {
    const chatLink = chatRunState.registry.peek(evt.runId);
    const sessionKey = chatLink?.sessionKey ?? resolveSessionKeyForRun(evt.runId);
    const clientRunId = chatLink?.clientRunId ?? evt.runId;
    const isAborted =
      chatRunState.abortedRuns.has(clientRunId) || chatRunState.abortedRuns.has(evt.runId);
    // Include sessionKey so Control UI can filter tool streams per session.
    const agentPayload = sessionKey ? { ...evt, sessionKey } : evt;
    const last = agentRunSeq.get(evt.runId) ?? 0;
    if (sessionKey && !isAborted && evt.stream === "tool") {
      flushPendingDelta(sessionKey, clientRunId, evt.seq);
      // The reasoning belonged to the message that called the tool; it is on screen now.
      reasoningRuns.delete(clientRunId);
    }
    if (evt.stream === "reasoning") {
      // Reasoning leaves the gateway only on the chat stream, redacted, and only where exposed;
      // the raw agent event is never broadcast.
      agentRunSeq.set(evt.runId, evt.seq);
      if (sessionKey && !isAborted && isReasoningExposed(evt.runId, clientRunId, sessionKey)) {
        emitChatReasoning(sessionKey, clientRunId, evt.seq, evt.data ?? {});
      }
      return;
    }
    if (evt.stream === "tool" && !shouldEmitToolEvents(evt.runId, sessionKey)) {
      agentRunSeq.set(evt.runId, evt.seq);
      return;
    }
    if (evt.seq !== last + 1) {
      broadcast("agent", {
        runId: evt.runId,
        stream: "error",
        ts: Date.now(),
        sessionKey,
        data: {
          reason: "seq gap",
          expected: last + 1,
          received: evt.seq,
        },
      });
    }
    agentRunSeq.set(evt.runId, evt.seq);
    broadcast("agent", agentPayload);

    const lifecyclePhase =
      evt.stream === "lifecycle" && typeof evt.data?.phase === "string" ? evt.data.phase : null;

    if (sessionKey) {
      nodeSendToSession(sessionKey, "agent", agentPayload);
      if (!isAborted && evt.stream === "assistant" && typeof evt.data?.text === "string") {
        emitChatDelta(sessionKey, clientRunId, evt.seq, evt.data.text);
      } else if (!isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        if (chatLink) {
          const finished = chatRunState.registry.shift(evt.runId);
          if (!finished) {
            clearAgentRunContext(evt.runId);
            return;
          }
          emitChatFinal(
            finished.sessionKey,
            finished.clientRunId,
            evt.seq,
            lifecyclePhase === "error" ? "error" : "done",
            evt.data?.error,
          );
        } else {
          emitChatFinal(
            sessionKey,
            evt.runId,
            evt.seq,
            lifecyclePhase === "error" ? "error" : "done",
            evt.data?.error,
          );
        }
      } else if (isAborted && (lifecyclePhase === "end" || lifecyclePhase === "error")) {
        chatRunState.abortedRuns.delete(clientRunId);
        chatRunState.abortedRuns.delete(evt.runId);
        chatRunState.buffers.delete(clientRunId);
        chatRunState.deltaSentAt.delete(clientRunId);
        deltaSentText.delete(clientRunId);
        reasoningRuns.delete(clientRunId);
        reasoningPatterns.delete(clientRunId);
        if (chatLink) {
          chatRunState.registry.remove(evt.runId, clientRunId, sessionKey);
        }
      }
    }

    if (lifecyclePhase === "end" || lifecyclePhase === "error") {
      clearAgentRunContext(evt.runId);
      reasoningExposure.delete(evt.runId);
    }
  };
}
