import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { requireNodeSqlite } from "../memory/sqlite.js";

const log = createSubsystemLogger("sibling-chat-db");

export type SiblingMessageRow = {
  id: string;
  runId: string;
  from: string;
  to: string;
  text: string;
  attachments: string | null; // JSON
  seq: number;
  timestamp: string;
  deliveredAt: string | null;
  readAt: string | null;
};

export type SiblingMessageInsert = {
  runId: string;
  from: string;
  to: string;
  text: string;
  attachments?: Array<Record<string, unknown>>;
};

export function initSiblingChatDb(dbPath: string): DatabaseSync {
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sibling_messages (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      from_sibling TEXT NOT NULL,
      to_sibling TEXT NOT NULL,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      attachments TEXT,
      timestamp TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation
      ON sibling_messages(from_sibling, to_sibling, seq);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_undelivered
      ON sibling_messages(to_sibling, delivered_at)
      WHERE delivered_at IS NULL;
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_run_id
      ON sibling_messages(run_id);
  `);

  log.info(`Sibling chat DB initialized at ${dbPath}`);
  return db;
}

export function getNextSeq(db: DatabaseSync, from: string, to: string): number {
  const normalizedFrom = from.toLowerCase();
  const normalizedTo = to.toLowerCase();
  // Get max seq for this conversation pair (order-independent)
  const row = db
    .prepare(`
    SELECT MAX(seq) as maxSeq FROM sibling_messages
    WHERE (from_sibling = ? AND to_sibling = ?)
       OR (from_sibling = ? AND to_sibling = ?)
  `)
    .get(normalizedFrom, normalizedTo, normalizedTo, normalizedFrom) as { maxSeq: number | null };

  return (row?.maxSeq ?? 0) + 1;
}

export function insertMessage(db: DatabaseSync, msg: SiblingMessageInsert): SiblingMessageRow {
  const id = randomUUID();
  const seq = getNextSeq(db, msg.from, msg.to);
  const now = new Date().toISOString();
  const attachments = msg.attachments ? JSON.stringify(msg.attachments) : null;

  db.prepare(`
    INSERT INTO sibling_messages (id, run_id, from_sibling, to_sibling, seq, text, attachments, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    msg.runId,
    msg.from.toLowerCase(),
    msg.to.toLowerCase(),
    seq,
    msg.text,
    attachments,
    now,
  );

  return {
    id,
    runId: msg.runId,
    from: msg.from.toLowerCase(),
    to: msg.to.toLowerCase(),
    text: msg.text,
    attachments,
    seq,
    timestamp: now,
    deliveredAt: now,
    readAt: null,
  };
}

function mapRowToMessage(row: Record<string, unknown>): SiblingMessageRow {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    from: row.from_sibling as string,
    to: row.to_sibling as string,
    text: row.text as string,
    attachments: row.attachments as string | null,
    seq: row.seq as number,
    timestamp: row.timestamp as string,
    deliveredAt: row.delivered_at as string | null,
    readAt: row.read_at as string | null,
  };
}

export function getConversationHistory(
  db: DatabaseSync,
  siblingA: string,
  siblingB: string,
  limit: number,
  before?: string,
): { messages: SiblingMessageRow[]; hasMore: boolean; nextCursor?: string } {
  const a = siblingA.toLowerCase();
  const b = siblingB.toLowerCase();

  // The cursor is the seq of the oldest message on the previous page, which is what the
  // page order is keyed on. A timestamp cursor (millisecond ISO string) is kept for older
  // clients, but it is lossy: messages written in the same millisecond as the boundary
  // message are skipped, which a fast disk reproduces on every run.
  const seqCursor = before !== undefined && /^\d+$/.test(before) ? Number(before) : undefined;
  const whereClause = before
    ? `WHERE ((from_sibling = ? AND to_sibling = ?) OR (from_sibling = ? AND to_sibling = ?))
       AND ${seqCursor !== undefined ? "seq < ?" : "timestamp < ?"}`
    : `WHERE (from_sibling = ? AND to_sibling = ?) OR (from_sibling = ? AND to_sibling = ?)`;

  const params = before ? [a, b, b, a, seqCursor ?? before] : [a, b, b, a];

  // Fetch limit + 1 to determine hasMore
  const rows = db
    .prepare(`
    SELECT * FROM sibling_messages
    ${whereClause}
    ORDER BY seq DESC
    LIMIT ?
  `)
    .all(...params, limit + 1) as Record<string, unknown>[];

  const hasMore = rows.length > limit;
  const messages = hasMore ? rows.slice(0, limit) : rows;

  // Reverse to get chronological order and map to camelCase
  messages.reverse();
  const mappedMessages = messages.map(mapRowToMessage);

  const nextCursor =
    hasMore && mappedMessages.length > 0 ? String(mappedMessages[0].seq) : undefined;

  return { messages: mappedMessages, hasMore, nextCursor };
}

export function markAsRead(db: DatabaseSync, withSibling: string, upToSeq?: number): number {
  const now = new Date().toISOString();
  const sibling = withSibling.toLowerCase();

  // We need to find messages where this sibling is the recipient
  // and mark them as read. Since we don't track the current reader in DB,
  // we mark all undelivered messages from this sibling as read.
  const stmt = upToSeq
    ? db.prepare(`
        UPDATE sibling_messages
        SET read_at = ?
        WHERE from_sibling = ? AND delivered_at IS NULL AND seq <= ?
      `)
    : db.prepare(`
        UPDATE sibling_messages
        SET read_at = ?
        WHERE from_sibling = ? AND delivered_at IS NULL
      `);

  const result = upToSeq ? stmt.run(now, sibling, upToSeq) : stmt.run(now, sibling);

  return (result as { changes: number }).changes;
}

export function getMessageByRunId(db: DatabaseSync, runId: string): SiblingMessageRow | undefined {
  const row = db
    .prepare(`
    SELECT * FROM sibling_messages WHERE run_id = ?
  `)
    .get(runId) as Record<string, unknown> | undefined;

  if (!row) return undefined;

  // Map snake_case to camelCase
  return {
    id: row.id as string,
    runId: row.run_id as string,
    from: row.from_sibling as string,
    to: row.to_sibling as string,
    text: row.text as string,
    attachments: row.attachments as string | null,
    seq: row.seq as number,
    timestamp: row.timestamp as string,
    deliveredAt: row.delivered_at as string | null,
    readAt: row.read_at as string | null,
  };
}

export function getUndeliveredMessages(db: DatabaseSync, toSibling: string): SiblingMessageRow[] {
  const rows = db
    .prepare(`
    SELECT * FROM sibling_messages
    WHERE to_sibling = ? AND delivered_at IS NULL
    ORDER BY seq ASC
  `)
    .all(toSibling.toLowerCase()) as Record<string, unknown>[];

  return rows.map(mapRowToMessage);
}

export function markAsDelivered(db: DatabaseSync, runId: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare(`
    UPDATE sibling_messages SET delivered_at = ? WHERE run_id = ?
  `)
    .run(now, runId);

  return ((result as { changes: number }).changes ?? 0) > 0;
}
