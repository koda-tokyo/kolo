// src/db/invite.ts
// Invite-only auth service
//
// "No invite = no account creation, full stop."

import type { CreateInvite, Invite, User, MemberRole } from "./types.js";
import { logAudit, AUDIT_ACTIONS } from "./audit.js";
import { query, mapInvite, mapUser, generateId, generateToken, hashToken } from "./client.js";

// ============================================================================
// Constants
// ============================================================================

const INVITE_EXPIRY_HOURS = 72; // 3 days
const SESSION_EXPIRY_DAYS = 30;

// ============================================================================
// Create Invite (Admin only)
// ============================================================================

export interface CreateInviteResult {
  invite: Invite;
  token: string; // Raw token - only returned ONCE
}

/**
 * Create an invite for a user to join a workspace.
 * The token is only returned once - it cannot be retrieved later.
 *
 * @param data - Invite data (email, workspaceId, role)
 * @param createdBy - User ID of the admin creating the invite
 * @param ipAddress - IP address for audit
 */
export async function createInvite(
  data: CreateInvite,
  createdBy: string,
  ipAddress?: string,
): Promise<CreateInviteResult> {
  const id = generateId();
  const token = generateToken(32);
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  const sql = `
    INSERT INTO invites (id, email, workspace_id, role, token_hash, expires_at, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;

  const result = await query(sql, [
    id,
    data.email.toLowerCase(),
    data.workspaceId,
    data.role ?? "member",
    tokenHash,
    expiresAt.toISOString(),
    createdBy,
  ]);

  const invite = mapInvite(result.rows[0]);

  // Audit log
  await logAudit({
    userId: createdBy,
    action: AUDIT_ACTIONS.WORKSPACE_INVITE_CREATE,
    targetType: "invite",
    targetId: id,
    ipAddress,
    metadata: {
      email: data.email,
      workspaceId: data.workspaceId,
      role: data.role,
    },
  });

  return { invite, token };
}

// ============================================================================
// Redeem Invite (Public endpoint)
// ============================================================================

export interface RedeemInviteResult {
  user: User;
  workspaceId: string;
  workspaceName: string;
  sessionToken: string;
}

/**
 * Redeem an invite token and create/link user account.
 *
 * @param token - The invite token from the invite link
 * @param name - Optional name for the user
 * @param ipAddress - IP address for audit
 */
export async function redeemInvite(
  token: string,
  name?: string,
  ipAddress?: string,
): Promise<RedeemInviteResult> {
  const tokenHash = hashToken(token);

  // Find valid invite
  const inviteSql = `
    SELECT i.*, w.name as workspace_name
    FROM invites i
    JOIN workspaces w ON i.workspace_id = w.id
    WHERE i.token_hash = $1
      AND i.used_at IS NULL
      AND i.expires_at > NOW()
  `;

  const inviteResult = await query(inviteSql, [tokenHash]);

  if (inviteResult.rows.length === 0) {
    throw new Error("Invalid or expired invite");
  }

  const inviteRow = inviteResult.rows[0];
  const invite = mapInvite(inviteRow);
  const workspaceName = inviteRow.workspace_name as string;

  // Find or create user
  let user: User;
  const existingUserSql = `SELECT * FROM users WHERE email = $1`;
  const existingUserResult = await query(existingUserSql, [invite.email]);

  if (existingUserResult.rows.length > 0) {
    user = mapUser(existingUserResult.rows[0]);
    // Update name if provided and user doesn't have one
    if (name && !user.name) {
      await query(`UPDATE users SET name = $1 WHERE id = $2`, [name, user.id]);
      user.name = name;
    }
  } else {
    // Create new user
    const userId = generateId();
    const createUserSql = `
      INSERT INTO users (id, email, name, role)
      VALUES ($1, $2, $3, 'member')
      RETURNING *
    `;
    const newUserResult = await query(createUserSql, [userId, invite.email, name ?? null]);
    user = mapUser(newUserResult.rows[0]);
  }

  // Check if already a member
  const membershipSql = `
    SELECT * FROM workspace_members
    WHERE workspace_id = $1 AND user_id = $2
  `;
  const membershipResult = await query(membershipSql, [invite.workspaceId, user.id]);

  if (membershipResult.rows.length === 0) {
    // Create membership
    await query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)`, [
      invite.workspaceId,
      user.id,
      invite.role,
    ]);
  }

  // Mark invite as used
  await query(`UPDATE invites SET used_at = NOW() WHERE id = $1`, [invite.id]);

  // Create session
  const sessionId = generateId();
  const sessionToken = generateToken(32);
  const sessionTokenHash = hashToken(sessionToken);
  const sessionExpiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [sessionId, user.id, sessionTokenHash, sessionExpiresAt.toISOString()],
  );

  // Audit logs
  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.WORKSPACE_INVITE_USE,
    targetType: "invite",
    targetId: invite.id,
    ipAddress,
    metadata: {
      workspaceId: invite.workspaceId,
      email: invite.email,
    },
  });

  await logAudit({
    userId: user.id,
    action: AUDIT_ACTIONS.AUTH_LOGIN,
    targetType: "session",
    targetId: sessionId,
    ipAddress,
    metadata: {
      method: "invite_redeem",
    },
  });

  return {
    user,
    workspaceId: invite.workspaceId,
    workspaceName,
    sessionToken,
  };
}

// ============================================================================
// Validate Session
// ============================================================================

export interface SessionValidation {
  valid: boolean;
  user?: User;
  workspaces?: Array<{ id: string; name: string; role: MemberRole }>;
}

/**
 * Validate a session token and return user info.
 *
 * @param token - The session token from cookie/header
 */
export async function validateSession(token: string): Promise<SessionValidation> {
  const tokenHash = hashToken(token);

  const sql = `
    SELECT s.*, u.*
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
  `;

  const result = await query(sql, [tokenHash]);

  if (result.rows.length === 0) {
    return { valid: false };
  }

  const row = result.rows[0];
  const user = mapUser(row);

  // Update last_used_at
  await query(`UPDATE sessions SET last_used_at = NOW() WHERE token_hash = $1`, [tokenHash]);

  // Get user's workspaces
  const workspacesSql = `
    SELECT w.id, w.name, wm.role
    FROM workspaces w
    JOIN workspace_members wm ON w.id = wm.workspace_id
    WHERE wm.user_id = $1
  `;
  const workspacesResult = await query(workspacesSql, [user.id]);

  const workspaces = workspacesResult.rows.map((w) => ({
    id: w.id as string,
    name: w.name as string,
    role: w.role as MemberRole,
  }));

  return { valid: true, user, workspaces };
}

// ============================================================================
// Logout
// ============================================================================

/**
 * Invalidate a session token (logout).
 *
 * @param token - The session token to invalidate
 * @param ipAddress - IP address for audit
 */
export async function logout(token: string, ipAddress?: string): Promise<boolean> {
  const tokenHash = hashToken(token);

  // Get session and user for audit
  const sessionSql = `
    SELECT s.id, s.user_id FROM sessions s
    WHERE s.token_hash = $1
  `;
  const sessionResult = await query(sessionSql, [tokenHash]);

  if (sessionResult.rows.length === 0) {
    return false;
  }

  const { id: sessionId, user_id: userId } = sessionResult.rows[0];

  // Delete session
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);

  // Audit log
  await logAudit({
    userId: userId as string,
    action: AUDIT_ACTIONS.AUTH_LOGOUT,
    targetType: "session",
    targetId: sessionId as string,
    ipAddress,
  });

  return true;
}

// ============================================================================
// List Pending Invites (Admin)
// ============================================================================

/**
 * List all pending (unused, unexpired) invites for a workspace.
 */
export async function listPendingInvites(workspaceId: string): Promise<Invite[]> {
  const sql = `
    SELECT * FROM invites
    WHERE workspace_id = $1
      AND used_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;

  const result = await query(sql, [workspaceId]);
  return result.rows.map(mapInvite);
}
