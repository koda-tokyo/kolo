import type { Component, KeyId, TUI } from "@mariozechner/pi-tui";
import type { EvidenceEvent } from "../evidence/types.js";

type FactoryEntryLike = { seq: number; kind: string; by: string; text: string };
type FactoryCardLike = {
  id: string;
  title: string;
  column: string;
  owner: string;
  repo: string;
  engineTaskId: string | null;
  branch: string | null;
  jobIds: string[];
  evidenceIds: string[];
  pr: { url: string } | null;
  runningJobId: string | null;
  error: string | null;
};
import type { ChatLog } from "./components/chat-log.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import type { GatewayHttp } from "./gateway-http.js";
import type { SiblingChatView } from "./sibling-chat-view.js";
import type {
  AgentSummary,
  GatewayStatusSummary,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";
import {
  formatThinkingLevels,
  normalizeUsageDisplay,
  resolveResponseUsageMode,
} from "../auto-reply/thinking.js";
import { createStepper, formatStep, type Stepper } from "../evidence/replay.js";
import { normalizeAgentId, parseAgentSessionKey } from "../routing/session-key.js";
import { formatRelativeTime } from "../utils/time-format.js";
import { helpText, parseCommand } from "./commands.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSettingsList,
} from "./components/selectors.js";
import { exportTranscript, parseExportArgs } from "./export.js";
import { editInExternalEditor } from "./external-editor.js";
import { formatKeybinds, type KeyBinding, type TuiKeybindAction } from "./keybinds.js";
import { resolveTheme } from "./theme/theme-file.js";
import { getThemeName, setThemePalette, TUI_THEME_NAMES } from "./theme/theme.js";
import { formatStatusSummary } from "./tui-status-summary.js";

// Peer agents are configured on the gateway, not hardcoded here; names are validated by
// the gateway handler. The TUI only checks the shape of the id.
const KNOWN_SIBLINGS: string[] = [];
const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

type CommandHandlerContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  deliverDefault: boolean;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setSession: (key: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  formatSessionKey: (key: string) => string;
  siblingChat?: SiblingChatView;
  /** Called after /theme switches the palette so the screen can be redrawn. */
  onThemeChanged?: (name: string) => void;
  keybinds?: Partial<Record<TuiKeybindAction, KeyBinding[]>>;
  leader?: KeyId | null;
  /** Prompt access and terminal release for /editor; export settings for /export. */
  getPromptText?: () => string;
  setPromptText?: (text: string) => void;
  withTerminalReleased?: <T>(fn: () => Promise<T>) => Promise<T>;
  exportCwd?: string;
  redactPatterns?: string[];
  /** REST client for routes without a WebSocket method (snapshots). */
  http?: GatewayHttp;
};

export function createCommandHandlers(context: CommandHandlerContext) {
  const {
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
    siblingChat,
    onThemeChanged,
    keybinds,
    leader,
    getPromptText,
    setPromptText,
    withTerminalReleased,
    exportCwd,
    redactPatterns,
    http,
  } = context;

  type RestoreStep = {
    id: string;
    tool: string;
    restored: string[];
    removed: string[];
    skipped: string[];
  };
  let evidenceStepper: Stepper | null = null;
  const snapshotsPath = () =>
    `/api/sessions/${encodeURIComponent(state.currentSessionKey)}/snapshots`;
  const describeRestore = (action: string, steps: RestoreStep[]) => {
    const restored = steps.flatMap((step) => step.restored);
    const removed = steps.flatMap((step) => step.removed);
    const skipped = steps.flatMap((step) => step.skipped);
    const lines = [
      `${action}: ${steps.length} snapshot${steps.length === 1 ? "" : "s"}, ${restored.length} file${restored.length === 1 ? "" : "s"} restored, ${removed.length} removed${skipped.length ? `, ${skipped.length} skipped` : ""}`,
    ];
    for (const file of [...restored, ...removed].slice(0, 12)) {
      lines.push(`  ${file}`);
    }
    for (const file of skipped) {
      lines.push(`  skipped (too large or unreadable): ${file}`);
    }
    return lines.join("\n");
  };
  const restoreSnapshots = async (action: "undo" | "redo" | { id: string }) => {
    if (!http) {
      chatLog.addSystem("snapshots: not available in this terminal");
      return;
    }
    const body = typeof action === "string" ? { action } : { id: action.id };
    const result = await http.request<{ action: string; steps: RestoreStep[] }>(
      "POST",
      `${snapshotsPath()}/restore`,
      body,
    );
    if (!result.ok) {
      chatLog.addSystem(`${typeof action === "string" ? action : "restore"}: ${result.error}`);
      return;
    }
    chatLog.addSystem(describeRestore(result.body.action, result.body.steps));
  };

  const setAgent = async (id: string) => {
    state.currentAgentId = normalizeAgentId(id);
    await setSession("");
  };

  const openModelSelector = async () => {
    try {
      const models = await client.listModels();
      if (models.length === 0) {
        chatLog.addSystem("no models available");
        tui.requestRender();
        return;
      }
      const items = models.map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: `${model.provider}/${model.id}`,
        description: model.name && model.name !== model.id ? model.name : "",
      }));
      const selector = createSearchableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          try {
            await client.patchSession({
              key: state.currentSessionKey,
              model: item.value,
            });
            chatLog.addSystem(`model set to ${item.value}`);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`model set failed: ${String(err)}`);
          }
          closeOverlay();
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`model list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openAgentSelector = async () => {
    await refreshAgents();
    if (state.agents.length === 0) {
      chatLog.addSystem("no agents found");
      tui.requestRender();
      return;
    }
    const items = state.agents.map((agent: AgentSummary) => ({
      value: agent.id,
      label: agent.name ? `${agent.id} (${agent.name})` : agent.id,
      description: agent.id === state.agentDefaultId ? "default" : "",
    }));
    const selector = createSearchableSelectList(items, 9);
    selector.onSelect = (item) => {
      void (async () => {
        closeOverlay();
        await setAgent(item.value);
        tui.requestRender();
      })();
    };
    selector.onCancel = () => {
      closeOverlay();
      tui.requestRender();
    };
    openOverlay(selector);
    tui.requestRender();
  };

  const NEW_SESSION_VALUE = "\u0000new";

  const openSessionSelector = async () => {
    try {
      const result = await client.listSessions({
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true,
      });
      const sorted = result.sessions.toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const items = sorted.map((session) => {
        const title = session.derivedTitle ?? session.displayName;
        const formattedKey = formatSessionKey(session.key);
        const agentId = parseAgentSessionKey(session.key)?.agentId ?? state.currentAgentId;
        // Avoid redundant "title (key)" when title matches key
        const name = title && title !== formattedKey ? `${title} (${formattedKey})` : formattedKey;
        const current = session.key === state.currentSessionKey ? " (current)" : "";
        const label = `${agentId}  ${name}${current}`;
        const timePart = session.updatedAt ? formatRelativeTime(session.updatedAt) : "no activity";
        const preview = session.lastMessagePreview?.replace(/\s+/g, " ").trim();
        const description = preview ? `${timePart} - ${preview}` : timePart;
        return {
          value: session.key,
          label,
          description,
          searchText: [
            agentId,
            session.displayName,
            session.label,
            session.subject,
            session.sessionId,
            session.key,
            session.lastMessagePreview,
          ]
            .filter(Boolean)
            .join(" "),
        };
      });
      items.unshift({
        value: NEW_SESSION_VALUE,
        label: `${state.currentAgentId}  new session`,
        description: "start a fresh session for the current agent",
        searchText: "new session",
      });
      const selector = createFilterableSelectList(items, 10);
      selector.onSelect = (item) => {
        void (async () => {
          closeOverlay();
          if (item.value === NEW_SESSION_VALUE) {
            await newSession("");
          } else {
            await setSession(item.value);
          }
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`sessions list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  // A new session is a fresh key for the current agent. Without a key one is derived from the
  // time, so two `/sessions new` in a row never collide.
  const newSession = async (rawKey: string) => {
    const key =
      rawKey.trim() ||
      `s${new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(2, 14)}`;
    await setSession(key);
    chatLog.addSystem(`session ${formatSessionKey(state.currentSessionKey)} started`);
  };

  const shortId = (id: string) => (id.length > 8 ? id.slice(0, 8) : id);

  const listJobs = async () => {
    try {
      const jobs = await client.listJobs({ limit: 20 });
      if (jobs.length === 0) {
        chatLog.addSystem("no jobs");
        return;
      }
      chatLog.addSystem(`jobs (${jobs.length}):`);
      for (const job of jobs) {
        const started = Date.parse(job.startedAt);
        const when = Number.isFinite(started) ? formatRelativeTime(started) : job.startedAt;
        const session = formatSessionKey(job.sessionKey);
        chatLog.addSystem(
          `  ${shortId(job.id)}  ${job.agent}  ${job.status}  steps ${job.steps}  ${when}  ${session}`,
        );
      }
    } catch (err) {
      chatLog.addSystem(`jobs list failed: ${String(err)}`);
    }
  };

  const cancelJob = async (rawId: string) => {
    let id = rawId.trim();
    try {
      if (!id) {
        // No id: the running job of this session, else the active run.
        const running = await client.listJobs({ status: "running", limit: 50 });
        const mine = running.find((job) => job.sessionKey === state.currentSessionKey);
        if (!mine) {
          await abortActive();
          return;
        }
        id = mine.id;
      } else if (id.length < 36) {
        const all = await client.listJobs({ limit: 200 });
        const match = all.filter((job) => job.id.startsWith(id));
        if (match.length === 1) {
          id = match[0].id;
        } else if (match.length > 1) {
          chatLog.addSystem(`job id ${id} is ambiguous (${match.length} matches)`);
          return;
        }
      }
      const result = await client.cancelJob(id);
      if (result.ok) {
        chatLog.addSystem(`job ${shortId(id)} cancelled`);
      } else {
        chatLog.addSystem(`job ${shortId(id)} not cancelled (${result.reason ?? "unknown"})`);
      }
    } catch (err) {
      chatLog.addSystem(`cancel failed: ${String(err)}`);
    }
  };

  const openSettings = () => {
    const items = [
      {
        id: "tools",
        label: "Tool output",
        currentValue: state.toolsExpanded ? "expanded" : "collapsed",
        values: ["collapsed", "expanded"],
      },
      {
        id: "thinking",
        label: "Reasoning",
        currentValue: state.showThinking ? state.reasoningLayout : "off",
        values: ["off", "collapsed", "expanded"],
      },
    ];
    const settings = createSettingsList(
      items,
      (id, value) => {
        if (id === "tools") {
          state.toolsExpanded = value === "expanded";
          chatLog.setToolsExpanded(state.toolsExpanded);
        }
        if (id === "thinking") {
          state.showThinking = value !== "off";
          if (value === "collapsed" || value === "expanded") {
            state.reasoningLayout = value;
          }
          // Persist like /reasoning does; a failed write leaves the local view as chosen.
          void client
            .patchSession({
              key: state.currentSessionKey,
              reasoningView: value as "off" | "collapsed" | "expanded",
            })
            .catch(() => undefined);
        }
        tui.requestRender();
      },
      () => {
        closeOverlay();
        tui.requestRender();
      },
    );
    openOverlay(settings);
    tui.requestRender();
  };

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) {
      return;
    }
    switch (name) {
      case "help":
        chatLog.addSystem(
          helpText({
            provider: state.sessionInfo.modelProvider,
            model: state.sessionInfo.model,
          }),
        );
        break;
      case "status":
        try {
          const status = await client.getStatus();
          if (typeof status === "string") {
            chatLog.addSystem(status);
            break;
          }
          if (status && typeof status === "object") {
            const lines = formatStatusSummary(status as GatewayStatusSummary);
            for (const line of lines) {
              chatLog.addSystem(line);
            }
            break;
          }
          chatLog.addSystem("status: unknown response");
        } catch (err) {
          chatLog.addSystem(`status failed: ${String(err)}`);
        }
        break;
      case "agent":
        if (!args) {
          await openAgentSelector();
        } else {
          await setAgent(args);
        }
        break;
      case "agents":
        await openAgentSelector();
        break;
      case "session":
        if (!args) {
          await openSessionSelector();
        } else {
          await setSession(args);
        }
        break;
      case "sessions": {
        const [verb, ...rest] = args.split(/\s+/).filter(Boolean);
        if (verb === "new") {
          await newSession(rest.join(" "));
        } else if (verb) {
          await setSession(args);
        } else {
          await openSessionSelector();
        }
        break;
      }
      case "jobs":
        await listJobs();
        break;
      case "cancel":
        await cancelJob(args);
        break;
      case "clear":
        chatLog.clearAll();
        chatLog.addSystem("screen cleared");
        break;
      case "diff": {
        const next = args ? args.toLowerCase() === "on" : !state.diffsEnabled;
        if (args && !["on", "off"].includes(args.toLowerCase())) {
          chatLog.addSystem("usage: /diff <on|off>");
          break;
        }
        state.diffsEnabled = next;
        chatLog.setDiffsEnabled(next);
        chatLog.addSystem(`diffs ${next ? "shown" : "hidden"}`);
        break;
      }
      case "theme": {
        if (!args) {
          chatLog.addSystem(
            `theme ${getThemeName()}. Available: ${TUI_THEME_NAMES.join(", ")}, or a theme file path. Use /theme <name|path>.`,
          );
          break;
        }
        const resolved = resolveTheme(args);
        if (resolved.error) {
          chatLog.addSystem(resolved.error);
          break;
        }
        setThemePalette(resolved.name, resolved.palette);
        onThemeChanged?.(resolved.name);
        for (const warning of resolved.warnings) {
          chatLog.addSystem(`theme: ${warning}`);
        }
        chatLog.addSystem(
          resolved.source === "built-in"
            ? `theme set to ${resolved.name}`
            : `theme set to ${resolved.name} (${resolved.source})`,
        );
        break;
      }
      case "keys":
        chatLog.addSystem(["key bindings:", ...formatKeybinds(keybinds ?? {}, leader)].join("\n"));
        break;
      case "export": {
        const parsed = parseExportArgs(args);
        if ("error" in parsed) {
          chatLog.addSystem(parsed.error);
          break;
        }
        try {
          const record = (await client.loadHistory({
            sessionKey: state.currentSessionKey,
            limit: 1000,
          })) as { messages?: unknown[] };
          const messages = Array.isArray(record?.messages) ? record.messages : [];
          const written = await exportTranscript({
            messages,
            meta: {
              sessionKey: state.currentSessionKey,
              agentId: state.currentAgentId,
              model: state.sessionInfo.model,
              exportedAt: new Date(),
            },
            format: parsed.format,
            outPath: parsed.outPath,
            cwd: exportCwd ?? process.cwd(),
            redactPatterns,
          });
          chatLog.addSystem(
            `exported ${written.messages} messages to ${written.path} (${written.bytes} bytes, secrets redacted)`,
          );
        } catch (err) {
          chatLog.addSystem(`export failed: ${(err as Error).message ?? String(err)}`);
        }
        break;
      }
      case "undo":
        await restoreSnapshots("undo");
        break;
      case "redo":
        await restoreSnapshots("redo");
        break;
      case "snapshots": {
        const [verb, id] = args.split(/\s+/).filter(Boolean);
        if (verb) {
          if (verb.toLowerCase() !== "restore" || !id) {
            chatLog.addSystem("usage: /snapshots [restore <id>]");
            break;
          }
          await restoreSnapshots({ id });
          break;
        }
        if (!http) {
          chatLog.addSystem("snapshots: not available in this terminal");
          break;
        }
        const result = await http.request<{
          cursor: number;
          snapshots: Array<{
            id: string;
            at: string;
            tool: string;
            applied: boolean;
            files: Array<{ path: string; existed: boolean; skipped?: string }>;
          }>;
        }>("GET", snapshotsPath());
        if (!result.ok) {
          chatLog.addSystem(`snapshots: ${result.error}`);
          break;
        }
        const { snapshots } = result.body;
        if (snapshots.length === 0) {
          chatLog.addSystem(
            "snapshots: none for this session (one is taken before each tool edit)",
          );
          break;
        }
        const lines = [`snapshots (${snapshots.length}; /undo, /redo, /snapshots restore <id>):`];
        for (const [index, snapshot] of snapshots.entries()) {
          const when = formatRelativeTime(Date.parse(snapshot.at));
          const files = snapshot.files.map((file) => file.path).join(", ");
          lines.push(
            `${String(index + 1).padStart(3)}  ${snapshot.id}  ${snapshot.applied ? "applied" : "undone "}  ${when.padEnd(8)} ${snapshot.tool.padEnd(11)} ${files}`,
          );
        }
        chatLog.addSystem(lines.join("\n"));
        break;
      }
      case "evidence": {
        // M12: the replay stepper on a job's evidence, through the REST route (attach scope).
        const [verb, rest] = args.split(/\s+/).filter(Boolean);
        const move = (verb ?? "").toLowerCase();
        if (move === "next" || move === "prev" || move === "jump" || (!verb && evidenceStepper)) {
          if (!evidenceStepper) {
            chatLog.addSystem("evidence: open a job first with /evidence <job-id>");
            break;
          }
          const state =
            move === "next"
              ? evidenceStepper.next()
              : move === "prev"
                ? evidenceStepper.prev()
                : move === "jump"
                  ? evidenceStepper.jump(Number.parseInt(rest ?? "", 10) || 0)
                  : evidenceStepper.current();
          chatLog.addSystem(formatStep(state).join("\n"));
          break;
        }
        if (!verb) {
          chatLog.addSystem("usage: /evidence <job-id> | next | prev | jump <step>");
          break;
        }
        if (!http) {
          chatLog.addSystem("evidence: not available in this terminal");
          break;
        }
        const events: EvidenceEvent[] = [];
        let from: number | null = 1;
        let failed: string | null = null;
        while (from !== null && events.length < 5000) {
          type EventsPage = { events: EvidenceEvent[]; next: number | null };
          const result: Awaited<ReturnType<typeof http.request<EventsPage>>> =
            await http.request<EventsPage>(
              "GET",
              `/api/jobs/${encodeURIComponent(verb)}/evidence/events?from=${from}&limit=500`,
            );
          if (!result.ok) {
            failed = result.error;
            break;
          }
          events.push(...result.body.events);
          from = result.body.next;
        }
        if (failed) {
          chatLog.addSystem(`evidence: ${failed}`);
          break;
        }
        if (events.length === 0) {
          chatLog.addSystem(`evidence: no events for job ${verb}`);
          break;
        }
        evidenceStepper = createStepper(events, 1);
        chatLog.addSystem(
          [
            `evidence ${verb}: ${events.length} events (/evidence next, prev, jump <step>)`,
            ...formatStep(evidenceStepper.current()),
          ].join("\n"),
        );
        break;
      }
      case "factory": {
        // M15: the Kanban as a table, through the REST routes (attach scope).
        if (!http) {
          chatLog.addSystem("factory: not available in this terminal");
          break;
        }
        const [verb, rest] = args.split(/\s+/).filter(Boolean);
        if ((verb ?? "").toLowerCase() === "show") {
          if (!rest) {
            chatLog.addSystem("usage: /factory show <card-id>");
            break;
          }
          type CardBody = { card: FactoryCardLike & { timeline: FactoryEntryLike[] } };
          const result = await http.request<CardBody>(
            "GET",
            `/api/factory/cards/${encodeURIComponent(rest)}`,
          );
          if (!result.ok) {
            chatLog.addSystem(`factory: ${result.error}`);
            break;
          }
          const card = result.body.card;
          const lines = [
            `card ${card.id}: ${card.title}`,
            `  column ${card.column}  owner ${card.owner}  repo ${card.repo}`,
            `  engine task ${card.engineTaskId ?? "none"}  branch ${card.branch ?? "none"}  pr ${card.pr?.url ?? "none"}`,
            `  jobs ${card.jobIds.length ? card.jobIds.join(", ") : "none"}  evidence ${card.evidenceIds.map((id) => `/evidence/${id}`).join(", ") || "none"}`,
            ...(card.error ? [`  error ${card.error}`] : []),
            ...card.timeline
              .slice(-12)
              .map(
                (e) =>
                  `  ${String(e.seq).padStart(4)}  ${e.kind.padEnd(8)} ${e.by.padEnd(10)} ${e.text}`,
              ),
          ];
          chatLog.addSystem(lines.join("\n"));
          break;
        }
        const board = verb ?? "";
        const result = await http.request<{ cards: FactoryCardLike[] }>(
          "GET",
          `/api/factory/cards?limit=200${board ? `&board=${encodeURIComponent(board)}` : ""}`,
        );
        if (!result.ok) {
          chatLog.addSystem(`factory: ${result.error}`);
          break;
        }
        const cards = result.body.cards;
        if (cards.length === 0) {
          chatLog.addSystem(`factory: no cards${board ? ` on board ${board}` : ""}`);
          break;
        }
        const columns = ["inbox", "spec", "build", "review", "ready", "merged", "failed"];
        const lines = [
          `factory${board ? ` ${board}` : ""} (${cards.length} cards; /factory show <card-id>):`,
        ];
        for (const column of columns) {
          const inColumn = cards.filter((c) => c.column === column);
          if (inColumn.length === 0) {
            continue;
          }
          lines.push(`${column} (${inColumn.length})`);
          for (const c of inColumn) {
            const link = c.pr?.url ?? c.branch ?? "";
            lines.push(
              `  ${shortId(c.id)}  ${c.title.slice(0, 48).padEnd(48)}  ${c.owner.padEnd(10)}  ${c.runningJobId ? "running" : c.error ? "error" : ""}${link ? `  ${link}` : ""}`,
            );
          }
        }
        chatLog.addSystem(lines.join("\n"));
        break;
      }
      case "editor": {
        if (!getPromptText || !setPromptText || !withTerminalReleased) {
          chatLog.addSystem("editor: not available in this terminal");
          break;
        }
        const result = await editInExternalEditor(getPromptText(), { withTerminalReleased });
        if (!result.ok) {
          chatLog.addSystem(`editor: ${result.error}`);
          break;
        }
        setPromptText(result.text);
        chatLog.addSystem(result.changed ? "prompt updated from the editor" : "prompt unchanged");
        break;
      }
      case "model":
        if (!args) {
          await openModelSelector();
        } else {
          try {
            await client.patchSession({
              key: state.currentSessionKey,
              model: args,
            });
            chatLog.addSystem(`model set to ${args}`);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`model set failed: ${String(err)}`);
          }
        }
        break;
      case "models":
        await openModelSelector();
        break;
      case "think":
        if (!args) {
          const levels = formatThinkingLevels(
            state.sessionInfo.modelProvider,
            state.sessionInfo.model,
            "|",
          );
          chatLog.addSystem(`usage: /think <${levels}>`);
          break;
        }
        try {
          await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: args,
          });
          chatLog.addSystem(`thinking set to ${args}`);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`think failed: ${String(err)}`);
        }
        break;
      case "verbose":
        if (!args) {
          chatLog.addSystem("usage: /verbose <on|off>");
          break;
        }
        try {
          await client.patchSession({
            key: state.currentSessionKey,
            verboseLevel: args,
          });
          chatLog.addSystem(`verbose set to ${args}`);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`verbose failed: ${String(err)}`);
        }
        break;
      case "reasoning": {
        const mode = args.trim().toLowerCase();
        if (!["on", "off", "collapsed", "expanded"].includes(mode)) {
          chatLog.addSystem("usage: /reasoning <on|off|collapsed|expanded>");
          break;
        }
        // `on` keeps the current layout; `collapsed` and `expanded` also turn reasoning on.
        const view =
          mode === "off"
            ? "off"
            : mode === "on"
              ? state.reasoningLayout
              : (mode as "collapsed" | "expanded");
        try {
          // reasoningView is what clients show (and whether the gateway streams reasoning to
          // this session); reasoningLevel keeps the per-session reasoning setting other
          // channels read in step, as before.
          await client.patchSession({
            key: state.currentSessionKey,
            reasoningView: view,
            reasoningLevel: view === "off" ? "off" : "on",
          });
          state.showThinking = view !== "off";
          if (view !== "off") {
            state.reasoningLayout = view;
          }
          chatLog.addSystem(
            view === "off" ? "reasoning hidden" : `reasoning shown (${state.reasoningLayout})`,
          );
          tui.requestRender();
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`reasoning failed: ${String(err)}`);
        }
        break;
      }
      case "usage": {
        const normalized = args ? normalizeUsageDisplay(args) : undefined;
        if (args && !normalized) {
          chatLog.addSystem("usage: /usage <off|tokens|full>");
          break;
        }
        const currentRaw = state.sessionInfo.responseUsage;
        const current = resolveResponseUsageMode(currentRaw);
        const next =
          normalized ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");
        try {
          await client.patchSession({
            key: state.currentSessionKey,
            responseUsage: next === "off" ? null : next,
          });
          chatLog.addSystem(`usage footer: ${next}`);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`usage failed: ${String(err)}`);
        }
        break;
      }
      case "elevated":
        if (!args) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        if (!["on", "off", "ask", "full"].includes(args)) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        try {
          await client.patchSession({
            key: state.currentSessionKey,
            elevatedLevel: args,
          });
          chatLog.addSystem(`elevated set to ${args}`);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`elevated failed: ${String(err)}`);
        }
        break;
      case "activation":
        if (!args) {
          chatLog.addSystem("usage: /activation <mention|always>");
          break;
        }
        try {
          await client.patchSession({
            key: state.currentSessionKey,
            groupActivation: args === "always" ? "always" : "mention",
          });
          chatLog.addSystem(`activation set to ${args}`);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`activation failed: ${String(err)}`);
        }
        break;
      case "new":
        if (args) {
          await newSession(args);
          break;
        }
      // falls through
      case "reset":
        try {
          // Clear token counts immediately to avoid stale display (#1523)
          state.sessionInfo.inputTokens = null;
          state.sessionInfo.outputTokens = null;
          state.sessionInfo.totalTokens = null;
          tui.requestRender();

          await client.resetSession(state.currentSessionKey);
          chatLog.addSystem(`session ${state.currentSessionKey} reset`);
          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`reset failed: ${String(err)}`);
        }
        break;
      case "abort":
        await abortActive();
        break;
      case "settings":
        openSettings();
        break;
      case "exit":
      case "quit":
        client.stop();
        tui.stop();
        process.exit(0);
        break;
      // ── Sibling Chat Commands ──────────────────────────────────────────────
      case "chat": {
        if (!siblingChat) {
          chatLog.addSystem("sibling chat not available");
          break;
        }
        if (!args) {
          const current = siblingChat.getCurrentSibling();
          if (current) {
            chatLog.addSystem(
              `currently chatting with ${current}. Type a message or /quit to exit.`,
            );
          } else {
            chatLog.addSystem("usage: /chat <agent-id>");
          }
          break;
        }
        const sibling = args.toLowerCase().trim();
        if (!AGENT_ID_RE.test(sibling)) {
          chatLog.addSystem(`invalid agent id: ${sibling}`);
          break;
        }
        try {
          await siblingChat.openChat(sibling);
          chatLog.addSystem(`connected to ${sibling}`);
          const messages = siblingChat.getMessages();
          if (messages.length > 0) {
            chatLog.addSystem(`loaded ${messages.length} message(s)`);
          }
        } catch (err) {
          chatLog.addSystem(`chat open failed: ${String(err)}`);
        }
        break;
      }
      case "siblings": {
        chatLog.addSystem("available siblings:");
        for (const s of KNOWN_SIBLINGS) {
          chatLog.addSystem(`  - ${s}`);
        }
        break;
      }
      case "history": {
        if (!siblingChat) {
          chatLog.addSystem("sibling chat not available");
          break;
        }
        const current = siblingChat.getCurrentSibling();
        if (!current) {
          chatLog.addSystem("no sibling chat open. Use /chat <sibling> first.");
          break;
        }
        try {
          const history = await client.getSiblingHistory({ with: current, limit: 50 });
          chatLog.addSystem(`history with ${current} (${history.messages.length} messages):`);
          for (const msg of history.messages.slice(-10)) {
            const prefix = msg.from === current ? current : "you";
            chatLog.addSystem(
              `  [${msg.timestamp.slice(0, 19)}] ${prefix}: ${msg.text.slice(0, 80)}`,
            );
          }
        } catch (err) {
          chatLog.addSystem(`history failed: ${String(err)}`);
        }
        break;
      }
      case "read": {
        if (!siblingChat) {
          chatLog.addSystem("sibling chat not available");
          break;
        }
        try {
          await siblingChat.markAsRead();
          chatLog.addSystem("messages marked as read");
        } catch (err) {
          chatLog.addSystem(`read failed: ${String(err)}`);
        }
        break;
      }
      default: {
        // If we're in a sibling chat, send the message to the sibling
        if (siblingChat && siblingChat.getCurrentSibling()) {
          await siblingChat.sendMessage(raw);
        } else {
          await sendMessage(raw);
        }
        break;
      }
    }
    tui.requestRender();
  };

  const sendMessage = async (text: string, options: { display?: string } = {}) => {
    try {
      chatLog.addUser(options.display ?? text);
      tui.requestRender();
      setActivityStatus("sending");
      // Codex-style submission queue: a message typed while the gateway is still connecting or
      // reconnecting waits for it (bounded) instead of failing with "gateway not connected".
      // Only an explicit false waits: tests and partial states leave the flag unset.
      // oxlint-disable-next-line typescript-eslint/no-unnecessary-boolean-literal-compare
      for (let waited = 0; state.isConnected === false && waited < 30_000; waited += 250) {
        setActivityStatus("waiting for gateway");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const { runId } = await client.sendChat({
        sessionKey: state.currentSessionKey,
        message: text,
        thinking: opts.thinking,
        deliver: deliverDefault,
        timeoutMs: opts.timeoutMs,
      });
      state.activeChatRunId = runId;
      setActivityStatus("waiting");
    } catch (err) {
      chatLog.addSystem(`send failed: ${String(err)}`);
      setActivityStatus("error");
    }
    tui.requestRender();
  };

  return {
    handleCommand,
    sendMessage,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    openSettings,
    setAgent,
    newSession,
    listJobs,
    cancelJob,
  };
}
