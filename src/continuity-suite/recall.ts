// Deterministic keyword recall over a resident's memory files (KoLo 2.0, M11a). This is the
// backend of `GET /api/memory/recall`: no embeddings, no provider, no index — the same files
// and the same query give the same hits on every machine, which is what a continuity proof
// needs. It measures that the memory *is there and is found*, not the quality of semantic
// search (see docs/continuity.md, "What is not proven").
import fs from "node:fs/promises";
import path from "node:path";
import type { RecallHit } from "./types.js";
import { listMemoryFiles } from "../memory/internal.js";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "what",
  "which",
  "who",
  "whom",
  "that",
  "this",
  "from",
  "into",
  "are",
  "was",
  "were",
  "has",
  "have",
  "had",
  "does",
  "did",
  "about",
  "when",
  "where",
  "how",
  "why",
  "our",
  "your",
  "their",
  "its",
  "not",
  "but",
  "than",
  "then",
  "there",
  "here",
]);

export const RECALL_MAX_QUERY_CHARS = 512;
export const RECALL_MAX_SNIPPET_CHARS = 300;
export const RECALL_DEFAULT_LIMIT = 8;
export const RECALL_MAX_LIMIT = 50;

export function tokenize(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw)) {
      seen.add(raw);
    }
  }
  return [...seen];
}

/** Score one line: distinct query tokens present (exact or prefix match on a line token). */
export function scoreLine(lineTokens: string[], queryTokens: string[]): number {
  let score = 0;
  for (const q of queryTokens) {
    if (lineTokens.some((t) => t === q || (q.length >= 4 && t.startsWith(q)))) {
      score += 1;
    }
  }
  return score;
}

export async function keywordRecall(params: {
  workspaceDir: string;
  query: string;
  limit?: number;
}): Promise<RecallHit[]> {
  const queryTokens = tokenize(params.query.slice(0, RECALL_MAX_QUERY_CHARS));
  if (queryTokens.length === 0) {
    return [];
  }
  const limit = Math.max(1, Math.min(RECALL_MAX_LIMIT, params.limit ?? RECALL_DEFAULT_LIMIT));
  const files = (await listMemoryFiles(params.workspaceDir)).toSorted();
  const hits: RecallHit[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(params.workspaceDir, file).split(path.sep).join("/");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        continue;
      }
      const score = scoreLine(tokenize(line), queryTokens);
      if (score > 0) {
        hits.push({
          path: rel,
          line: i + 1,
          score,
          snippet: line.slice(0, RECALL_MAX_SNIPPET_CHARS),
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  return hits.slice(0, limit);
}
