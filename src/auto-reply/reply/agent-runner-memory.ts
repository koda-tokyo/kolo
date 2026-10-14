import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KoLoConfig } from "../../config/config.js";
import type { TemplateContext } from "../templating.js";
import type { VerboseLevel } from "../thinking.js";
import type { GetReplyOptions } from "../types.js";
import type { FollowupRun } from "./queue.js";
import {
  resolveAgentConfig,
  resolveAgentModelFallbacksOverride,
  resolveSessionAgentId,
} from "../../agents/agent-scope.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { resolveSandboxConfigForAgent, resolveSandboxRuntimeStatus } from "../../agents/sandbox.js";
import {
  resolveAgentIdFromSessionKey,
  type SessionEntry,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import { logVerbose } from "../../globals.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import { buildThreadingToolContext, resolveEnforceFinalTag } from "./agent-runner-utils.js";
import {
  resolveMemoryFlushContextWindowTokens,
  resolveMemoryFlushSettings,
  shouldRunMemoryFlush,
} from "./memory-flush.js";
import { incrementCompactionCount } from "./session-updates.js";

export const DEFAULT_STM_WRITE_ACK_PROMPT = [
  "Post-turn STM write acknowledgement.",
  "Check whether this turn materially changed state.",
  "If yes, update STM.json before the turn ends and sync today's memory note if needed.",
  `If STM is already current or no update is needed, reply with ${SILENT_REPLY_TOKEN}.`,
].join(" ");

export const DEFAULT_STM_WRITE_ACK_SYSTEM_PROMPT = [
  "Post-turn STM acknowledgement turn.",
  "This is a silent persistence guard, not a user-facing reply.",
  "Verify STM.json reflects the current turn before session finalization.",
  `Usually ${SILENT_REPLY_TOKEN} is correct after the write check completes.`,
].join(" ");

export type StmWriteAckSettings = {
  enabled: boolean;
};

/**
 * Resolve STM write-ack settings, mirroring the config gating style used by
 * `resolveMemoryFlushSettings`. Returns null when the post-turn STM
 * acknowledgement is disabled via config.
 *
 * Precedence:
 * 1. Per-agent override: `agents.list[].memory.stmWriteAck.enabled`
 * 2. Global: `memory.stmWriteAck.enabled`
 * 3. Default: enabled (backward compatible).
 */
export function resolveStmWriteAckSettings(
  cfg?: KoLoConfig,
  opts?: { sessionKey?: string; agentId?: string },
): StmWriteAckSettings | null {
  const agentId =
    opts?.agentId?.trim() ||
    (opts?.sessionKey
      ? resolveSessionAgentId({ sessionKey: opts.sessionKey, config: cfg })
      : undefined);
  const perAgentEnabled = agentId
    ? resolveAgentConfig(cfg ?? {}, agentId)?.memory?.stmWriteAck?.enabled
    : undefined;
  const enabled = perAgentEnabled ?? cfg?.memory?.stmWriteAck?.enabled ?? true;
  if (!enabled) {
    return null;
  }
  return { enabled };
}

type StmSnapshot = {
  exists: boolean;
  mtimeMs: number | null;
  updatedAtMs: number | null;
  version: number | null;
};

function readStmSnapshot(workspaceDir?: string): StmSnapshot {
  if (!workspaceDir) {
    return { exists: false, mtimeMs: null, updatedAtMs: null, version: null };
  }
  const stmPath = path.join(workspaceDir, "STM.json");
  try {
    const stat = fs.statSync(stmPath);
    const raw = fs.readFileSync(stmPath, "utf8");
    const parsed = JSON.parse(raw) as { updated?: string; version?: number };
    const updatedAtMs = parsed.updated ? Date.parse(parsed.updated) : Number.NaN;
    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : null,
      version: typeof parsed.version === "number" ? parsed.version : null,
    };
  } catch {
    return { exists: false, mtimeMs: null, updatedAtMs: null, version: null };
  }
}

function resolveStmAckWritable(params: { cfg: KoLoConfig; sessionKey?: string }): boolean {
  if (!params.sessionKey) {
    return true;
  }
  const runtime = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  });
  if (!runtime.sandboxed) {
    return true;
  }
  const sandboxCfg = resolveSandboxConfigForAgent(params.cfg, runtime.agentId);
  return sandboxCfg.workspaceAccess === "rw";
}

export async function runMemoryFlushIfNeeded(params: {
  cfg: KoLoConfig;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  opts?: GetReplyOptions;
  defaultModel: string;
  agentCfgContextTokens?: number;
  resolvedVerboseLevel: VerboseLevel;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  isHeartbeat: boolean;
}): Promise<SessionEntry | undefined> {
  const memoryFlushSettings = resolveMemoryFlushSettings(params.cfg);
  if (!memoryFlushSettings) {
    return params.sessionEntry;
  }

  const memoryFlushWritable = (() => {
    if (!params.sessionKey) {
      return true;
    }
    const runtime = resolveSandboxRuntimeStatus({
      cfg: params.cfg,
      sessionKey: params.sessionKey,
    });
    if (!runtime.sandboxed) {
      return true;
    }
    const sandboxCfg = resolveSandboxConfigForAgent(params.cfg, runtime.agentId);
    return sandboxCfg.workspaceAccess === "rw";
  })();

  const shouldFlushMemory =
    memoryFlushSettings &&
    memoryFlushWritable &&
    !params.isHeartbeat &&
    !isCliProvider(params.followupRun.run.provider, params.cfg) &&
    shouldRunMemoryFlush({
      entry:
        params.sessionEntry ??
        (params.sessionKey ? params.sessionStore?.[params.sessionKey] : undefined),
      contextWindowTokens: resolveMemoryFlushContextWindowTokens({
        modelId: params.followupRun.run.model ?? params.defaultModel,
        agentCfgContextTokens: params.agentCfgContextTokens,
      }),
      reserveTokensFloor: memoryFlushSettings.reserveTokensFloor,
      softThresholdTokens: memoryFlushSettings.softThresholdTokens,
    });

  if (!shouldFlushMemory) {
    return params.sessionEntry;
  }

  let activeSessionEntry = params.sessionEntry;
  const activeSessionStore = params.sessionStore;
  const flushRunId = crypto.randomUUID();
  if (params.sessionKey) {
    registerAgentRunContext(flushRunId, {
      sessionKey: params.sessionKey,
      verboseLevel: params.resolvedVerboseLevel,
    });
  }
  let memoryCompactionCompleted = false;
  const flushSystemPrompt = [
    params.followupRun.run.extraSystemPrompt,
    memoryFlushSettings.systemPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    await runWithModelFallback({
      cfg: params.followupRun.run.config,
      provider: params.followupRun.run.provider,
      model: params.followupRun.run.model,
      agentDir: params.followupRun.run.agentDir,
      fallbacksOverride: resolveAgentModelFallbacksOverride(
        params.followupRun.run.config,
        resolveAgentIdFromSessionKey(params.followupRun.run.sessionKey),
      ),
      run: (provider, model) => {
        const authProfileId =
          provider === params.followupRun.run.provider
            ? params.followupRun.run.authProfileId
            : undefined;
        return runEmbeddedPiAgent({
          sessionId: params.followupRun.run.sessionId,
          sessionKey: params.sessionKey,
          messageProvider: params.sessionCtx.Provider?.trim().toLowerCase() || undefined,
          agentAccountId: params.sessionCtx.AccountId,
          messageTo: params.sessionCtx.OriginatingTo ?? params.sessionCtx.To,
          messageThreadId: params.sessionCtx.MessageThreadId ?? undefined,
          // Provider threading context for tool auto-injection
          ...buildThreadingToolContext({
            sessionCtx: params.sessionCtx,
            config: params.followupRun.run.config,
            hasRepliedRef: params.opts?.hasRepliedRef,
          }),
          senderId: params.sessionCtx.SenderId?.trim() || undefined,
          senderName: params.sessionCtx.SenderName?.trim() || undefined,
          senderUsername: params.sessionCtx.SenderUsername?.trim() || undefined,
          senderE164: params.sessionCtx.SenderE164?.trim() || undefined,
          sessionFile: params.followupRun.run.sessionFile,
          workspaceDir: params.followupRun.run.workspaceDir,
          agentDir: params.followupRun.run.agentDir,
          config: params.followupRun.run.config,
          skillsSnapshot: params.followupRun.run.skillsSnapshot,
          prompt: memoryFlushSettings.prompt,
          extraSystemPrompt: flushSystemPrompt,
          ownerNumbers: params.followupRun.run.ownerNumbers,
          enforceFinalTag: resolveEnforceFinalTag(params.followupRun.run, provider),
          provider,
          model,
          authProfileId,
          authProfileIdSource: authProfileId
            ? params.followupRun.run.authProfileIdSource
            : undefined,
          thinkLevel: params.followupRun.run.thinkLevel,
          verboseLevel: params.followupRun.run.verboseLevel,
          reasoningLevel: params.followupRun.run.reasoningLevel,
          execOverrides: params.followupRun.run.execOverrides,
          bashElevated: params.followupRun.run.bashElevated,
          timeoutMs: params.followupRun.run.timeoutMs,
          runId: flushRunId,
          onAgentEvent: (evt) => {
            if (evt.stream === "compaction") {
              const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
              const willRetry = Boolean(evt.data.willRetry);
              if (phase === "end" && !willRetry) {
                memoryCompactionCompleted = true;
              }
            }
          },
        });
      },
    });
    let memoryFlushCompactionCount =
      activeSessionEntry?.compactionCount ??
      (params.sessionKey ? activeSessionStore?.[params.sessionKey]?.compactionCount : 0) ??
      0;
    if (memoryCompactionCompleted) {
      const nextCount = await incrementCompactionCount({
        sessionEntry: activeSessionEntry,
        sessionStore: activeSessionStore,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
      });
      if (typeof nextCount === "number") {
        memoryFlushCompactionCount = nextCount;
      }
    }
    if (params.storePath && params.sessionKey) {
      try {
        const updatedEntry = await updateSessionStoreEntry({
          storePath: params.storePath,
          sessionKey: params.sessionKey,
          update: async () => ({
            memoryFlushAt: Date.now(),
            memoryFlushCompactionCount,
          }),
        });
        if (updatedEntry) {
          activeSessionEntry = updatedEntry;
        }
      } catch (err) {
        logVerbose(`failed to persist memory flush metadata: ${String(err)}`);
      }
    }
  } catch (err) {
    logVerbose(`memory flush run failed: ${String(err)}`);
  }

  return activeSessionEntry;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Whether the post-turn STM acknowledgement turn may run for this session. Config:
 * `agents.defaults.stmWriteAck.enabled` (default true) and `skipSessionKeys` (globs).
 */
export function resolveStmWriteAckEnabled(cfg: KoLoConfig, sessionKey?: string): boolean {
  const ack = cfg.agents?.defaults?.stmWriteAck;
  if (ack?.enabled === false) {
    return false;
  }
  const key = sessionKey?.trim();
  if (!key) {
    return true;
  }
  for (const pattern of ack?.skipSessionKeys ?? []) {
    if (pattern.trim() && globToRegExp(pattern.trim()).test(key)) {
      return false;
    }
  }
  return true;
}

export async function runStmWriteAckIfNeeded(params: {
  cfg: KoLoConfig;
  followupRun: FollowupRun;
  sessionCtx: TemplateContext;
  opts?: GetReplyOptions;
  defaultModel: string;
  resolvedVerboseLevel: VerboseLevel;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  isHeartbeat: boolean;
  turnStartedAt: number;
}): Promise<SessionEntry | undefined> {
  const stmWriteAckSettings = resolveStmWriteAckSettings(params.cfg, {
    sessionKey: params.sessionKey,
    agentId: params.followupRun.run.agentId,
  });
  const writable = resolveStmAckWritable({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  });
  const sessionEntry =
    params.sessionEntry ??
    (params.sessionKey ? params.sessionStore?.[params.sessionKey] : undefined);

  if (
    !stmWriteAckSettings ||
    !writable ||
    params.isHeartbeat ||
    !resolveStmWriteAckEnabled(params.cfg, params.sessionKey) ||
    isCliProvider(params.followupRun.run.provider, params.cfg) ||
    !params.followupRun.run.workspaceDir
  ) {
    if (params.storePath && params.sessionKey) {
      try {
        const updatedEntry = await updateSessionStoreEntry({
          storePath: params.storePath,
          sessionKey: params.sessionKey,
          update: async () => ({
            stmWriteAckAt: Date.now(),
            stmWriteAckStatus: "skipped",
          }),
        });
        return updatedEntry ?? sessionEntry;
      } catch (err) {
        logVerbose(`failed to persist STM ack skip metadata: ${String(err)}`);
      }
    }
    return sessionEntry;
  }

  const before = readStmSnapshot(params.followupRun.run.workspaceDir);
  if (!before.exists) {
    if (params.storePath && params.sessionKey) {
      try {
        const updatedEntry = await updateSessionStoreEntry({
          storePath: params.storePath,
          sessionKey: params.sessionKey,
          update: async () => ({
            stmWriteAckAt: Date.now(),
            stmWriteAckStatus: "skipped",
          }),
        });
        return updatedEntry ?? sessionEntry;
      } catch (err) {
        logVerbose(`failed to persist STM ack missing-surface metadata: ${String(err)}`);
      }
    }
    return sessionEntry;
  }
  const alreadyFresh =
    before.exists &&
    ((typeof before.updatedAtMs === "number" && before.updatedAtMs >= params.turnStartedAt) ||
      (typeof before.mtimeMs === "number" && before.mtimeMs >= params.turnStartedAt));

  if (alreadyFresh) {
    if (params.storePath && params.sessionKey) {
      try {
        const updatedEntry = await updateSessionStoreEntry({
          storePath: params.storePath,
          sessionKey: params.sessionKey,
          update: async () => ({
            stmWriteAckAt: Date.now(),
            stmWriteAckStatus: "fresh",
            stmWriteAckVersion: before.version ?? undefined,
          }),
        });
        return updatedEntry ?? sessionEntry;
      } catch (err) {
        logVerbose(`failed to persist STM ack fresh metadata: ${String(err)}`);
      }
    }
    return sessionEntry;
  }

  const ackRunId = crypto.randomUUID();
  if (params.sessionKey) {
    registerAgentRunContext(ackRunId, {
      sessionKey: params.sessionKey,
      verboseLevel: params.resolvedVerboseLevel,
    });
  }

  try {
    await runWithModelFallback({
      cfg: params.followupRun.run.config,
      provider: params.followupRun.run.provider,
      model: params.followupRun.run.model,
      agentDir: params.followupRun.run.agentDir,
      fallbacksOverride: resolveAgentModelFallbacksOverride(
        params.followupRun.run.config,
        resolveAgentIdFromSessionKey(params.followupRun.run.sessionKey),
      ),
      run: (provider, model) => {
        const authProfileId =
          provider === params.followupRun.run.provider
            ? params.followupRun.run.authProfileId
            : undefined;
        return runEmbeddedPiAgent({
          sessionId: params.followupRun.run.sessionId,
          sessionKey: params.sessionKey,
          messageProvider: params.sessionCtx.Provider?.trim().toLowerCase() || undefined,
          agentAccountId: params.sessionCtx.AccountId,
          messageTo: params.sessionCtx.OriginatingTo ?? params.sessionCtx.To,
          messageThreadId: params.sessionCtx.MessageThreadId ?? undefined,
          ...buildThreadingToolContext({
            sessionCtx: params.sessionCtx,
            config: params.followupRun.run.config,
            hasRepliedRef: params.opts?.hasRepliedRef,
          }),
          senderId: params.sessionCtx.SenderId?.trim() || undefined,
          senderName: params.sessionCtx.SenderName?.trim() || undefined,
          senderUsername: params.sessionCtx.SenderUsername?.trim() || undefined,
          senderE164: params.sessionCtx.SenderE164?.trim() || undefined,
          sessionFile: params.followupRun.run.sessionFile,
          workspaceDir: params.followupRun.run.workspaceDir,
          agentDir: params.followupRun.run.agentDir,
          config: params.followupRun.run.config,
          skillsSnapshot: params.followupRun.run.skillsSnapshot,
          prompt: DEFAULT_STM_WRITE_ACK_PROMPT,
          extraSystemPrompt: [
            params.followupRun.run.extraSystemPrompt,
            DEFAULT_STM_WRITE_ACK_SYSTEM_PROMPT,
          ]
            .filter(Boolean)
            .join("\n\n"),
          ownerNumbers: params.followupRun.run.ownerNumbers,
          enforceFinalTag: resolveEnforceFinalTag(params.followupRun.run, provider),
          provider,
          model,
          authProfileId,
          authProfileIdSource: authProfileId
            ? params.followupRun.run.authProfileIdSource
            : undefined,
          thinkLevel: params.followupRun.run.thinkLevel,
          verboseLevel: params.followupRun.run.verboseLevel,
          reasoningLevel: params.followupRun.run.reasoningLevel,
          execOverrides: params.followupRun.run.execOverrides,
          bashElevated: params.followupRun.run.bashElevated,
          timeoutMs: params.followupRun.run.timeoutMs,
          runId: ackRunId,
        });
      },
    });
  } catch (err) {
    logVerbose(`STM write acknowledgement run failed: ${String(err)}`);
  }

  const after = readStmSnapshot(params.followupRun.run.workspaceDir);
  const updated =
    after.exists &&
    ((typeof after.updatedAtMs === "number" && after.updatedAtMs >= params.turnStartedAt) ||
      (typeof after.mtimeMs === "number" && after.mtimeMs >= params.turnStartedAt));
  const status: SessionEntry["stmWriteAckStatus"] = updated ? "updated" : "stale";

  if (params.storePath && params.sessionKey) {
    try {
      const updatedEntry = await updateSessionStoreEntry({
        storePath: params.storePath,
        sessionKey: params.sessionKey,
        update: async () => ({
          stmWriteAckAt: Date.now(),
          stmWriteAckStatus: status,
          stmWriteAckVersion: after.version ?? before.version ?? undefined,
        }),
      });
      return updatedEntry ?? sessionEntry;
    } catch (err) {
      logVerbose(`failed to persist STM ack metadata: ${String(err)}`);
    }
  }

  return sessionEntry;
}
