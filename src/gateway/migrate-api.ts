// src/gateway/migrate-api.ts
// One-time migration endpoint - DELETE THIS FILE after migration runs
//
// Trigger with: curl -X POST https://kolo-alpha.fly.dev/api/migrate -H "X-Migrate-Key: $INVITE_SIGNING_KEY"

import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { getDb, initDatabase } from "../db/client.js";
import { safeEqualSecret } from "../infra/secure-compare.js";

const MIGRATION_SQL = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1, 2, 3)),
  jp_compliance_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace members (many-to-many)
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id)
);

-- Invites table
CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit events table
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id UUID,
  ip_address VARCHAR(45),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users and workspaces
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create default workspace for alpha
INSERT INTO workspaces (id, name, tier, jp_compliance_mode)
VALUES ('00000000-0000-0000-0000-000000000001', 'KoLo Alpha', 1, false)
ON CONFLICT DO NOTHING;
`;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function handleMigrateRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname !== "/api/migrate" || req.method !== "POST") {
    return false;
  }

  // Verify secret key
  const migrateKey = req.headers["x-migrate-key"];
  const expectedKey = process.env.INVITE_SIGNING_KEY;

  if (typeof migrateKey !== "string" || !expectedKey || !safeEqualSecret(migrateKey, expectedKey)) {
    sendJson(res, 403, { ok: false, error: "Invalid migrate key" });
    return true;
  }

  try {
    // Initialize database if not already done
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      sendJson(res, 500, { ok: false, error: "DATABASE_URL not configured" });
      return true;
    }
    initDatabase(dbUrl);

    const db = getDb();
    await db.unsafe(MIGRATION_SQL);

    sendJson(res, 200, {
      ok: true,
      message: "Migration completed successfully",
      tables: ["users", "workspaces", "workspace_members", "invites", "sessions", "audit_events"],
    });
  } catch (err) {
    console.error("[migrate-api] Migration failed:", err);
    sendJson(res, 500, {
      ok: false,
      error: "Migration failed",
      details: err instanceof Error ? err.message : String(err),
    });
  }

  return true;
}

/**
 * Bootstrap invite endpoint - creates first admin invite without auth
 * POST /api/bootstrap-invite
 * Body: { email: string, role?: "owner" | "admin" | "member" }
 * Header: X-Migrate-Key
 */
export async function handleBootstrapInviteRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname !== "/api/bootstrap-invite" || req.method !== "POST") {
    return false;
  }

  // Verify secret key
  const migrateKey = req.headers["x-migrate-key"];
  const expectedKey = process.env.INVITE_SIGNING_KEY;

  if (typeof migrateKey !== "string" || !expectedKey || !safeEqualSecret(migrateKey, expectedKey)) {
    sendJson(res, 403, { ok: false, error: "Invalid migrate key" });
    return true;
  }

  try {
    // Read body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const email = body.email;
    const role = body.role ?? "owner";

    if (!email || typeof email !== "string") {
      sendJson(res, 400, { ok: false, error: "email required" });
      return true;
    }

    // Initialize database
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      sendJson(res, 500, { ok: false, error: "DATABASE_URL not configured" });
      return true;
    }
    initDatabase(dbUrl);

    const db = getDb();

    // Get the default workspace
    const workspaceId = "00000000-0000-0000-0000-000000000001";

    // Generate invite token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invite directly
    await db.unsafe(
      `
      INSERT INTO invites (email, workspace_id, role, token_hash, expires_at)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [email, workspaceId, role, tokenHash, expiresAt.toISOString()],
    );

    const baseUrl = process.env.APP_URL ?? "https://kolo-alpha.fly.dev";
    const inviteUrl = `${baseUrl}/invite?token=${encodeURIComponent(token)}`;

    sendJson(res, 201, {
      ok: true,
      message: "Bootstrap invite created",
      email,
      role,
      expiresAt: expiresAt.toISOString(),
      inviteUrl,
      token, // Returned once - save it!
    });
  } catch (err) {
    console.error("[migrate-api] Bootstrap invite failed:", err);
    sendJson(res, 500, {
      ok: false,
      error: "Bootstrap invite failed",
      details: err instanceof Error ? err.message : String(err),
    });
  }

  return true;
}
