// Conversation pause (KoLo 2.0, M14b): `/pause` stops the resident answering in one channel
// conversation until `/resume`. In-memory, mirrored to `<KOLO_HOME>/run/channel-pause.json` so a
// restart keeps the pause. Commands still work while paused; the first dropped message gets a
// one-time notice so the person knows why nothing comes back.
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

export type PauseRecord = {
  key: string;
  channel: string;
  accountId?: string;
  conversationId: string;
  sessionKey: string;
  pausedBy?: string;
  pausedAt: string;
  noticed?: boolean;
};

let records: Map<string, PauseRecord> | null = null;

export function resolvePauseFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "run", "channel-pause.json");
}

export function pauseKey(channel: string, accountId: string | undefined, conversationId: string) {
  return `${channel.toLowerCase()}:${accountId ?? "default"}:${conversationId.toLowerCase()}`;
}

function load(env?: NodeJS.ProcessEnv): Map<string, PauseRecord> {
  if (records) {
    return records;
  }
  records = new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(resolvePauseFile(env), "utf8")) as unknown;
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (entry && typeof entry === "object" && typeof (entry as PauseRecord).key === "string") {
          records.set((entry as PauseRecord).key, entry as PauseRecord);
        }
      }
    }
  } catch {
    // No mirror yet.
  }
  return records;
}

function save(env?: NodeJS.ProcessEnv): void {
  if (!records) {
    return;
  }
  try {
    const file = resolvePauseFile(env);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...records.values()], null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // Mirroring is best-effort; memory stays authoritative.
  }
}

export function getPause(
  input: { channel: string; accountId?: string; conversationId: string },
  env?: NodeJS.ProcessEnv,
): PauseRecord | null {
  return load(env).get(pauseKey(input.channel, input.accountId, input.conversationId)) ?? null;
}

export function pauseConversation(
  input: {
    channel: string;
    accountId?: string;
    conversationId: string;
    sessionKey: string;
    by?: string;
    now?: Date;
  },
  env?: NodeJS.ProcessEnv,
): { created: boolean; record: PauseRecord } {
  const map = load(env);
  const key = pauseKey(input.channel, input.accountId, input.conversationId);
  const existing = map.get(key);
  if (existing) {
    return { created: false, record: existing };
  }
  const record: PauseRecord = {
    key,
    channel: input.channel.toLowerCase(),
    accountId: input.accountId,
    conversationId: input.conversationId,
    sessionKey: input.sessionKey,
    pausedBy: input.by,
    pausedAt: (input.now ?? new Date()).toISOString(),
  };
  map.set(key, record);
  save(env);
  return { created: true, record };
}

export function resumeConversation(
  input: { channel: string; accountId?: string; conversationId: string },
  env?: NodeJS.ProcessEnv,
): boolean {
  const map = load(env);
  const removed = map.delete(pauseKey(input.channel, input.accountId, input.conversationId));
  if (removed) {
    save(env);
  }
  return removed;
}

/** Mark the one-time notice as sent; returns true the first time only. */
export function markPauseNoticed(record: PauseRecord, env?: NodeJS.ProcessEnv): boolean {
  if (record.noticed) {
    return false;
  }
  record.noticed = true;
  save(env);
  return true;
}

export function listPaused(env?: NodeJS.ProcessEnv): PauseRecord[] {
  return [...load(env).values()];
}

export function __resetPauseForTest(): void {
  records = null;
}
