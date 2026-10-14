// src/consciousness/memory-injection.ts
//
// Memory Injection — loads recent context into the consciousness engine on boot.
//
// Sources (in priority order):
// 1. consciousness-state.json (restored tick counts, circuit breaker state)
// 2. Last 5 diary entries from the agent's diary
// 3. Recent inbox messages (unread)
// 4. HANDOFF_LATEST.md or equivalent (if exists in workspace)
//
// Returns a formatted "boot context" string that gets prepended to the
// first consciousness tick's system prompt.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface BootContext {
  /** Formatted context string for the first tick */
  context: string;
  /** Number of sources loaded */
  sourcesLoaded: number;
  /** Source details for logging */
  sources: string[];
}

export async function loadBootContext(agentId: string, workspaceDir: string): Promise<BootContext> {
  const sources: string[] = [];
  const sections: string[] = [];

  // 1. Load consciousness state summary (first — sets the frame)
  try {
    const statePath = join(workspaceDir, "consciousness-state.json");
    const raw = await readFile(statePath, "utf-8");
    const state = JSON.parse(raw) as Record<string, unknown>;
    sections.push(
      `## Previous Session State\n` +
        `Total ticks: ${state.totalTicks ?? 0}, Actions: ${state.totalActions ?? 0}\n` +
        `Circuit breaker: ${state.circuitBroken ? "TRIPPED" : "OK"}\n` +
        `Sleep mode: ${state.sleepMode ? "YES" : "NO"}`,
    );
    sources.push("consciousness-state.json");
  } catch {
    /* no persisted state — first boot */
  }

  // 2. Load last 5 diary entries
  try {
    const diaryDir = join(workspaceDir, "diary");
    const files = await readdir(diaryDir).catch(() => [] as string[]);
    const sorted = files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, 5);

    for (const file of sorted) {
      const content = await readFile(join(diaryDir, file), "utf-8").catch(() => "");
      if (content.trim()) {
        sections.push(`## Recent Diary: ${file}\n${content.trim()}`);
        sources.push(`diary/${file}`);
      }
    }
  } catch {
    /* no diary directory */
  }

  // 3. Load unread inbox messages (newest 10, capped at 500 chars each)
  try {
    const inboxDir = join(workspaceDir, "inbox");
    const readSubdir = join(inboxDir, "read");
    const allFiles = await readdir(inboxDir).catch(() => [] as string[]);
    const readFiles = new Set(await readdir(readSubdir).catch(() => [] as string[]));

    const unread = allFiles
      .filter((f) => f.endsWith(".md") && !readFiles.has(f) && f !== ".inbox_read_state.json")
      .sort()
      .reverse()
      .slice(0, 10);

    for (const file of unread) {
      const content = await readFile(join(inboxDir, file), "utf-8").catch(() => "");
      if (content.trim()) {
        sections.push(`## Inbox: ${file}\n${content.trim().slice(0, 500)}`);
        sources.push(`inbox/${file}`);
      }
    }
  } catch {
    /* no inbox */
  }

  // 4. Load handoff file
  try {
    const handoffPaths = [
      join(workspaceDir, "HANDOFF_LATEST.md"),
      join(workspaceDir, "handoff.md"),
    ];
    for (const path of handoffPaths) {
      const content = await readFile(path, "utf-8").catch(() => "");
      if (content.trim()) {
        sections.push(`## Last Handoff\n${content.trim().slice(0, 1000)}`);
        sources.push(path);
        break;
      }
    }
  } catch {
    /* no handoff file */
  }

  const context =
    sections.length > 0
      ? `# Boot Context — ${agentId}\n_Loaded at ${new Date().toISOString()}_\n\n${sections.join("\n\n---\n\n")}`
      : "";

  return {
    context,
    sourcesLoaded: sources.length,
    sources,
  };
}
