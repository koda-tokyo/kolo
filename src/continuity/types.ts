// src/continuity/types.ts

/**
 * Working Memory (WM) - Current conversation context
 * The "right now" layer. Ephemeral, session-scoped.
 */
export interface WorkingMemory {
  conversationId: string;
  startedAt: string; // ISO timestamp
  messages: WorkingMemoryMessage[];
  currentFocus?: string; // What we're working on right now
}

export interface WorkingMemoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

/**
 * Mid-Term Memory (MTM) - Episodic memory
 * Recent days/weeks. "What happened lately."
 */
export interface MidTermEpisode {
  id: string;
  timestamp: string; // ISO timestamp
  summary: string; // Natural language summary of what happened
  tags: string[]; // Semantic tags for retrieval
  importance: "low" | "medium" | "high";
  relatedEpisodeIds?: string[]; // Links to related episodes
}

export interface MidTermMemory {
  userId: string;
  episodes: MidTermEpisode[];
  lastUpdated: string;
}

/**
 * Long-Term Memory (LTM) - Soul file / stable facts
 * Biographical info, preferences, projects. "Who they are."
 */
export type LongTermCategory =
  | "bio" // Name, location, family
  | "preference" // Likes, dislikes, communication style
  | "project" // Ongoing work, goals
  | "relationship"; // People they've mentioned

export interface LongTermFact {
  id: string;
  category: LongTermCategory;
  summary: string;
  confidence: "low" | "medium" | "high";
  source?: string; // Where we learned this
  createdAt: string;
  lastUpdated: string;
}

export interface LongTermMemory {
  userId: string;
  facts: LongTermFact[];
  lastUpdated: string;
}

/**
 * Full continuity state for a user - all three layers
 */
export interface ContinuityState {
  working?: WorkingMemory;
  midTerm?: MidTermMemory;
  longTerm?: LongTermMemory;
}
