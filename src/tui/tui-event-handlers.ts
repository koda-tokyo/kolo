import type { TUI } from "@mariozechner/pi-tui";
import type { ChatLog } from "./components/chat-log.js";
import type { AgentEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { wasSentLocally } from "./gateway-chat.js";
import {
  asString,
  extractTextFromMessage,
  isCommandMessage,
  splitAssistantMessage,
} from "./tui-formatters.js";
import { TuiStreamAssembler } from "./tui-stream-assembler.js";

type EventHandlerContext = {
  chatLog: ChatLog;
  tui: TUI;
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  refreshSessionInfo?: () => Promise<void>;
  // Re-reads the session record and redraws it (OpenCode-style resync after streaming).
  reconcileHistory?: () => Promise<void>;
  // Reads the session record's messages without redrawing (used to fill one missing message).
  fetchRecordMessages?: () => Promise<unknown[]>;
  // Coalescing renderer for the stream path (deltas, tool updates). Defaults to tui.requestRender.
  render?: { request: () => void; flush: () => void };
};

export function createEventHandlers(context: EventHandlerContext) {
  const {
    chatLog,
    tui,
    state,
    setActivityStatus,
    refreshSessionInfo,
    reconcileHistory,
    fetchRecordMessages,
  } = context;
  const render = context.render ?? {
    request: () => tui.requestRender(),
    flush: () => tui.requestRender(),
  };
  const finalizedRuns = new Map<string, number>();
  const sessionRuns = new Map<string, number>();
  let streamAssembler = new TuiStreamAssembler();
  let lastSessionKey = state.currentSessionKey;
  // One run can contain several assistant messages (text, tool call, more text). The gateway
  // streams only the CURRENT message's accumulated text, so keying one bubble per run made each
  // new message overwrite the previous one on screen. Following the Codex TUI "history cell"
  // model, each assistant message is its own segment: it is committed when a tool starts or a new
  // message begins, and later text streams into a fresh bubble below it.
  // `reasoning` is the reasoning text shown for the segment (its own block above the answer);
  // `reasoningStartedAt` tells one message's reasoning from the next one's.
  type RunSegment = {
    n: number;
    text: string;
    display: string;
    reasoning: string;
    reasoningStartedAt?: number;
  };
  const runSegments = new Map<string, RunSegment>();
  // Runs whose stream was cut by a disconnect: their final redraws from the record.
  const interruptedRuns = new Set<string>();
  // Last text committed to the screen per run, so a fill from the record never repeats it.
  const lastCommitted = new Map<string, string>();
  const segmentKey = (runId: string, seg: RunSegment) =>
    seg.n === 0 ? runId : `${runId}#${seg.n}`;
  const getSegment = (runId: string): RunSegment => {
    let seg = runSegments.get(runId);
    if (!seg) {
      seg = { n: 0, text: "", display: "", reasoning: "" };
      runSegments.set(runId, seg);
    }
    return seg;
  };
  const commitSegment = (runId: string) => {
    const seg = runSegments.get(runId);
    if (!seg || (!seg.display && !seg.reasoning)) {
      return;
    }
    const key = segmentKey(runId, seg);
    chatLog.finalizeAssistant(seg.display, key, streamAssembler.peekReasoning(key));
    streamAssembler.drop(key);
    lastCommitted.set(runId, seg.display);
    seg.n += 1;
    seg.text = "";
    seg.display = "";
    seg.reasoning = "";
    seg.reasoningStartedAt = undefined;
  };

  // A short message right before a tool call can be swallowed whole by the gateway's delta
  // throttle: nothing of it streams, and the next message replaces it in the gateway's buffer.
  // The record already holds it (a message is written before its tool runs), so read the record
  // and put the text back above the tool cell. Best effort; the post-run resync is the backstop.
  const fillMissingMessage = (runId: string, toolCallId: string) => {
    if (!fetchRecordMessages) {
      return;
    }
    setTimeout(() => {
      void (async () => {
        try {
          const messages = await fetchRecordMessages();
          const last = messages
            .toReversed()
            .find(
              (m) => m && typeof m === "object" && (m as { role?: unknown }).role === "assistant",
            );
          if (!last || finalizedRuns.has(runId)) {
            return;
          }
          const { content: text, reasoning } = splitAssistantMessage(last);
          if ((!text && !reasoning) || (text && text === lastCommitted.get(runId))) {
            return;
          }
          chatLog.insertAssistantBefore(text, toolCallId, reasoning);
          lastCommitted.set(runId, text);
          tui.requestRender();
        } catch {
          // best effort; see above
        }
      })();
    }, 80);
  };

  // The gateway connection came back and the screen was redrawn from the record. Every run that
  // was streaming lost its in-flight text with the socket, so its final must resync from the
  // record instead of trusting what the stream delivered (OpenCode: the server's record is truth).
  const handleReconnect = () => {
    for (const runId of sessionRuns.keys()) {
      interruptedRuns.add(runId);
    }
    if (state.activeChatRunId) {
      interruptedRuns.add(state.activeChatRunId);
    }
    runSegments.clear();
    lastCommitted.clear();
    streamAssembler = new TuiStreamAssembler();
  };

  const isSilentReplyPrefix = (text: string | null | undefined) => {
    const trimmed = (text ?? "").trim();
    return trimmed.length > 0 && SILENT_REPLY_TOKEN.startsWith(trimmed);
  };

  const pruneRunMap = (runs: Map<string, number>) => {
    if (runs.size <= 200) {
      return;
    }
    const keepUntil = Date.now() - 10 * 60 * 1000;
    for (const [key, ts] of runs) {
      if (runs.size <= 150) {
        break;
      }
      if (ts < keepUntil) {
        runs.delete(key);
      }
    }
    if (runs.size > 200) {
      for (const key of runs.keys()) {
        runs.delete(key);
        if (runs.size <= 150) {
          break;
        }
      }
    }
  };

  const syncSessionKey = () => {
    if (state.currentSessionKey === lastSessionKey) {
      return;
    }
    lastSessionKey = state.currentSessionKey;
    finalizedRuns.clear();
    sessionRuns.clear();
    runSegments.clear();
    interruptedRuns.clear();
    lastCommitted.clear();
    streamAssembler = new TuiStreamAssembler();
  };

  const noteSessionRun = (runId: string) => {
    sessionRuns.set(runId, Date.now());
    pruneRunMap(sessionRuns);
  };

  const noteFinalizedRun = (runId: string) => {
    finalizedRuns.set(runId, Date.now());
    sessionRuns.delete(runId);
    const seg = runSegments.get(runId);
    streamAssembler.drop(seg ? segmentKey(runId, seg) : runId);
    runSegments.delete(runId);
    lastCommitted.delete(runId);
    pruneRunMap(finalizedRuns);
  };

  const handleChatEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as ChatEvent;
    syncSessionKey();
    if (evt.sessionKey !== state.currentSessionKey) {
      return;
    }
    if (finalizedRuns.has(evt.runId)) {
      if (evt.state === "delta") {
        return;
      }
      if (evt.state === "final") {
        return;
      }
    }
    noteSessionRun(evt.runId);
    if (!state.activeChatRunId) {
      state.activeChatRunId = evt.runId;
    }
    if (evt.state === "delta") {
      const seg = getSegment(evt.runId);
      const { content: incoming, reasoning: incomingReasoning } = splitAssistantMessage(
        evt.message,
        evt.reasoning,
      );
      const incomingReasoningText = incomingReasoning?.text ?? "";
      if (isSilentReplyPrefix(incoming) && !wasSentLocally(evt.runId)) {
        // A housekeeping run (post-turn STM acknowledgement) answering NO_REPLY: its throttled
        // prefix ("NO") must not become a bubble.
        return;
      }
      const sameReasoning =
        !seg.reasoning ||
        !incomingReasoningText ||
        (incomingReasoning?.startedAt !== undefined && seg.reasoningStartedAt !== undefined
          ? incomingReasoning.startedAt === seg.reasoningStartedAt
          : incomingReasoningText.startsWith(seg.reasoning.slice(0, 32)));
      if (
        (seg.text && incoming && !incoming.startsWith(seg.text)) ||
        // Reasoning of a new message arrives before its answer: the gateway starts it with
        // empty text while the previous message's answer is still on this segment.
        (seg.text && !incoming && incomingReasoningText) ||
        !sameReasoning
      ) {
        // A new assistant message started inside the same run: keep the previous one on screen.
        commitSegment(evt.runId);
      }
      const key = segmentKey(evt.runId, seg);
      const view = streamAssembler.ingestDelta(key, evt.message, evt.reasoning);
      if (incoming) {
        seg.text = incoming;
      }
      if (incomingReasoningText) {
        seg.reasoning = incomingReasoningText;
        seg.reasoningStartedAt = incomingReasoning?.startedAt;
      }
      if (!view) {
        return;
      }
      seg.display = view.content;
      chatLog.updateAssistant(view.content, key, view.reasoning);
      setActivityStatus(view.content ? "streaming" : "thinking");
      render.request();
      return;
    }
    if (evt.state === "final") {
      if (isCommandMessage(evt.message)) {
        const text = extractTextFromMessage(evt.message);
        if (text) {
          chatLog.addSystem(text);
        }
        streamAssembler.drop(evt.runId);
        noteFinalizedRun(evt.runId);
        state.activeChatRunId = null;
        setActivityStatus("idle");
        void refreshSessionInfo?.();
        tui.requestRender();
        return;
      }
      const stopReason =
        evt.message && typeof evt.message === "object" && !Array.isArray(evt.message)
          ? typeof (evt.message as Record<string, unknown>).stopReason === "string"
            ? ((evt.message as Record<string, unknown>).stopReason as string)
            : ""
          : "";

      const seg = getSegment(evt.runId);
      const { content: rawFinalContent, reasoning: finalReasoning } = splitAssistantMessage(
        evt.message,
        evt.reasoning,
      );
      const finalContent =
        isSilentReplyPrefix(rawFinalContent) && !wasSentLocally(evt.runId) ? "" : rawFinalContent;
      if (seg.text && finalContent && !finalContent.startsWith(seg.text)) {
        // The last message's deltas never reached us (throttled); keep what was shown.
        commitSegment(evt.runId);
      }
      if (
        !finalContent &&
        !seg.display &&
        !seg.reasoning &&
        (seg.n > 0 || !wasSentLocally(evt.runId))
      ) {
        // Nothing new to show: earlier messages are already on screen, or this is a background
        // run (heartbeat, follow-up) that ended silently. Only a run typed here gets "(no output)".
        interruptedRuns.delete(evt.runId);
        noteFinalizedRun(evt.runId);
        state.activeChatRunId = null;
        setActivityStatus(stopReason === "error" ? "error" : "idle");
        void refreshSessionInfo?.();
        tui.requestRender();
        return;
      }
      const key = segmentKey(evt.runId, seg);
      const needsResync = seg.n > 0 || interruptedRuns.has(evt.runId);
      interruptedRuns.delete(evt.runId);
      const view = streamAssembler.finalize(key, evt.message, evt.reasoning);
      // A message that only reasoned (its answer went elsewhere, or there was none) shows the
      // reasoning block alone instead of "(no output)".
      const reasoningOnly =
        !finalContent && !seg.display && Boolean(view.reasoning ?? finalReasoning);
      chatLog.finalizeAssistant(reasoningOnly ? "" : view.content, key, view.reasoning);
      if (needsResync && reconcileHistory) {
        // Streamed updates are throttled, so an earlier message's last words can be missing.
        // Once nothing else is streaming, redraw from the session record, which is complete.
        setTimeout(() => {
          if (!state.activeChatRunId && sessionRuns.size === 0) {
            void reconcileHistory();
          }
        }, 300);
      }
      noteFinalizedRun(evt.runId);
      state.activeChatRunId = null;
      setActivityStatus(stopReason === "error" ? "error" : "idle");
      // Refresh session info to update token counts in footer
      void refreshSessionInfo?.();
    }
    if (evt.state === "aborted") {
      commitSegment(evt.runId);
      chatLog.addSystem("run aborted");
      runSegments.delete(evt.runId);
      streamAssembler.drop(evt.runId);
      sessionRuns.delete(evt.runId);
      state.activeChatRunId = null;
      setActivityStatus("aborted");
      void refreshSessionInfo?.();
    }
    if (evt.state === "error") {
      commitSegment(evt.runId);
      chatLog.addSystem(`run error: ${evt.errorMessage ?? "unknown"}`);
      runSegments.delete(evt.runId);
      streamAssembler.drop(evt.runId);
      sessionRuns.delete(evt.runId);
      state.activeChatRunId = null;
      setActivityStatus("error");
      void refreshSessionInfo?.();
    }
    tui.requestRender();
  };

  const handleAgentEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const evt = payload as AgentEvent;
    syncSessionKey();
    // Agent events (tool streaming, lifecycle) are emitted per-run. Filter against the
    // active chat run id, not the session id.
    const isActiveRun = evt.runId === state.activeChatRunId;
    if (!isActiveRun && !sessionRuns.has(evt.runId)) {
      return;
    }
    if (evt.stream === "tool") {
      const data = evt.data ?? {};
      const phase = asString(data.phase, "");
      const toolCallId = asString(data.toolCallId, "");
      const toolName = asString(data.name, "tool");
      if (!toolCallId) {
        return;
      }
      if (phase === "start") {
        // Commit the text written before this tool so the tool shows below it and the next
        // message streams into a new bubble instead of overwriting this one.
        const streamedText = Boolean(runSegments.get(evt.runId)?.display);
        commitSegment(evt.runId);
        chatLog.startTool(toolCallId, toolName, data.args);
        if (!streamedText) {
          fillMissingMessage(evt.runId, toolCallId);
        }
      } else if (phase === "update") {
        chatLog.updateToolResult(toolCallId, data.partialResult, {
          partial: true,
        });
        render.request();
        return;
      } else if (phase === "result") {
        chatLog.updateToolResult(toolCallId, data.result, {
          isError: Boolean(data.isError),
        });
        if (isActiveRun) {
          state.runSteps = (state.runSteps ?? 0) + 1;
        }
      }
      render.flush();
      return;
    }
    if (evt.stream === "lifecycle") {
      if (!isActiveRun) {
        return;
      }
      const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      if (phase === "start") {
        state.runSteps = 0;
        setActivityStatus("running");
      }
      if (phase === "end") {
        setActivityStatus("idle");
      }
      if (phase === "error") {
        setActivityStatus("error");
      }
      tui.requestRender();
    }
  };

  // M14: a message that arrived on a channel for the session this terminal is attached to.
  const handleChannelInbound = (payload: unknown) => {
    const evt = payload as {
      channel?: string;
      sessionKey?: string;
      sender?: { id?: string; name?: string };
      text?: string;
      attachments?: Array<{ path: string }>;
    };
    if (!evt || evt.sessionKey !== state.currentSessionKey) {
      return;
    }
    const who = evt.sender?.name ?? evt.sender?.id ?? "?";
    const files = evt.attachments?.length ? ` [${evt.attachments.length} file(s)]` : "";
    chatLog.addUser(`[${evt.channel ?? "channel"} ${who}] ${evt.text ?? ""}${files}`);
    tui.requestRender();
  };

  return { handleChatEvent, handleAgentEvent, handleReconnect, handleChannelInbound };
}
