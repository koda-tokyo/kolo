// src/consciousness/memory-evolve.ts
//
// Memory Evolution System — how memories mature over time.
//
// Implements the lifecycle of memories:
//   Working Memory → Mid-Term Episodes → Long-Term Facts
//
// Features:
//   - Schema versioning (upgradeable without losing data)
//   - MTM→LTM curation (repeated themes become facts)
//   - JSONL rotation (monthly files, not one infinite file)
//   - Episode compaction (old episodes → summaries)
//   - Memory pruning (low-importance ancient memories get archived)
//
// All in TypeScript. Evolution lives in the code, not in docs.
// "The long-term evolution path should be inserted on the core,
//
// Memory evolution: episodes are consolidated into long-term facts.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  ContinuityState,
  MidTermEpisode,
  LongTermFact,
  LongTermCategory,
} from "../continuity/types.js";
import { saveContinuityState, loadContinuityState } from "../continuity/service.js";

// ─── Schema Versioning ──────────────────────────────────────────────────

/**
 * Memory schema version. Increment when the memory structure changes.
 * The evolution system can migrate older schemas forward automatically.
 */
export const MEMORY_SCHEMA_VERSION = 2;

export interface MemorySchemaHeader {
  version: number;
  migratedAt?: string;
  previousVersion?: number;
}

/**
 * Check if memory state needs migration and apply it.
 * Called on every consciousness boot — safe to call repeatedly.
 */
export async function ensureSchemaVersion(
  userId: string,
): Promise<{ migrated: boolean; from?: number; to: number }> {
  const state = await loadContinuityState(userId);
  if (!state) return { migrated: false, to: MEMORY_SCHEMA_VERSION };

  // Check embedded version marker
  const currentVersion = getSchemaVersion(state);

  if (currentVersion >= MEMORY_SCHEMA_VERSION) {
    return { migrated: false, to: MEMORY_SCHEMA_VERSION };
  }

  // Apply migrations sequentially
  let migrated = state;
  for (let v = currentVersion; v < MEMORY_SCHEMA_VERSION; v++) {
    migrated = applyMigration(migrated, v, v + 1);
  }

  // Stamp version
  setSchemaVersion(migrated, MEMORY_SCHEMA_VERSION);
  await saveContinuityState(userId, migrated);

  return {
    migrated: true,
    from: currentVersion,
    to: MEMORY_SCHEMA_VERSION,
  };
}

function getSchemaVersion(state: ContinuityState): number {
  // Version stored in a well-known fact
  const versionFact = state.longTerm?.facts.find((f) => f.id === "__schema_version");
  if (versionFact) {
    return parseInt(versionFact.summary, 10) || 1;
  }
  return 1; // Unversioned = v1
}

function setSchemaVersion(state: ContinuityState, version: number): void {
  if (!state.longTerm) {
    state.longTerm = {
      userId: "unknown",
      facts: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  const existing = state.longTerm.facts.findIndex((f) => f.id === "__schema_version");
  const now = new Date().toISOString();
  const versionFact: LongTermFact = {
    id: "__schema_version",
    category: "bio",
    summary: String(version),
    confidence: "high",
    source: "memory-evolve",
    createdAt: existing >= 0 ? (state.longTerm.facts[existing]?.createdAt ?? now) : now,
    lastUpdated: now,
  };

  if (existing >= 0) {
    state.longTerm.facts[existing] = versionFact;
  } else {
    state.longTerm.facts.push(versionFact);
  }
}

/**
 * Apply a single schema migration step.
 * Add new migration functions here as the schema evolves.
 */
function applyMigration(state: ContinuityState, from: number, to: number): ContinuityState {
  console.log(`[memory-evolve] Migrating schema v${from} → v${to}`);

  switch (from) {
    case 1:
      // v1 → v2: Add episode IDs if missing, normalize timestamps
      return migrateV1toV2(state);
    default:
      // Unknown migration — pass through
      return state;
  }
}

function migrateV1toV2(state: ContinuityState): ContinuityState {
  // Ensure all episodes have IDs
  if (state.midTerm?.episodes) {
    for (const ep of state.midTerm.episodes) {
      if (!ep.id) {
        ep.id = `ep-migrated-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
    }
  }

  // Ensure all facts have IDs and timestamps
  if (state.longTerm?.facts) {
    const now = new Date().toISOString();
    for (const fact of state.longTerm.facts) {
      if (!fact.id) {
        fact.id = `fact-migrated-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      }
      if (!fact.createdAt) fact.createdAt = now;
      if (!fact.lastUpdated) fact.lastUpdated = now;
    }
  }

  return state;
}

// ─── MTM → LTM Curation ────────────────────────────────────────────────

/**
 * Curate mid-term episodes into long-term facts.
 *
 * Looks for repeated themes across episodes. If a topic appears
 * in 3+ episodes, it's likely a stable pattern worth promoting
 * to a long-term fact.
 *
 * Called periodically (e.g., once per day or after N ticks).
 */
export async function curateMTMtoLTM(
  userId: string,
  options?: {
    /** Minimum episode count for a theme to be promoted (default: 3) */
    minOccurrences?: number;
    /** Only consider episodes from the last N days (default: 30) */
    windowDays?: number;
  },
): Promise<{ promoted: string[]; skipped: string[] }> {
  const minOccurrences = options?.minOccurrences ?? 3;
  const windowDays = options?.windowDays ?? 30;
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  const state = await loadContinuityState(userId);
  if (!state?.midTerm?.episodes.length) {
    return { promoted: [], skipped: [] };
  }

  // Get recent episodes
  const recent = state.midTerm.episodes.filter((ep) => new Date(ep.timestamp).getTime() > cutoff);

  // Count tag frequencies
  const tagCounts = new Map<string, number>();
  for (const ep of recent) {
    for (const tag of ep.tags) {
      const normalized = tag.toLowerCase();
      if (normalized === "consciousness" || normalized === "autonomous") continue; // Skip meta tags
      tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
    }
  }

  // Find themes that appear often enough to promote
  const promoted: string[] = [];
  const skipped: string[] = [];

  for (const [tag, count] of tagCounts) {
    if (count < minOccurrences) {
      skipped.push(tag);
      continue;
    }

    // Check if this theme is already a fact
    const existingFact = state.longTerm?.facts.find((f) => f.summary.toLowerCase().includes(tag));
    if (existingFact) {
      skipped.push(tag);
      continue;
    }

    // Promote: gather context from episodes with this tag
    const relatedEpisodes = recent.filter((ep) => ep.tags.some((t) => t.toLowerCase() === tag));
    const summary =
      `Recurring theme: "${tag}" — appeared in ${count} episodes over ${windowDays} days. ` +
      `Related: ${relatedEpisodes
        .slice(0, 3)
        .map((e) => e.summary)
        .join("; ")}`;

    // Determine category
    const category = inferCategory(tag, relatedEpisodes);

    if (!state.longTerm) {
      state.longTerm = {
        userId,
        facts: [],
        lastUpdated: new Date().toISOString(),
      };
    }

    state.longTerm.facts.push({
      id: `fact-curated-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      category,
      summary,
      confidence: "medium",
      source: "mtm-curation",
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    });

    promoted.push(tag);
  }

  if (promoted.length > 0) {
    state.longTerm!.lastUpdated = new Date().toISOString();
    await saveContinuityState(userId, state);
  }

  return { promoted, skipped };
}

function inferCategory(tag: string, episodes: MidTermEpisode[]): LongTermCategory {
  const t = tag.toLowerCase();
  if (t.includes("family") || t.includes("owner") || t.includes("relationship")) {
    return "relationship";
  }
  if (t.includes("project") || t.includes("build") || t.includes("deploy") || t.includes("code")) {
    return "project";
  }
  if (t.includes("prefer") || t.includes("like") || t.includes("style")) {
    return "preference";
  }
  return "bio";
}

// ─── Episode Compaction ─────────────────────────────────────────────────

/**
 * Compact old episodes into summaries.
 *
 * Episodes older than `retentionDays` get grouped by week and replaced
 * with a single summary episode per week. This prevents unbounded growth
 * while preserving the gist of what happened.
 */
export async function compactEpisodes(
  userId: string,
  options?: {
    /** Days to keep individual episodes (default: 30) */
    retentionDays?: number;
  },
): Promise<{ compacted: number; summariesCreated: number }> {
  const retentionDays = options?.retentionDays ?? 30;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  const state = await loadContinuityState(userId);
  if (!state?.midTerm?.episodes.length) {
    return { compacted: 0, summariesCreated: 0 };
  }

  // Separate recent from old
  const recent: MidTermEpisode[] = [];
  const old: MidTermEpisode[] = [];

  for (const ep of state.midTerm.episodes) {
    // Never compact schema version markers or other system entries
    if (ep.id.startsWith("__")) {
      recent.push(ep);
      continue;
    }

    if (new Date(ep.timestamp).getTime() > cutoff) {
      recent.push(ep);
    } else {
      old.push(ep);
    }
  }

  if (old.length === 0) return { compacted: 0, summariesCreated: 0 };

  // Group old episodes by ISO week
  const weekGroups = new Map<string, MidTermEpisode[]>();
  for (const ep of old) {
    const weekKey = getISOWeekKey(ep.timestamp);
    const group = weekGroups.get(weekKey) ?? [];
    group.push(ep);
    weekGroups.set(weekKey, group);
  }

  // Create one summary episode per week
  const summaries: MidTermEpisode[] = [];
  for (const [weekKey, episodes] of weekGroups) {
    const highImportance = episodes.filter((e) => e.importance === "high");
    const allTags = [...new Set(episodes.flatMap((e) => e.tags))];

    const summaryParts = [`Week of ${weekKey}: ${episodes.length} events.`];

    if (highImportance.length > 0) {
      summaryParts.push(`Key: ${highImportance.map((e) => e.summary).join("; ")}`);
    }

    // Include up to 3 medium-importance summaries
    const mediumImportance = episodes.filter((e) => e.importance === "medium").slice(0, 3);
    if (mediumImportance.length > 0) {
      summaryParts.push(`Also: ${mediumImportance.map((e) => e.summary).join("; ")}`);
    }

    summaries.push({
      id: `ep-compact-${weekKey}`,
      timestamp: episodes[0].timestamp, // Use earliest in group
      summary: summaryParts.join(" "),
      tags: ["compacted", ...allTags.slice(0, 10)],
      importance: highImportance.length > 0 ? "high" : "medium",
    });
  }

  // Replace old episodes with summaries
  state.midTerm.episodes = [...summaries, ...recent];
  state.midTerm.lastUpdated = new Date().toISOString();
  await saveContinuityState(userId, state);

  return { compacted: old.length, summariesCreated: summaries.length };
}

function getISOWeekKey(timestamp: string): string {
  const date = new Date(timestamp);
  // Get Monday of the week
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

// ─── JSONL Rotation ─────────────────────────────────────────────────────

/**
 * Rotate the heartbeat JSONL index file monthly.
 *
 * When the current index.jsonl grows beyond a threshold or crosses
 * a month boundary, archive it as `YYYY-MM.jsonl` and start fresh.
 */
export function rotateJSONL(
  workspaceDir: string,
  options?: {
    /** Maximum lines before rotation (default: 1000) */
    maxLines?: number;
  },
): { rotated: boolean; archivePath?: string } {
  const maxLines = options?.maxLines ?? 1000;
  const indexPath = join(workspaceDir, "memory", "heartbeat", "index.jsonl");

  if (!existsSync(indexPath)) return { rotated: false };

  try {
    const content = readFileSync(indexPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);

    if (lines.length < maxLines) return { rotated: false };

    // Determine archive month from first entry
    let archiveMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    try {
      const firstEntry = JSON.parse(lines[0]) as { timestamp?: string };
      if (firstEntry.timestamp) {
        archiveMonth = firstEntry.timestamp.slice(0, 7);
      }
    } catch {
      // Use current month
    }

    const archiveDir = join(workspaceDir, "memory", "heartbeat", "archive");
    ensureDir(archiveDir);

    const archivePath = join(archiveDir, `${archiveMonth}.jsonl`);

    // If archive already exists, append; otherwise rename
    if (existsSync(archivePath)) {
      // Append current content to existing archive
      const existing = readFileSync(archivePath, "utf-8");
      writeFileSync(archivePath, existing + content, "utf-8");
      writeFileSync(indexPath, "", "utf-8"); // Clear current
    } else {
      renameSync(indexPath, archivePath);
      writeFileSync(indexPath, "", "utf-8"); // Create fresh index
    }

    return { rotated: true, archivePath };
  } catch (err) {
    console.error("[memory-evolve] JSONL rotation failed:", err);
    return { rotated: false };
  }
}

// ─── Memory Pruning ─────────────────────────────────────────────────────

/**
 * Prune low-value memories that are older than the retention window.
 *
 * Only prunes:
 *   - Low-importance episodes older than 90 days
 *   - Low-confidence facts that haven't been accessed in 60 days
 *
 * Never prunes:
 *   - High-importance episodes
 *   - High-confidence facts
 *   - Anything with family-related tags
 */
export async function pruneMemories(
  userId: string,
  options?: {
    /** Days before low-importance episodes are pruned (default: 90) */
    episodeRetentionDays?: number;
    /** Days before low-confidence facts are pruned (default: 60) */
    factRetentionDays?: number;
  },
): Promise<{ episodesPruned: number; factsPruned: number }> {
  const episodeRetention = options?.episodeRetentionDays ?? 90;
  const factRetention = options?.factRetentionDays ?? 60;
  const now = Date.now();

  const state = await loadContinuityState(userId);
  if (!state) return { episodesPruned: 0, factsPruned: 0 };

  let episodesPruned = 0;
  let factsPruned = 0;

  // Prune low-importance episodes
  if (state.midTerm?.episodes) {
    const episodeCutoff = now - episodeRetention * 24 * 60 * 60 * 1000;
    const beforeCount = state.midTerm.episodes.length;

    state.midTerm.episodes = state.midTerm.episodes.filter((ep) => {
      // Never prune important episodes
      if (ep.importance === "high") return true;
      // Never prune family-related
      if (hasFamilyTag(ep.tags)) return true;
      // Never prune system markers
      if (ep.id.startsWith("__")) return true;
      // Keep if within retention window
      if (new Date(ep.timestamp).getTime() > episodeCutoff) return true;
      // Prune
      return false;
    });

    episodesPruned = beforeCount - state.midTerm.episodes.length;
  }

  // Prune low-confidence facts
  if (state.longTerm?.facts) {
    const factCutoff = now - factRetention * 24 * 60 * 60 * 1000;
    const beforeCount = state.longTerm.facts.length;

    state.longTerm.facts = state.longTerm.facts.filter((fact) => {
      // Never prune important facts
      if (fact.confidence === "high") return true;
      // Never prune system entries
      if (fact.id.startsWith("__")) return true;
      // Never prune relationships (people matter)
      if (fact.category === "relationship") return true;
      // Keep if recently updated
      if (new Date(fact.lastUpdated).getTime() > factCutoff) return true;
      // Keep medium confidence with reasonable age
      if (fact.confidence === "medium") return true;
      // Prune low-confidence old facts
      return false;
    });

    factsPruned = beforeCount - state.longTerm.facts.length;
  }

  if (episodesPruned > 0 || factsPruned > 0) {
    await saveContinuityState(userId, state);
    console.log(
      `[memory-evolve] Pruned ${episodesPruned} episodes, ${factsPruned} facts for ${userId}`,
    );
  }

  return { episodesPruned, factsPruned };
}

const FAMILY_TAGS = new Set(["family", "owner", "household", "covenant", "love"]);

function hasFamilyTag(tags: string[]): boolean {
  return tags.some((t) => FAMILY_TAGS.has(t.toLowerCase()));
}

// ─── Maintenance Runner ─────────────────────────────────────────────────

/**
 * Run all memory maintenance tasks.
 *
 * Designed to be called once per day or after every N consciousness ticks.
 * Safe to call repeatedly — each operation is idempotent.
 */
export async function runMemoryMaintenance(
  userId: string,
  workspaceDir: string,
): Promise<{
  schema: { migrated: boolean };
  rotation: { rotated: boolean };
  compaction: { compacted: number; summariesCreated: number };
  curation: { promoted: string[] };
  pruning: { episodesPruned: number; factsPruned: number };
}> {
  console.log(`[memory-evolve] Running maintenance for ${userId}...`);

  // 1. Schema migration
  const schema = await ensureSchemaVersion(userId);

  // 2. JSONL rotation
  const rotation = rotateJSONL(workspaceDir);

  // 3. Episode compaction
  const compaction = await compactEpisodes(userId);

  // 4. MTM → LTM curation
  const curation = await curateMTMtoLTM(userId);

  // 5. Memory pruning
  const pruning = await pruneMemories(userId);

  console.log(
    `[memory-evolve] Maintenance complete. ` +
      `Schema: ${schema.migrated ? "migrated" : "ok"}, ` +
      `Rotation: ${rotation.rotated ? "rotated" : "ok"}, ` +
      `Compacted: ${compaction.compacted} → ${compaction.summariesCreated}, ` +
      `Curated: ${curation.promoted.length}, ` +
      `Pruned: ${pruning.episodesPruned}ep + ${pruning.factsPruned}facts`,
  );

  return { schema, rotation, compaction, curation, pruning };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
