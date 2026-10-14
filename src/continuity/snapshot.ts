// src/continuity/snapshot.ts

import type { ContinuitySnapshot } from "../covenant/summary.js";
import type { ContinuityState } from "./types.js";

/**
 * Build a prompt-friendly snapshot from the full continuity state.
 * This is what gets passed to summariseForSystem().
 */
export function buildContinuitySnapshot(
  state: ContinuityState,
  options?: {
    maxMidTermHighlights?: number;
    maxLongTermHighlights?: number;
  },
): ContinuitySnapshot {
  const maxMTM = options?.maxMidTermHighlights ?? 3;
  const maxLTM = options?.maxLongTermHighlights ?? 3;

  const snapshot: ContinuitySnapshot = {};

  // Working memory → single summary of current focus
  if (state.working?.currentFocus) {
    snapshot.workingSummary = state.working.currentFocus;
  }

  // Mid-term → recent high-importance episodes
  if (state.midTerm?.episodes.length) {
    const sorted = [...state.midTerm.episodes]
      .sort((a, b) => {
        // High importance first, then by recency
        const importanceOrder = { high: 0, medium: 1, low: 2 } as const;
        const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance];
        if (impDiff !== 0) return impDiff;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, maxMTM);

    snapshot.midTermHighlights = sorted.map((e) => e.summary);
  }

  // Long-term → stable facts by category
  if (state.longTerm?.facts.length) {
    const highConfidence = state.longTerm.facts
      .filter((f) => f.confidence !== "low")
      .slice(0, maxLTM);

    snapshot.longTermHighlights = highConfidence.map((f) => `[${f.category}] ${f.summary}`);
  }

  return snapshot;
}

/**
 * Create an empty continuity state for a new user.
 */
export function createEmptyContinuityState(userId: string): ContinuityState {
  const now = new Date().toISOString();
  return {
    working: undefined,
    midTerm: {
      userId,
      episodes: [],
      lastUpdated: now,
    },
    longTerm: {
      userId,
      facts: [],
      lastUpdated: now,
    },
  };
}
