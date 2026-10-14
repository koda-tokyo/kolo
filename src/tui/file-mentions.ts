import fs from "node:fs/promises";
import path from "node:path";

/**
 * `@` file references (KoLo 2.0, M10). The editor completes `@path` (or `@"path with spaces"`)
 * from the working directory; before a message is sent, each reference that names a readable
 * text file is appended to the message as a fenced block, bounded per file and in total. The
 * chat log shows the typed line, not the attached content.
 */

export const FILE_MENTION_DEFAULT_MAX_FILE_BYTES = 64 * 1024;
export const FILE_MENTION_DEFAULT_MAX_TOTAL_BYTES = 256 * 1024;
export const FILE_MENTION_DEFAULT_MAX_FILES = 10;

export type FileMention = { token: string; path: string };

const MENTION = /(?:^|[\s(,;])@(?:"([^"]+)"|([^\s"'<>]+))/g;

export function parseFileMentions(text: string): FileMention[] {
  const out: FileMention[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION)) {
    const raw = (match[1] ?? match[2] ?? "").replace(/[.,;:!?)]+$/, "");
    if (!raw || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    out.push({ token: match[1] ? `@"${raw}"` : `@${raw}`, path: raw });
  }
  return out;
}

export type ExpandedMessage = {
  message: string;
  attached: Array<{ path: string; bytes: number }>;
  skipped: Array<{ path: string; reason: "too-large" | "binary" | "budget" | "unreadable" }>;
};

function looksBinary(data: Buffer): boolean {
  const probe = data.subarray(0, 8192);
  return probe.includes(0);
}

function fence(text: string): string {
  const ticks = text.includes("```") ? "````" : "```";
  return `${ticks}\n${text.replace(/\n$/, "")}\n${ticks}`;
}

export async function expandFileMentions(
  text: string,
  options: {
    cwd: string;
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxFiles?: number;
  },
): Promise<ExpandedMessage> {
  const maxFileBytes = options.maxFileBytes ?? FILE_MENTION_DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? FILE_MENTION_DEFAULT_MAX_TOTAL_BYTES;
  const maxFiles = options.maxFiles ?? FILE_MENTION_DEFAULT_MAX_FILES;
  const attached: ExpandedMessage["attached"] = [];
  const skipped: ExpandedMessage["skipped"] = [];
  const blocks: string[] = [];
  let budget = maxTotalBytes;
  for (const mention of parseFileMentions(text)) {
    const absolute = path.resolve(options.cwd, mention.path);
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absolute);
    } catch {
      continue; // not a file: an ordinary mention, left as typed
    }
    if (!stat.isFile()) {
      continue;
    }
    if (attached.length >= maxFiles) {
      skipped.push({ path: mention.path, reason: "budget" });
      continue;
    }
    if (stat.size > maxFileBytes) {
      skipped.push({ path: mention.path, reason: "too-large" });
      continue;
    }
    if (stat.size > budget) {
      skipped.push({ path: mention.path, reason: "budget" });
      continue;
    }
    let data: Buffer;
    try {
      data = await fs.readFile(absolute);
    } catch {
      skipped.push({ path: mention.path, reason: "unreadable" });
      continue;
    }
    if (looksBinary(data)) {
      skipped.push({ path: mention.path, reason: "binary" });
      continue;
    }
    budget -= data.length;
    const relative = path.relative(options.cwd, absolute) || mention.path;
    const shown = relative.startsWith("..") ? absolute : relative;
    blocks.push(`File: ${shown}\n${fence(data.toString("utf8"))}`);
    attached.push({ path: shown, bytes: data.length });
  }
  return {
    message: blocks.length > 0 ? `${text}\n\n${blocks.join("\n\n")}` : text,
    attached,
    skipped,
  };
}
