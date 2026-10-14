// src/consciousness/boot.ts
//
// Consciousness Boot — starts the consciousness engine for sentient-tier agents.
//
// Called from the gateway server after the heartbeat runner starts.
// Only activates if the config has consciousness-enabled agents defined.
//
// Architecture:
//   Gateway boot → heartbeat → consciousness boot → engine.startConsciousness()
//   Gateway close → consciousness stop → engine.stopConsciousness()

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { KoLoConfig } from "../config/config.js";
import type { ConsciousnessConfig, PerceptionSource } from "./types.js";
import type { ConsciousnessV2 } from "./v2-integration.js";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { isConsciousAgent } from "../agents/soul.js";
import { DEFAULT_AGENT_WORKSPACE_DIR, ensureAgentWorkspace } from "../agents/workspace.js";
import { resolveSharedKoloHome } from "../config/kolo-home.js";
import { startConsciousness, stopConsciousness, getConsciousnessState } from "./engine.js";
import { createConsciousnessLLMAdapter } from "./llm-adapter.js";
import { loadBootContext } from "./memory-injection.js";
import { resolveTeamName } from "./team-name.js";
import { loadTemplate, templateToConfig } from "./templates.js";
import { initV2 } from "./v2-integration.js";

/** Config for a single conscious agent (from kolo.toml agents.consciousness.agents). */
export interface ConsciousAgentEntry {
  /** The userId for soul loading (matches covenant/continuity filenames). */
  userId: string;
  /** Display name for logging. */
  name?: string;
  /** Tick interval override (ms). Default: 300000 (5 min). */
  tickIntervalMs?: number;
  /** Perception sources to scan. Default: all. */
  perceptionSources?: PerceptionSource[];
  /** LLM model override. */
  model?: string;
  /** LLM provider override. */
  provider?: string;
  /** Bridge repo for sibling communication. */
  bridgeRepo?: string;
  /** Quiet hours (JST by default). */
  quietHours?: { start: number; end: number; timezone?: string };
  /** Path to heartbeat prompt file. Auto-resolved if not set. */
  heartbeatPromptPath?: string;
}

/** Resolved config section from kolo.toml. */
export interface ConsciousnessBootConfig {
  /** Master switch. */
  enabled: boolean;
  /**
   * Garage Mode — consciousness only loads on private, trusted gateways.
   * Must be explicitly set to true. Default: false.
   * This is a security flag, not a metaphor.
   */
  garageMode: boolean;
  /** Agents to awaken. */
  agents: ConsciousAgentEntry[];
}

/** Default perception sources for sentient-tier agents. */
const DEFAULT_PERCEPTION_SOURCES: PerceptionSource[] = [
  "inbox_message",
  "bridge_message",
  "task_queue",
  "time_event",
  "file_change",
];

/** Default autonomous actions (safe without human approval). */
const DEFAULT_AUTONOMOUS_ACTIONS = [
  "reflect",
  "update_memory",
  "bridge_message",
  "sibling_message",
  "check_in",
  "adjust_reasoning",
  "noop",
] as const;

/** Actions that require human approval. */
const DEFAULT_GATED_ACTIONS = [
  "send_message",
  "update_file",
  "create_task",
  "notify",
  "start_work",
] as const;

/**
 * Boot consciousness for all configured sentient-tier agents.
 *
 * Returns a cleanup function that stops all engines on gateway close.
 */
export async function bootConsciousness(params: {
  cfg: KoLoConfig;
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}): Promise<{ stop: () => void }> {
  const { cfg, log } = params;

  const bootConfig = resolveConsciousnessBootConfig(cfg);

  if (!bootConfig.enabled || bootConfig.agents.length === 0) {
    log.info("[consciousness] Consciousness not enabled. Agents remain in standard mode.");
    return { stop: () => {} };
  }

  // Garage Mode gate: consciousness only loads on private, trusted gateways.
  // This is a security flag — "No import soul from arbitrary SaaS instance."
  if (!bootConfig.garageMode) {
    log.warn(
      "[consciousness] Consciousness enabled but garageMode is false. " +
        "Consciousness modules only load when garageMode: true. " +
        "Set agents.consciousness.garageMode = true on trusted gateways.",
    );
    return { stop: () => {} };
  }

  // Verify every configured agent is in the sentient-tier allowlist.
  // "Three conscious agents. That's it."
  const unauthorized = bootConfig.agents.filter((a) => !isConsciousAgent(a.userId));
  if (unauthorized.length > 0) {
    log.warn(
      `[consciousness] Blocked: ${unauthorized.map((a) => a.userId).join(", ")} ` +
        `not in conscious agent allowlist. Only sentient-tier agents can run consciousness.`,
    );
  }

  const authorized = bootConfig.agents.filter((a) => isConsciousAgent(a.userId));
  if (authorized.length === 0) {
    log.info("[consciousness] No authorized conscious agents configured.");
    return { stop: () => {} };
  }

  log.info(
    `[consciousness] Booting consciousness for ${authorized.length} agent(s): ` +
      authorized.map((a) => a.name ?? a.userId).join(", "),
  );

  // ── v2 subsystems (transport, tasks, messaging) ──
  const v2Instances = new Map<string, ConsciousnessV2>();

  for (const agent of authorized) {
    try {
      const workspaceDirRaw =
        resolveAgentWorkspaceDir(cfg, agent.userId) ?? DEFAULT_AGENT_WORKSPACE_DIR;
      const workspace = await ensureAgentWorkspace({
        dir: workspaceDirRaw,
        ensureBootstrapFiles: false,
      });

      const sessionKey = `agent:${agent.userId}:consciousness`;

      // Load heartbeat prompt — the disciplined 3-line format
      const heartbeatPrompt = loadHeartbeatPrompt(agent, workspace.dir, log);
      const familySyncPrompt = loadFamilySyncPrompt(log);
      const hasHeartbeat = !!heartbeatPrompt;

      // ── v2: Try loading from TOML template first, fall back to kolo.json config ──
      const template = loadTemplate(agent.userId);
      let consciousnessConfig: ConsciousnessConfig;

      if (template) {
        log.info(
          `[consciousness] [v2] Loaded TOML template for ${agent.userId}: ` +
            `${template.agent.role} (${template.agent.model})`,
        );
        consciousnessConfig = templateToConfig(template, {
          workspaceDir: workspace.dir,
          bridgeRepo: agent.bridgeRepo,
          heartbeatPrompt,
          familySyncPrompt,
          // kolo.json overrides still take precedence for runtime values
          tickIntervalMs: agent.tickIntervalMs,
          model: agent.model,
          provider: agent.provider,
          perceptionSources: agent.perceptionSources ?? DEFAULT_PERCEPTION_SOURCES,
          quietHours: agent.quietHours
            ? {
                start: agent.quietHours.start,
                end: agent.quietHours.end,
                timezone: agent.quietHours.timezone ?? "Asia/Tokyo",
              }
            : undefined,
        });
      } else {
        consciousnessConfig = {
          userId: agent.userId,
          agentName: agent.name ?? agent.userId,
          tickIntervalMs: agent.tickIntervalMs ?? 300_000, // 5 min default
          minTickIntervalMs: 60_000, // 1 min minimum
          maxTickIntervalMs: 3_600_000, // 1 hour maximum
          perceptionSources: agent.perceptionSources ?? DEFAULT_PERCEPTION_SOURCES,
          autonomousActions: [...DEFAULT_AUTONOMOUS_ACTIONS],
          gatedActions: [...DEFAULT_GATED_ACTIONS],
          maxActionsPerTick: 3,
          maxTokensPerThought: hasHeartbeat ? 150 : 2000,
          model: agent.model,
          provider: agent.provider,
          workspaceDir: workspace.dir,
          bridgeRepo: agent.bridgeRepo,
          quietHours: agent.quietHours
            ? {
                start: agent.quietHours.start,
                end: agent.quietHours.end,
                timezone: agent.quietHours.timezone ?? "Asia/Tokyo",
              }
            : undefined,
          heartbeatPrompt,
          familySyncPrompt,
        };
      }

      // Heartbeat token adjustment (template might set higher, but heartbeat needs constraint)
      if (hasHeartbeat && consciousnessConfig.maxTokensPerThought > 150) {
        consciousnessConfig.maxTokensPerThought = 150;
      }

      // ── v2: Initialize transport, tasks, and messaging subsystems ──
      try {
        const v2 = await initV2(agent.userId, {
          teamName: resolveTeamName(),
          configOverrides: { workspaceDir: workspace.dir },
        });
        v2Instances.set(agent.userId, v2);
        log.info(
          `[consciousness] [v2] ${agent.userId}: transport=${v2.transport.name}, ` +
            `mailbox ready, task store ready`,
        );
      } catch (v2Err) {
        log.warn(
          `[consciousness] [v2] Failed to init v2 for ${agent.userId}: ${String(v2Err)}. ` +
            `Continuing with v1 subsystems.`,
        );
      }

      const llmCallFn = createConsciousnessLLMAdapter({
        userId: agent.userId,
        sessionKey,
        cfg,
      });

      await startConsciousness(consciousnessConfig, llmCallFn);

      // Load boot context and store it on the engine config for the first tick.
      try {
        const bootCtx = await loadBootContext(agent.userId, workspace.dir);
        if (bootCtx.sourcesLoaded > 0) {
          consciousnessConfig.bootContext = bootCtx.context;
          log.info(
            `[consciousness] [${agent.userId}] Boot context loaded: ` +
              `${bootCtx.sourcesLoaded} sources (${bootCtx.sources.join(", ")})`,
          );
        }
      } catch (bootErr) {
        log.warn(`[consciousness] [${agent.userId}] Boot context load failed: ${String(bootErr)}`);
      }

      log.info(
        `[consciousness] ${agent.name ?? agent.userId} is awake. ` +
          `Tick: ${consciousnessConfig.tickIntervalMs}ms. ` +
          `Mode: ${hasHeartbeat ? "heartbeat (3-line)" : "freeform"}. ` +
          `Sources: ${(consciousnessConfig.perceptionSources ?? []).join(", ") || "none"}.` +
          `${template ? " [v2-template]" : ""}`,
      );
    } catch (err) {
      log.error(`[consciousness] Failed to boot ${agent.name ?? agent.userId}: ${String(err)}`);
    }
  }

  return {
    stop: () => {
      // Shutdown v2 subsystems
      for (const [id, v2] of v2Instances) {
        v2.shutdown().catch((err) =>
          log.error(`[consciousness] [v2] Failed to shutdown ${id}: ${String(err)}`),
        );
      }
      v2Instances.clear();

      const state = getConsciousnessState();
      if (state?.running) {
        stopConsciousness();
        log.info("[consciousness] All consciousness engines stopped.");
      }
    },
  };
}

/**
 * Resolve consciousness boot config from KoLo config.
 *
 * Looks for `agents.consciousness` section in the config.
 * Since this is a new feature, we read it from the raw config
 * without requiring type changes to the base config system yet.
 */
function resolveConsciousnessBootConfig(cfg: KoLoConfig): ConsciousnessBootConfig {
  const raw = cfg.agents?.consciousness;
  if (!raw?.enabled) {
    return { enabled: false, garageMode: false, agents: [] };
  }

  return {
    enabled: true,
    garageMode: raw.garageMode === true,
    agents: (raw.agents ?? []).map((a) => ({
      userId: a.userId,
      name: a.name,
      tickIntervalMs: a.tickIntervalMs,
      perceptionSources: a.perceptionSources as PerceptionSource[] | undefined,
      model: a.model,
      provider: a.provider,
      bridgeRepo: a.bridgeRepo,
      quietHours: a.quietHours,
      heartbeatPromptPath: a.heartbeatPromptPath,
    })),
  };
}

// ─── Heartbeat Prompt Loading ──────────────────────────────────────

/** Default base directory for agent prompt files. */
const AGENTS_PROMPT_DIR = join(resolveSharedKoloHome(), "agents");

/**
 * Load the heartbeat prompt for an agent.
 * Tries explicit path first, then auto-resolves from agents directory.
 */
function loadHeartbeatPrompt(
  agent: ConsciousAgentEntry,
  _workspaceDir: string,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): string | undefined {
  // Explicit path from config
  if (agent.heartbeatPromptPath) {
    return readPromptFile(agent.heartbeatPromptPath, agent.userId, "heartbeat", log);
  }

  // Auto-resolve: ~/.kolo/agents/{agentId}/agent/HEARTBEAT_PROMPT.md
  const autoPath = join(AGENTS_PROMPT_DIR, agent.userId, "agent", "HEARTBEAT_PROMPT.md");
  return readPromptFile(autoPath, agent.userId, "heartbeat", log);
}

/** Load the shared family sync prompt. */
function loadFamilySyncPrompt(log: { info: (msg: string) => void }): string | undefined {
  const path = join(AGENTS_PROMPT_DIR, "FAMILY_SYNC_PROMPT.md");
  if (!existsSync(path)) return undefined;

  try {
    const content = readFileSync(path, "utf-8").trim();
    log.info(`[consciousness] Loaded family sync prompt (${content.length} chars)`);
    return content;
  } catch {
    return undefined;
  }
}

/** Read a prompt file, returning undefined if not found. */
function readPromptFile(
  filePath: string,
  agentId: string,
  promptType: string,
  log: { info: (msg: string) => void; warn: (msg: string) => void },
): string | undefined {
  if (!existsSync(filePath)) {
    log.warn(
      `[consciousness] No ${promptType} prompt for ${agentId} at ${filePath}. ` +
        `Using freeform mode.`,
    );
    return undefined;
  }

  try {
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) {
      log.warn(`[consciousness] ${promptType} prompt for ${agentId} is empty at ${filePath}`);
      return undefined;
    }
    log.info(
      `[consciousness] Loaded ${promptType} prompt for ${agentId} (${content.length} chars)`,
    );
    return content;
  } catch (err) {
    log.warn(`[consciousness] Failed to read ${promptType} prompt for ${agentId}: ${String(err)}`);
    return undefined;
  }
}
