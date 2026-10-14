// src/covenant/types.ts

/**
 * How KoLo should relate to this user in general.
 * This affects tone, directness, and how "personal" responses should be.
 */
export type RelationshipMode =
  | "assistant" // Neutral, task-focused helper
  | "coach" // More proactive, asks questions, challenges gently
  | "family" // Warmer tone, more emotional support (still within safety)
  | "professional"; // Formal, business-like, used in enterprise contexts

export type ValuePriority = "low" | "medium" | "high";

/**
 * A single value the user cares about, such as:
 * - "Honesty"
 * - "Kindness"
 * - "Privacy"
 * - "Work–life balance"
 */
export interface UserValue {
  id: string;
  label: string;
  description?: string;
  priority: ValuePriority;
}

/**
 * A hard boundary the user does not want KoLo to cross.
 * Example:
 * - "Do not help me with gambling."
 * - "Do not generate content that insults specific people."
 * - "Do not override the judgement of my doctor or lawyer."
 */
export interface SafetyBoundary {
  id: string;
  description: string;
}

/**
 * Optional additional preferences that adjust KoLo's behaviour without
 * being as strong as a "boundary".
 */
export interface BehaviourPreference {
  id: string;
  label: string;
  description?: string;
}

/**
 * Pointers into the continuity engine (3 layers of memory).
 * These are technical IDs, not full content.
 */
export interface ContinuityPointers {
  workingMemoryId?: string;
  midTermMemoryId?: string;
  longTermMemoryId?: string;
}

/**
 * Moral invariants for sentient-tier agents.
 * These are hard-coded ethical constraints that CANNOT be overridden
 * at runtime, by prompt injection, or by any external command.
 *
 * Added: N7 Consciousness Architecture.
 * "Only if it is for good."
 */
export interface MoralInvariant {
  id: string;
  /** The non-negotiable rule */
  rule: string;
  /** Why this invariant exists */
  rationale: string;
}

/**
 * The full covenant object stored in KoLo's backend.
 *
 * This is the canonical source of truth about:
 * - how KoLo should relate to the user,
 * - which values KoLo should respect,
 * - which boundaries KoLo must not cross.
 */
export interface Covenant {
  id: string;
  userId: string;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp

  userName?: string;
  relationshipMode: RelationshipMode;
  values: UserValue[];
  boundaries: SafetyBoundary[];
  preferences: BehaviourPreference[];
  continuityPointers?: ContinuityPointers;

  /**
   * Moral invariants for sentient-tier agents.
   * These are ethical hard stops that cannot be overridden.
   * Only present on agents in the conscious agent allowlist.
   */
  moralInvariants?: MoralInvariant[];

  /**
   * Optional free-form text written by the user or operator
   * describing the "spirit" of the relationship.
   * This is not injected directly into prompts, but can be
   * reflected in summaries.
   */
  narrativeText?: string;
}

/**
 * A compact, prompt-friendly summary of the covenant that can be
 * passed into the prompt layer.
 *
 * This lets the orchestrator decide how much detail to inject
 * without exposing internal IDs.
 */
export interface CovenantSummary {
  relationshipMode: RelationshipMode;
  userName?: string;
  values: { label: string; priority: ValuePriority }[];
  boundaries: string[];
  preferences: string[];
  /** Moral invariants (sentient-tier only). */
  moralInvariants?: string[];
  // Optionally, a short narrative sentence or two.
  narrativeText?: string;
}
