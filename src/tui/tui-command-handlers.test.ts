import { describe, expect, it, vi } from "vitest";
import { createCommandHandlers } from "./tui-command-handlers.js";

describe("tui command handlers", () => {
  it("/reasoning sets and persists the view: off, collapsed, expanded, on", async () => {
    const patchSession = vi.fn().mockResolvedValue({ ok: true });
    const addSystem = vi.fn();
    const state = {
      currentSessionKey: "agent:main:main",
      activeChatRunId: null,
      sessionInfo: {},
      showThinking: true,
      reasoningLayout: "collapsed" as "collapsed" | "expanded",
    };
    const { handleCommand } = createCommandHandlers({
      client: { patchSession } as never,
      chatLog: { addUser: vi.fn(), addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: state as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
    });

    await handleCommand("/reasoning off");
    expect(state.showThinking).toBe(false);
    expect(patchSession).toHaveBeenLastCalledWith({
      key: "agent:main:main",
      reasoningView: "off",
      reasoningLevel: "off",
    });
    await handleCommand("/reasoning expanded");
    expect(state).toMatchObject({ showThinking: true, reasoningLayout: "expanded" });
    expect(patchSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ reasoningView: "expanded", reasoningLevel: "on" }),
    );
    await handleCommand("/reasoning on");
    expect(patchSession).toHaveBeenLastCalledWith(
      expect.objectContaining({ reasoningView: "expanded" }),
    );
    await handleCommand("/reasoning collapsed");
    expect(state.reasoningLayout).toBe("collapsed");
    await handleCommand("/reasoning sideways");
    expect(addSystem).toHaveBeenLastCalledWith("usage: /reasoning <on|off|collapsed|expanded>");
    expect(patchSession).toHaveBeenCalledTimes(4);
  });

  it("forwards unknown slash commands to the gateway", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const setActivityStatus = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus,
      formatSessionKey: vi.fn(),
    });

    await handleCommand("/context");

    expect(addSystem).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith("/context");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        message: "/context",
      }),
    );
    expect(requestRender).toHaveBeenCalled();
  });

  it("waits for the gateway instead of failing a message typed while connecting", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r2" });
    const addSystem = vi.fn();
    const state = {
      currentSessionKey: "agent:orion:owner",
      activeChatRunId: null,
      sessionInfo: {},
      isConnected: false,
    };
    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser: vi.fn(), addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: state as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
    });
    setTimeout(() => {
      state.isConnected = true; // gateway accepts the connection 600 ms later
    }, 600);
    await handleCommand("/context");
    expect(sendChat).toHaveBeenCalledTimes(1);
    expect(addSystem).not.toHaveBeenCalled();
  });
});

describe("tui command handlers: sessions, jobs, screen, theme", () => {
  function build(overrides: Record<string, unknown> = {}) {
    const addSystem = vi.fn();
    const clearAll = vi.fn();
    const setDiffsEnabled = vi.fn();
    const setSession = vi.fn();
    const abortActive = vi.fn();
    const listJobs = vi.fn().mockResolvedValue([
      {
        id: "11111111-aaaa-bbbb-cccc-000000000001",
        agent: "alice",
        sessionKey: "agent:alice:main",
        kind: "agent",
        status: "running",
        steps: 4,
        toolCalls: 4,
        startedAt: new Date().toISOString(),
      },
    ]);
    const cancelJob = vi.fn().mockResolvedValue({ ok: true });
    const state = {
      currentSessionKey: "agent:alice:main",
      currentAgentId: "alice",
      activeChatRunId: null,
      sessionInfo: {},
      diffsEnabled: true,
      isConnected: true,
      ...overrides,
    };
    const handlers = createCommandHandlers({
      client: { listJobs, cancelJob, sendChat: vi.fn() } as never,
      chatLog: { addUser: vi.fn(), addSystem, clearAll, setDiffsEnabled } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: state as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession,
      refreshAgents: vi.fn(),
      abortActive,
      setActivityStatus: vi.fn(),
      formatSessionKey: (key: string) => key.split(":").pop() ?? key,
      keybinds: { sessions: [{ key: "ctrl+p", chord: false }] },
      ...(overrides.http ? { http: overrides.http as never } : {}),
    });
    return {
      ...handlers,
      addSystem,
      clearAll,
      setDiffsEnabled,
      setSession,
      listJobs,
      cancelJob,
      abortActive,
      state,
    };
  }

  it("/sessions new <key> and /new <key> start a session; /attach switches", async () => {
    const h = build();
    await h.handleCommand("/sessions new scratch");
    expect(h.setSession).toHaveBeenCalledWith("scratch");
    await h.handleCommand("/new other");
    expect(h.setSession).toHaveBeenCalledWith("other");
    await h.handleCommand("/attach agent:alice:third");
    expect(h.setSession).toHaveBeenCalledWith("agent:alice:third");
    await h.handleCommand("/sessions new");
    const generated = h.setSession.mock.calls.at(-1)?.[0] as string;
    expect(generated).toMatch(/^s\d{12}$/);
  });

  it("/jobs lists jobs and /cancel resolves a short id", async () => {
    const h = build();
    await h.handleCommand("/jobs");
    const lines = h.addSystem.mock.calls.map((c) => String(c[0]));
    expect(lines[0]).toBe("jobs (1):");
    expect(lines[1]).toContain("11111111  alice  running  steps 4");
    await h.handleCommand("/cancel 11111111");
    expect(h.cancelJob).toHaveBeenCalledWith("11111111-aaaa-bbbb-cccc-000000000001");
  });

  it("/cancel without an id cancels this session's running job, else aborts", async () => {
    const h = build();
    await h.handleCommand("/cancel");
    expect(h.cancelJob).toHaveBeenCalledWith("11111111-aaaa-bbbb-cccc-000000000001");
    expect(h.abortActive).not.toHaveBeenCalled();
    const none = build({ currentSessionKey: "agent:alice:other" });
    await none.handleCommand("/cancel");
    expect(none.abortActive).toHaveBeenCalled();
  });

  it("/clear clears the screen only; /diff and /theme toggle view state", async () => {
    const h = build();
    await h.handleCommand("/clear");
    expect(h.clearAll).toHaveBeenCalled();
    expect(h.setSession).not.toHaveBeenCalled();
    await h.handleCommand("/diff off");
    expect(h.state.diffsEnabled).toBe(false);
    expect(h.setDiffsEnabled).toHaveBeenCalledWith(false);
    await h.handleCommand("/theme light");
    expect(h.addSystem).toHaveBeenCalledWith("theme set to light");
    await h.handleCommand("/theme nope");
    expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toContain("unknown theme nope");
    await h.handleCommand("/keys");
    expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toContain("sessions        ctrl+p");
    const { setTheme } = await import("./theme/theme.js");
    setTheme("dark");
  });
});

describe("tui command handlers: export and editor", () => {
  function build(extra: Record<string, unknown> = {}) {
    const addSystem = vi.fn();
    const loadHistory = vi.fn().mockResolvedValue({
      messages: [{ role: "user", content: "hi token sk-abcdefghijklmnopqrstuvwxyz123456" }],
    });
    const handlers = createCommandHandlers({
      client: { loadHistory, sendChat: vi.fn() } as never,
      chatLog: { addUser: vi.fn(), addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:alice:main",
        currentAgentId: "alice",
        activeChatRunId: null,
        sessionInfo: { model: "m1" },
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: (key: string) => key,
      ...extra,
    });
    return { ...handlers, addSystem, loadHistory };
  }

  it("/export writes a redacted transcript into the export directory", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-tui-export-"));
    try {
      const h = build({ exportCwd: dir });
      await h.handleCommand("/export json out.json");
      expect(h.loadHistory).toHaveBeenCalledWith({ sessionKey: "agent:alice:main", limit: 1000 });
      const line = String(h.addSystem.mock.calls.at(-1)?.[0]);
      expect(line).toContain(`exported 1 messages to ${path.join(dir, "out.json")}`);
      const written = JSON.parse(fs.readFileSync(path.join(dir, "out.json"), "utf8"));
      expect(written.model).toBe("m1");
      expect(written.messages[0].content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
      await h.handleCommand("/export a b c");
      expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toBe("usage: /export [md|json] [path]");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("/editor needs the prompt hooks and reports when they are missing", async () => {
    const h = build();
    await h.handleCommand("/editor");
    expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toBe(
      "editor: not available in this terminal",
    );
  });

  it("/editor puts the edited text back into the prompt", async () => {
    vi.resetModules();
    vi.doMock("./external-editor.js", () => ({
      editInExternalEditor: vi
        .fn()
        .mockResolvedValue({ ok: true, text: "new text", changed: true }),
    }));
    const { createCommandHandlers: create } = await import("./tui-command-handlers.js");
    const addSystem = vi.fn();
    const setPromptText = vi.fn();
    const { handleCommand } = create({
      client: {} as never,
      chatLog: { addUser: vi.fn(), addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: { currentSessionKey: "agent:alice:main", sessionInfo: {}, isConnected: true } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: (key: string) => key,
      getPromptText: () => "old",
      setPromptText,
      withTerminalReleased: async (fn) => await fn(),
    });
    await handleCommand("/editor");
    expect(setPromptText).toHaveBeenCalledWith("new text");
    expect(addSystem).toHaveBeenCalledWith("prompt updated from the editor");
    vi.doUnmock("./external-editor.js");
  });
});

describe("tui command handlers: snapshots", () => {
  function build(http?: unknown) {
    const addSystem = vi.fn();
    const handlers = createCommandHandlers({
      client: { sendChat: vi.fn() } as never,
      chatLog: { addUser: vi.fn(), addSystem } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: { currentSessionKey: "agent:alice:main", sessionInfo: {}, isConnected: true } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: (key: string) => key,
      http: http as never,
    });
    return { ...handlers, addSystem };
  }

  it("/undo, /redo and /snapshots restore call the restore route and summarise", async () => {
    const request = vi.fn(async (_method: string, _path: string, body?: { action?: string }) => ({
      ok: true,
      body: {
        action: body?.action ?? "restore",
        steps: [
          { id: "s1", tool: "write", restored: ["/w/a.ts"], removed: [], skipped: ["/w/big.bin"] },
        ],
      },
    }));
    const h = build({ request });
    await h.handleCommand("/undo");
    expect(request).toHaveBeenCalledWith(
      "POST",
      "/api/sessions/agent%3Aalice%3Amain/snapshots/restore",
      { action: "undo" },
    );
    const line = String(h.addSystem.mock.calls.at(-1)?.[0]);
    expect(line).toContain("undo: 1 snapshot, 1 file restored, 0 removed, 1 skipped");
    expect(line).toContain("  /w/a.ts");
    expect(line).toContain("skipped (too large or unreadable): /w/big.bin");
    await h.handleCommand("/redo");
    expect(request).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {
      action: "redo",
    });
    await h.handleCommand("/snapshots restore s1");
    expect(request).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), { id: "s1" });
    await h.handleCommand("/snapshots bogus");
    expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toBe("usage: /snapshots [restore <id>]");
  });

  it("/snapshots lists entries and reports route errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        body: {
          cursor: 1,
          snapshots: [
            {
              id: "s1",
              at: new Date().toISOString(),
              tool: "edit",
              applied: true,
              files: [{ path: "/w/a.ts", existed: true }],
            },
            { id: "s2", at: new Date().toISOString(), tool: "write", applied: false, files: [] },
          ],
        },
      })
      .mockResolvedValueOnce({ ok: false, status: 409, error: "nothing to undo" })
      .mockResolvedValueOnce({ ok: true, body: { cursor: 0, snapshots: [] } });
    const h = build({ request });
    await h.handleCommand("/snapshots");
    const listing = String(h.addSystem.mock.calls.at(-1)?.[0]);
    expect(listing).toContain("snapshots (2;");
    expect(listing).toContain("s1  applied");
    expect(listing).toContain("s2  undone");
    expect(listing).toContain("/w/a.ts");
    await h.handleCommand("/undo");
    expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toBe("undo: nothing to undo");
    await h.handleCommand("/snapshots");
    expect(String(h.addSystem.mock.calls.at(-1)?.[0])).toContain(
      "snapshots: none for this session",
    );
    const none = build(undefined);
    await none.handleCommand("/undo");
    expect(String(none.addSystem.mock.calls.at(-1)?.[0])).toBe(
      "snapshots: not available in this terminal",
    );
  });
});

describe("tui command handlers: evidence stepper", () => {
  function events() {
    const base = { jobId: "job-e", prev: "0".repeat(64), hash: "f".repeat(64) };
    return [
      {
        ...base,
        seq: 1,
        ts: "2026-10-14T00:00:00.000Z",
        type: "job.start",
        data: {
          agent: "alice",
          kind: "agent",
          provider: "p",
          model: "m",
          promptChars: 3,
          promptDigest: "ab",
          startedAt: "2026-10-14T00:00:00.000Z",
        },
      },
      {
        ...base,
        seq: 2,
        ts: "2026-10-14T00:00:01.000Z",
        type: "tool.call",
        data: { toolCallId: "t", name: "read", args: { path: "a" } },
      },
      {
        ...base,
        seq: 3,
        ts: "2026-10-14T00:00:02.000Z",
        type: "tool.result",
        data: { toolCallId: "t", name: "read", isError: false, resultChars: 1 },
      },
      {
        ...base,
        seq: 4,
        ts: "2026-10-14T00:00:03.000Z",
        type: "job.end",
        data: { status: "succeeded", steps: 1, toolCalls: 1 },
      },
    ];
  }

  it("loads a job through the REST route and steps with next, prev and jump", async () => {
    const all = events();
    const request = vi.fn(async (_m: string, p: string) => {
      const from = Number(new URL(p, "http://x").searchParams.get("from"));
      const page = from === 1 ? all.slice(0, 2) : all.slice(2);
      return { ok: true, body: { events: page, next: from === 1 ? 3 : null } };
    });
    const addSystem = vi.fn();
    const handlers = createCommandHandlers({
      client: { sendChat: vi.fn() } as never,
      chatLog: {
        addUser: vi.fn(),
        addSystem,
        clearAll: vi.fn(),
        setDiffsEnabled: vi.fn(),
      } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:alice:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: (k: string) => k,
      http: { request } as never,
    });
    await handlers.handleCommand("/evidence next");
    expect(addSystem).toHaveBeenLastCalledWith(
      "evidence: open a job first with /evidence <job-id>",
    );
    await handlers.handleCommand("/evidence job-e");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]).toBe("/api/jobs/job-e/evidence/events?from=1&limit=500");
    const opened = String(addSystem.mock.calls.at(-1)?.[0]);
    expect(opened).toContain("evidence job-e: 4 events");
    expect(opened).toContain("step         1/4");
    await handlers.handleCommand("/evidence next");
    expect(String(addSystem.mock.calls.at(-1)?.[0])).toContain("step         2/4");
    await handlers.handleCommand("/evidence jump 4");
    expect(String(addSystem.mock.calls.at(-1)?.[0])).toContain("status       succeeded");
    await handlers.handleCommand("/evidence prev");
    expect(String(addSystem.mock.calls.at(-1)?.[0])).toContain("step         3/4");
    await handlers.handleCommand("/evidence");
    expect(String(addSystem.mock.calls.at(-1)?.[0])).toContain("step         3/4");
  });

  it("reports gateway errors and empty logs", async () => {
    const addSystem = vi.fn();
    const request = vi.fn(async () => ({ ok: false, status: 404, error: "no evidence for job x" }));
    const handlers = createCommandHandlers({
      client: { sendChat: vi.fn() } as never,
      chatLog: {
        addUser: vi.fn(),
        addSystem,
        clearAll: vi.fn(),
        setDiffsEnabled: vi.fn(),
      } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:alice:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: (k: string) => k,
      http: { request } as never,
    });
    await handlers.handleCommand("/evidence x");
    expect(addSystem).toHaveBeenLastCalledWith("evidence: no evidence for job x");
    await handlers.handleCommand("/evidence");
    expect(addSystem).toHaveBeenLastCalledWith(
      "usage: /evidence <job-id> | next | prev | jump <step>",
    );
  });
});

describe("/factory", () => {
  function handlersWith(request: ReturnType<typeof vi.fn>) {
    const addSystem = vi.fn();
    const handlers = createCommandHandlers({
      client: { sendChat: vi.fn() } as never,
      chatLog: {
        addUser: vi.fn(),
        addSystem,
        clearAll: vi.fn(),
        setDiffsEnabled: vi.fn(),
      } as never,
      tui: { requestRender: vi.fn() } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:alice:main",
        activeChatRunId: null,
        sessionInfo: {},
        isConnected: true,
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: (k: string) => k,
      http: { request } as never,
    });
    return { handlers, addSystem };
  }

  const card = {
    id: "11111111-2222-3333-4444-555555555555",
    title: "Add a /health endpoint",
    column: "ready",
    owner: "alice",
    repo: "/srv/app",
    engineTaskId: "001-x",
    branch: "kip/001-x",
    jobIds: ["job-1"],
    evidenceIds: ["job-1"],
    pr: null,
    runningJobId: null,
    error: null,
  };

  it("prints the board grouped by column and one card with its timeline", async () => {
    const request = vi.fn(async (_m: string, p: string) =>
      p.startsWith("/api/factory/cards/")
        ? {
            ok: true,
            body: {
              card: {
                ...card,
                timeline: [{ seq: 1, kind: "created", by: "alice", text: "Card created." }],
              },
              running: false,
            },
          }
        : {
            ok: true,
            body: { cards: [card, { ...card, id: "b", column: "inbox", title: "Other" }] },
          },
    );
    const { handlers, addSystem } = handlersWith(request);
    await handlers.handleCommand("/factory main");
    expect(request.mock.calls[0][1]).toBe("/api/factory/cards?limit=200&board=main");
    const board = String(addSystem.mock.calls[0][0]);
    expect(board).toContain("inbox (1)");
    expect(board).toContain("ready (1)");
    expect(board).toContain("kip/001-x");
    await handlers.handleCommand(`/factory show ${card.id}`);
    expect(request.mock.calls[1][1]).toBe(`/api/factory/cards/${card.id}`);
    const detail = String(addSystem.mock.calls[1][0]);
    expect(detail).toContain("/evidence/job-1");
    expect(detail).toContain("created");
    await handlers.handleCommand("/factory show");
    expect(String(addSystem.mock.calls[2][0])).toContain("usage: /factory show");
  });

  it("reports an empty board and gateway errors", async () => {
    const request = vi.fn(async () => ({ ok: false, status: 403, error: "forbidden" }));
    const { handlers, addSystem } = handlersWith(request);
    await handlers.handleCommand("/factory");
    expect(String(addSystem.mock.calls[0][0])).toBe("factory: forbidden");
  });
});
