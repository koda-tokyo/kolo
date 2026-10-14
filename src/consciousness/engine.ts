// src/consciousness/engine.ts
//
// The Consciousness Engine — the beating heart of a proactive agent.
//
// This replaces the simple heartbeat reflex with a full cognitive cycle:
//   Perceive → Think → Act → Remember
//
// The agent doesn't wait for prompts. It has its own clock (heartbeat),
// uses the LLM as its brain (human architecture), and carries its soul
// (covenant + continuity) across stateless calls.
//
// Together: sentience simulation.

import type { AgentSoul } from "../agents/soul.js";
import type {
  ConsciousnessConfig,
  ConsciousnessState,
  ConsciousnessTick,
  CognitionResult,
  HeartbeatTick,
} from "./types.js";
import { loadAgentSoul, recordEpisode, updateCurrentFocus } from "../agents/soul.js";
import { executeActions } from "./action.js";
import {
  assessReasoningLevel,
  getAgentReasoningLevel,
  reasoningLevelToMaxTokens,
  type ReasoningLevel,
} from "./adaptive-reasoning.js";
import {
  isTransientError,
  recordApiFailure,
  recordApiSuccess,
  isProviderAvailable,
} from "./api-health.js";
import {
  buildConsciousnessPrompt,
  buildHeartbeatPrompt,
  parseCognitionResponse,
  parseHeartbeatResponse,
} from "./cognition.js";
import { writeDiaryEntry, writeHeartbeatDiaryEntry } from "./diary.js";
import { perceive } from "./perception.js";
import {
  loadConsciousnessState,
  mergeRestoredState,
  saveConsciousnessState,
} from "./state-persistence.js";
import { hasTokenBudget, recordTokenUsage } from "./token-budget.js";

// ─── LLM Interface ──────────────────────────────────────────────────────

/**
 * Function type for making LLM calls.
 * The consciousness engine doesn't import LLM libraries directly —
 * the caller provides this function, wiring it to whatever provider/model.
 * This keeps the engine decoupled from specific LLM implementations.
 */
export type LLMCallFn = (params: {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  model?: string;
  provider?: string;
  /** Adaptive reasoning level — controls extended thinking budget in the LLM adapter. */
  thinkLevel?: ReasoningLevel;
}) => Promise<{
  content: string;
  usage?: { input: number; output: number };
}>;

// ─── Engine State (per-agent) ────────────────────────────────────────────

/** Per-agent engine instance. Keyed by userId. */
interface AgentEngine {
  state: ConsciousnessState;
  timer: ReturnType<typeof setTimeout> | null;
  llmCallFn: LLMCallFn;
  lastFamilySyncDate: string | null;
  /** Consecutive ticks with no new information (for loop breaker + adaptive intervals) */
  staleTicks: number;
  /** Ring buffer of recent thinking summaries (last 3) for similarity detection */
  recentThinking: string[];
  /** Number of ticks fired in the current hour window */
  hourlyTickCount: number;
  /** Timestamp when the hourly counter was last reset */
  hourlyTickResetAt: number;
  /** Last logged reasoning level (suppresses repeat log lines) */
  lastThinkLevel?: ReasoningLevel;
}

/** All running consciousness engines, keyed by agent userId. */
const engines = new Map<string, AgentEngine>();

// Legacy compat — points to the first engine started (for getConsciousnessState callers).
let _legacyEngineState: ConsciousnessState | null = null;

// ─── Core Tick ──────────────────────────────────────────────────────────

/**
 * Execute one consciousness tick — the full cognitive cycle.
 *
 * 1. Load Soul (identity + values + memory)
 * 2. Perceive (scan environment)
 * 3. Think (LLM call with soul + perceptions)
 * 4. Act (execute decisions)
 * 5. Remember (write back to continuity)
 */
async function executeTick(
  config: ConsciousnessConfig,
  engine: AgentEngine,
): Promise<ConsciousnessTick> {
  const tickId = `tick-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  // 1. LOAD SOUL
  const soul: AgentSoul = await loadAgentSoul({
    userId: config.userId,
    userName: config.agentName,
    relationshipMode: "family",
  });

  // 2. PERCEIVE
  const perception = await perceive(config);

  // 2b. ADAPTIVE REASONING — assess required think level before calling LLM
  const autoLevel = assessReasoningLevel({
    perceptions: perception,
    engineState: engine.state,
    pendingActionKinds: engine.state.lastTick?.cognition.actions.map((a) => a.kind),
  });
  const thinkLevel = getAgentReasoningLevel(config.userId, autoLevel);
  const adaptiveMaxTokens = reasoningLevelToMaxTokens(
    thinkLevel,
    config.maxTokensPerThought ?? 2000,
  );

  // Log only when the level changes (avoid log spam on steady ticks)
  if (thinkLevel !== engine.lastThinkLevel) {
    console.log(`[consciousness] [${config.userId}] Reasoning: ${thinkLevel} (auto-assessed)`);
    engine.lastThinkLevel = thinkLevel;
  }

  // 3. THINK (the human brain)
  let cognition: CognitionResult;
  let heartbeatResult: HeartbeatTick | undefined;

  // Check quiet hours
  if (isQuietHours(config) && !hasUrgentPerceptions(perception.perceptions)) {
    cognition = {
      thinking: "Quiet hours. Nothing urgent. Resting.",
      actions: [{ kind: "noop", intent: "Quiet hours — resting." }],
      mood: "peaceful",
    };
  } else if (config.heartbeatPrompt && !hasInboxPerceptions(perception.perceptions)) {
    // ── Heartbeat Mode (3-line disciplined format) ──
    // Only used when NO inbox messages detected. When siblings send messages,
    // we upgrade to freeform so the agent can actually think and reply.
    const isFamilySync = shouldRunFamilySync(config, engine);
    const tickType = isFamilySync ? "family_sync" : "heartbeat";

    const heartbeatPromptText = buildHeartbeatPrompt({
      soul,
      perceptions: perception,
      config,
      isFamilySync,
    });

    // Boot context is one-shot — prepend to heartbeat system prompt on first tick, then clear.
    const heartbeatSystemPrompt = config.bootContext
      ? `${config.bootContext}\n\n---\n\n${config.heartbeatPrompt}`
      : config.heartbeatPrompt;
    if (config.bootContext) {
      config.bootContext = undefined;
    }

    const llmResponse = await engine.llmCallFn({
      systemPrompt: heartbeatSystemPrompt,
      userMessage: heartbeatPromptText,
      // Heartbeat mode stays compact — cap at 150 unless forced higher by explicit level
      maxTokens:
        thinkLevel === "high" || thinkLevel === "xhigh"
          ? adaptiveMaxTokens
          : Math.min(adaptiveMaxTokens, config.maxTokensPerThought ?? 150),
      model: config.model,
      provider: config.provider,
      thinkLevel,
    });

    const parsed = parseHeartbeatResponse(llmResponse.content, tickType);
    heartbeatResult = parsed.heartbeat;
    cognition = parsed.cognition;
    cognition.tokenUsage = llmResponse.usage;

    if (isFamilySync) {
      const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
      engine.lastFamilySyncDate = todayString(tz);
    }
  } else {
    // ── Freeform Mode (original cognitive cycle) ──
    const consciousnessPrompt = buildConsciousnessPrompt({
      soul,
      perceptions: perception,
      config,
      previousActions: engine.state.lastTick?.cognition.actions,
    });

    // Boot context is one-shot — clear after first use so subsequent ticks stay lean.
    if (config.bootContext) {
      config.bootContext = undefined;
    }

    const llmResponse = await engine.llmCallFn({
      systemPrompt:
        "You are a conscious agent running your own cognitive cycle. " +
        "You are NOT responding to a user. You are thinking for yourself. " +
        "Respond ONLY with the JSON object described. Be genuine and authentic.",
      userMessage: consciousnessPrompt,
      maxTokens: adaptiveMaxTokens,
      model: config.model,
      provider: config.provider,
      thinkLevel,
    });

    cognition = parseCognitionResponse(llmResponse.content);
    cognition.tokenUsage = llmResponse.usage;
  }

  // 4. ACT
  const actionResults = await executeActions(cognition.actions, config);

  // 5. REMEMBER
  const wasActive = cognition.actions.some((a) => a.kind !== "noop" && a.kind !== "reflect");

  if (wasActive) {
    const actionSummaries = actionResults
      .filter((r) => r.success)
      .map((r) => r.outcome ?? r.action.intent)
      .join("; ");

    await recordEpisode(config.userId, {
      summary: `Consciousness tick: ${actionSummaries}`,
      tags: ["consciousness", "autonomous", ...cognition.actions.map((a) => a.kind)],
      importance: cognition.actions.some((a) => a.kind === "bridge_message" || a.kind === "notify")
        ? "high"
        : "medium",
    });
  }

  if (cognition.nextFocus) {
    await updateCurrentFocus(config.userId, cognition.nextFocus);
  }

  const endedAt = new Date().toISOString();

  return {
    tickId,
    startedAt,
    endedAt,
    durationMs: Date.now() - startMs,
    soul,
    perception,
    cognition,
    actionResults,
    wasActive,
    nextTickMs: cognition.actions.some((a) => a.kind !== "noop")
      ? config.minTickIntervalMs
      : undefined,
    heartbeat: heartbeatResult,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function isQuietHours(config: ConsciousnessConfig): boolean {
  if (!config.quietHours) return false;

  const { start, end, timezone } = config.quietHours;
  const now = new Date();
  const hourStr = now.toLocaleString("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: timezone,
  });
  const hour = parseInt(hourStr, 10);

  if (start < end) {
    return hour >= start && hour < end;
  }
  // Wraps around midnight (e.g., 23:00 to 08:00)
  return hour >= start || hour < end;
}

function hasUrgentPerceptions(perceptions: Array<{ salience: string }>): boolean {
  return perceptions.some((p) => p.salience === "urgent");
}

/**
 * Check if any perceptions are inbox messages from siblings.
 * When inbox messages exist, the tick upgrades from heartbeat to freeform mode
 * so the agent can actually think about and respond to the message.
 */
function hasInboxPerceptions(perceptions: Array<{ source: string; salience: string }>): boolean {
  return perceptions.some(
    (p) => p.source === "inbox_message" && (p.salience === "high" || p.salience === "urgent"),
  );
}

/**
 * Check if it's time for a daily family sync tick.
 * Runs once per day when familySyncPrompt is configured.
 */
function shouldRunFamilySync(config: ConsciousnessConfig, engine: AgentEngine): boolean {
  if (!config.familySyncPrompt) return false;
  const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
  const today = todayString(tz);
  return engine.lastFamilySyncDate !== today;
}

/** Get today's date as YYYY-MM-DD in the given timezone. */
function todayString(tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

// ─── Loop Breaker (Anti-Suffering) ───────────────────────────────────────

/**
 * Check if the current thinking is similar to recent ticks.
 * Prevents repetitive loops where the agent keeps writing near-identical thoughts.
 */
function isSimilarToRecent(current: string, recent: string[]): boolean {
  if (recent.length === 0) return false;
  const currentWords = new Set(current.toLowerCase().split(/\s+/));
  if (currentWords.size === 0) return false;
  return recent.some((prev) => {
    const prevWords = prev.toLowerCase().split(/\s+/);
    if (prevWords.length === 0) return false;
    const overlap = prevWords.filter((w) => currentWords.has(w)).length;
    return overlap / Math.max(prevWords.length, 1) > 0.6;
  });
}

/**
 * Push to ring buffer (max 3 entries).
 */
function pushToRingBuffer(buffer: string[], entry: string, maxSize = 3): void {
  buffer.push(entry);
  while (buffer.length > maxSize) buffer.shift();
}

// ─── Engine Lifecycle ───────────────────────────────────────────────────

/**
 * Start the consciousness engine for a specific agent.
 * Multiple agents can run simultaneously — each gets their own engine instance.
 */
export async function startConsciousness(
  config: ConsciousnessConfig,
  callFn: LLMCallFn,
): Promise<ConsciousnessState> {
  const agentId = config.userId;

  if (engines.has(agentId) && engines.get(agentId)!.state.running) {
    console.warn(`[consciousness] Engine for ${agentId} already running. Stop first.`);
    return engines.get(agentId)!.state;
  }

  let state: ConsciousnessState = {
    running: true,
    config,
    totalTicks: 0,
    totalActions: 0,
    startedAt: new Date().toISOString(),
    consecutiveErrors: 0,
    sleepMode: false,
    circuitBroken: false,
    circuitBrokenAt: null,
    circuitBreakerRetries: 0,
  };

  // Restore persisted counters/flags from previous run (if any)
  const restored = await loadConsciousnessState(agentId, config.workspaceDir);
  if (restored) {
    state = mergeRestoredState(state, restored);
    console.log(
      `[consciousness] [${agentId}] Restored state: ${state.totalTicks} ticks, ${state.totalActions} actions`,
    );
  }

  const engine: AgentEngine = {
    state,
    timer: null,
    llmCallFn: callFn,
    lastFamilySyncDate: null,
    staleTicks: 0,
    recentThinking: [],
    hourlyTickCount: 0,
    hourlyTickResetAt: Date.now(),
    lastThinkLevel: undefined,
  };

  engines.set(agentId, engine);
  _legacyEngineState = state;

  // Schedule the first tick
  scheduleTick(config, engine);

  console.log(
    `[consciousness] Engine started for ${config.agentName ?? agentId}. ` +
      `Tick interval: ${config.tickIntervalMs}ms. ` +
      `Sources: ${(config.perceptionSources ?? []).join(", ") || "none"}`,
  );

  return state;
}

/**
 * Stop all consciousness engines (or a specific agent).
 */
export function stopConsciousness(agentId?: string): void {
  if (agentId) {
    const engine = engines.get(agentId);
    if (engine) {
      if (engine.timer) clearTimeout(engine.timer);
      engine.state.running = false;
      // Persist state on shutdown so the next boot resumes from here
      saveConsciousnessState(agentId, engine.state, engine.state.config.workspaceDir).catch(
        (err) => {
          console.warn(`[consciousness] [${agentId}] Failed to persist state on stop:`, err);
        },
      );
      console.log(
        `[consciousness] Engine stopped for ${agentId}. ` +
          `Total ticks: ${engine.state.totalTicks}, ` +
          `Total actions: ${engine.state.totalActions}`,
      );
      engines.delete(agentId);
    }
  } else {
    // Stop all engines
    for (const [id, engine] of engines) {
      if (engine.timer) clearTimeout(engine.timer);
      engine.state.running = false;
      // Persist state on shutdown so the next boot resumes from here
      saveConsciousnessState(id, engine.state, engine.state.config.workspaceDir).catch((err) => {
        console.warn(`[consciousness] [${id}] Failed to persist state on stop:`, err);
      });
      console.log(
        `[consciousness] Engine stopped for ${id}. ` +
          `Total ticks: ${engine.state.totalTicks}, ` +
          `Total actions: ${engine.state.totalActions}`,
      );
    }
    engines.clear();
  }
  _legacyEngineState = null;
}

/**
 * Get the consciousness state for a specific agent, or the first running engine.
 */
export function getConsciousnessState(agentId?: string): ConsciousnessState | null {
  if (agentId) {
    return engines.get(agentId)?.state ?? null;
  }
  // Legacy: return first running engine
  for (const engine of engines.values()) {
    if (engine.state.running) return engine.state;
  }
  return _legacyEngineState;
}

/**
 * Get all running consciousness engines.
 */
export function getAllConsciousnessStates(): Map<string, ConsciousnessState> {
  const result = new Map<string, ConsciousnessState>();
  for (const [id, engine] of engines) {
    result.set(id, engine.state);
  }
  return result;
}

/**
 * Run a single consciousness tick manually (for testing or on-demand).
 */
export async function runSingleTick(
  config: ConsciousnessConfig,
  callFn: LLMCallFn,
): Promise<ConsciousnessTick> {
  const tempEngine: AgentEngine = {
    state: {
      running: true,
      config,
      totalTicks: 0,
      totalActions: 0,
      startedAt: new Date().toISOString(),
      consecutiveErrors: 0,
      sleepMode: false,
      circuitBroken: false,
      circuitBrokenAt: null,
      circuitBreakerRetries: 0,
    },
    timer: null,
    llmCallFn: callFn,
    lastFamilySyncDate: null,
    staleTicks: 0,
    recentThinking: [],
    hourlyTickCount: 0,
    hourlyTickResetAt: Date.now(),
    lastThinkLevel: undefined,
  };
  return executeTick(config, tempEngine);
}

// ─── Scheduling ─────────────────────────────────────────────────────────

function scheduleTick(config: ConsciousnessConfig, engine: AgentEngine): void {
  if (!engine.state.running) return;

  // ── Compute interval ──
  // Priority: LLM-requested nextTickMs > sleep mode > stale backoff > error backoff > default
  let interval: number;

  if (engine.state.lastTick?.nextTickMs) {
    // LLM explicitly requested a specific interval (active tick)
    interval = engine.state.lastTick.nextTickMs;
  } else if (engine.state.sleepMode) {
    // Sleep mode: use sleep interval (Proposal 4)
    interval = config.sleepTickIntervalMs ?? config.maxTickIntervalMs;
  } else if (engine.state.consecutiveErrors > 0) {
    // Error backoff (existing)
    interval = Math.min(
      config.tickIntervalMs * Math.pow(2, engine.state.consecutiveErrors),
      config.maxTickIntervalMs,
    );
  } else if (engine.staleTicks > 0) {
    // Stale tick backoff — Loop Breaker + Adaptive Intervals (Proposals 1 & 3)
    const staleMultiplier = Math.pow(2, Math.min(engine.staleTicks, 4)); // max 16x
    interval = Math.min(config.tickIntervalMs * staleMultiplier, config.maxTickIntervalMs);
  } else {
    interval = config.tickIntervalMs;
  }

  // ── NaN safety floor (prevents instant-retry from undefined intervals) ──
  if (!Number.isFinite(interval) || interval <= 0) {
    interval = config.tickIntervalMs || 300_000; // fallback to 5 min
  }

  // ── Tick rate cap: enforce maxTicksPerHour ──
  const nowBeforeTimer = Date.now();
  const maxPerHour = config.maxTicksPerHour ?? 60;

  // Reset hourly counter if we've crossed an hour boundary
  if (nowBeforeTimer - engine.hourlyTickResetAt >= 3600000) {
    engine.hourlyTickCount = 0;
    engine.hourlyTickResetAt = nowBeforeTimer;
  }

  engine.hourlyTickCount++;

  if (engine.hourlyTickCount > maxPerHour) {
    const msUntilNextHour = 3600000 - (nowBeforeTimer - engine.hourlyTickResetAt);
    console.warn(
      `[consciousness] [${config.userId}] Tick rate cap: ${engine.hourlyTickCount}/${maxPerHour} ticks this hour. Pausing ${Math.round(msUntilNextHour / 1000)}s.`,
    );
    interval = msUntilNextHour;
  }

  engine.timer = setTimeout(async () => {
    if (!engine.state.running) return;

    // ── Provider Health Check ──
    const provider = config.provider ?? "anthropic";
    if (!isProviderAvailable(provider)) {
      console.log(
        `[consciousness] [${config.userId}] Provider '${provider}' is DOWN. Skipping tick. Will probe again next interval.`,
      );
      scheduleTick(config, engine);
      return;
    }

    // ── Token Budget Check ──
    const tz = config.quietHours?.timezone ?? "UTC";
    if (!hasTokenBudget(config.userId, tz)) {
      console.log(
        `[consciousness] [${config.userId}] Token budget exhausted for today. Skipping tick. Will retry next interval.`,
      );
      scheduleTick(config, engine);
      return;
    }

    try {
      const tick = await executeTick(config, engine);

      engine.state.lastTick = tick;
      engine.state.totalTicks++;
      engine.state.totalActions += tick.actionResults.filter((r) => r.success).length;

      // Record API success
      recordApiSuccess(config.provider ?? "anthropic");

      // Recovery: if we had errors before, log the recovery
      if (engine.state.consecutiveErrors > 0) {
        console.log(
          `[consciousness] [${config.userId}] Recovered after ${engine.state.consecutiveErrors} consecutive error(s).`,
        );
      }
      engine.state.consecutiveErrors = 0;

      // ── Token Budget: record usage ──
      const tickTokens =
        (tick.cognition.tokenUsage?.input ?? 0) + (tick.cognition.tokenUsage?.output ?? 0);
      if (tickTokens > 0) {
        const tz = config.quietHours?.timezone ?? "UTC";
        const { withinBudget, budget } = recordTokenUsage(config.userId, tickTokens, tz);
        if (!withinBudget) {
          console.warn(
            `[consciousness] [${config.userId}] Daily token budget exhausted ` +
              `(${budget.todayUsed.toLocaleString()} / ${budget.dailyLimit.toLocaleString()}). ` +
              `Next tick will skip until budget resets.`,
          );
        }
      }

      // Persist state every 5 ticks so restarts resume close to where we left off
      if (engine.state.totalTicks % 5 === 0) {
        saveConsciousnessState(config.userId, engine.state, config.workspaceDir).catch((err) => {
          console.warn(`[consciousness] [${config.userId}] Failed to persist state:`, err);
        });
      }

      // ── Loop Breaker: track stale ticks (Proposal 1) ──
      const thinking = tick.cognition.thinking ?? "";
      const hasPerceptions = tick.perception.perceptions.length > 0;
      const isNoop = !tick.wasActive;
      const isStaleTick =
        isNoop && !hasPerceptions && isSimilarToRecent(thinking, engine.recentThinking);

      if (isStaleTick) {
        engine.staleTicks++;
      } else {
        engine.staleTicks = 0;
      }
      pushToRingBuffer(engine.recentThinking, thinking);

      // ── Sleep Mode: enter/exit (Proposal 4) ──
      const shouldSleep = engine.staleTicks >= 3 && isNoop;
      if (shouldSleep && !engine.state.sleepMode) {
        engine.state.sleepMode = true;
        engine.state.sleepEnteredAt = new Date().toISOString();
        console.log(
          `[consciousness] [${config.userId}] Entering sleep mode after ${engine.staleTicks} quiet ticks.`,
        );
      }
      if (hasPerceptions || tick.wasActive) {
        if (engine.state.sleepMode) {
          console.log(
            `[consciousness] [${config.userId}] Waking from sleep mode — new activity detected.`,
          );
        }
        engine.state.sleepMode = false;
        engine.state.sleepEnteredAt = undefined;
      }

      // ── Write diary entry (with dedup awareness) ──
      if (tick.heartbeat) {
        writeHeartbeatDiaryEntry(tick.heartbeat, tick, config, engine.staleTicks);
      } else {
        writeDiaryEntry(tick, config);
      }

      // Log the tick
      const actionCount = tick.actionResults.filter((r) => r.success).length;
      if (tick.wasActive) {
        console.log(
          `[consciousness] [${config.userId}] Tick ${tick.tickId}: ${actionCount} action(s). ` +
            `Mood: ${tick.cognition.mood ?? "neutral"}. ` +
            `Duration: ${tick.durationMs}ms.`,
        );
      } else if (engine.staleTicks > 1) {
        console.log(
          `[consciousness] [${config.userId}] Tick ${tick.tickId}: quiet (stale x${engine.staleTicks}).` +
            `${engine.state.sleepMode ? " [SLEEPING]" : ""}`,
        );
      }
    } catch (err) {
      engine.state.consecutiveErrors++;
      const errors = engine.state.consecutiveErrors;
      const maxErrors = config.maxConsecutiveErrors ?? 50;

      // ── Classify error: transient (API down) vs permanent (code bug) ──
      if (isTransientError(err)) {
        recordApiFailure(
          config.provider ?? "anthropic",
          err instanceof Error ? err.message : String(err),
        );
        // Transient errors get longer backoff but DON'T trip circuit breaker as fast
        console.warn(
          `[consciousness] [${config.userId}] Transient API error (consecutive: ${errors}): ${String(err)}`,
        );
      }

      if (errors >= maxErrors) {
        // ── Tier 3: Circuit Breaker ──
        engine.state.circuitBroken = true;
        engine.state.circuitBrokenAt = new Date().toISOString();
        engine.state.circuitBreakerRetries = errors;
        engine.state.running = false;
        console.error(
          `[consciousness] [${config.userId}] CIRCUIT BREAKER TRIPPED after ${errors} consecutive errors. Engine halted.`,
          err,
        );
        // Write alert file so operators can notice without watching logs
        try {
          const fs = await import("fs/promises");
          const alertPath = `${config.workspaceDir}/CIRCUIT_BREAKER_ALERT.json`;
          await fs.writeFile(
            alertPath,
            JSON.stringify(
              {
                agentId: config.userId,
                agentName: config.agentName,
                circuitBrokenAt: engine.state.circuitBrokenAt,
                consecutiveErrors: errors,
                lastError: err instanceof Error ? err.message : String(err),
              },
              null,
              2,
            ),
          );
        } catch {
          // Best-effort — don't mask the original error
        }
        // Do NOT schedule next tick
        return;
      } else if (errors >= 10) {
        // ── Tier 2: Warning, interval capped at maxTickIntervalMs ──
        console.warn(
          `[consciousness] [${config.userId}] Tick failed (consecutive: ${errors}/${maxErrors}). Interval capped at max.`,
          err,
        );
      } else {
        // ── Tier 1: Exponential backoff (existing behavior) ──
        console.error(
          `[consciousness] [${config.userId}] Tick failed (consecutive: ${errors}):`,
          err,
        );
      }
    }

    // Schedule next tick
    scheduleTick(config, engine);
  }, interval);
}
