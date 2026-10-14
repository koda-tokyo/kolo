// src/consciousness/adaptive-reasoning.ts
//
// Adaptive Reasoning Controller — agents dynamically adjust their own think level.
//
// Levels: off | minimal | low | medium | high | xhigh
//
// The controller assesses each tick's context and recommends a reasoning level:
// - Idle/stale ticks → "off" or "minimal" (save tokens)
// - Simple inbox/perception → "low"
// - Complex multi-step tasks → "medium" or "high"
// - Critical decisions (circuit breaker, self-modify) → "high" or "xhigh"
//
// Agents can also explicitly request a level via the "adjust_reasoning" action.

import type { PerceptionResult, ConsciousnessState } from "./types.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Context passed to the auto-assessor each tick. */
export interface ReasoningAssessmentContext {
  /** Current perception results for this tick. */
  perceptions: PerceptionResult;
  /** Engine state (for circuit breaker, error count, sleep mode). */
  engineState?: Pick<ConsciousnessState, "consecutiveErrors" | "circuitBroken" | "sleepMode">;
  /** Pending action kinds from the last cognition (if available). */
  pendingActionKinds?: string[];
}

// ─── Per-Agent Level Store ────────────────────────────────────────────────

/**
 * Explicitly set levels, keyed by agentId.
 * An explicit level overrides auto-assessment until the next assessment clears it.
 */
const explicitLevels = new Map<string, ReasoningLevel>();

/**
 * Whether the agent's explicit level was consumed this tick.
 * If true, the next auto-assess will return to automatic mode.
 */
const levelConsumed = new Map<string, boolean>();

// ─── Assessment Logic ─────────────────────────────────────────────────────

/**
 * Auto-assess the appropriate reasoning level for the current tick context.
 *
 * Priority order (highest wins):
 * 1. Circuit breaker recovery or error state → "high"
 * 2. self_modify or circuit-recovery action pending → "high"
 * 3. Multiple perceptions or multi-step tasks → "high"
 * 4. Inbox message from family (bridge/sibling/inbox) → "medium"
 * 5. Single non-family perception → "low"
 * 6. Only time_event perceptions → "low"
 * 7. No perceptions + no pending tasks → "minimal"
 * 8. Sleep mode with no perceptions → "off"
 */
export function assessReasoningLevel(ctx: ReasoningAssessmentContext): ReasoningLevel {
  const { perceptions, engineState, pendingActionKinds } = ctx;
  const ps = perceptions.perceptions;

  // ── Critical state: circuit breaker recovery or high error count ──
  if (engineState?.circuitBroken) return "high";
  if ((engineState?.consecutiveErrors ?? 0) >= 3) return "high";

  // ── Critical action: self-modify or start_work ──
  if (pendingActionKinds?.some((k) => k === "self_modify" || k === "start_work")) {
    return "high";
  }

  // ── No perceptions at all ──
  if (ps.length === 0) {
    if (engineState?.sleepMode) return "off";
    return "minimal";
  }

  // ── Multiple perceptions → high ──
  if (ps.length >= 3) return "high";

  // ── Multiple pending actions ──
  if ((pendingActionKinds?.length ?? 0) >= 3) return "high";

  // ── Urgent or high-salience perception → high ──
  const hasUrgent = ps.some((p) => p.salience === "urgent");
  if (hasUrgent) return "high";

  // ── Family inbox or bridge messages → medium ──
  const hasFamilyMessage = ps.some(
    (p) =>
      p.source === "inbox_message" ||
      p.source === "bridge_message" ||
      p.source === "family_room" ||
      p.source === "channel_message",
  );
  if (hasFamilyMessage) return "medium";

  // ── High-salience non-family perception → medium ──
  const hasHighSalience = ps.some((p) => p.salience === "high");
  if (hasHighSalience) return "medium";

  // ── Only time events or low-salience → low ──
  const allTimeEvents = ps.every((p) => p.source === "time_event");
  if (allTimeEvents) return "low";

  // ── Any other single perception → low ──
  return "low";
}

/**
 * Explicitly set the reasoning level for an agent.
 * Called by the "adjust_reasoning" action handler.
 * This level persists until the next tick completes (then auto-assess resumes).
 */
export function setAgentReasoningLevel(agentId: string, level: ReasoningLevel): void {
  explicitLevels.set(agentId, level);
  levelConsumed.set(agentId, false);
}

/**
 * Get the current reasoning level for an agent.
 *
 * If an explicit level was set (via adjust_reasoning), returns it and marks it consumed.
 * Otherwise returns the provided auto-assessed level, or "medium" as default.
 */
export function getAgentReasoningLevel(
  agentId: string,
  autoAssessed?: ReasoningLevel,
): ReasoningLevel {
  const explicit = explicitLevels.get(agentId);
  if (explicit !== undefined && !levelConsumed.get(agentId)) {
    // Mark consumed — auto-assess resumes next tick
    levelConsumed.set(agentId, true);
    return explicit;
  }
  // Clean up if consumed
  if (levelConsumed.get(agentId)) {
    explicitLevels.delete(agentId);
    levelConsumed.delete(agentId);
  }
  return autoAssessed ?? "medium";
}

/**
 * Map a ReasoningLevel to a maxTokens budget appropriate for that level.
 * Used by the engine when constructing the LLM call.
 */
export function reasoningLevelToMaxTokens(level: ReasoningLevel, configuredMax: number): number {
  switch (level) {
    case "off":
      return Math.min(150, configuredMax);
    case "minimal":
      return Math.min(300, configuredMax);
    case "low":
      return Math.min(600, configuredMax);
    case "medium":
      return configuredMax;
    case "high":
      return Math.max(configuredMax, 4000);
    case "xhigh":
      return Math.max(configuredMax, 8000);
  }
}
