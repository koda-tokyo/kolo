// src/db/client.ts
// PostgreSQL client for KoLo auth + workspace system
//
// Uses raw SQL with type-safe wrappers for simplicity and control.
// No heavy ORM - just clean queries.

import { createHash, randomBytes } from "node:crypto";
import postgres, { type Sql } from "postgres";

// ============================================================================
// Database Connection
// ============================================================================

let sql: ReturnType<typeof postgres> | null = null;

export function initDatabase(url: string): void {
  sql = postgres(url, {
    // Connection pool settings
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Transform column names from snake_case to camelCase? No - we handle this in mappers
    transform: { undefined: null },
  });
  console.log("[db] Database initialized");
}

export function getDb(): ReturnType<typeof postgres> {
  if (!sql) {
    throw new Error("[db] Database not initialized. Call initDatabase(url) first.");
  }
  return sql;
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    console.log("[db] Database connection closed");
  }
}

// ============================================================================
// Query Helper
// ============================================================================

interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/**
 * Execute a parameterized SQL query.
 * Uses $1, $2 placeholder syntax for parameters.
 */
export async function query<T = Record<string, unknown>>(
  sqlText: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any[] = [],
): Promise<QueryResult<T>> {
  const db = getDb();

  // Use postgres.js unsafe for parameterized queries with $1, $2 syntax
  // This is safe because we're using parameterized queries, not string interpolation
  const result = await db.unsafe<T[]>(sqlText, params);

  return {
    rows: result as T[],
    rowCount: result.length,
  };
}

/**
 * Check if database is connected and responding.
 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    const db = getDb();
    await db`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Hash a token for storage (one-way)
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a secure random token
 */
export function generateToken(bytes: number = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// Row Mappers (snake_case → camelCase)
// ============================================================================

export function mapUser(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string | null,
    role: row.role as "member" | "admin",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export function mapWorkspace(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    tier: row.tier as number,
    jpComplianceMode: row.jp_compliance_mode as boolean,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export function mapWorkspaceMember(row: Record<string, unknown>) {
  return {
    workspaceId: row.workspace_id as string,
    userId: row.user_id as string,
    role: row.role as "owner" | "admin" | "member",
    createdAt: new Date(row.created_at as string),
  };
}

export function mapInvite(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    email: row.email as string,
    workspaceId: row.workspace_id as string,
    role: row.role as "owner" | "admin" | "member",
    tokenHash: row.token_hash as string,
    expiresAt: new Date(row.expires_at as string),
    usedAt: row.used_at ? new Date(row.used_at as string) : null,
    createdBy: row.created_by as string | null,
    createdAt: new Date(row.created_at as string),
  };
}

export function mapAuditEvent(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    timestamp: new Date(row.timestamp as string),
    userId: row.user_id as string | null,
    action: row.action as string,
    targetType: row.target_type as string,
    targetId: row.target_id as string | null,
    ipAddress: row.ip_address as string | null,
    metadata: (row.metadata as Record<string, unknown>) || {},
  };
}

export function mapSession(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    tokenHash: row.token_hash as string,
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
    lastUsedAt: new Date(row.last_used_at as string),
  };
}
