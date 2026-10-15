// src/db/types.ts
// Database types for Kurahi auth + workspace system

import { z } from "zod";

// ============================================================================
// User
// ============================================================================
export const UserRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: UserRoleSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: UserRoleSchema.default("member"),
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

// ============================================================================
// Workspace
// ============================================================================
export const WorkspaceTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type WorkspaceTier = z.infer<typeof WorkspaceTierSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tier: WorkspaceTierSchema,
  jpComplianceMode: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1),
  tier: WorkspaceTierSchema.default(1),
  jpComplianceMode: z.boolean().default(false),
});
export type CreateWorkspace = z.infer<typeof CreateWorkspaceSchema>;

// ============================================================================
// Workspace Member
// ============================================================================
export const MemberRoleSchema = z.enum(["owner", "admin", "member"]);
export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const WorkspaceMemberSchema = z.object({
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: MemberRoleSchema,
  createdAt: z.date(),
});
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;

// ============================================================================
// Invite
// ============================================================================
export const InviteSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  workspaceId: z.string().uuid(),
  role: MemberRoleSchema,
  tokenHash: z.string(),
  expiresAt: z.date(),
  usedAt: z.date().nullable(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.date(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const CreateInviteSchema = z.object({
  email: z.string().email(),
  workspaceId: z.string().uuid(),
  role: MemberRoleSchema.default("member"),
});
export type CreateInvite = z.infer<typeof CreateInviteSchema>;

// ============================================================================
// Audit Event
// ============================================================================
export const AuditActionSchema = z.enum([
  // Auth
  "auth.login",
  "auth.logout",
  // Workspace
  "workspace.create",
  "workspace.update",
  "workspace.invite_create",
  "workspace.invite_use",
  // Covenant
  "covenant.create",
  "covenant.update",
  // Engine
  "engine.select",
  "engine.policy_violation",
  // Admin views
  "admin.view_covenant",
  "admin.view_continuity",
  "admin.view_user",
  "admin.view_workspace",
  "admin.view_audit",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditTargetTypeSchema = z.enum([
  "user",
  "workspace",
  "covenant",
  "continuity",
  "engine",
  "invite",
  "session",
]);
export type AuditTargetType = z.infer<typeof AuditTargetTypeSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.date(),
  userId: z.string().uuid().nullable(),
  action: z.string(), // Allow any string for flexibility
  targetType: z.string(),
  targetId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const CreateAuditEventSchema = z.object({
  userId: z.string().uuid().nullable().optional(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateAuditEvent = z.infer<typeof CreateAuditEventSchema>;

// ============================================================================
// Session
// ============================================================================
export const SessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  tokenHash: z.string(),
  expiresAt: z.date(),
  createdAt: z.date(),
  lastUsedAt: z.date(),
});
export type Session = z.infer<typeof SessionSchema>;
