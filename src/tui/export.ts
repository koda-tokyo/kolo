import fs from "node:fs/promises";
import path from "node:path";
import { redactSensitiveText } from "../logging/redact.js";

/**
 * `/export` (KoLo 2.0, M10): write the session transcript to a Markdown or JSON file. Secrets are
 * redacted with the same patterns the logs use (`logging.redactPatterns`), and the export always
 * redacts even when log redaction is off, because a file leaves the machine more easily than a log.
 */

export type ExportFormat = "md" | "json";

export type ExportMeta = {
  sessionKey: string;
  agentId?: string;
  model?: string;
  exportedAt: Date;
};

export type ParsedExportArgs = { format: ExportFormat; outPath?: string };

const FORMAT_ALIASES: Record<string, ExportFormat> = {
  md: "md",
  markdown: "md",
  json: "json",
};

export function parseExportArgs(args: string): ParsedExportArgs | { error: string } {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  let format: ExportFormat | undefined;
  let outPath: string | undefined;
  for (const part of parts) {
    const alias = FORMAT_ALIASES[part.toLowerCase()];
    if (alias && !format && outPath === undefined) {
      format = alias;
    } else if (outPath === undefined) {
      outPath = part;
    } else {
      return { error: "usage: /export [md|json] [path]" };
    }
  }
  return { format: format ?? (outPath && /\.json$/i.test(outPath) ? "json" : "md"), outPath };
}

type Block = {
  type?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
};
type Message = {
  role?: string;
  content?: unknown;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp?: number;
  model?: string;
  provider?: string;
};

function asBlocks(content: unknown): Block[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return Array.isArray(content) ? (content as Block[]) : [];
}

function formatTime(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : "";
}

function fence(text: string, lang = ""): string {
  const ticks = text.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${text.replace(/\n$/, "")}\n${ticks}`;
}

function blocksToMarkdown(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      out.push(block.text);
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      out.push(`<details><summary>thinking</summary>\n\n${block.thinking}\n\n</details>`);
    } else if (block.type === "toolCall") {
      const args = JSON.stringify(block.arguments ?? {}, null, 2);
      out.push(`Tool call: \`${block.name ?? "tool"}\`\n\n${fence(args, "json")}`);
    } else if (block.type === "image") {
      out.push("(image omitted)");
    }
  }
  return out;
}

function toolResultText(message: Message): string {
  const blocks = asBlocks(message.content);
  const text = blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  return text || JSON.stringify(message.content ?? "", null, 2);
}

export function renderTranscriptMarkdown(messages: unknown[], meta: ExportMeta): string {
  const lines: string[] = [];
  lines.push(`# Session ${meta.sessionKey}`, "");
  lines.push(`- exported: ${meta.exportedAt.toISOString()}`);
  if (meta.agentId) {
    lines.push(`- agent: ${meta.agentId}`);
  }
  if (meta.model) {
    lines.push(`- model: ${meta.model}`);
  }
  lines.push(`- messages: ${messages.length}`, "");
  for (const raw of messages) {
    const message = (raw ?? {}) as Message;
    const when = formatTime(message.timestamp);
    const stamp = when ? ` (${when})` : "";
    if (message.role === "user") {
      lines.push(`## User${stamp}`, "", ...blocksToMarkdown(asBlocks(message.content)), "");
    } else if (message.role === "assistant") {
      const model = message.model ? ` · ${message.model}` : "";
      lines.push(
        `## Assistant${stamp}${model}`,
        "",
        ...blocksToMarkdown(asBlocks(message.content)),
        "",
      );
    } else if (message.role === "toolResult") {
      const name = message.toolName ?? "tool";
      const state = message.isError ? "error" : "ok";
      lines.push(`### Tool result: ${name} (${state})`, "", fence(toolResultText(message)), "");
    }
  }
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

export function renderTranscriptJson(messages: unknown[], meta: ExportMeta): string {
  return `${JSON.stringify(
    {
      sessionKey: meta.sessionKey,
      ...(meta.agentId ? { agentId: meta.agentId } : {}),
      ...(meta.model ? { model: meta.model } : {}),
      exportedAt: meta.exportedAt.toISOString(),
      messages,
    },
    null,
    2,
  )}\n`;
}

function safeName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "session"
  );
}

export function defaultExportPath(
  cwd: string,
  sessionKey: string,
  format: ExportFormat,
  now: Date,
) {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  return path.join(cwd, `kolo-session-${safeName(sessionKey)}-${stamp}.${format}`);
}

export async function exportTranscript(params: {
  messages: unknown[];
  meta: ExportMeta;
  format: ExportFormat;
  outPath?: string;
  cwd: string;
  /** Extra redaction patterns (`logging.redactPatterns`). */
  redactPatterns?: string[];
}): Promise<{ path: string; bytes: number; messages: number }> {
  const text =
    params.format === "json"
      ? renderTranscriptJson(params.messages, params.meta)
      : renderTranscriptMarkdown(params.messages, params.meta);
  const redacted = redactSensitiveText(text, { mode: "tools", patterns: params.redactPatterns });
  const target = params.outPath
    ? path.resolve(params.cwd, params.outPath)
    : defaultExportPath(params.cwd, params.meta.sessionKey, params.format, params.meta.exportedAt);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, redacted, { encoding: "utf8", flag: "wx" }).catch(async (err) => {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`file exists: ${target}`, { cause: err });
    }
    throw err;
  });
  return {
    path: target,
    bytes: Buffer.byteLength(redacted, "utf8"),
    messages: params.messages.length,
  };
}
