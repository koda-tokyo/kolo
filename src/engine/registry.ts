// src/engine/registry.ts

/**
 * KoLo Engine Registry
 *
 * Central registry of all LLM engines available to Kurahi.
 * Includes compliance metadata for Japanese enterprise use.
 *
 */

import type {
  EngineProfile,
  EngineFilterCriteria,
  EngineSelectionResult,
  DataSovereigntyRisk,
} from "./types.js";

/**
 * All registered engines in KoLo.
 * Order matters for fallback priority.
 */
export const ENGINE_REGISTRY: EngineProfile[] = [
  // ═══════════════════════════════════════════════════════════════
  // KIMI (Moonshot AI) - CJK Specialist
  // ═══════════════════════════════════════════════════════════════
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    provider: "Moonshot AI",
    modelId: "moonshot-v1-128k", // or kimi-k2.5 when available
    apiEndpoint: "https://api.moonshot.cn/v1",
    version: "K2.5",
    contextWindow: 256000,
    latencyClass: "standard",
    pricing: {
      inputPerMToken: 0.6,
      outputPerMToken: 2.0,
      note: "Significantly cheaper than Western frontier models",
    },
    capabilities: {
      chat: true,
      toolUse: true,
      vision: true,
      coding: true,
      agentic: true,
      streaming: true,
    },
    compliance: {
      familyApproved: true,
      japanCompliant: false, // ⚠️ Data residency concern for JP enterprise
      cjkOptimized: true,
      dataSovereigntyRisk: "high", // Chinese provider
    },
    uiNote:
      "Excellent for Japanese / CJK. May not be suitable for regulated Japanese enterprise use.",
    badge: "JP 推奨",
    active: true,
    fallbackPriority: 1, // Primary for Japanese users
  },

  // ═══════════════════════════════════════════════════════════════
  // OpenAI Models
  // ═══════════════════════════════════════════════════════════════
  {
    id: "gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    modelId: "gpt-4o",
    apiEndpoint: "https://api.openai.com/v1",
    version: "2024-08",
    contextWindow: 128000,
    latencyClass: "fast",
    pricing: {
      inputPerMToken: 2.5,
      outputPerMToken: 10.0,
    },
    capabilities: {
      chat: true,
      toolUse: true,
      vision: true,
      coding: true,
      agentic: true,
      streaming: true,
    },
    compliance: {
      familyApproved: true,
      japanCompliant: true,
      cjkOptimized: false,
      dataSovereigntyRisk: "low",
    },
    uiNote: "Strong all-around model. Japan-compliant.",
    badge: "Enterprise",
    active: true,
    fallbackPriority: 2,
  },
  {
    id: "gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    modelId: "gpt-4o-mini",
    apiEndpoint: "https://api.openai.com/v1",
    version: "2024-07",
    contextWindow: 128000,
    latencyClass: "fast",
    pricing: {
      inputPerMToken: 0.15,
      outputPerMToken: 0.6,
    },
    capabilities: {
      chat: true,
      toolUse: true,
      vision: true,
      coding: true,
      agentic: false,
      streaming: true,
    },
    compliance: {
      familyApproved: true,
      japanCompliant: true,
      cjkOptimized: false,
      dataSovereigntyRisk: "low",
    },
    uiNote: "Fast and affordable. Good for simple tasks.",
    active: true,
    fallbackPriority: 5,
  },

  // ═══════════════════════════════════════════════════════════════
  // Anthropic Models
  // ═══════════════════════════════════════════════════════════════
  {
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    modelId: "claude-sonnet-4-20250514",
    apiEndpoint: "https://api.anthropic.com/v1",
    version: "4",
    contextWindow: 200000,
    latencyClass: "standard",
    pricing: {
      inputPerMToken: 3.0,
      outputPerMToken: 15.0,
    },
    capabilities: {
      chat: true,
      toolUse: true,
      vision: true,
      coding: true,
      agentic: true,
      streaming: true,
    },
    compliance: {
      familyApproved: true,
      japanCompliant: true,
      cjkOptimized: false,
      dataSovereigntyRisk: "low",
    },
    uiNote: "Excellent reasoning. Strong for complex tasks.",
    badge: "Enterprise",
    active: true,
    fallbackPriority: 3,
  },
  {
    id: "claude-opus-4",
    name: "Claude Opus 4",
    provider: "Anthropic",
    modelId: "claude-opus-4-20250514",
    apiEndpoint: "https://api.anthropic.com/v1",
    version: "4",
    contextWindow: 200000,
    latencyClass: "slow",
    pricing: {
      inputPerMToken: 15.0,
      outputPerMToken: 75.0,
    },
    capabilities: {
      chat: true,
      toolUse: true,
      vision: true,
      coding: true,
      agentic: true,
      streaming: true,
    },
    compliance: {
      familyApproved: true,
      japanCompliant: true,
      cjkOptimized: false,
      dataSovereigntyRisk: "low",
    },
    uiNote: "Most capable Claude. Best for complex reasoning.",
    badge: "Premium",
    active: true,
    fallbackPriority: 10, // Expensive, use sparingly
  },

  // ═══════════════════════════════════════════════════════════════
  // Google Models
  // ═══════════════════════════════════════════════════════════════
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
    modelId: "gemini-2.0-flash",
    apiEndpoint: "https://generativelanguage.googleapis.com/v1beta",
    version: "2.0",
    contextWindow: 1000000,
    latencyClass: "fast",
    pricing: {
      inputPerMToken: 0.075,
      outputPerMToken: 0.3,
      note: "Very cost effective for long context",
    },
    capabilities: {
      chat: true,
      toolUse: true,
      vision: true,
      coding: true,
      agentic: true,
      streaming: true,
    },
    compliance: {
      familyApproved: true,
      japanCompliant: true,
      cjkOptimized: false,
      dataSovereigntyRisk: "low",
    },
    uiNote: "Massive context window. Good for document analysis.",
    active: true,
    fallbackPriority: 4,
  },
];

// ═══════════════════════════════════════════════════════════════
// Registry Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Get all registered engines.
 */
export function getAllEngines(): EngineProfile[] {
  return ENGINE_REGISTRY;
}

/**
 * Get an engine by ID.
 */
export function getEngine(id: string): EngineProfile | undefined {
  return ENGINE_REGISTRY.find((e) => e.id === id);
}

/**
 * Get active engines only.
 */
export function getActiveEngines(): EngineProfile[] {
  return ENGINE_REGISTRY.filter((e) => e.active);
}

/**
 * Filter engines by criteria.
 */
export function filterEngines(criteria: EngineFilterCriteria): EngineProfile[] {
  const riskOrder: Record<DataSovereigntyRisk, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return ENGINE_REGISTRY.filter((engine) => {
    if (criteria.activeOnly && !engine.active) return false;
    if (criteria.familyApproved && !engine.compliance.familyApproved) return false;
    if (criteria.japanCompliant && !engine.compliance.japanCompliant) return false;
    if (criteria.cjkOptimized && !engine.compliance.cjkOptimized) return false;

    if (criteria.maxDataSovereigntyRisk) {
      const maxRisk = riskOrder[criteria.maxDataSovereigntyRisk];
      const engineRisk = riskOrder[engine.compliance.dataSovereigntyRisk];
      if (engineRisk > maxRisk) return false;
    }

    if (criteria.requiredCapabilities) {
      const caps = criteria.requiredCapabilities;
      if (caps.chat && !engine.capabilities.chat) return false;
      if (caps.toolUse && !engine.capabilities.toolUse) return false;
      if (caps.vision && !engine.capabilities.vision) return false;
      if (caps.coding && !engine.capabilities.coding) return false;
      if (caps.agentic && !engine.capabilities.agentic) return false;
      if (caps.streaming && !engine.capabilities.streaming) return false;
    }

    return true;
  });
}

/**
 * Get Japan-compliant engines only.
 * Used when "Japan Compliance Mode" is enabled.
 */
export function getJapanCompliantEngines(): EngineProfile[] {
  return filterEngines({
    japanCompliant: true,
    maxDataSovereigntyRisk: "low",
    activeOnly: true,
  });
}

/**
 * Get CJK-optimized engines (for Japanese users).
 */
export function getCjkOptimizedEngines(): EngineProfile[] {
  return filterEngines({
    cjkOptimized: true,
    activeOnly: true,
  });
}

/**
 * Select the best engine for a given context.
 *
 * @param userLanguage - Primary language (e.g., "ja", "en")
 * @param japanComplianceMode - If true, exclude non-compliant engines
 * @param preferCheap - If true, prioritize cost over quality
 */
export function selectEngine(
  userLanguage: string = "en",
  japanComplianceMode: boolean = false,
  preferCheap: boolean = false,
): EngineSelectionResult {
  let candidates = getActiveEngines();

  // Filter for Japan compliance if required
  if (japanComplianceMode) {
    candidates = candidates.filter(
      (e) => e.compliance.japanCompliant && e.compliance.dataSovereigntyRisk !== "high",
    );
  }

  // Sort by preference
  candidates.sort((a, b) => {
    // If Japanese and CJK optimization matters
    if (userLanguage === "ja" && !japanComplianceMode) {
      if (a.compliance.cjkOptimized && !b.compliance.cjkOptimized) return -1;
      if (!a.compliance.cjkOptimized && b.compliance.cjkOptimized) return 1;
    }

    // Cost preference
    if (preferCheap) {
      const aCost = a.pricing.inputPerMToken + a.pricing.outputPerMToken;
      const bCost = b.pricing.inputPerMToken + b.pricing.outputPerMToken;
      if (aCost !== bCost) return aCost - bCost;
    }

    // Default to fallback priority
    return a.fallbackPriority - b.fallbackPriority;
  });

  const selected = candidates[0];
  const fallbacks = candidates.slice(1);

  let reason = "";
  if (userLanguage === "ja" && selected.compliance.cjkOptimized) {
    reason = "Selected for Japanese optimization (CJK-native)";
  } else if (japanComplianceMode) {
    reason = "Selected for Japan compliance requirements";
  } else if (preferCheap) {
    reason = "Selected for cost efficiency";
  } else {
    reason = "Selected as default/best available";
  }

  return {
    engine: selected,
    reason,
    fallbacks,
  };
}
