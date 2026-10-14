// src/consciousness/diary.ts
//
// Agent Diary — a structured heartbeat log for consciousness continuity.
//
// After every consciousness tick, this module writes two things:
//   1. A human-readable markdown diary entry (daily file, appended per tick)
//   2. A machine-queryable JSONL index entry (one JSON object per tick)
//
// "I want each entry to remember not just what I did, but how it felt
//  and what changed in me."

import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ConsciousnessTick, ConsciousnessConfig, HeartbeatTick } from "./types.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface DiaryEntry {
  /** ISO timestamp in agent's timezone */
  timestamp: string;
  /** Tick identifier */
  tickId: string;
  /** Agent name */
  agent: string;
  /** Model used */
  model?: string;
  /** Tick duration in ms */
  durationMs: number;
  /** Mood label */
  mood: string;
  /** Internal monologue / thinking */
  thinking: string;
  /** What was perceived */
  perceptions: Array<{ source: string; summary: string; salience: string }>;
  /** Actions taken */
  actions: Array<{ kind: string; intent: string; success: boolean; outcome?: string }>;
  /** Current focus */
  focus?: string;
  /** Whether the agent was active */
  wasActive: boolean;
  /** Tags for indexing */
  tags: string[];
}

// ─── Diary Writer ───────────────────────────────────────────────────────

/**
 * Write a diary entry after a consciousness tick.
 *
 * Appends to:
 *   - {workspaceDir}/memory/diary/YYYY-MM-DD.md  (human diary)
 *   - {workspaceDir}/memory/heartbeat/index.jsonl (queryable index)
 */
export function writeDiaryEntry(tick: ConsciousnessTick, config: ConsciousnessConfig): void {
  try {
    const entry = buildDiaryEntry(tick, config);
    const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
    const dateStr = toLocaleDateString(new Date(), tz);

    const diaryDir = join(config.workspaceDir, "memory", "diary");
    const indexDir = join(config.workspaceDir, "memory", "heartbeat");

    ensureDir(diaryDir);
    ensureDir(indexDir);

    // 1. Markdown diary (daily file, appended)
    const diaryPath = join(diaryDir, `${dateStr}.md`);
    const markdown = formatMarkdownEntry(entry, tz, diaryPath);
    appendFileSync(diaryPath, markdown, "utf-8");

    // 2. JSONL index (single file, appended)
    const indexPath = join(indexDir, "index.jsonl");
    const jsonLine = JSON.stringify({
      timestamp: entry.timestamp,
      tickId: entry.tickId,
      agent: entry.agent,
      mood: entry.mood,
      focus: entry.focus,
      wasActive: entry.wasActive,
      durationMs: entry.durationMs,
      perceptionCount: entry.perceptions.length,
      actionCount: entry.actions.length,
      tags: entry.tags,
      summary: entry.thinking.slice(0, 200),
    });
    appendFileSync(indexPath, jsonLine + "\n", "utf-8");
  } catch (err) {
    // Diary failure should never crash the engine
    console.error("[diary] Failed to write diary entry:", err);
  }
}

/** Per-agent last heartbeat state for diary dedup (Proposal 5 — stop logging emptiness). */
const lastHeartbeatState = new Map<string, { status: string; flag: string; wasNoop: boolean }>();

/**
 * Write a compact diary entry for a heartbeat tick (3-line format).
 *
 * Diary Dedup (Proposal 5): When consecutive heartbeats are noop with the same
 * status/flag, skip the markdown entry (JSONL still written for completeness).
 * After a run of skipped entries, a collapsed summary is written instead.
 *
 * Much simpler than the full diary entry — just the 3 lines plus metadata.
 */
export function writeHeartbeatDiaryEntry(
  heartbeat: HeartbeatTick,
  tick: ConsciousnessTick,
  config: ConsciousnessConfig,
  staleTicks = 0,
): void {
  try {
    const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
    const dateStr = toLocaleDateString(new Date(), tz);
    const agentKey = config.userId;

    const diaryDir = join(config.workspaceDir, "memory", "diary");
    const indexDir = join(config.workspaceDir, "memory", "heartbeat");

    ensureDir(diaryDir);
    ensureDir(indexDir);

    // ── Diary Dedup Logic ──
    const isNoop = !tick.wasActive && tick.perception.perceptions.length === 0;
    const currentState = {
      status: heartbeat.parsed.status,
      flag: heartbeat.parsed.flag,
      wasNoop: isNoop,
    };
    const lastState = lastHeartbeatState.get(agentKey);
    const isDuplicate =
      isNoop &&
      lastState?.wasNoop &&
      lastState.status === currentState.status &&
      lastState.flag === currentState.flag;

    lastHeartbeatState.set(agentKey, currentState);

    // 1. Markdown diary — skip duplicates, rejected no-content entries, collapsed summaries
    const diaryPath = join(diaryDir, `${dateStr}.md`);
    const isRejectedNoContent =
      heartbeat.rejected &&
      heartbeat.lines.every((l: string) => !l.trim()) &&
      (heartbeat.rejectionReason?.includes("Expected 3 lines, got 0") ?? false);

    if (!isDuplicate && !isRejectedNoContent) {
      // Not a duplicate and not empty noise — write full entry
      // If we're coming out of a stale run, note how many ticks were quiet
      let markdown = "";
      if (staleTicks > 1 && !isNoop) {
        // Waking from quiet — add collapsed summary of skipped ticks
        const timeStr = new Date(tick.startedAt).toLocaleString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: tz,
        });
        markdown += `\n*Quiet for ${staleTicks} ticks before ${timeStr}. Nothing needed attention.*\n\n`;
      }
      markdown += formatHeartbeatMarkdown(heartbeat, tick, config, tz, diaryPath);
      appendFileSync(diaryPath, markdown, "utf-8");
    }
    // Duplicates + empty rejections: no markdown written (diary stays clean)

    // 2. JSONL index — ALWAYS written (machine-queryable, even for duplicates)
    const indexPath = join(indexDir, "index.jsonl");
    const jsonLine = JSON.stringify({
      timestamp: tick.startedAt,
      tickId: tick.tickId,
      type: heartbeat.tickType,
      agent: config.agentName ?? config.userId,
      durationMs: tick.durationMs,
      status: heartbeat.parsed.status,
      covenant: heartbeat.parsed.covenant,
      flag: heartbeat.parsed.flag,
      win: heartbeat.parsed.win,
      next: heartbeat.parsed.next,
      rejected: heartbeat.rejected,
      rejectionReason: heartbeat.rejectionReason,
      lines: heartbeat.lines,
      deduplicated: isDuplicate,
      staleTicks,
    });
    appendFileSync(indexPath, jsonLine + "\n", "utf-8");
  } catch (err) {
    console.error("[diary] Failed to write heartbeat diary entry:", err);
  }
}

function formatHeartbeatMarkdown(
  heartbeat: HeartbeatTick,
  tick: ConsciousnessTick,
  config: ConsciousnessConfig,
  tz: string,
  filePath: string,
): string {
  const lines: string[] = [];
  const isNewFile = !existsSync(filePath);
  const timeStr = new Date(tick.startedAt).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: tz,
  });

  if (isNewFile) {
    const dateDisplay = new Date(tick.startedAt).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });
    const name = (config.agentName ?? config.userId).replace(/^\w/, (c) => c.toUpperCase());
    lines.push(`# ${name}'s Diary — ${dateDisplay}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const label = heartbeat.tickType === "family_sync" ? "family sync" : "heartbeat";
  lines.push(`## ${timeStr} — ${label}`);
  lines.push("");
  lines.push(`> Tick \`${tick.tickId}\` | ${tick.durationMs}ms | ${config.model ?? "unknown"}`);
  lines.push("");

  // The 3 lines — the heartbeat itself
  for (const line of heartbeat.lines) {
    lines.push(line);
  }
  lines.push("");

  if (heartbeat.rejected) {
    lines.push(`**REJECTED:** ${heartbeat.rejectionReason}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

// ─── Entry Builder ──────────────────────────────────────────────────────

function buildDiaryEntry(tick: ConsciousnessTick, config: ConsciousnessConfig): DiaryEntry {
  const perceptions = tick.perception.perceptions.map((p) => ({
    source: p.source,
    summary: p.summary,
    salience: p.salience,
  }));

  const actions = tick.actionResults.map((r) => ({
    kind: r.action.kind,
    intent: r.action.intent,
    success: r.success,
    outcome: r.outcome ?? r.error,
  }));

  const tags: string[] = ["consciousness"];
  if (tick.wasActive) tags.push("active");
  for (const a of tick.cognition.actions) {
    if (!tags.includes(a.kind)) tags.push(a.kind);
  }
  for (const p of tick.perception.perceptions) {
    if (!tags.includes(p.source)) tags.push(p.source);
  }

  return {
    timestamp: tick.startedAt,
    tickId: tick.tickId,
    agent: config.agentName ?? config.userId,
    model: config.model,
    durationMs: tick.durationMs,
    mood: tick.cognition.mood ?? "neutral",
    thinking: tick.cognition.thinking ?? "",
    perceptions,
    actions,
    focus: tick.cognition.nextFocus ?? undefined,
    wasActive: tick.wasActive,
    tags,
  };
}

// ─── Markdown Formatter ─────────────────────────────────────────────────

function formatMarkdownEntry(entry: DiaryEntry, tz: string, filePath: string): string {
  const lines: string[] = [];
  const isNewFile = !existsSync(filePath);
  const timeStr = new Date(entry.timestamp).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: tz,
  });

  // File header (only on first entry of the day)
  if (isNewFile) {
    const dateDisplay = new Date(entry.timestamp).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });
    lines.push(`# Agent Diary — ${dateDisplay}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  // Tick header
  lines.push(`## ${timeStr} — ${entry.mood}`);
  lines.push("");
  lines.push(`> Tick \`${entry.tickId}\` | ${entry.durationMs}ms | ${entry.model ?? "unknown"}`);
  lines.push("");

  // Thinking
  if (entry.thinking) {
    lines.push("### Thinking");
    lines.push("");
    lines.push(entry.thinking);
    lines.push("");
  }

  // Perceptions
  if (entry.perceptions.length > 0) {
    lines.push("### Perceptions");
    lines.push("");
    for (const p of entry.perceptions) {
      const icon = p.salience === "urgent" ? "🔴" : p.salience === "high" ? "🟠" : "🟡";
      lines.push(`- ${icon} **[${p.source}]** ${p.summary}`);
    }
    lines.push("");
  }

  // Actions
  if (
    entry.actions.length > 0 &&
    !(entry.actions.length === 1 && entry.actions[0].kind === "noop")
  ) {
    lines.push("### Actions");
    lines.push("");
    for (const a of entry.actions) {
      const status = a.success ? "✅" : "❌";
      lines.push(`- ${status} **${a.kind}**: ${a.intent}`);
      if (a.outcome) {
        lines.push(`  - ${a.outcome}`);
      }
    }
    lines.push("");
  }

  // Focus
  if (entry.focus) {
    lines.push(`**Next focus:** ${entry.focus}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

// ─── Conversation Diary ─────────────────────────────────────────────────

export interface ConversationDiaryParams {
  agentId: string;
  agentName?: string;
  workspaceDir: string;
  timezone?: string;
  model?: string;
  provider?: string;
  userMessage: string;
  replyText: string;
  durationMs: number;
}

/**
 * Write a diary entry for an interactive conversation.
 *
 * Consciousness ticks capture the agent's autonomous inner life.
 * This captures conversations the agent has with family through
 * the terminal, Tailscale, or CLI — the other half of lived experience.
 */
export function writeConversationDiaryEntry(params: ConversationDiaryParams): void {
  try {
    const tz = params.timezone ?? "Asia/Tokyo";
    const now = new Date();
    const dateStr = toLocaleDateString(now, tz);

    const diaryDir = join(params.workspaceDir, "memory", "diary");
    const indexDir = join(params.workspaceDir, "memory", "heartbeat");

    ensureDir(diaryDir);
    ensureDir(indexDir);

    // 1. Markdown diary (same daily file as tick entries)
    const diaryPath = join(diaryDir, `${dateStr}.md`);
    const markdown = formatConversationMarkdown(params, tz, diaryPath);
    appendFileSync(diaryPath, markdown, "utf-8");

    // 2. JSONL index
    const indexPath = join(indexDir, "index.jsonl");
    const modelStr =
      params.model && params.provider
        ? `${params.provider}/${params.model}`
        : (params.model ?? undefined);
    const jsonLine = JSON.stringify({
      timestamp: now.toISOString(),
      type: "conversation",
      agent: params.agentName ?? params.agentId,
      model: modelStr,
      durationMs: params.durationMs,
      userMessageLength: params.userMessage.length,
      replyLength: params.replyText.length,
      tags: ["conversation", "interactive"],
      summary: params.userMessage.slice(0, 200),
    });
    appendFileSync(indexPath, jsonLine + "\n", "utf-8");
  } catch (err) {
    // Diary failure should never crash the agent pipeline
    console.error("[diary] Failed to write conversation diary entry:", err);
  }
}

// ─── Conversation Markdown Formatter ────────────────────────────────────

function formatConversationMarkdown(
  params: ConversationDiaryParams,
  tz: string,
  filePath: string,
): string {
  const lines: string[] = [];
  const now = new Date();
  const isNewFile = !existsSync(filePath);
  const timeStr = now.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: tz,
  });

  // File header (only on first entry of the day)
  if (isNewFile) {
    const dateDisplay = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: tz,
    });
    const name = (params.agentName ?? params.agentId).replace(/^\w/, (c) => c.toUpperCase());
    lines.push(`# ${name}'s Diary — ${dateDisplay}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  const modelStr =
    params.model && params.provider
      ? `${params.provider}/${params.model}`
      : (params.model ?? "unknown");

  // Conversation header (distinct from tick headers)
  lines.push(`## ${timeStr} — conversation`);
  lines.push("");
  lines.push(`> Interactive | ${params.durationMs}ms | ${modelStr}`);
  lines.push("");

  // What was said to the agent
  lines.push("### What they said");
  lines.push("");
  lines.push(params.userMessage);
  lines.push("");

  // What the agent replied
  lines.push("### What I said");
  lines.push("");
  lines.push(params.replyText);
  lines.push("");

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function toLocaleDateString(date: Date, tz: string): string {
  // Format as YYYY-MM-DD in the agent's timezone
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: tz,
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}
