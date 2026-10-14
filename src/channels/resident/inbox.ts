// Channel inbox (KoLo 2.0, M14a): attachments that arrive on a channel are copied under
// `<KOLO_HOME>/inbox/<channel>/<yyyy-mm-dd>/` so tools can read them by path. Size and count
// are capped (`channels.inbox`); oversized files are skipped and reported, never truncated.
import fs from "node:fs";
import path from "node:path";
import type { KoLoConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";

export const INBOX_DEFAULTS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxFilesPerMessage: 8,
  retentionDays: 30,
} as const;

export type InboxLimits = {
  maxFileBytes: number;
  maxFilesPerMessage: number;
  retentionDays: number;
};

export type InboxSaveResult = {
  saved: Array<{ path: string; size: number; name: string }>;
  skipped: Array<{ name: string; reason: "too_large" | "missing" | "limit" }>;
};

export function resolveInboxLimits(cfg?: KoLoConfig): InboxLimits {
  const c = cfg?.channels?.inbox;
  return {
    maxFileBytes: c?.maxFileBytes ?? INBOX_DEFAULTS.maxFileBytes,
    maxFilesPerMessage: c?.maxFilesPerMessage ?? INBOX_DEFAULTS.maxFilesPerMessage,
    retentionDays: c?.retentionDays ?? INBOX_DEFAULTS.retentionDays,
  };
}

export function resolveInboxRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "inbox");
}

function safeChannel(channel: string): string {
  const cleaned = channel.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned || "unknown";
}

function safeName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, "_");
  return base.slice(0, 120) || "file";
}

export function resolveInboxDir(
  channel: string,
  day: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveInboxRoot(env), safeChannel(channel), day.toISOString().slice(0, 10));
}

/** Copy inbound media files into the inbox. Files are copied, never moved. */
export function saveInboundFilesToInbox(input: {
  channel: string;
  messageId?: string | null;
  files: Array<{ path: string; name?: string }>;
  limits: InboxLimits;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): InboxSaveResult {
  const result: InboxSaveResult = { saved: [], skipped: [] };
  if (input.files.length === 0) {
    return result;
  }
  const dir = resolveInboxDir(input.channel, input.now, input.env);
  const prefix = (input.messageId ?? String(Date.now()))
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 48);
  let count = 0;
  for (const file of input.files) {
    const name = safeName(file.name ?? path.basename(file.path));
    if (count >= input.limits.maxFilesPerMessage) {
      result.skipped.push({ name, reason: "limit" });
      continue;
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file.path);
    } catch {
      result.skipped.push({ name, reason: "missing" });
      continue;
    }
    if (!stat.isFile()) {
      result.skipped.push({ name, reason: "missing" });
      continue;
    }
    if (stat.size > input.limits.maxFileBytes) {
      result.skipped.push({ name, reason: "too_large" });
      continue;
    }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = path.join(dir, `${prefix}-${count + 1}-${name}`);
    fs.copyFileSync(file.path, target);
    fs.chmodSync(target, 0o600);
    result.saved.push({ path: target, size: stat.size, name });
    count += 1;
  }
  return result;
}

/** Save a buffer (webhook attachments arrive inline). */
export function saveInboundBufferToInbox(input: {
  channel: string;
  messageId?: string | null;
  name: string;
  data: Buffer;
  index?: number;
  limits: InboxLimits;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): { path: string; size: number } | { skipped: "too_large" } {
  if (input.data.byteLength > input.limits.maxFileBytes) {
    return { skipped: "too_large" };
  }
  const dir = resolveInboxDir(input.channel, input.now, input.env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const prefix = (input.messageId ?? String(Date.now()))
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 48);
  const target = path.join(dir, `${prefix}-${(input.index ?? 0) + 1}-${safeName(input.name)}`);
  fs.writeFileSync(target, input.data, { mode: 0o600 });
  return { path: target, size: input.data.byteLength };
}

/** Remove inbox day folders older than the retention window. Returns removed folder count. */
export function pruneInbox(input: {
  retentionDays: number;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): number {
  const root = resolveInboxRoot(input.env);
  if (input.retentionDays <= 0 || !fs.existsSync(root)) {
    return 0;
  }
  const cutoff = (input.now ?? new Date()).getTime() - input.retentionDays * 86_400_000;
  let removed = 0;
  for (const channel of fs.readdirSync(root)) {
    const channelDir = path.join(root, channel);
    let days: string[] = [];
    try {
      days = fs.readdirSync(channelDir);
    } catch {
      continue;
    }
    for (const day of days) {
      const ts = Date.parse(`${day}T00:00:00Z`);
      if (Number.isFinite(ts) && ts < cutoff) {
        fs.rmSync(path.join(channelDir, day), { recursive: true, force: true });
        removed += 1;
      }
    }
  }
  return removed;
}

export function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${Math.round(n / 1024)} KiB`;
  }
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MiB`;
}
