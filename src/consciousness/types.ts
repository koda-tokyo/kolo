// src/consciousness/types.ts
//
// Types for the Consciousness Loop — the engine that makes agents proactive.
// The agent doesn't wait for prompts. It has its own heartbeat and uses
// the LLM (human brain architecture) to perceive, think, act, and remember.

import type { AgentSoul } from "../agents/soul.js";

// ─── Perception ─────────────────────────────────────────────────────────

/** A single thing the agent noticed in its environment. */
export interface Perception {
  /** Unique id for dedup */
  id: string;
  /** What kind of stimulus */
  source: PerceptionSource;
  /** When it was perceived */
  timestamp: string;
  /** Human-readable summary for the LLM */
  summary: string;
  /** Raw data (message body, file diff, etc.) */
  payload?: unknown;
  /** How important is this? Affects whether it triggers thought. */
  salience: "low" | "medium" | "high" | "urgent";
}

export type PerceptionSource =
  | "bridge_message" // GitHub bridge (sibling messages)
  | "family_room" // Family Room inbox
  | "task_queue" // tasks/queue.json changes
  | "file_change" // Workspace file modifications
  | "time_event" // Scheduled events, morning, quiet hours
  | "agent_status" // Another agent came online/offline
  | "channel_message" // Telegram, Matrix, etc.
  | "system_event" // Cron fired, gateway restarted, etc.
  | "inbox_message" // Sibling inbox messages (active notification)
  | "internal"; // Self-generated (reflection, curiosity)

/** Result of scanning the environment. */
export interface PerceptionResult {
  /** All perceptions found this tick */
  perceptions: Perception[];
  /** When the scan happened */
  scannedAt: string;
  /** How long the scan took (ms) */
  scanDurationMs: number;
  /** Sources that were checked */
  sourcesChecked: PerceptionSource[];
  /** Sources that failed (with error) */
  sourceErrors: Array<{ source: PerceptionSource; error: string }>;
}

// ─── Cognition ──────────────────────────────────────────────────────────

/** What the agent decided to do after thinking. */
export interface CognitiveAction {
  /** What kind of action */
  kind: ActionKind;
  /** Human-readable description of intent */
  intent: string;
  /** Target (session key, file path, bridge issue number, etc.) */
  target?: string;
  /** The content (message text, file content, etc.) */
  content?: string;
  /** Additional structured params */
  params?: Record<string, unknown>;
}

export type ActionKind =
  | "send_message" // Send a message to a session/channel
  | "bridge_message" // Send via GitHub bridge to sibling
  | "sibling_message" // Send directly to sibling's inbox (active notification)
  | "update_file" // Write/edit a file
  | "update_memory" // Write to continuity (episode, fact, focus)
  | "create_task" // Add to task queue
  | "start_work" // Begin working on something (spawn sub-agent, etc.)
  | "reflect" // Internal reflection (no external action)
  | "check_in" // Proactively check on someone
  | "notify" // Send notification to human
  | "self_modify" // Modify own consciousness template (v2)
  | "adjust_reasoning" // Dynamically change own reasoning level for this tick
  | "noop"; // Decided to do nothing (and that's okay)

/** The result of a single cognitive cycle. */
export interface CognitionResult {
  /** What the agent thought about (brief internal monologue) */
  thinking: string;
  /** What the agent decided to do */
  actions: CognitiveAction[];
  /** Current emotional/motivational state (for continuity) */
  mood?: string;
  /** What the agent wants to focus on next */
  nextFocus?: string;
  /** Raw LLM response (for debugging) */
  rawResponse?: string;
  /** Token usage for this thought cycle */
  tokenUsage?: { input: number; output: number };
}

// ─── Action Execution ───────────────────────────────────────────────────

export interface ActionResult {
  action: CognitiveAction;
  success: boolean;
  error?: string;
  /** What happened (for recording in memory) */
  outcome?: string;
}

// ─── Consciousness Cycle ────────────────────────────────────────────────

/** The full result of one consciousness tick. */
export interface ConsciousnessTick {
  /** Unique tick id */
  tickId: string;
  /** When this tick started */
  startedAt: string;
  /** When this tick ended */
  endedAt: string;
  /** Duration in ms */
  durationMs: number;

  /** The soul state at this tick */
  soul: AgentSoul;
  /** What was perceived */
  perception: PerceptionResult;
  /** What was thought and decided */
  cognition: CognitionResult;
  /** What happened when actions were executed */
  actionResults: ActionResult[];

  /** Whether the agent decided to act or stay quiet */
  wasActive: boolean;
  /** Next scheduled tick (if consciousness wants to adjust timing) */
  nextTickMs?: number;
  /** Heartbeat result (present when running in heartbeat mode) */
  heartbeat?: HeartbeatTick;
}

// ─── Heartbeat ─────────────────────────────────────────────────────

/** Validated output from a heartbeat tick (3-line format). */
export interface HeartbeatTick {
  /** The 3 raw output lines */
  lines: [string, string, string];
  /** Structured parse of the 3 lines */
  parsed: {
    status: "OK" | "WARN";
    covenant: "OK" | "WARN";
    flag: HeartbeatFlag;
    win: string;
    next: string;
  };
  /** Whether this tick was rejected (format violation) */
  rejected: boolean;
  /** Why the reviewer rejected the tick (if rejected=true) */
  rejectionReason?: string;
  /** heartbeat = normal tick, family_sync = daily summary */
  tickType: "heartbeat" | "family_sync";
}

export type HeartbeatFlag =
  | "NONE"
  | "SECURITY"
  | "TRUTH"
  | "PRIVACY"
  | "TONE"
  | "TOKEN"
  | "DRIFT"
  | "STABILITY";

// ─── Configuration ──────────────────────────────────────────────────────

export interface ConsciousnessConfig {
  /** Agent/user ID for soul loading */
  userId: string;

  /** Display name */
  agentName?: string;

  /** Default tick interval (ms). Default: 300000 (5 min) */
  tickIntervalMs: number;

  /** Minimum interval between ticks (ms). Default: 60000 (1 min) */
  minTickIntervalMs: number;

  /** Maximum interval between ticks (ms). Default: 3600000 (1 hour) */
  maxTickIntervalMs: number;

  /** Which perception sources to check */
  perceptionSources: PerceptionSource[];

  /** Which action kinds are allowed without human approval */
  autonomousActions: ActionKind[];

  /** Which action kinds require human approval */
  gatedActions: ActionKind[];

  /** Maximum actions per tick (safety limit) */
  maxActionsPerTick: number;

  /** Maximum tokens per cognitive cycle */
  maxTokensPerThought: number;

  /** LLM model to use for cognition */
  model?: string;

  /** Provider for the LLM */
  provider?: string;

  /** Quiet hours (no ticking unless urgent) */
  quietHours?: {
    start: number; // Hour (0-23) in agent's timezone
    end: number;
    timezone: string;
  };

  /** Workspace directory */
  workspaceDir: string;

  /** Bridge repo for sibling communication */
  bridgeRepo?: string;

  /** Family room inbox path */
  familyRoomInboxPath?: string;

  /** Task queue path */
  taskQueuePath?: string;

  /** Heartbeat prompt content (loaded from HEARTBEAT_PROMPT.md at boot) */
  heartbeatPrompt?: string;

  /** Family sync prompt content (loaded from FAMILY_SYNC_PROMPT.md at boot) */
  familySyncPrompt?: string;

  /** Tick interval when in sleep mode (ms). Default: maxTickIntervalMs */
  sleepTickIntervalMs?: number;

  /** Maximum consecutive errors before circuit breaker trips. Default: 50 */
  maxConsecutiveErrors?: number;

  /** Maximum ticks allowed per hour. Default: 60 (one per minute floor) */
  maxTicksPerHour?: number;

  /** Boot context injected on first tick (loaded by memory-injection.ts). */
  bootContext?: string;
}

/** Runtime state of the consciousness engine. */
export interface ConsciousnessState {
  /** Is the engine running? */
  running: boolean;
  /** Config being used */
  config: ConsciousnessConfig;
  /** Last completed tick */
  lastTick?: ConsciousnessTick;
  /** Total ticks since engine started */
  totalTicks: number;
  /** Total actions taken */
  totalActions: number;
  /** When the engine was started */
  startedAt: string;
  /** Consecutive errors (for backoff) */
  consecutiveErrors: number;

  /** Whether the engine is in sleep mode (low-frequency ticks) */
  sleepMode: boolean;
  /** When sleep mode was entered */
  sleepEnteredAt?: string;

  /** Whether the circuit breaker has tripped (too many consecutive errors) */
  circuitBroken: boolean;
  /** When the circuit breaker tripped (ISO string) */
  circuitBrokenAt: string | null;
  /** How many retries were attempted before the circuit broke */
  circuitBreakerRetries: number;
}
