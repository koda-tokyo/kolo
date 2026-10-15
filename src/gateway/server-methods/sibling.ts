import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";
import { loadConfig } from "../../config/config.js";
import { resolveKoloHome } from "../../config/kolo-home.js";
import { resolveSiblingInboxDir } from "../../config/sibling-paths.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSiblingHistoryParams,
  validateSiblingReadParams,
  validateSiblingSendParams,
  validateSiblingSubscribeParams,
} from "../protocol/index.js";
import {
  initSiblingChatDb,
  insertMessage,
  getConversationHistory,
  markAsRead,
  getMessageByRunId,
  getUndeliveredMessages,
  markAsDelivered,
  type SiblingMessageRow,
} from "../sibling-chat-db.js";
import { formatForLog } from "../ws-log.js";

// ── Singleton DB (initialized on first handler use) ────────────────────────────

let _db: DatabaseSync | null = null;
let _dbPath: string | null = null;

/** Reset the singleton DB — used in tests to isolate test cases */
export function resetSiblingDb(): void {
  _db = null;
  _dbPath = null;
  rateLimitMap.clear();
}

export function setSiblingDb(db: DatabaseSync, dbPath: string): void {
  _db = db;
  _dbPath = dbPath;
}

function getSiblingChatDb(context: GatewayRequestContext): DatabaseSync {
  if (!_db) {
    // Derive DB path from gateway config
    const configDir = context.cronStorePath
      ? path.dirname(context.cronStorePath)
      : resolveKoloHome();
    _dbPath = path.join(configDir, "sibling-chat.db");
    _db = initSiblingChatDb(_dbPath);
  }
  return _db;
}

// ── Known siblings (validated at handler level) ────────────────────────────────

// Peer agents are whatever the configuration declares (`agents.list[].id`), never a fixed
// roster. The config loader caches, so this is cheap per call.
function knownSiblings(): Set<string> {
  try {
    const cfg = loadConfig();
    return new Set((cfg.agents?.list ?? []).map((agent) => agent.id.toLowerCase()));
  } catch {
    return new Set();
  }
}

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function validateSiblingName(name: string): string | null {
  const normalized = name.toLowerCase().trim();
  if (!AGENT_ID_RE.test(normalized)) {
    return `invalid agent id: ${name}`;
  }
  // With no roster configured (agents.list empty) any well-formed id is accepted; with a
  // roster, only its members are.
  const roster = knownSiblings();
  if (roster.size > 0 && !roster.has(normalized)) {
    return `unknown sibling: ${name}`;
  }
  return null;
}

// ── Rate limiter (in-memory, per-sibling pair) ─────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_MESSAGES = 30; // per pair per window

type RateLimitEntry = {
  timestamps: number[];
};

const rateLimitMap = new Map<string, RateLimitEntry>();

function getRateLimitKey(from: string, to: string): string {
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function checkRateLimit(from: string, to: string): { ok: boolean; retryAfterMs?: number } {
  const key = getRateLimitKey(from, to);
  const now = Date.now();
  let entry = rateLimitMap.get(key);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitMap.set(key, entry);
  }

  // Prune old timestamps
  entry.timestamps = entry.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

  if (entry.timestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfter = RATE_LIMIT_WINDOW_MS - (now - oldestInWindow);
    return { ok: false, retryAfterMs: Math.max(retryAfter, 1000) };
  }

  entry.timestamps.push(now);
  return { ok: true };
}

// Clean up rate limit entries periodically (every 5 minutes). unref: this module is imported
// transitively by CLI subcommands, and a referenced interval would keep every `kolo` process
// alive after its command finished (seen as a hang in `kurahi completion --install`).
const rateLimitPrune = setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
      if (entry.timestamps.length === 0) {
        rateLimitMap.delete(key);
      }
    }
  },
  5 * 60 * 1000,
);
rateLimitPrune.unref?.();

// ── File inbox fallback ────────────────────────────────────────────────────────

function writeToFileInbox(
  context: GatewayRequestContext,
  from: string,
  to: string,
  text: string,
  runId: string,
): string {
  const inboxDir = path.join(resolveSiblingInboxDir(to), "sibling-chat");

  try {
    fs.mkdirSync(inboxDir, { recursive: true });
  } catch {
    // Directory may already exist
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `from_${from}_${timestamp}_${runId.slice(0, 8)}.md`;
  const filepath = path.join(inboxDir, filename);

  const content = `---
from: ${from}
to: ${to}
runId: ${runId}
timestamp: ${new Date().toISOString()}
---

${text}
`;

  try {
    fs.writeFileSync(filepath, content, "utf-8");
    context.logGateway.info(`Sibling chat file inbox: wrote ${filepath}`);
    return filepath;
  } catch (err) {
    context.logGateway.error(`Failed to write sibling chat to file inbox: ${formatForLog(err)}`);
    return "";
  }
}

// ── Handlers ───────────────────────────────────────────────────────────────────

export const siblingHandlers: GatewayRequestHandlers = {
  "sibling.send": async ({ params, respond, context, client }) => {
    if (!validateSiblingSendParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sibling.send params: ${formatValidationErrors(validateSiblingSendParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as {
      to: string;
      text: string;
      attachments?: Array<{
        type?: string;
        mimeType?: string;
        fileName?: string;
        content?: string;
      }>;
      idempotencyKey: string;
    };

    // Validate target sibling
    const siblingError = validateSiblingName(p.to);
    if (siblingError) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, siblingError));
      return;
    }

    // Validate sender (from client identity)
    const senderName = client?.connect?.client?.id ?? "unknown";
    // Extract the agent name from the client id (e.g. "alice" from "alice-tui")
    const fromSibling = senderName.split("-")[0]?.toLowerCase() || senderName.toLowerCase();
    const senderError = validateSiblingName(fromSibling);
    if (senderError) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `invalid sender: ${senderError}`),
      );
      return;
    }

    // Check text is not empty
    const text = (p.text || "").trim();
    if (!text && (!p.attachments || p.attachments.length === 0)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message text or attachments required"),
      );
      return;
    }

    // Check text size limit (4KB)
    if (text.length > 4096) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "message text exceeds 4KB limit"),
      );
      return;
    }

    // Rate limit check
    const rateLimit = checkRateLimit(fromSibling, p.to);
    if (!rateLimit.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "rate limit exceeded", {
          retryable: true,
          retryAfterMs: rateLimit.retryAfterMs,
        }),
      );
      return;
    }

    // Check idempotency (dedup)
    const dedupeKey = `sibling.send:${p.idempotencyKey}`;
    const cached = context.dedupe.get(dedupeKey);
    if (cached) {
      respond(cached.ok, cached.payload, cached.error, { cached: true });
      return;
    }

    const runId = p.idempotencyKey || randomUUID();

    try {
      const db = getSiblingChatDb(context);

      // Insert message
      const row = insertMessage(db, {
        runId,
        from: fromSibling,
        to: p.to.toLowerCase(),
        text,
        attachments: p.attachments,
      });

      // Build event payload for real-time delivery
      const eventPayload = {
        type: "message",
        from: row.from,
        text: row.text,
        attachments: p.attachments,
        seq: row.seq,
        runId: row.runId,
        timestamp: row.timestamp,
      };

      // Broadcast to all subscribers (the recipient's connected clients will receive it)
      context.broadcast("sibling", eventPayload);

      // Also try node-specific delivery if the recipient has a connected node
      context.nodeSendToAllSubscribed("sibling", {
        ...eventPayload,
        to: p.to.toLowerCase(),
      });

      // File inbox fallback (always write for offline persistence)
      const inboxPath = writeToFileInbox(context, fromSibling, p.to.toLowerCase(), text, runId);

      const resultPayload = {
        ok: true,
        runId,
        seq: row.seq,
        inboxPath: inboxPath || undefined,
      };

      context.dedupe.set(dedupeKey, {
        ts: Date.now(),
        ok: true,
        payload: resultPayload,
      });

      respond(true, resultPayload);
    } catch (err) {
      const error = errorShape(ErrorCodes.UNAVAILABLE, `sibling.send failed: ${formatForLog(err)}`);
      context.dedupe.set(dedupeKey, {
        ts: Date.now(),
        ok: false,
        error,
      });
      respond(false, undefined, error);
    }
  },

  "sibling.subscribe": async ({ params, respond, context, client }) => {
    if (!validateSiblingSubscribeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sibling.subscribe params: ${formatValidationErrors(validateSiblingSubscribeParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as { from?: string };

    // Validate filter if provided
    if (p.from) {
      const filterError = validateSiblingName(p.from);
      if (filterError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, filterError));
        return;
      }
    }

    // Subscribe the client to sibling events
    // The actual event delivery happens via context.broadcast("sibling", ...)
    // This handler just acknowledges the subscription
    const senderName = client?.connect?.client?.id ?? "unknown";
    const subscriberSibling = senderName.split("-")[0]?.toLowerCase() || senderName.toLowerCase();

    // Deliver any undelivered messages from the inbox
    try {
      const db = getSiblingChatDb(context);
      const undelivered = getUndeliveredMessages(db, subscriberSibling);

      for (const msg of undelivered) {
        if (p.from && msg.from !== p.from.toLowerCase()) {
          continue;
        }

        // Mark as delivered
        markAsDelivered(db, msg.runId);

        // Send to client
        respond(true, {
          type: "message",
          from: msg.from,
          text: msg.text,
          attachments: msg.attachments ? JSON.parse(msg.attachments) : undefined,
          seq: msg.seq,
          runId: msg.runId,
          timestamp: msg.timestamp,
        });
      }
    } catch (err) {
      context.logGateway.warn(`sibling.subscribe: failed to deliver backlog: ${formatForLog(err)}`);
    }

    respond(true, {
      ok: true,
      subscribed: true,
      subscriber: subscriberSibling,
      filterFrom: p.from || null,
    });
  },

  "sibling.history": async ({ params, respond, context, client }) => {
    if (!validateSiblingHistoryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sibling.history params: ${formatValidationErrors(validateSiblingHistoryParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as {
      with: string;
      limit?: number;
      before?: string;
    };

    // Validate sibling name
    const siblingError = validateSiblingName(p.with);
    if (siblingError) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, siblingError));
      return;
    }

    // Get sender from client identity
    const senderName = client?.connect?.client?.id ?? "unknown";
    const fromSibling = senderName.split("-")[0]?.toLowerCase() || senderName.toLowerCase();

    const db = getSiblingChatDb(context);

    try {
      const limit = Math.min(p.limit ?? 50, 500);
      const result = getConversationHistory(db, fromSibling, p.with, limit, p.before);

      respond(true, {
        messages: result.messages.map((m) => ({
          id: m.id,
          runId: m.runId,
          from: m.from,
          to: m.to,
          text: m.text,
          attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
          seq: m.seq,
          timestamp: m.timestamp,
          deliveredAt: m.deliveredAt,
          readAt: m.readAt,
        })),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
      });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sibling.history failed: ${formatForLog(err)}`),
      );
    }
  },

  "sibling.read": async ({ params, respond, context }) => {
    if (!validateSiblingReadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sibling.read params: ${formatValidationErrors(validateSiblingReadParams.errors)}`,
        ),
      );
      return;
    }

    const p = params as {
      with: string;
      upToSeq?: number;
    };

    const siblingError = validateSiblingName(p.with);
    if (siblingError) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, siblingError));
      return;
    }

    try {
      const db = getSiblingChatDb(context);
      const changes = markAsRead(db, p.with, p.upToSeq);
      respond(true, { ok: true, markedRead: changes });
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, `sibling.read failed: ${formatForLog(err)}`),
      );
    }
  },
};
