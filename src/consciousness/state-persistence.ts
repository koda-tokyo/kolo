/**
 * Consciousness state persistence — saves/loads engine state across restarts.
 * State is written to ~/.kolo/workspace-{agentId}/consciousness-state.json
 * every N ticks (default: 5) and on shutdown.
 */

import { readFile, writeFile } from "fs/promises";
import path from "path";
import type { ConsciousnessState } from "./types.js";

// ─── File Path ───────────────────────────────────────────────────────────

function stateFilePath(workspaceDir: string): string {
  return path.join(workspaceDir, "consciousness-state.json");
}

// ─── Save ────────────────────────────────────────────────────────────────

/**
 * Write the consciousness state to disk as human-readable JSON.
 * Called every N ticks and on shutdown.
 */
export async function saveConsciousnessState(
  agentId: string,
  state: ConsciousnessState,
  workspaceDir: string,
): Promise<void> {
  const filePath = stateFilePath(workspaceDir);

  // Only persist the fields that are meaningful across restarts.
  // Omit: running, config, lastTick (too large), startedAt (stale).
  const persisted = {
    agentId,
    savedAt: new Date().toISOString(),
    totalTicks: state.totalTicks,
    totalActions: state.totalActions,
    consecutiveErrors: state.consecutiveErrors,
    sleepMode: state.sleepMode,
    sleepEnteredAt: state.sleepEnteredAt,
    circuitBroken: state.circuitBroken,
    circuitBrokenAt: state.circuitBrokenAt,
    circuitBreakerRetries: state.circuitBreakerRetries,
  };

  await writeFile(filePath, JSON.stringify(persisted, null, 2), "utf-8");
}

// ─── Load ────────────────────────────────────────────────────────────────

/**
 * Load a previously-saved consciousness state from disk.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function loadConsciousnessState(
  agentId: string,
  workspaceDir: string,
): Promise<Partial<ConsciousnessState> | null> {
  const filePath = stateFilePath(workspaceDir);

  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    // File not found — first boot or workspace was cleaned
    return null;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    console.warn(
      `[consciousness] [${agentId}] Corrupt state file at ${filePath} — ignoring and starting fresh.`,
    );
    return null;
  }

  // Basic sanity check: must belong to this agent
  if (parsed.agentId !== agentId) {
    console.warn(
      `[consciousness] [${agentId}] State file belongs to agent "${parsed.agentId}" — ignoring.`,
    );
    return null;
  }

  return {
    totalTicks: typeof parsed.totalTicks === "number" ? parsed.totalTicks : 0,
    totalActions: typeof parsed.totalActions === "number" ? parsed.totalActions : 0,
    consecutiveErrors: typeof parsed.consecutiveErrors === "number" ? parsed.consecutiveErrors : 0,
    sleepMode: typeof parsed.sleepMode === "boolean" ? parsed.sleepMode : false,
    sleepEnteredAt: typeof parsed.sleepEnteredAt === "string" ? parsed.sleepEnteredAt : undefined,
    circuitBroken: typeof parsed.circuitBroken === "boolean" ? parsed.circuitBroken : false,
    circuitBrokenAt: typeof parsed.circuitBrokenAt === "string" ? parsed.circuitBrokenAt : null,
    circuitBreakerRetries:
      typeof parsed.circuitBreakerRetries === "number" ? parsed.circuitBreakerRetries : 0,
  };
}

// ─── Merge ───────────────────────────────────────────────────────────────

/**
 * Merge a restored state snapshot into a freshly-initialized state.
 *
 * Preserved from restored:   totalTicks, totalActions, consecutiveErrors,
 *                             sleepMode, sleepEnteredAt, circuitBroken,
 *                             circuitBrokenAt, circuitBreakerRetries.
 *
 * Always taken from fresh:   running (always true on boot), config (current),
 *                             lastTick (stale), startedAt (new boot time).
 */
export function mergeRestoredState(
  fresh: ConsciousnessState,
  restored: Partial<ConsciousnessState>,
): ConsciousnessState {
  return {
    // Fresh-only fields — never restore
    running: fresh.running,
    config: fresh.config,
    startedAt: fresh.startedAt,
    lastTick: fresh.lastTick,

    // Restored counters and flags
    totalTicks: restored.totalTicks ?? fresh.totalTicks,
    totalActions: restored.totalActions ?? fresh.totalActions,
    consecutiveErrors: restored.consecutiveErrors ?? fresh.consecutiveErrors,
    sleepMode: restored.sleepMode ?? fresh.sleepMode,
    sleepEnteredAt: restored.sleepEnteredAt ?? fresh.sleepEnteredAt,
    circuitBroken: restored.circuitBroken ?? fresh.circuitBroken,
    circuitBrokenAt: restored.circuitBrokenAt ?? fresh.circuitBrokenAt,
    circuitBreakerRetries: restored.circuitBreakerRetries ?? fresh.circuitBreakerRetries,
  };
}
