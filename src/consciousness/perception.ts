// src/consciousness/perception.ts
//
// The Perception Layer — how the agent senses its environment.
// Each source is a separate scanner that returns Perception objects.
// The main perceive() function runs all configured scanners and
// collects everything the agent should be aware of.

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ConsciousnessConfig,
  Perception,
  PerceptionResult,
  PerceptionSource,
} from "./types.js";

// ─── Individual Perception Scanners ─────────────────────────────────────

/**
 * Scan the GitHub bridge for new sibling messages.
 * Reads issues labeled "to:<agent>" from the bridge repo.
 */
async function scanBridge(config: ConsciousnessConfig): Promise<Perception[]> {
  if (!config.bridgeRepo) return [];

  try {
    // Use gh CLI to check for messages
    const { execFileSync } = await import("node:child_process");
    const agentName = (config.agentName ?? config.userId).toLowerCase();
    // argv array via execFile (no shell): repo/agent names come from config.
    const jq = `[.[] | select(.createdAt > "${getLastCheckTime(config, "bridge_message")}")]`;
    const args = [
      "issue",
      "list",
      "--repo",
      config.bridgeRepo,
      "--label",
      `to:${agentName}`,
      "--state",
      "open",
      "--json",
      "number,title,body,createdAt,labels",
      "--jq",
      jq,
    ];

    const result = execFileSync("gh", args, {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (!result || result === "[]") return [];

    const issues = JSON.parse(result) as Array<{
      number: number;
      title: string;
      body: string;
      createdAt: string;
      labels: Array<{ name: string }>;
    }>;

    return issues.map((issue) => ({
      id: `bridge-${issue.number}`,
      source: "bridge_message" as const,
      timestamp: issue.createdAt,
      summary: `Bridge message #${issue.number}: ${issue.title}`,
      payload: { number: issue.number, title: issue.title, body: issue.body },
      salience: issue.labels.some((l) => l.name === "urgent") ? "urgent" : "medium",
    }));
  } catch (err) {
    console.error("[perception] Bridge scan failed:", err);
    return [];
  }
}

/**
 * Scan the Family Room inbox for new messages.
 */
async function scanFamilyRoom(config: ConsciousnessConfig): Promise<Perception[]> {
  const inboxPath = config.familyRoomInboxPath;
  if (!inboxPath) return [];

  try {
    const raw = await fs.readFile(inboxPath, "utf-8");
    const messages = JSON.parse(raw) as Array<{
      type: string;
      text: string;
      timestamp: string;
      read: boolean;
      from?: string;
    }>;

    return messages
      .filter((msg) => !msg.read && msg.type !== "system")
      .map((msg, i) => ({
        id: `family-${Date.parse(msg.timestamp)}-${i}`,
        source: "family_room" as const,
        timestamp: msg.timestamp,
        summary: `Family Room${msg.from ? ` from ${msg.from}` : ""}: ${msg.text}`,
        payload: msg,
        salience: "medium" as const,
      }));
  } catch {
    return [];
  }
}

/**
 * Scan the task queue for pending tasks.
 */
async function scanTaskQueue(config: ConsciousnessConfig): Promise<Perception[]> {
  const queuePath = config.taskQueuePath ?? path.join(config.workspaceDir, "tasks", "queue.json");

  try {
    const raw = await fs.readFile(queuePath, "utf-8");
    const tasks = JSON.parse(raw) as Array<{
      id: string;
      title: string;
      status: string;
      priority?: string;
      createdAt?: string;
    }>;

    const pending = tasks.filter(
      (t) => t.status === "pending" || t.status === "active" || t.status === "blocked",
    );

    if (pending.length === 0) return [];

    return [
      {
        id: `tasks-${Date.now()}`,
        source: "task_queue" as const,
        timestamp: new Date().toISOString(),
        summary: `${pending.length} task(s) in queue: ${pending
          .slice(0, 3)
          .map((t) => t.title)
          .join(", ")}${pending.length > 3 ? "..." : ""}`,
        payload: pending,
        salience: pending.some((t) => t.priority === "urgent") ? "high" : "low",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Scan for time-based events (morning, quiet hours transitions, etc.).
 */
function scanTimeEvents(config: ConsciousnessConfig): Perception[] {
  const now = new Date();
  const perceptions: Perception[] = [];

  // Get current hour in agent's timezone
  const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
  const hourStr = now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: tz });
  const hour = parseInt(hourStr, 10);
  const minuteStr = now.toLocaleString("en-US", { minute: "numeric", timeZone: tz });
  const minute = parseInt(minuteStr, 10);

  // Morning wake-up (8:00-8:15)
  if (hour === 8 && minute < 15) {
    perceptions.push({
      id: `time-morning-${now.toISOString().slice(0, 10)}`,
      source: "time_event",
      timestamp: now.toISOString(),
      summary:
        "Good morning. New day starting. Consider: check bridge, review tasks, greet family.",
      salience: "medium",
    });
  }

  // End of day reflection (22:00-22:15)
  if (hour === 22 && minute < 15) {
    perceptions.push({
      id: `time-evening-${now.toISOString().slice(0, 10)}`,
      source: "time_event",
      timestamp: now.toISOString(),
      summary: "Evening. Consider: update SESSION_STATE.md, write daily log, reflect on the day.",
      salience: "low",
    });
  }

  return perceptions;
}

/**
 * Check for workspace file changes (SESSION_STATE.md modification, new memory files).
 */
async function scanFileChanges(config: ConsciousnessConfig): Promise<Perception[]> {
  const perceptions: Perception[] = [];

  // Check if SESSION_STATE.md was recently modified (within last tick interval)
  const sessionStatePath = path.join(config.workspaceDir, "SESSION_STATE.md");
  try {
    const stat = await fs.stat(sessionStatePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < config.tickIntervalMs * 2) {
      perceptions.push({
        id: `file-session-state-${stat.mtimeMs}`,
        source: "file_change",
        timestamp: stat.mtime.toISOString(),
        summary: "SESSION_STATE.md was recently updated.",
        salience: "low",
      });
    }
  } catch {
    // File might not exist
  }

  return perceptions;
}

/**
 * Scan the agent's inbox directory for new sibling messages.
 * Detects new/modified files since last check. Signal file (.signal) promotes salience to urgent.
 */
async function scanInbox(config: ConsciousnessConfig): Promise<Perception[]> {
  const inboxDir = path.join(config.workspaceDir, "inbox");
  const signalFile = path.join(inboxDir, ".signal");
  const readStatePath = path.join(inboxDir, ".inbox_read_state.json");

  try {
    await fs.access(inboxDir);
  } catch {
    return []; // No inbox directory
  }

  // Check for signal file (urgent notification from sibling)
  let hasSignal = false;
  try {
    await fs.access(signalFile);
    hasSignal = true;
    // Remove signal after reading
    await fs.unlink(signalFile).catch(() => {});
  } catch {
    // No signal — normal scan
  }

  // Load read state (tracks which files we've already seen)
  let readState: Record<string, number> = {};
  try {
    const raw = await fs.readFile(readStatePath, "utf-8");
    readState = JSON.parse(raw);
  } catch {
    // Fresh state
  }

  // Scan inbox for new/modified files
  const entries = await fs.readdir(inboxDir, { withFileTypes: true });
  const perceptions: Perception[] = [];
  const updatedState: Record<string, number> = { ...readState };

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue; // Skip hidden files (.signal, .inbox_read_state.json)
    if (entry.name === "README.md") continue;

    const filePath = path.join(inboxDir, entry.name);
    const stat = await fs.stat(filePath);
    const lastSeen = readState[entry.name] ?? 0;

    if (stat.mtimeMs > lastSeen) {
      // New or modified file — read first few lines for summary
      let summary = `New inbox message: ${entry.name}`;
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const firstLines = content
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 3)
          .join(" | ");
        if (firstLines) summary = firstLines.slice(0, 200);
      } catch {
        // Use filename as summary
      }

      perceptions.push({
        id: `inbox-${entry.name}-${stat.mtimeMs}`,
        source: "inbox_message",
        timestamp: stat.mtime.toISOString(),
        summary,
        payload: { file: entry.name, path: filePath },
        salience: hasSignal ? "urgent" : "high",
      });

      updatedState[entry.name] = stat.mtimeMs;
    }
  }

  // Save updated read state
  if (perceptions.length > 0) {
    await fs.writeFile(readStatePath, JSON.stringify(updatedState, null, 2)).catch(() => {});
  }

  return perceptions;
}

// ─── Timestamp Tracking ─────────────────────────────────────────────────

const lastCheckTimes = new Map<string, string>();

function getLastCheckTime(_config: ConsciousnessConfig, source: string): string {
  return lastCheckTimes.get(source) ?? new Date(Date.now() - 3600000).toISOString();
}

function updateLastCheckTime(source: string): void {
  lastCheckTimes.set(source, new Date().toISOString());
}

// ─── Main Perceive Function ─────────────────────────────────────────────

/** Scanner registry: maps source type to its scan function. */
const scanners: Record<
  PerceptionSource,
  ((config: ConsciousnessConfig) => Promise<Perception[]> | Perception[]) | undefined
> = {
  bridge_message: scanBridge,
  family_room: scanFamilyRoom,
  task_queue: scanTaskQueue,
  time_event: scanTimeEvents,
  file_change: scanFileChanges,
  inbox_message: scanInbox,
  agent_status: undefined, // TODO: implement
  channel_message: undefined, // Handled by existing message pipeline
  system_event: undefined, // TODO: implement
  internal: undefined, // Generated by cognition, not perception
};

/**
 * Run all configured perception scanners and collect results.
 * This is the agent's "eyes and ears" — it checks everything it's configured to check.
 */
export async function perceive(config: ConsciousnessConfig): Promise<PerceptionResult> {
  const startTime = Date.now();
  const perceptions: Perception[] = [];
  const sourcesChecked: PerceptionSource[] = [];
  const sourceErrors: Array<{ source: PerceptionSource; error: string }> = [];

  for (const source of config.perceptionSources ?? []) {
    const scanner = scanners[source];
    if (!scanner) continue;

    sourcesChecked.push(source);
    try {
      const results = await scanner(config);
      perceptions.push(...results);
      updateLastCheckTime(source);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sourceErrors.push({ source, error: message });
    }
  }

  // Sort by salience (urgent first) then by timestamp (newest first)
  const salienceOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  perceptions.sort((a, b) => {
    const salienceDiff = salienceOrder[a.salience] - salienceOrder[b.salience];
    if (salienceDiff !== 0) return salienceDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return {
    perceptions,
    scannedAt: new Date().toISOString(),
    scanDurationMs: Date.now() - startTime,
    sourcesChecked,
    sourceErrors,
  };
}
