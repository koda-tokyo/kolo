// src/db/audit.ts
// Centralized audit logging for Kurahi
//
// "Audit log from day 1 - trust is built by default, not retrofitted"

import type { CreateAuditEvent, AuditEvent } from "./types.js";
import { auditSafe } from "../audit/audit-log.js";
import { query, mapAuditEvent, generateId } from "./client.js";

// ============================================================================
// Audit Event Actions (canonical list)
// ============================================================================
export const AUDIT_ACTIONS = {
  // Auth
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",

  // Workspace
  WORKSPACE_CREATE: "workspace.create",
  WORKSPACE_UPDATE: "workspace.update",
  WORKSPACE_INVITE_CREATE: "workspace.invite_create",
  WORKSPACE_INVITE_USE: "workspace.invite_use",

  // Covenant
  COVENANT_CREATE: "covenant.create",
  COVENANT_UPDATE: "covenant.update",

  // Engine
  ENGINE_SELECT: "engine.select",
  ENGINE_POLICY_VIOLATION: "engine.policy_violation",

  // Admin views (visibility is part of governance)
  ADMIN_VIEW_COVENANT: "admin.view_covenant",
  ADMIN_VIEW_CONTINUITY: "admin.view_continuity",
  ADMIN_VIEW_USER: "admin.view_user",
  ADMIN_VIEW_WORKSPACE: "admin.view_workspace",
  ADMIN_VIEW_AUDIT: "admin.view_audit",
} as const;

// ============================================================================
// Log Audit Event (THE central function - call everywhere)
// ============================================================================

/**
 * Log an audit event. Call this from EVERYWHERE that matters:
 * - Login/logout
 * - Invite create/use
 * - Covenant create/update
 * - Engine selection
 * - Admin views
 *
 * @example
 * await logAudit({
 *   userId: currentUser.id,
 *   action: AUDIT_ACTIONS.WORKSPACE_INVITE_CREATE,
 *   targetType: "invite",
 *   targetId: invite.id,
 *   ipAddress: req.ip,
 *   metadata: { email: invite.email, workspaceId: invite.workspaceId }
 * });
 */
export async function logAudit(event: CreateAuditEvent): Promise<string> {
  const id = generateId();
  // M2b: mirror into the hash-chained file log (survives DB loss; tamper-evident).
  void auditSafe({
    identity: event.userId ?? null,
    action: event.action,
    outcome: "ok",
    source: "admin-api",
    detail: {
      id,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      ip: event.ipAddress ?? null,
      metadata: event.metadata ?? null,
    },
  });
  const sql = `
    INSERT INTO audit_events (id, user_id, action, target_type, target_id, ip_address, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `;

  const result = await query(sql, [
    id,
    event.userId ?? null,
    event.action,
    event.targetType,
    event.targetId ?? null,
    event.ipAddress ?? null,
    JSON.stringify(event.metadata ?? {}),
  ]);

  return result.rows[0].id as string;
}

// ============================================================================
// Query Audit Events (for Control Room)
// ============================================================================

export interface AuditQueryOptions {
  userId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  cursor?: string; // ISO timestamp for cursor-based pagination
}

/**
 * Query audit events with filters and cursor pagination.
 * Returns events in reverse chronological order.
 */
export async function queryAuditEvents(
  options: AuditQueryOptions = {},
): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const { userId, action, targetType, targetId, startDate, endDate, limit = 50, cursor } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (cursor) {
    conditions.push(`timestamp < $${paramIndex++}`);
    params.push(cursor);
  }

  if (userId) {
    conditions.push(`user_id = $${paramIndex++}`);
    params.push(userId);
  }

  if (action) {
    conditions.push(`action = $${paramIndex++}`);
    params.push(action);
  }

  if (targetType) {
    conditions.push(`target_type = $${paramIndex++}`);
    params.push(targetType);
  }

  if (targetId) {
    conditions.push(`target_id = $${paramIndex++}`);
    params.push(targetId);
  }

  if (startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(startDate.toISOString());
  }

  if (endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(endDate.toISOString());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch limit + 1 to determine if there are more results
  const sql = `
    SELECT id, timestamp, user_id, action, target_type, target_id, ip_address, metadata
    FROM audit_events
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${paramIndex}
  `;
  params.push(limit + 1);

  const result = await query(sql, params);
  const hasMore = result.rows.length > limit;
  const events = result.rows.slice(0, limit).map(mapAuditEvent);

  // Next cursor is the timestamp of the last event
  const nextCursor =
    hasMore && events.length > 0 ? events[events.length - 1].timestamp.toISOString() : null;

  return { events, nextCursor };
}

/**
 * Get audit event counts by action (for dashboard)
 */
export async function getAuditStats(
  startDate?: Date,
  endDate?: Date,
): Promise<Record<string, number>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(startDate.toISOString());
  }

  if (endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(endDate.toISOString());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sql = `
    SELECT action, COUNT(*) as count
    FROM audit_events
    ${whereClause}
    GROUP BY action
    ORDER BY count DESC
  `;

  const result = await query(sql, params);
  const stats: Record<string, number> = {};

  for (const row of result.rows) {
    stats[row.action as string] = Number(row.count);
  }

  return stats;
}
