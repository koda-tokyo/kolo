// src/engine/types.ts

/**
 * KoLo Engine Profile System
 *
 * Defines the metadata and compliance flags for LLM engines
 * that KoLo can use. Supports multi-engine architecture with
 * compliance controls for Japanese enterprise/medical use.
 *
 */

/**
 * How quickly the engine typically responds.
 * Used for UX decisions (show spinner vs instant).
 */
export type LatencyClass = "fast" | "standard" | "slow";

/**
 * Risk level for data leaving the user's jurisdiction.
 * Critical for Japanese compliance requirements.
 */
export type DataSovereigntyRisk = "low" | "medium" | "high";

/**
 * Engine capability flags for feature gating.
 */
export interface EngineCapabilities {
  /** Supports multi-turn conversation with context */
  chat: boolean;
  /** Supports tool/function calling */
  toolUse: boolean;
  /** Supports image input (vision) */
  vision: boolean;
  /** Supports code generation with high quality */
  coding: boolean;
  /** Designed for agentic workflows */
  agentic: boolean;
  /** Supports streaming responses */
  streaming: boolean;
}

/**
 * Compliance flags for engine selection in different contexts.
 */
export interface ComplianceFlags {
  /**
   * Safe for general family/consumer use globally.
   * No content or privacy concerns for home users.
   */
  familyApproved: boolean;

  /**
   * Meets Japanese enterprise compliance requirements.
   * Data residency, logging, and regulatory requirements.
   * false = cannot be used in "Japan Compliance Mode".
   */
  japanCompliant: boolean;

  /**
   * Optimized for CJK languages (Chinese, Japanese, Korean).
   * Shows "Recommended for Japanese" badge in UI when true.
   */
  cjkOptimized: boolean;

  /**
   * Risk level for data sovereignty concerns.
   * "high" = data may be processed in regions that concern
   * Japanese enterprises (e.g., mainland China).
   */
  dataSovereigntyRisk: DataSovereigntyRisk;
}

/**
 * Pricing information per million tokens.
 * All values in USD.
 */
export interface EnginePricing {
  inputPerMToken: number;
  outputPerMToken: number;
  /** Optional note about pricing tiers or conditions */
  note?: string;
}

/**
 * Full profile for an LLM engine in KoLo's registry.
 */
export interface EngineProfile {
  /** Unique identifier (e.g., "kimi-k2.5", "gpt-4o", "claude-sonnet") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Provider company */
  provider: string;

  /** Provider's model identifier for API calls */
  modelId: string;

  /** API endpoint base URL */
  apiEndpoint: string;

  /** Version or release date */
  version?: string;

  /** Maximum context window in tokens */
  contextWindow: number;

  /** Response speed classification */
  latencyClass: LatencyClass;

  /** Pricing per million tokens */
  pricing: EnginePricing;

  /** What this engine can do */
  capabilities: EngineCapabilities;

  /** Compliance and safety flags */
  compliance: ComplianceFlags;

  /**
   * UI note shown in engine selector.
   * E.g., "Excellent for Japanese / CJK. May not be suitable
   * for regulated Japanese enterprise use."
   */
  uiNote?: string;

  /** Badge text for UI (e.g., "JP 推奨", "Enterprise") */
  badge?: string;

  /** Whether this engine is currently active/available */
  active: boolean;

  /** Priority for fallback ordering (lower = try first) */
  fallbackPriority: number;
}

/**
 * Criteria for filtering engines in the registry.
 */
export interface EngineFilterCriteria {
  /** Only include engines approved for family use */
  familyApproved?: boolean;

  /** Only include Japan-compliant engines */
  japanCompliant?: boolean;

  /** Only include CJK-optimized engines */
  cjkOptimized?: boolean;

  /** Maximum acceptable data sovereignty risk */
  maxDataSovereigntyRisk?: DataSovereigntyRisk;

  /** Required capabilities */
  requiredCapabilities?: Partial<EngineCapabilities>;

  /** Only active engines */
  activeOnly?: boolean;
}

/**
 * Result of engine selection with reasoning.
 */
export interface EngineSelectionResult {
  /** Selected engine */
  engine: EngineProfile;

  /** Why this engine was selected */
  reason: string;

  /** Fallback engines if primary fails */
  fallbacks: EngineProfile[];
}
