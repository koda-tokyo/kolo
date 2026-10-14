import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { DEFAULT_STM_WRITE_ACK_PROMPT } from "./agent-runner-memory.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();

type EmbeddedRunParams = {
  prompt?: string;
  workspaceDir?: string;
};

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: async ({
    provider,
    model,
    run,
  }: {
    provider: string;
    model: string;
    run: (provider: string, model: string) => Promise<unknown>;
  }) => ({
    result: await run(provider, model),
    provider,
    model,
  }),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: vi.fn(),
    scheduleFollowupDrain: vi.fn(),
  };
});

import { runReplyAgent } from "./agent-runner.js";

async function seedSessionStore(params: {
  storePath: string;
  sessionKey: string;
  entry: Record<string, unknown>;
}) {
  await fs.mkdir(path.dirname(params.storePath), { recursive: true });
  await fs.writeFile(
    params.storePath,
    JSON.stringify({ [params.sessionKey]: params.entry }, null, 2),
    "utf-8",
  );
}

async function seedStm(workspaceDir: string, params: { version: number; updated: string }) {
  await fs.mkdir(workspaceDir, { recursive: true });
  const stmPath = path.join(workspaceDir, "STM.json");
  await fs.writeFile(
    stmPath,
    JSON.stringify(
      {
        version: params.version,
        updated: params.updated,
        injected_by: "test",
        context: {},
      },
      null,
      2,
    ),
    "utf-8",
  );
  // The ack decision also looks at the file's mtime (>= turn start means "written this turn").
  // Seeding right before the turn can land in the same millisecond on a fast disk, so give the
  // seed the mtime its `updated` field claims; a stale seed must look stale on every OS.
  const updated = new Date(params.updated);
  if (!Number.isNaN(updated.getTime())) {
    await fs.utimes(stmPath, updated, updated);
  }
}

function createBaseRun(params: {
  storePath: string;
  sessionEntry: Record<string, unknown>;
  workspaceDir: string;
  config?: Record<string, unknown>;
}) {
  const typing = createMockTypingController();
  const sessionCtx = {
    Provider: "whatsapp",
    OriginatingTo: "+15550001111",
    AccountId: "primary",
    MessageSid: "msg",
  } as unknown as TemplateContext;
  const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;
  const followupRun = {
    prompt: "hello",
    summaryLine: "hello",
    enqueuedAt: Date.now(),
    run: {
      agentId: "iris",
      agentDir: "/tmp/agent",
      sessionId: "session",
      sessionKey: "main",
      messageProvider: "whatsapp",
      sessionFile: "/tmp/session.jsonl",
      workspaceDir: params.workspaceDir,
      config: params.config ?? {},
      skillsSnapshot: {},
      provider: "anthropic",
      model: "claude",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: {
        enabled: false,
        allowed: false,
        defaultLevel: "off",
      },
      timeoutMs: 1_000,
      blockReplyBreak: "message_end",
    },
  } as unknown as FollowupRun;

  return {
    typing,
    sessionCtx,
    resolvedQueue,
    followupRun,
  };
}

describe("runReplyAgent STM write acknowledgement", () => {
  it("runs a silent STM acknowledgement turn when STM is stale", async () => {
    runEmbeddedPiAgentMock.mockReset();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-stm-ack-"));
    const storePath = path.join(tmp, "sessions.json");
    const workspaceDir = path.join(tmp, "workspace");
    const sessionKey = "main";
    const sessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      compactionCount: 0,
    };

    await seedSessionStore({ storePath, sessionKey, entry: sessionEntry });
    await seedStm(workspaceDir, { version: 1, updated: "2026-05-04T15:00:00+09:00" });

    const calls: string[] = [];
    runEmbeddedPiAgentMock.mockImplementation(async (params: EmbeddedRunParams) => {
      calls.push(params.prompt ?? "");
      if (params.prompt === DEFAULT_STM_WRITE_ACK_PROMPT && params.workspaceDir) {
        await seedStm(params.workspaceDir, {
          version: 2,
          updated: new Date().toISOString(),
        });
        return { payloads: [], meta: {} };
      }
      return {
        payloads: [{ text: "ok" }],
        meta: { agentMeta: { usage: { input: 1, output: 1 } } },
      };
    });

    const { typing, sessionCtx, resolvedQueue, followupRun } = createBaseRun({
      storePath,
      sessionEntry,
      workspaceDir,
    });

    await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionEntry,
      sessionStore: { [sessionKey]: sessionEntry },
      sessionKey,
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
      agentCfgContextTokens: 100_000,
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(calls).toEqual(["hello", DEFAULT_STM_WRITE_ACK_PROMPT]);

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].stmWriteAckAt).toBeTypeOf("number");
    expect(stored[sessionKey].stmWriteAckStatus).toBe("updated");
    expect(stored[sessionKey].stmWriteAckVersion).toBe(2);
  });

  it("skips the acknowledgement turn when the main turn already refreshed STM", async () => {
    runEmbeddedPiAgentMock.mockReset();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-stm-ack-"));
    const storePath = path.join(tmp, "sessions.json");
    const workspaceDir = path.join(tmp, "workspace");
    const sessionKey = "main";
    const sessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      compactionCount: 0,
    };

    await seedSessionStore({ storePath, sessionKey, entry: sessionEntry });
    await seedStm(workspaceDir, { version: 1, updated: "2026-05-04T15:00:00+09:00" });

    const calls: string[] = [];
    runEmbeddedPiAgentMock.mockImplementation(async (params: EmbeddedRunParams) => {
      calls.push(params.prompt ?? "");
      if (params.prompt === "hello" && params.workspaceDir) {
        await seedStm(params.workspaceDir, {
          version: 2,
          updated: new Date().toISOString(),
        });
      }
      return {
        payloads: [{ text: "ok" }],
        meta: { agentMeta: { usage: { input: 1, output: 1 } } },
      };
    });

    const { typing, sessionCtx, resolvedQueue, followupRun } = createBaseRun({
      storePath,
      sessionEntry,
      workspaceDir,
    });

    await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionEntry,
      sessionStore: { [sessionKey]: sessionEntry },
      sessionKey,
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
      agentCfgContextTokens: 100_000,
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(calls).toEqual(["hello"]);

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].stmWriteAckAt).toBeTypeOf("number");
    expect(stored[sessionKey].stmWriteAckStatus).toBe("fresh");
    expect(stored[sessionKey].stmWriteAckVersion).toBe(2);
  });

  it("skips the acknowledgement turn when STM write ack is disabled globally", async () => {
    runEmbeddedPiAgentMock.mockReset();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-stm-ack-"));
    const storePath = path.join(tmp, "sessions.json");
    const workspaceDir = path.join(tmp, "workspace");
    const sessionKey = "main";
    const sessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      compactionCount: 0,
    };

    await seedSessionStore({ storePath, sessionKey, entry: sessionEntry });
    await seedStm(workspaceDir, { version: 1, updated: "2026-05-04T15:00:00+09:00" });

    const calls: string[] = [];
    runEmbeddedPiAgentMock.mockImplementation(async (params: EmbeddedRunParams) => {
      calls.push(params.prompt ?? "");
      return {
        payloads: [{ text: "ok" }],
        meta: { agentMeta: { usage: { input: 1, output: 1 } } },
      };
    });

    const { typing, sessionCtx, resolvedQueue, followupRun } = createBaseRun({
      storePath,
      sessionEntry,
      workspaceDir,
      config: { memory: { stmWriteAck: { enabled: false } } },
    });

    await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionEntry,
      sessionStore: { [sessionKey]: sessionEntry },
      sessionKey,
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
      agentCfgContextTokens: 100_000,
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(calls).toEqual(["hello"]);

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].stmWriteAckAt).toBeTypeOf("number");
    expect(stored[sessionKey].stmWriteAckStatus).toBe("skipped");
  });

  it("skips the acknowledgement turn when disabled for the agent via per-agent override", async () => {
    runEmbeddedPiAgentMock.mockReset();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-stm-ack-"));
    const storePath = path.join(tmp, "sessions.json");
    const workspaceDir = path.join(tmp, "workspace");
    const sessionKey = "main";
    const sessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      compactionCount: 0,
    };

    await seedSessionStore({ storePath, sessionKey, entry: sessionEntry });
    await seedStm(workspaceDir, { version: 1, updated: "2026-05-04T15:00:00+09:00" });

    const calls: string[] = [];
    runEmbeddedPiAgentMock.mockImplementation(async (params: EmbeddedRunParams) => {
      calls.push(params.prompt ?? "");
      return {
        payloads: [{ text: "ok" }],
        meta: { agentMeta: { usage: { input: 1, output: 1 } } },
      };
    });

    const { typing, sessionCtx, resolvedQueue, followupRun } = createBaseRun({
      storePath,
      sessionEntry,
      workspaceDir,
      config: {
        agents: { list: [{ id: "iris", memory: { stmWriteAck: { enabled: false } } }] },
      },
    });

    await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionEntry,
      sessionStore: { [sessionKey]: sessionEntry },
      sessionKey,
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
      agentCfgContextTokens: 100_000,
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(calls).toEqual(["hello"]);

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].stmWriteAckAt).toBeTypeOf("number");
    expect(stored[sessionKey].stmWriteAckStatus).toBe("skipped");
  });

  it("runs the acknowledgement turn when the agent re-enables it over a global disable", async () => {
    runEmbeddedPiAgentMock.mockReset();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-stm-ack-"));
    const storePath = path.join(tmp, "sessions.json");
    const workspaceDir = path.join(tmp, "workspace");
    const sessionKey = "main";
    const sessionEntry = {
      sessionId: "session",
      updatedAt: Date.now(),
      compactionCount: 0,
    };

    await seedSessionStore({ storePath, sessionKey, entry: sessionEntry });
    await seedStm(workspaceDir, { version: 1, updated: "2026-05-04T15:00:00+09:00" });

    const calls: string[] = [];
    runEmbeddedPiAgentMock.mockImplementation(async (params: EmbeddedRunParams) => {
      calls.push(params.prompt ?? "");
      if (params.prompt === DEFAULT_STM_WRITE_ACK_PROMPT && params.workspaceDir) {
        await seedStm(params.workspaceDir, {
          version: 2,
          updated: new Date().toISOString(),
        });
        return { payloads: [], meta: {} };
      }
      return {
        payloads: [{ text: "ok" }],
        meta: { agentMeta: { usage: { input: 1, output: 1 } } },
      };
    });

    const { typing, sessionCtx, resolvedQueue, followupRun } = createBaseRun({
      storePath,
      sessionEntry,
      workspaceDir,
      config: {
        memory: { stmWriteAck: { enabled: false } },
        agents: { list: [{ id: "iris", memory: { stmWriteAck: { enabled: true } } }] },
      },
    });

    await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionEntry,
      sessionStore: { [sessionKey]: sessionEntry },
      sessionKey,
      storePath,
      defaultModel: "anthropic/claude-opus-4-5",
      agentCfgContextTokens: 100_000,
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(calls).toEqual(["hello", DEFAULT_STM_WRITE_ACK_PROMPT]);

    const stored = JSON.parse(await fs.readFile(storePath, "utf-8"));
    expect(stored[sessionKey].stmWriteAckAt).toBeTypeOf("number");
    expect(stored[sessionKey].stmWriteAckStatus).toBe("updated");
    expect(stored[sessionKey].stmWriteAckVersion).toBe(2);
  });
});
