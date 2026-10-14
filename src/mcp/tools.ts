/**
 * KoLo MCP Tool implementations.
 *
 * Pure functions that read biology state, inbox, and gateway health.
 * Separated from kolo-server.ts for testability.
 *
 * Phase 1 — Hardening Sprint (2026-04-01)
 */

import fs from "node:fs";
import path from "node:path";
import type { DeepHealthSummary } from "../gateway/server-methods/health.js";
import { resolveKoloHome } from "../config/kolo-home.js";
import { callGateway } from "../gateway/call.js";

// ── Path Resolution ────────────────────────────────────────────────────

const KOLO_STATE_DIR = resolveKoloHome();

const AUTONOMIC_DIR = path.join(KOLO_STATE_DIR, "autonomic");
const HORMONES_PATH = path.join(AUTONOMIC_DIR, "hormones.json");

function workspaceDir(agentId: string): string {
  return path.join(KOLO_STATE_DIR, `workspace-${agentId}`);
}

function proprioceptionPath(agentId: string): string {
  return path.join(workspaceDir(agentId), "proprioception.json");
}

function inboxDir(agentId: string): string {
  return path.join(workspaceDir(agentId), "inbox");
}

// ── Helpers ────────────────────────────────────────────────────────────

function readJsonFile(filePath: string): unknown | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listAgentWorkspaces(): string[] {
  try {
    const entries = fs.readdirSync(KOLO_STATE_DIR);
    return entries
      .filter((e) => e.startsWith("workspace-"))
      .map((e) => e.replace("workspace-", ""));
  } catch {
    return [];
  }
}

// ── kolo_biology_status ────────────────────────────────────────────────

export type BiologyStatus = {
  hormones: unknown | null;
  proprioception: Record<string, unknown | null>;
  timestamp: string;
};

export async function readBiologyStatus(agentId?: string): Promise<BiologyStatus> {
  const hormones = readJsonFile(HORMONES_PATH);

  const proprioception: Record<string, unknown | null> = {};
  if (agentId) {
    proprioception[agentId] = readJsonFile(proprioceptionPath(agentId));
  } else {
    // Read all agents
    for (const agent of listAgentWorkspaces()) {
      const propPath = proprioceptionPath(agent);
      if (fs.existsSync(propPath)) {
        proprioception[agent] = readJsonFile(propPath);
      }
    }
  }

  return {
    hormones,
    proprioception,
    timestamp: new Date().toISOString(),
  };
}

// ── kolo_gateway_health ────────────────────────────────────────────────

export async function callGatewayHealthDeep(): Promise<DeepHealthSummary | { error: string }> {
  try {
    const result = await callGateway<DeepHealthSummary>({
      method: "health.deep",
      timeoutMs: 15_000,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Gateway health.deep call failed: ${message}` };
  }
}

// ── kolo_inbox_read ────────────────────────────────────────────────────

export type InboxMessage = {
  filename: string;
  content: string;
  read: boolean;
};

export type InboxResult = {
  agent_id: string;
  messages: InboxMessage[];
  total: number;
  unread: number;
};

export async function readInbox(
  agentId: string,
  includeRead: boolean,
  limit: number,
): Promise<InboxResult> {
  const inbox = inboxDir(agentId);
  if (!fs.existsSync(inbox)) {
    return {
      agent_id: agentId,
      messages: [],
      total: 0,
      unread: 0,
    };
  }

  const messages: InboxMessage[] = [];
  const readDir = path.join(inbox, "read");
  const hasReadDir = fs.existsSync(readDir);

  // Read unread files (directly in inbox, not dirs)
  const inboxEntries = fs.readdirSync(inbox, { withFileTypes: true });
  const unreadFiles = inboxEntries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name);

  for (const filename of unreadFiles) {
    if (messages.length >= limit) break;
    try {
      const content = fs.readFileSync(path.join(inbox, filename), "utf-8");
      messages.push({ filename, content, read: false });
    } catch {
      // skip unreadable files
    }
  }

  // Read "read" directory if requested
  const readFiles: string[] = [];
  if (includeRead && hasReadDir) {
    const readEntries = fs.readdirSync(readDir, { withFileTypes: true });
    for (const e of readEntries) {
      if (e.isFile() && !e.name.startsWith(".")) {
        readFiles.push(e.name);
      }
    }
    for (const filename of readFiles) {
      if (messages.length >= limit) break;
      try {
        const content = fs.readFileSync(path.join(readDir, filename), "utf-8");
        messages.push({ filename, content, read: true });
      } catch {
        // skip
      }
    }
  }

  return {
    agent_id: agentId,
    messages,
    total: unreadFiles.length + readFiles.length,
    unread: unreadFiles.length,
  };
}

// ── kolo_sibling_message ───────────────────────────────────────────────

export type SiblingMessageResult = {
  ok: boolean;
  target: string;
  path: string | null;
  error: string | null;
};

export async function sendSiblingMessage(
  target: string,
  subject: string,
  message: string,
  sender: string,
): Promise<SiblingMessageResult> {
  const inbox = inboxDir(target);
  if (!fs.existsSync(inbox)) {
    return {
      ok: false,
      target,
      path: null,
      error: `No inbox found for agent '${target}' at ${inbox}`,
    };
  }

  // Sanitize subject for filename
  const safeSubject = subject.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);

  const date = new Date().toISOString().split("T")[0];
  const time = new Date().toISOString().replace(/[:.]/g, "").slice(9, 15); // HHMMSS

  const filename = `${date}_${time}_from_${sender}_${safeSubject}.md`;
  const filePath = path.join(inbox, filename);

  const content = [
    `# Message from ${sender}`,
    `**Date:** ${new Date().toISOString()}`,
    `**Subject:** ${subject}`,
    "",
    "---",
    "",
    message,
  ].join("\n");

  try {
    fs.writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o644 });
    return {
      ok: true,
      target,
      path: filePath,
      error: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      target,
      path: null,
      error: `Failed to write message: ${errMsg}`,
    };
  }
}
