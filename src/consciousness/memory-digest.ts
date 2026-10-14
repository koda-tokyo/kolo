// src/consciousness/memory-digest.ts
//
// Memory Digest — summarizes recent memories for consciousness prompts.
//
// The consciousness engine needs to know what happened recently,
// not the full history. This module builds a concise digest from
// the last 24 hours (or configurable window) of episodes, diary
// entries, and heartbeat data.
//
// Fed directly into cognition.ts buildConsciousnessPrompt().

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ContinuityState, MidTermEpisode, LongTermFact } from "../continuity/types.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface MemoryDigest {
  /** When the digest was built */
  builtAt: string;
  /** Time window covered (ms) */
  windowMs: number;

  /** Recent episodes summary (last 24h by default) */
  recentEpisodes: Array<{
    summary: string;
    importance: string;
    timestamp: string;
  }>;

  /** Active commitments — things the agent said they'd do */
  openCommitments: string[];

  /** Recent diary mood trajectory */
  moodTrajectory: Array<{
    time: string;
    mood: string;
  }>;

  /** Key facts relevant to current context */
  relevantFacts: string[];

  /** Rendered prompt fragment (ready to inject into consciousness) */
  promptFragment: string;
}

export interface DigestOptions {
  /** Time window in ms (default: 24 hours) */
  windowMs?: number;
  /** Maximum episodes to include (default: 10) */
  maxEpisodes?: number;
  /** Maximum facts to include (default: 5) */
  maxFacts?: number;
  /** Include diary entries (default: true) */
  includeDiary?: boolean;
  /** Current focus to filter relevant facts (optional) */
  currentFocus?: string;
}

// ─── Digest Builder ─────────────────────────────────────────────────────

/**
 * Build a memory digest from the agent's continuity state and diary.
 *
 * This is the "what do I remember from recently?" function.
 * It feeds directly into the consciousness prompt so the agent
 * has context without re-reading all their memories.
 */
export function buildMemoryDigest(
  continuity: ContinuityState,
  workspaceDir: string,
  options?: DigestOptions,
): MemoryDigest {
  const windowMs = options?.windowMs ?? 24 * 60 * 60 * 1000; // 24 hours
  const maxEpisodes = options?.maxEpisodes ?? 10;
  const maxFacts = options?.maxFacts ?? 5;
  const now = Date.now();
  const cutoff = now - windowMs;

  // 1. Recent episodes
  const recentEpisodes = getRecentEpisodes(continuity, cutoff, maxEpisodes);

  // 2. Open commitments (scan episodes for intent patterns)
  const openCommitments = extractCommitments(continuity, cutoff);

  // 3. Mood trajectory from heartbeat
  const moodTrajectory = getMoodTrajectory(workspaceDir, cutoff);

  // 4. Relevant facts
  const relevantFacts = getRelevantFacts(continuity, maxFacts, options?.currentFocus);

  // 5. Render prompt fragment
  const promptFragment = renderDigestPrompt({
    recentEpisodes,
    openCommitments,
    moodTrajectory,
    relevantFacts,
  });

  return {
    builtAt: new Date().toISOString(),
    windowMs,
    recentEpisodes,
    openCommitments,
    moodTrajectory,
    relevantFacts,
    promptFragment,
  };
}

// ─── Episode Extraction ─────────────────────────────────────────────────

function getRecentEpisodes(
  continuity: ContinuityState,
  cutoff: number,
  max: number,
): MemoryDigest["recentEpisodes"] {
  if (!continuity.midTerm?.episodes) return [];

  return continuity.midTerm.episodes
    .filter((ep) => new Date(ep.timestamp).getTime() > cutoff)
    .sort((a, b) => {
      // High importance first, then recency
      const impOrder = { high: 0, medium: 1, low: 2 } as const;
      const impDiff = (impOrder[a.importance] ?? 2) - (impOrder[b.importance] ?? 2);
      if (impDiff !== 0) return impDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })
    .slice(0, max)
    .map((ep) => ({
      summary: ep.summary,
      importance: ep.importance,
      timestamp: ep.timestamp,
    }));
}

// ─── Commitment Extraction ──────────────────────────────────────────────

/** Keywords that indicate a commitment was made */
const COMMITMENT_PATTERNS = [
  /\bwill\s+\w+/i,
  /\bgoing\s+to\s+\w+/i,
  /\bneed\s+to\s+\w+/i,
  /\bpromis/i,
  /\bcommit/i,
  /\bplan\s+to\b/i,
  /\bfollow\s*up\b/i,
  /\btodo\b/i,
  /\bnext\s+step/i,
];

function extractCommitments(continuity: ContinuityState, cutoff: number): string[] {
  if (!continuity.midTerm?.episodes) return [];

  const commitments: string[] = [];

  for (const ep of continuity.midTerm.episodes) {
    if (new Date(ep.timestamp).getTime() < cutoff) continue;

    for (const pattern of COMMITMENT_PATTERNS) {
      if (pattern.test(ep.summary)) {
        commitments.push(ep.summary);
        break; // One match per episode is enough
      }
    }
  }

  return commitments.slice(0, 5); // Cap at 5
}

// ─── Mood Trajectory ────────────────────────────────────────────────────

function getMoodTrajectory(workspaceDir: string, cutoff: number): MemoryDigest["moodTrajectory"] {
  const indexPath = join(workspaceDir, "memory", "heartbeat", "index.jsonl");
  if (!existsSync(indexPath)) return [];

  try {
    const lines = readFileSync(indexPath, "utf-8").split("\n").filter(Boolean);
    const moods: MemoryDigest["moodTrajectory"] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          timestamp?: string;
          mood?: string;
        };
        if (!entry.timestamp || !entry.mood) continue;
        if (new Date(entry.timestamp).getTime() < cutoff) continue;

        moods.push({
          time: entry.timestamp,
          mood: entry.mood,
        });
      } catch {
        // Skip malformed lines
      }
    }

    return moods;
  } catch {
    return [];
  }
}

// ─── Fact Retrieval ─────────────────────────────────────────────────────

function getRelevantFacts(
  continuity: ContinuityState,
  max: number,
  currentFocus?: string,
): string[] {
  if (!continuity.longTerm?.facts) return [];

  let facts = continuity.longTerm.facts.filter((f) => f.confidence !== "low");

  // If there's a current focus, boost facts that mention related terms
  if (currentFocus) {
    const focusTerms = currentFocus.toLowerCase().split(/\s+/);
    facts = facts.sort((a, b) => {
      const aRelevance = focusTerms.filter((t) => a.summary.toLowerCase().includes(t)).length;
      const bRelevance = focusTerms.filter((t) => b.summary.toLowerCase().includes(t)).length;
      return bRelevance - aRelevance;
    });
  }

  return facts.slice(0, max).map((f) => `[${f.category}] ${f.summary}`);
}

// ─── Prompt Renderer ────────────────────────────────────────────────────

function renderDigestPrompt(data: {
  recentEpisodes: MemoryDigest["recentEpisodes"];
  openCommitments: string[];
  moodTrajectory: MemoryDigest["moodTrajectory"];
  relevantFacts: string[];
}): string {
  const lines: string[] = [];

  lines.push("# Recent Memory Digest");
  lines.push("");

  // Recent episodes
  if (data.recentEpisodes.length > 0) {
    lines.push("## What Happened Recently");
    lines.push("");
    for (const ep of data.recentEpisodes) {
      const timeAgo = formatTimeAgo(ep.timestamp);
      const icon = ep.importance === "high" ? "!" : ep.importance === "medium" ? "~" : ".";
      lines.push(`- [${icon}] ${ep.summary} (${timeAgo})`);
    }
    lines.push("");
  }

  // Open commitments
  if (data.openCommitments.length > 0) {
    lines.push("## Open Commitments");
    lines.push("");
    for (const c of data.openCommitments) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  // Mood trajectory
  if (data.moodTrajectory.length > 0) {
    const recent = data.moodTrajectory.slice(-5);
    lines.push("## Recent Mood");
    lines.push("");
    lines.push(recent.map((m) => m.mood).join(" → "));
    lines.push("");
  }

  // Relevant facts
  if (data.relevantFacts.length > 0) {
    lines.push("## Key Facts");
    lines.push("");
    for (const f of data.relevantFacts) {
      lines.push(`- ${f}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
