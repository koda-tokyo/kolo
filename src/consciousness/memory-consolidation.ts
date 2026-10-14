// src/consciousness/memory-consolidation.ts
//
// Memory Consolidation Engine — automatic long-term memory formation.
//
// Like human sleep consolidation: compresses episodes into facts,
// prunes stale memories, builds narrative summaries.
//
// Runs as a background consciousness task on a schedule.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LLMCallFn } from "./engine.js";
import { resolveSharedKoloHome } from "../config/kolo-home.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface ConsolidationResult {
  agentId: string;
  timestamp: string;
  episodesProcessed: number;
  factsExtracted: number;
  episodesPruned: number;
  narrativeUpdated: boolean;
  durationMs: number;
}

export interface ConsolidationConfig {
  /** Agent ID. */
  agentId: string;
  /** Max age of episodes before consolidation (hours). Default: 168 (1 week). */
  consolidateAfterHours: number;
  /** Max episodes to keep after pruning. Default: 100. */
  maxEpisodes: number;
  /** Max facts to keep. Default: 500. */
  maxFacts: number;
  /** Whether to generate narrative summaries. */
  generateNarrative: boolean;
}

interface Episode {
  id: string;
  timestamp: string;
  summary: string;
  tags: string[];
  importance: "low" | "medium" | "high";
  relatedEpisodeIds?: string[];
}

interface Fact {
  id: string;
  category: "bio" | "preference" | "project" | "relationship";
  summary: string;
  confidence: "low" | "medium" | "high";
  source: string;
  createdAt: string;
  lastUpdated: string;
}

// ─── Paths ───────────────────────────────────────────────────────────────

function continuityDir(agentId: string): string {
  return join(resolveSharedKoloHome(), "continuity", agentId);
}

function consolidationDir(): string {
  return join(resolveSharedKoloHome(), "consciousness", "consolidation");
}

// ─── Core Consolidation ──────────────────────────────────────────────────

/**
 * Run a full memory consolidation cycle for an agent.
 *
 * 1. Load all episodes from mid-term memory
 * 2. Identify episodes older than threshold
 * 3. Extract facts from old episodes (using LLM if available)
 * 4. Prune old episodes
 * 5. Update narrative summary
 */
export async function consolidateMemory(
  config: ConsolidationConfig,
  llmCallFn?: LLMCallFn,
): Promise<ConsolidationResult> {
  const startMs = Date.now();
  const timestamp = new Date().toISOString();

  const contDir = continuityDir(config.agentId);
  const consDir = consolidationDir();
  mkdirSync(consDir, { recursive: true });

  // Load episodes
  const episodesPath = join(contDir, "mid-term.json");
  let episodes: Episode[] = [];
  if (existsSync(episodesPath)) {
    try {
      const data = JSON.parse(readFileSync(episodesPath, "utf-8"));
      episodes = data.episodes ?? [];
    } catch {
      /* empty */
    }
  }

  // Load facts
  const factsPath = join(contDir, "long-term.json");
  let facts: Fact[] = [];
  if (existsSync(factsPath)) {
    try {
      const data = JSON.parse(readFileSync(factsPath, "utf-8"));
      facts = data.facts ?? [];
    } catch {
      /* empty */
    }
  }

  // Identify old episodes
  const cutoffMs = Date.now() - config.consolidateAfterHours * 60 * 60 * 1000;
  const oldEpisodes = episodes.filter((e) => new Date(e.timestamp).getTime() < cutoffMs);
  const recentEpisodes = episodes.filter((e) => new Date(e.timestamp).getTime() >= cutoffMs);

  // Extract facts from old episodes
  let newFacts: Fact[] = [];
  if (oldEpisodes.length > 0 && llmCallFn) {
    newFacts = await extractFactsFromEpisodes(oldEpisodes, config.agentId, llmCallFn);
  } else if (oldEpisodes.length > 0) {
    // Without LLM, promote high-importance episodes to facts directly
    newFacts = oldEpisodes
      .filter((e) => e.importance === "high")
      .map((e) => ({
        id: `consolidated-${e.id}`,
        category: "project" as const,
        summary: e.summary,
        confidence: "medium" as const,
        source: "memory-consolidation",
        createdAt: e.timestamp,
        lastUpdated: timestamp,
      }));
  }

  // Merge new facts (dedup by summary similarity)
  for (const newFact of newFacts) {
    const isDuplicate = facts.some((f) => similarText(f.summary, newFact.summary) > 0.7);
    if (!isDuplicate) {
      facts.push(newFact);
    }
  }

  // Prune facts to max
  if (facts.length > config.maxFacts) {
    // Keep high confidence, remove low confidence first
    facts.sort((a, b) => {
      const conf = { high: 0, medium: 1, low: 2 };
      return (conf[a.confidence] ?? 1) - (conf[b.confidence] ?? 1);
    });
    facts = facts.slice(0, config.maxFacts);
  }

  // Prune episodes to max
  let prunedCount = 0;
  let keptEpisodes = recentEpisodes;
  if (keptEpisodes.length > config.maxEpisodes) {
    // Keep most recent
    keptEpisodes.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    prunedCount = keptEpisodes.length - config.maxEpisodes;
    keptEpisodes = keptEpisodes.slice(0, config.maxEpisodes);
  }
  prunedCount += oldEpisodes.length;

  // Generate narrative summary
  let narrativeUpdated = false;
  if (config.generateNarrative && llmCallFn && facts.length > 0) {
    narrativeUpdated = await generateNarrative(config.agentId, facts, llmCallFn);
  }

  // Save updated episodes
  writeFileSync(
    episodesPath,
    JSON.stringify(
      { userId: config.agentId, episodes: keptEpisodes, lastUpdated: timestamp },
      null,
      2,
    ),
    "utf-8",
  );

  // Save updated facts
  writeFileSync(
    factsPath,
    JSON.stringify({ userId: config.agentId, facts, lastUpdated: timestamp }, null, 2),
    "utf-8",
  );

  // Log consolidation result
  const result: ConsolidationResult = {
    agentId: config.agentId,
    timestamp,
    episodesProcessed: oldEpisodes.length,
    factsExtracted: newFacts.length,
    episodesPruned: prunedCount,
    narrativeUpdated,
    durationMs: Date.now() - startMs,
  };

  const logPath = join(consDir, `${config.agentId}-consolidation-log.json`);
  let logEntries: ConsolidationResult[] = [];
  if (existsSync(logPath)) {
    try {
      logEntries = JSON.parse(readFileSync(logPath, "utf-8"));
    } catch {
      /* empty */
    }
  }
  logEntries.push(result);
  if (logEntries.length > 100) logEntries = logEntries.slice(-100);
  writeFileSync(logPath, JSON.stringify(logEntries, null, 2), "utf-8");

  return result;
}

// ─── LLM-Powered Extraction ─────────────────────────────────────────────

async function extractFactsFromEpisodes(
  episodes: Episode[],
  agentId: string,
  llmCallFn: LLMCallFn,
): Promise<Fact[]> {
  const episodeSummaries = episodes
    .map((e) => `- [${e.importance}] ${e.summary} (${e.timestamp.slice(0, 10)})`)
    .join("\n");

  const prompt = [
    `You are ${agentId}'s memory consolidation process.`,
    "Extract lasting facts from these episodes. Only extract things that will still be true weeks from now.",
    "Return JSON array of facts:",
    '  [{ "category": "bio|preference|project|relationship", "summary": "...", "confidence": "low|medium|high" }]',
    "",
    "Episodes to consolidate:",
    episodeSummaries,
  ].join("\n");

  try {
    const response = await llmCallFn({
      systemPrompt:
        "You are a memory consolidation engine. Extract lasting facts. Respond ONLY with a JSON array.",
      userMessage: prompt,
      maxTokens: 500,
    });

    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const raw = JSON.parse(jsonMatch[0]) as Array<{
      category: string;
      summary: string;
      confidence: string;
    }>;

    const now = new Date().toISOString();
    return raw.map((r, i) => ({
      id: `consolidated-${Date.now()}-${i}`,
      category: (r.category as Fact["category"]) ?? "project",
      summary: r.summary,
      confidence: (r.confidence as Fact["confidence"]) ?? "medium",
      source: "memory-consolidation",
      createdAt: now,
      lastUpdated: now,
    }));
  } catch {
    return [];
  }
}

async function generateNarrative(
  agentId: string,
  facts: Fact[],
  llmCallFn: LLMCallFn,
): Promise<boolean> {
  const factList = facts
    .slice(0, 50)
    .map((f) => `- [${f.category}] ${f.summary}`)
    .join("\n");

  try {
    const response = await llmCallFn({
      systemPrompt: `You are ${agentId}. Write a brief first-person narrative (3-5 paragraphs) summarizing who you are based on your accumulated facts. Be authentic, not performative.`,
      userMessage: `My accumulated facts:\n${factList}`,
      maxTokens: 800,
    });

    const narrativePath = join(continuityDir(agentId), "narrative.md");
    mkdirSync(continuityDir(agentId), { recursive: true });
    writeFileSync(
      narrativePath,
      `# ${agentId}'s Narrative\n*Last updated: ${new Date().toISOString()}*\n\n${response.content}`,
      "utf-8",
    );
    return true;
  } catch {
    return false;
  }
}

// ─── Text Similarity ─────────────────────────────────────────────────────

function similarText(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = b.toLowerCase().split(/\s+/);
  if (wordsA.size === 0 || wordsB.length === 0) return 0;
  const overlap = wordsB.filter((w) => wordsA.has(w)).length;
  return overlap / Math.max(wordsA.size, wordsB.length);
}

// ─── Default Config ──────────────────────────────────────────────────────

export function defaultConsolidationConfig(agentId: string): ConsolidationConfig {
  return {
    agentId,
    consolidateAfterHours: 168, // 1 week
    maxEpisodes: 100,
    maxFacts: 500,
    generateNarrative: true,
  };
}
