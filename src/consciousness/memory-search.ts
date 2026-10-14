// src/consciousness/memory-search.ts
//
// Semantic Memory Search — TF-IDF Implementation
//
// Pure TypeScript. Zero external dependencies.
// Searches across episodes, facts, and diary entries using term frequency
// inverse document frequency (TF-IDF) scoring.
//
// Lightweight memory search: no vector store, no index service.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ContinuityState, MidTermEpisode, LongTermFact } from "../continuity/types.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface SearchDocument {
  /** Unique identifier */
  id: string;
  /** Source type */
  type: "episode" | "fact" | "diary" | "heartbeat";
  /** Searchable text content */
  text: string;
  /** When this was created/updated */
  timestamp: string;
  /** Original data reference */
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  /** The matched document */
  document: SearchDocument;
  /** TF-IDF relevance score (0-1 normalized) */
  score: number;
  /** Which query terms matched */
  matchedTerms: string[];
}

export interface SearchIndex {
  /** All indexed documents */
  documents: SearchDocument[];
  /** Term → document frequency (how many docs contain this term) */
  documentFrequency: Map<string, number>;
  /** Document ID → term frequency map */
  termFrequencies: Map<string, Map<string, number>>;
  /** Total number of documents */
  totalDocuments: number;
  /** When the index was last built */
  builtAt: string;
}

// ─── Tokenizer ──────────────────────────────────────────────────────────

/** Stop words to filter out (common English words that add noise) */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "out",
  "off",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "nor",
  "not",
  "only",
  "own",
  "same",
  "so",
  "than",
  "too",
  "very",
  "just",
  "but",
  "and",
  "or",
  "if",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "him",
  "his",
  "she",
  "her",
  "they",
  "them",
  "their",
  "what",
  "which",
  "who",
  "whom",
  "up",
  "about",
  "also",
]);

/**
 * Tokenize text into normalized terms.
 * Lowercases, removes punctuation, filters stop words, stems lightly.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ") // Remove punctuation except hyphens
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .map((word) => lightStem(word));
}

/**
 * Light stemming — strips common English suffixes.
 * Not as aggressive as Porter stemmer, but zero deps and good enough
 * for memory search where precision matters more than recall.
 */
function lightStem(word: string): string {
  if (word.length < 4) return word;

  // Order matters — check longest suffixes first
  if (word.endsWith("ation")) return word.slice(0, -5);
  if (word.endsWith("ment")) return word.slice(0, -4);
  if (word.endsWith("ness")) return word.slice(0, -4);
  if (word.endsWith("ting")) return word.slice(0, -3);
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ied")) return word.slice(0, -3) + "y";
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("ted")) return word.slice(0, -2);
  if (word.endsWith("ed")) return word.slice(0, -2);
  if (word.endsWith("ly")) return word.slice(0, -2);
  if (word.endsWith("er")) return word.slice(0, -2);
  if (word.endsWith("es")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);

  return word;
}

// ─── Index Builder ──────────────────────────────────────────────────────

/**
 * Build a search index from continuity state + diary files.
 *
 * Indexes:
 *   - Mid-term episodes (tags + summary)
 *   - Long-term facts (category + summary)
 *   - Diary markdown files (full text)
 *   - Heartbeat JSONL entries (summary + tags)
 */
export function buildSearchIndex(continuity: ContinuityState, workspaceDir: string): SearchIndex {
  const documents: SearchDocument[] = [];

  // 1. Index mid-term episodes
  if (continuity.midTerm?.episodes) {
    for (const ep of continuity.midTerm.episodes) {
      documents.push({
        id: ep.id,
        type: "episode",
        text: `${ep.summary} ${ep.tags.join(" ")} ${ep.importance}`,
        timestamp: ep.timestamp,
        metadata: { importance: ep.importance, tags: ep.tags },
      });
    }
  }

  // 2. Index long-term facts
  if (continuity.longTerm?.facts) {
    for (const fact of continuity.longTerm.facts) {
      documents.push({
        id: fact.id,
        type: "fact",
        text: `${fact.category} ${fact.summary} ${fact.source ?? ""}`,
        timestamp: fact.lastUpdated,
        metadata: { category: fact.category, confidence: fact.confidence },
      });
    }
  }

  // 3. Index diary files
  const diaryDir = join(workspaceDir, "memory", "diary");
  if (existsSync(diaryDir)) {
    try {
      const files = readdirSync(diaryDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        const content = readFileSync(join(diaryDir, file), "utf-8");
        // Split diary into entries by "## " headers for granular search
        const entries = content.split(/^## /m).filter((e) => e.trim());
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const dateStr = file.replace(".md", "");
          documents.push({
            id: `diary-${dateStr}-${i}`,
            type: "diary",
            text: entry.slice(0, 2000), // Cap diary entries to prevent bloat
            timestamp: `${dateStr}T00:00:00.000Z`,
            metadata: { file, entryIndex: i },
          });
        }
      }
    } catch {
      // Diary dir read failure is non-fatal
    }
  }

  // 4. Index heartbeat JSONL
  const indexPath = join(workspaceDir, "memory", "heartbeat", "index.jsonl");
  if (existsSync(indexPath)) {
    try {
      const lines = readFileSync(indexPath, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as {
            timestamp?: string;
            tickId?: string;
            summary?: string;
            tags?: string[];
            type?: string;
            agent?: string;
          };
          const id = entry.tickId ?? `hb-${entry.timestamp ?? Date.now()}`;
          documents.push({
            id,
            type: "heartbeat",
            text: `${entry.summary ?? ""} ${(entry.tags ?? []).join(" ")} ${entry.type ?? ""} ${entry.agent ?? ""}`,
            timestamp: entry.timestamp ?? new Date().toISOString(),
            metadata: entry,
          });
        } catch {
          // Skip malformed JSONL lines
        }
      }
    } catch {
      // JSONL read failure is non-fatal
    }
  }

  // Build term frequency maps
  const documentFrequency = new Map<string, number>();
  const termFrequencies = new Map<string, Map<string, number>>();

  for (const doc of documents) {
    const terms = tokenize(doc.text);
    const tf = new Map<string, number>();
    const seenTerms = new Set<string>();

    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
      seenTerms.add(term);
    }

    // Normalize TF by document length
    const maxFreq = Math.max(...tf.values(), 1);
    for (const [term, count] of tf) {
      tf.set(term, count / maxFreq);
    }

    termFrequencies.set(doc.id, tf);

    // Update document frequency
    for (const term of seenTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    documents,
    documentFrequency,
    termFrequencies,
    totalDocuments: documents.length,
    builtAt: new Date().toISOString(),
  };
}

// ─── Search ─────────────────────────────────────────────────────────────

/**
 * Search the memory index using TF-IDF scoring.
 *
 * @param query - Natural language search query
 * @param index - Pre-built search index
 * @param options - Search options
 * @returns Ranked results, highest relevance first
 */
export function searchMemory(
  query: string,
  index: SearchIndex,
  options?: {
    /** Maximum results to return (default: 10) */
    maxResults?: number;
    /** Minimum score threshold (default: 0.01) */
    minScore?: number;
    /** Filter by document type */
    type?: SearchDocument["type"];
    /** Boost recent documents (default: true) */
    recencyBoost?: boolean;
  },
): SearchResult[] {
  const maxResults = options?.maxResults ?? 10;
  const minScore = options?.minScore ?? 0.01;
  const recencyBoost = options?.recencyBoost ?? true;

  if (index.totalDocuments === 0) return [];

  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const results: SearchResult[] = [];
  const now = Date.now();

  for (const doc of index.documents) {
    // Type filter
    if (options?.type && doc.type !== options.type) continue;

    const tf = index.termFrequencies.get(doc.id);
    if (!tf) continue;

    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of queryTerms) {
      const termTf = tf.get(term);
      if (termTf === undefined) continue;

      const df = index.documentFrequency.get(term) ?? 0;
      if (df === 0) continue;

      // TF-IDF = TF * log(N / DF)
      const idf = Math.log(index.totalDocuments / df);
      score += termTf * idf;
      matchedTerms.push(term);
    }

    if (score < minScore || matchedTerms.length === 0) continue;

    // Recency boost: documents from the last 7 days get up to 1.5x boost
    if (recencyBoost) {
      try {
        const docAge = now - new Date(doc.timestamp).getTime();
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (docAge < sevenDays) {
          const recencyFactor = 1 + 0.5 * (1 - docAge / sevenDays);
          score *= recencyFactor;
        }
      } catch {
        // Invalid timestamp — no boost
      }
    }

    results.push({ document: doc, score, matchedTerms });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Normalize scores to 0-1 range
  const maxScore = results[0]?.score ?? 1;
  if (maxScore > 0) {
    for (const r of results) {
      r.score = r.score / maxScore;
    }
  }

  return results.slice(0, maxResults);
}
