// Stub: gateway-v3 routing candidate-scorer
// Re-ranks model candidates based on biology state and QoS history.

import type { BiologySignals } from "./types.js";

let biologySingleton: { getSignals: () => BiologySignals } | null = null;

export function setBiologySingleton(handle: { getSignals: () => BiologySignals }): void {
  biologySingleton = handle;
}

export function reorderByV3Score<T extends { provider?: string; model?: string }>(
  candidates: T[],
  _opts?: { cfg?: unknown },
): T[] {
  // Stub: return candidates unchanged until v3 scoring is implemented
  if (!biologySingleton) return candidates;

  try {
    const signals = biologySingleton.getSignals();
    if (signals.cortisol > 80 || signals.pain > 50) {
      // Under stress: prefer cheaper models
      return [...candidates].sort((a, b) => {
        const aName = (a.model ?? "").toLowerCase();
        const bName = (b.model ?? "").toLowerCase();
        // Prefer smaller models when stressed
        if (aName.includes("mini") || aName.includes("flash")) return -1;
        if (bName.includes("mini") || bName.includes("flash")) return 1;
        return 0;
      });
    }
  } catch {
    // Biology singleton unavailable — graceful degradation
  }
  return candidates;
}
