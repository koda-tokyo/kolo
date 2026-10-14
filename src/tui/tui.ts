import {
  CombinedAutocompleteProvider,
  Container,
  Loader,
  ProcessTerminal,
  Text,
  TUI,
} from "@mariozechner/pi-tui";
import type {
  AgentSummary,
  SessionInfo,
  SessionScope,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import { TUI_THEME_NAMES } from "../config/types.tui.js";
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { getSlashCommands } from "./commands.js";
import { ChatLog } from "./components/chat-log.js";
import { CustomEditor } from "./components/custom-editor.js";
import { expandFileMentions } from "./file-mentions.js";
import { GatewayChatClient } from "./gateway-chat.js";
import { createGatewayHttp } from "./gateway-http.js";
import { formatBinding, resolveKeybinds } from "./keybinds.js";
import { createRenderScheduler } from "./render-scheduler.js";
import { resolveTheme } from "./theme/theme-file.js";
import { editorTheme, getThemeName, setThemePalette, theme } from "./theme/theme.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { formatTokens } from "./tui-formatters.js";
import { createLocalShellRunner } from "./tui-local-shell.js";
import { createOverlayHandlers } from "./tui-overlays.js";
import { createSessionActions } from "./tui-session-actions.js";
import { composeStatusLine } from "./tui-status-line.js";
import { buildWaitingStatusMessage, defaultWaitingPhrases } from "./tui-waiting.js";

export { resolveFinalAssistantText } from "./tui-formatters.js";
export type { TuiOptions } from "./tui-types.js";

export function createEditorSubmitHandler(params: {
  editor: {
    setText: (value: string) => void;
    addToHistory: (value: string) => void;
  };
  handleCommand: (value: string) => Promise<void> | void;
  sendMessage: (value: string) => Promise<void> | void;
  handleBangLine: (value: string) => Promise<void> | void;
}) {
  return (text: string) => {
    const raw = text;
    const value = raw.trim();
    params.editor.setText("");

    // Keep previous behavior: ignore empty/whitespace-only submissions.
    if (!value) {
      return;
    }

    // Bash mode: only if the very first character is '!' and it's not just '!'.
    // IMPORTANT: use the raw (untrimmed) text so leading spaces do NOT trigger.
    // Per requirement: a lone '!' should be treated as a normal message.
    if (raw.startsWith("!") && raw !== "!") {
      params.editor.addToHistory(raw);
      void params.handleBangLine(raw);
      return;
    }

    // Enable built-in editor prompt history navigation (up/down).
    params.editor.addToHistory(value);

    if (value.startsWith("/")) {
      void params.handleCommand(value);
      return;
    }

    void params.sendMessage(value);
  };
}

export async function runTui(opts: TuiOptions) {
  const config = loadConfig();
  const themeResolution = resolveTheme(config.tui?.theme);
  setThemePalette(themeResolution.name, themeResolution.palette);
  const keybinds = resolveKeybinds(config.tui?.keybinds);
  const initialSessionInput = (opts.session ?? "").trim();
  let sessionScope: SessionScope = (config.session?.scope ?? "per-sender") as SessionScope;
  let sessionMainKey = normalizeMainKey(config.session?.mainKey);
  let agentDefaultId = resolveDefaultAgentId(config);
  let currentAgentId = agentDefaultId;
  let agents: AgentSummary[] = [];
  const agentNames = new Map<string, string>();
  let currentSessionKey = "";
  let initialSessionApplied = false;
  let currentSessionId: string | null = null;
  let activeChatRunId: string | null = null;
  let historyLoaded = false;
  let isConnected = false;
  let wasDisconnected = false;
  let toolsExpanded = false;
  // Reasoning view: on by default, collapsed to its first lines once the answer starts.
  let showThinking = true;
  let reasoningLayout: "collapsed" | "expanded" = "collapsed";
  let diffsEnabled = config.tui?.diffs !== false;
  let runSteps = 0;
  let reconnectCountdown: NodeJS.Timeout | null = null;
  let reconnectAt: number | null = null;
  let disconnectReason = "";

  const deliverDefault = opts.deliver ?? false;
  const autoMessage = opts.message?.trim();
  let autoMessageSent = false;
  let sessionInfo: SessionInfo = {};
  let lastCtrlCAt = 0;
  let activityStatus = "idle";
  let connectionStatus = "connecting";
  let statusTimeout: NodeJS.Timeout | null = null;
  let statusTimer: NodeJS.Timeout | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = activityStatus;

  const state: TuiStateAccess = {
    get agentDefaultId() {
      return agentDefaultId;
    },
    set agentDefaultId(value) {
      agentDefaultId = value;
    },
    get sessionMainKey() {
      return sessionMainKey;
    },
    set sessionMainKey(value) {
      sessionMainKey = value;
    },
    get sessionScope() {
      return sessionScope;
    },
    set sessionScope(value) {
      sessionScope = value;
    },
    get agents() {
      return agents;
    },
    set agents(value) {
      agents = value;
    },
    get currentAgentId() {
      return currentAgentId;
    },
    set currentAgentId(value) {
      currentAgentId = value;
    },
    get currentSessionKey() {
      return currentSessionKey;
    },
    set currentSessionKey(value) {
      currentSessionKey = value;
    },
    get currentSessionId() {
      return currentSessionId;
    },
    set currentSessionId(value) {
      currentSessionId = value;
    },
    get activeChatRunId() {
      return activeChatRunId;
    },
    set activeChatRunId(value) {
      activeChatRunId = value;
    },
    get historyLoaded() {
      return historyLoaded;
    },
    set historyLoaded(value) {
      historyLoaded = value;
    },
    get sessionInfo() {
      return sessionInfo;
    },
    set sessionInfo(value) {
      sessionInfo = value;
    },
    get initialSessionApplied() {
      return initialSessionApplied;
    },
    set initialSessionApplied(value) {
      initialSessionApplied = value;
    },
    get isConnected() {
      return isConnected;
    },
    set isConnected(value) {
      isConnected = value;
    },
    get autoMessageSent() {
      return autoMessageSent;
    },
    set autoMessageSent(value) {
      autoMessageSent = value;
    },
    get toolsExpanded() {
      return toolsExpanded;
    },
    set toolsExpanded(value) {
      toolsExpanded = value;
    },
    get showThinking() {
      return showThinking;
    },
    set showThinking(value) {
      showThinking = value;
      chatLog.setReasoningVisible(value);
    },
    get reasoningLayout() {
      return reasoningLayout;
    },
    set reasoningLayout(value) {
      reasoningLayout = value;
      chatLog.setReasoningLayout(value);
    },
    get diffsEnabled() {
      return diffsEnabled;
    },
    set diffsEnabled(value) {
      diffsEnabled = value;
    },
    get runSteps() {
      return runSteps;
    },
    set runSteps(value) {
      runSteps = value;
    },
    get connectionStatus() {
      return connectionStatus;
    },
    set connectionStatus(value) {
      connectionStatus = value;
    },
    get activityStatus() {
      return activityStatus;
    },
    set activityStatus(value) {
      activityStatus = value;
    },
    get statusTimeout() {
      return statusTimeout;
    },
    set statusTimeout(value) {
      statusTimeout = value;
    },
    get lastCtrlCAt() {
      return lastCtrlCAt;
    },
    set lastCtrlCAt(value) {
      lastCtrlCAt = value;
    },
  };

  const client = new GatewayChatClient({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  const tui = new TUI(new ProcessTerminal());
  const header = new Text("", 1, 0);
  const statusContainer = new Container();
  const footer = new Text("", 1, 0);
  const chatLog = new ChatLog();
  chatLog.setDiffsEnabled(diffsEnabled);
  const reasoningKey = keybinds.bindings.toggleReasoning?.[0];
  chatLog.setReasoningOptions({
    visible: showThinking,
    layout: reasoningLayout,
    maxLines: config.tui?.reasoning?.maxLines,
    toggleKeyLabel: reasoningKey ? formatBinding(reasoningKey, keybinds.leader) : undefined,
  });
  const editor = new CustomEditor(tui, editorTheme);
  editor.bindings = keybinds.bindings;
  editor.leader = keybinds.leader;
  const renderScheduler = createRenderScheduler(tui);
  chatLog.setRenderRequester(() => renderScheduler.request());
  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(footer);
  root.addChild(editor);

  const updateAutocompleteProvider = () => {
    editor.setAutocompleteProvider(
      new CombinedAutocompleteProvider(
        getSlashCommands({
          cfg: config,
          provider: sessionInfo.modelProvider,
          model: sessionInfo.model,
        }),
        process.cwd(),
      ),
    );
  };

  tui.addChild(root);
  tui.setFocus(editor);

  const formatSessionKey = (key: string) => {
    if (key === "global" || key === "unknown") {
      return key;
    }
    const parsed = parseAgentSessionKey(key);
    return parsed?.rest ?? key;
  };

  const formatAgentLabel = (id: string) => {
    const name = agentNames.get(id);
    return name ? `${id} (${name})` : id;
  };

  const resolveSessionKey = (raw?: string) => {
    const trimmed = (raw ?? "").trim();
    if (sessionScope === "global") {
      return "global";
    }
    if (!trimmed) {
      return buildAgentMainSessionKey({
        agentId: currentAgentId,
        mainKey: sessionMainKey,
      });
    }
    if (trimmed === "global" || trimmed === "unknown") {
      return trimmed;
    }
    if (trimmed.startsWith("agent:")) {
      return trimmed;
    }
    return `agent:${currentAgentId}:${trimmed}`;
  };

  currentSessionKey = resolveSessionKey(initialSessionInput);

  const updateHeader = () => {
    const sessionLabel = formatSessionKey(currentSessionKey);
    const agentLabel = formatAgentLabel(currentAgentId);
    header.setText(
      theme.header(
        `kolo tui - ${client.connection.url} - agent ${agentLabel} - session ${sessionLabel}`,
      ),
    );
  };

  const busyStates = new Set(["sending", "waiting", "streaming", "running"]);
  let statusText: Text | null = null;
  let statusLoader: Loader | null = null;
  // Shown while the gateway is unreachable; the status container keeps it above the state line.
  // M13: also shown while the policy kill switch or a budget pause holds the current agent.
  const banner = new Text("", 1, 0);
  let bannerShown = false;
  let policyNotice = "";

  const updateBanner = () => {
    if (isConnected) {
      if (policyNotice) {
        banner.setText(theme.banner(` ${policyNotice} `));
        if (!bannerShown) {
          statusContainer.addChild(banner);
          bannerShown = true;
        }
        return;
      }
      if (bannerShown) {
        statusContainer.removeChild(banner);
        bannerShown = false;
      }
      return;
    }
    const seconds =
      reconnectAt !== null ? Math.max(0, Math.ceil((reconnectAt - Date.now()) / 1000)) : null;
    const reason = disconnectReason ? ` (${disconnectReason})` : "";
    const when =
      seconds === null
        ? "reconnecting"
        : seconds === 0
          ? "reconnecting now"
          : `reconnecting in ${seconds}s`;
    banner.setText(theme.banner(` gateway unreachable${reason}. ${when} `));
    if (!bannerShown) {
      statusContainer.addChild(banner);
      bannerShown = true;
    }
  };

  const stopReconnectCountdown = () => {
    if (reconnectCountdown) {
      clearInterval(reconnectCountdown);
      reconnectCountdown = null;
    }
    reconnectAt = null;
  };

  const formatElapsed = (startMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const ensureStatusText = () => {
    if (statusText) {
      return;
    }
    statusContainer.clear();
    bannerShown = false;
    statusLoader?.stop();
    statusLoader = null;
    statusText = new Text("", 1, 0);
    statusContainer.addChild(statusText);
    updateBanner();
  };

  const ensureStatusLoader = () => {
    if (statusLoader) {
      return;
    }
    statusContainer.clear();
    bannerShown = false;
    statusText = null;
    statusLoader = new Loader(
      tui,
      (spinner) => theme.accent(spinner),
      (text) => theme.bold(theme.accentSoft(text)),
      "",
    );
    statusContainer.addChild(statusLoader);
    updateBanner();
  };

  let waitingTick = 0;
  let waitingTimer: NodeJS.Timeout | null = null;
  let waitingPhrase: string | null = null;

  const updateBusyStatusMessage = () => {
    if (!statusLoader || !statusStartedAt) {
      return;
    }
    const elapsed = formatElapsed(statusStartedAt);

    if (activityStatus === "waiting") {
      waitingTick++;
      statusLoader.setMessage(
        buildWaitingStatusMessage({
          theme,
          tick: waitingTick,
          elapsed,
          connectionStatus,
          phrases: waitingPhrase ? [waitingPhrase] : undefined,
        }),
      );
      return;
    }

    statusLoader.setMessage(`${activityStatus} • ${elapsed} | ${connectionStatus}`);
  };

  const startStatusTimer = () => {
    if (statusTimer) {
      return;
    }
    statusTimer = setInterval(() => {
      if (!busyStates.has(activityStatus)) {
        return;
      }
      updateBusyStatusMessage();
    }, 1000);
  };

  const stopStatusTimer = () => {
    if (!statusTimer) {
      return;
    }
    clearInterval(statusTimer);
    statusTimer = null;
  };

  const startWaitingTimer = () => {
    if (waitingTimer) {
      return;
    }

    // Pick a phrase once per waiting session.
    if (!waitingPhrase) {
      const idx = Math.floor(Math.random() * defaultWaitingPhrases.length);
      waitingPhrase = defaultWaitingPhrases[idx] ?? defaultWaitingPhrases[0] ?? "waiting";
    }

    waitingTick = 0;

    waitingTimer = setInterval(() => {
      if (activityStatus !== "waiting") {
        return;
      }
      updateBusyStatusMessage();
    }, 120);
  };

  const stopWaitingTimer = () => {
    if (!waitingTimer) {
      return;
    }
    clearInterval(waitingTimer);
    waitingTimer = null;
    waitingPhrase = null;
  };

  const renderStatus = () => {
    const isBusy = busyStates.has(activityStatus);
    if (isBusy) {
      if (!statusStartedAt || lastActivityStatus !== activityStatus) {
        statusStartedAt = Date.now();
      }
      ensureStatusLoader();
      if (activityStatus === "waiting") {
        stopStatusTimer();
        startWaitingTimer();
      } else {
        stopWaitingTimer();
        startStatusTimer();
      }
      updateBusyStatusMessage();
    } else {
      statusStartedAt = null;
      stopStatusTimer();
      stopWaitingTimer();
      statusLoader?.stop();
      statusLoader = null;
      ensureStatusText();
      const text = activityStatus ? `${connectionStatus} | ${activityStatus}` : connectionStatus;
      statusText?.setText(theme.dim(text));
    }
    lastActivityStatus = activityStatus;
  };

  const setConnectionStatus = (text: string, ttlMs?: number) => {
    connectionStatus = text;
    renderStatus();
    if (statusTimeout) {
      clearTimeout(statusTimeout);
    }
    if (ttlMs && ttlMs > 0) {
      statusTimeout = setTimeout(() => {
        connectionStatus = isConnected ? "connected" : "disconnected";
        renderStatus();
      }, ttlMs);
    }
  };

  const setActivityStatus = (text: string) => {
    const changed = activityStatus !== text;
    activityStatus = text;
    if (!changed && busyStates.has(text)) {
      // Repeated deltas: the loader is already running; nothing to rebuild.
      return;
    }
    renderStatus();
    updateFooter();
  };

  const resolveStepLimit = () => {
    const perAgent = config.agents?.list?.find((agent) => agent.id === currentAgentId)?.limits
      ?.maxSteps;
    return perAgent ?? config.agents?.defaults?.limits?.maxSteps ?? 200;
  };

  const updateFooter = () => {
    const sessionKeyLabel = formatSessionKey(currentSessionKey);
    const sessionLabel = sessionInfo.displayName
      ? `${sessionKeyLabel} (${sessionInfo.displayName})`
      : sessionKeyLabel;
    const tokens = formatTokens(sessionInfo.totalTokens ?? null, sessionInfo.contextTokens ?? null);
    const think = sessionInfo.thinkingLevel ?? "off";
    const verbose = sessionInfo.verboseLevel ?? "off";
    const reasoning = sessionInfo.reasoningLevel ?? "off";
    const reasoningLabel =
      reasoning === "on" ? "reasoning" : reasoning === "stream" ? "reasoning:stream" : null;
    const busy = busyStates.has(activityStatus);
    const line = composeStatusLine({
      agentId: currentAgentId,
      assistantName: agentNames.get(currentAgentId) ?? config.ui?.assistant?.name?.trim(),
      sessionLabel,
      jobState: isConnected ? activityStatus || "idle" : "offline",
      steps: busy || runSteps > 0 ? runSteps : null,
      stepLimit: resolveStepLimit(),
      providerProfile: sessionInfo.modelProvider,
      model: sessionInfo.model,
      extras: [
        think !== "off" ? `think ${think}` : null,
        verbose !== "off" ? `verbose ${verbose}` : null,
        reasoningLabel,
        tokens,
      ],
      width: process.stdout.columns ?? 0,
    });
    footer.setText(theme.dim(line));
  };

  const { openOverlay, closeOverlay } = createOverlayHandlers(tui, editor);

  const initialSessionAgentId = (() => {
    if (!initialSessionInput) {
      return null;
    }
    const parsed = parseAgentSessionKey(initialSessionInput);
    return parsed ? normalizeAgentId(parsed.agentId) : null;
  })();

  const sessionActions = createSessionActions({
    client,
    chatLog,
    tui,
    opts,
    state,
    agentNames,
    initialSessionInput,
    initialSessionAgentId,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    updateAutocompleteProvider,
    setActivityStatus,
  });
  const { refreshAgents, refreshSessionInfo, loadHistory, setSession, abortActive } =
    sessionActions;

  const { handleChatEvent, handleAgentEvent, handleReconnect, handleChannelInbound } =
    createEventHandlers({
      chatLog,
      tui,
      state,
      setActivityStatus,
      refreshSessionInfo,
      reconcileHistory: loadHistory,
      render: renderScheduler,
      fetchRecordMessages: async () => {
        const record = (await client.loadHistory({
          sessionKey: state.currentSessionKey,
          limit: 12,
        })) as { messages?: unknown[] };
        return record.messages ?? [];
      },
    });

  const { handleCommand, sendMessage, openModelSelector, openAgentSelector, openSessionSelector } =
    createCommandHandlers({
      client,
      chatLog,
      tui,
      opts,
      state,
      deliverDefault,
      openOverlay,
      closeOverlay,
      refreshSessionInfo,
      loadHistory,
      setSession,
      refreshAgents,
      abortActive,
      setActivityStatus,
      formatSessionKey,
      keybinds: keybinds.bindings,
      leader: keybinds.leader,
      getPromptText: () => editor.getText(),
      setPromptText: (text) => {
        editor.setText(text);
        tui.requestRender();
      },
      withTerminalReleased: async (fn) => {
        tui.stop();
        try {
          return await fn();
        } finally {
          tui.start();
          tui.requestRender(true);
        }
      },
      redactPatterns: config.logging?.redactPatterns,
      http: createGatewayHttp(client.connection),
      onThemeChanged: () => {
        // Components cache styled strings; redraw from the record with the new palette.
        updateHeader();
        updateFooter();
        void loadHistory();
      },
    });

  const { runLocalShellLine } = createLocalShellRunner({
    chatLog,
    tui,
    openOverlay,
    closeOverlay,
  });
  updateAutocompleteProvider();
  editor.onSubmit = createEditorSubmitHandler({
    editor,
    handleCommand,
    sendMessage: async (text) => {
      // `@path` references are attached to the message; the log shows the typed line.
      const expanded = await expandFileMentions(text, { cwd: process.cwd() });
      for (const skip of expanded.skipped) {
        chatLog.addSystem(`not attached (${skip.reason}): ${skip.path}`);
      }
      if (expanded.attached.length > 0) {
        chatLog.addSystem(
          `attached ${expanded.attached.map((file) => `${file.path} (${file.bytes} bytes)`).join(", ")}`,
        );
      }
      await sendMessage(expanded.message, { display: text });
    },
    handleBangLine: runLocalShellLine,
  });

  const exitTui = () => {
    client.stop();
    tui.stop();
    process.exit(0);
  };

  const clearInputKey =
    keybinds.bindings.clearInput.find((binding) => !binding.chord)?.key ?? "ctrl+c";
  editor.onLeaderState = (leaderState, key) => {
    if (leaderState === "armed") {
      setActivityStatus(
        `${keybinds.leader ?? "leader"} pressed; next key runs a chord (escape cancels)`,
      );
    } else if (leaderState === "cancelled") {
      setActivityStatus("chord cancelled");
    } else {
      setActivityStatus(`no chord bound to ${JSON.stringify(key ?? "")}; /keys lists them`);
    }
    tui.requestRender();
  };
  editor.onAction = (action) => {
    switch (action) {
      case "help":
        void handleCommand("/help");
        return;
      case "status":
        void handleCommand("/status");
        return;
      case "jobs":
        void handleCommand("/jobs");
        return;
      case "settings":
        void handleCommand("/settings");
        return;
      case "toggleUsage":
        void handleCommand("/usage");
        return;
      case "cycleTheme": {
        const names = TUI_THEME_NAMES as readonly string[];
        const index = names.indexOf(getThemeName());
        void handleCommand(`/theme ${names[(index + 1) % names.length]}`);
        return;
      }
      case "keys":
        void handleCommand("/keys");
        return;
      case "newSession":
        void handleCommand("/new");
        return;
      case "clearScreen":
        void handleCommand("/clear");
        return;
      case "export":
        void handleCommand("/export");
        return;
      case "editor":
        void handleCommand("/editor");
        return;
      case "undo":
        void handleCommand("/undo");
        return;
      case "redo":
        void handleCommand("/redo");
        return;
      case "snapshots":
        void handleCommand("/snapshots");
        return;
      case "abort":
        void abortActive();
        return;
      case "clearInput": {
        const now = Date.now();
        if (editor.getText().trim().length > 0) {
          editor.setText("");
          setActivityStatus("cleared input");
          tui.requestRender();
          return;
        }
        if (now - lastCtrlCAt < 1000) {
          exitTui();
        }
        lastCtrlCAt = now;
        setActivityStatus(`press ${clearInputKey} again to exit`);
        tui.requestRender();
        return;
      }
      case "exit":
        exitTui();
        return;
      case "toggleTools":
        toolsExpanded = !toolsExpanded;
        chatLog.setToolsExpanded(toolsExpanded);
        setActivityStatus(toolsExpanded ? "tools expanded" : "tools collapsed");
        tui.requestRender();
        return;
      case "toggleDiff":
        diffsEnabled = !diffsEnabled;
        chatLog.setDiffsEnabled(diffsEnabled);
        setActivityStatus(diffsEnabled ? "diffs shown" : "diffs hidden");
        tui.requestRender();
        return;
      case "models":
        void openModelSelector();
        return;
      case "agents":
        void openAgentSelector();
        return;
      case "sessions":
        void openSessionSelector();
        return;
      case "toggleThinking":
        state.showThinking = !showThinking;
        setActivityStatus(showThinking ? "reasoning shown" : "reasoning hidden");
        tui.requestRender();
        return;
      case "toggleReasoning":
        if (!chatLog.toggleLatestReasoning()) {
          setActivityStatus("no reasoning to expand");
        }
        tui.requestRender();
        return;
      default:
        return;
    }
  };

  // M13: the policy banner follows kill / release / budget events for this agent or the fleet.
  const applyPolicyStatus = (status: {
    kill?: { fleet?: { by: string } | null; agents?: Record<string, { by: string }> };
    paused?: Record<string, { rule: string }>;
    fleetPaused?: { rule: string } | null;
  }) => {
    if (status.kill?.fleet) {
      policyNotice = `policy: fleet stopped by ${status.kill.fleet.by}. Release with: kolo policy release --all`;
    } else if (status.kill?.agents?.[currentAgentId]) {
      policyNotice = `policy: agent ${currentAgentId} stopped by ${status.kill.agents[currentAgentId].by}. Release with: kolo policy release --agent ${currentAgentId}`;
    } else if (status.fleetPaused) {
      policyNotice = `policy: fleet paused (${status.fleetPaused.rule})`;
    } else if (status.paused?.[currentAgentId]) {
      policyNotice = `policy: agent ${currentAgentId} paused (${status.paused[currentAgentId].rule})`;
    } else {
      policyNotice = "";
    }
    updateBanner();
    tui.requestRender();
  };

  const refreshPolicyBanner = async () => {
    try {
      const res = await client.policyStatus();
      applyPolicyStatus(res.status);
    } catch {
      // Older gateways have no policy.status; the banner stays off.
    }
  };

  const handlePolicyEvent = (payload: unknown) => {
    const evt = payload as { type?: string; agent?: string | null; by?: string; ruleId?: string };
    if (evt.type === "kill" || evt.type === "release" || evt.type === "budget") {
      void refreshPolicyBanner();
    }
  };

  client.onEvent = (evt) => {
    if (evt.event === "chat") {
      handleChatEvent(evt.payload);
    }
    if (evt.event === "agent") {
      handleAgentEvent(evt.payload);
    }
    if (evt.event === "policy") {
      handlePolicyEvent(evt.payload);
    }
    if (evt.event === "channel.inbound") {
      handleChannelInbound(evt.payload);
    }
  };

  client.onConnected = () => {
    isConnected = true;
    const reconnected = wasDisconnected;
    wasDisconnected = false;
    stopReconnectCountdown();
    disconnectReason = "";
    updateBanner();
    setConnectionStatus("connected");
    void (async () => {
      if (reconnected) {
        handleReconnect();
      }
      await refreshAgents();
      updateHeader();
      await refreshPolicyBanner();
      await loadHistory();
      setConnectionStatus(reconnected ? "gateway reconnected" : "gateway connected", 4000);
      tui.requestRender();
      if (!autoMessageSent && autoMessage) {
        autoMessageSent = true;
        await sendMessage(autoMessage);
      }
      updateFooter();
      tui.requestRender();
    })();
  };

  client.onDisconnected = (reason) => {
    isConnected = false;
    wasDisconnected = true;
    historyLoaded = false;
    const reasonLabel = reason?.trim() ? reason.trim() : "connection closed";
    disconnectReason = reasonLabel;
    setConnectionStatus("disconnected");
    setActivityStatus("idle");
    updateBanner();
    updateFooter();
    tui.requestRender();
  };

  client.onReconnectScheduled = (delayMs) => {
    reconnectAt = Date.now() + delayMs;
    updateBanner();
    if (!reconnectCountdown) {
      reconnectCountdown = setInterval(() => {
        if (isConnected) {
          stopReconnectCountdown();
          return;
        }
        updateBanner();
        tui.requestRender();
      }, 1000);
      reconnectCountdown.unref?.();
    }
    tui.requestRender();
  };

  client.onGap = (info) => {
    setConnectionStatus(`event gap: expected ${info.expected}, got ${info.received}`, 5000);
    tui.requestRender();
  };

  updateHeader();
  setConnectionStatus("connecting");
  updateFooter();
  for (const warning of keybinds.warnings) {
    chatLog.addSystem(warning);
  }
  if (themeResolution.error) {
    chatLog.addSystem(themeResolution.error);
  }
  for (const warning of themeResolution.warnings) {
    chatLog.addSystem(`tui.theme: ${warning}`);
  }
  tui.start();
  client.start();
}
