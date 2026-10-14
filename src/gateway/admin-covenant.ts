// src/gateway/admin-covenant.ts
// Admin API for covenant data - exposes user covenants to Control Room

import type { IncomingMessage, ServerResponse } from "node:http";
import type { CovenantSummary } from "../covenant/types.js";
import { loadCovenant, ensureCovenant } from "../covenant/service.js";
import { buildCovenantSummary } from "../covenant/summary.js";

const ADMIN_COVENANT_PREFIX = "/api/admin/covenants";

/**
 * Response shape for GET /api/admin/covenants/:userId
 */
export interface AdminCovenantResponse {
  ok: true;
  userId: string;
  covenant: CovenantSummary;
  raw?: {
    id: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface AdminCovenantErrorResponse {
  ok: false;
  error: string;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body:
    | AdminCovenantResponse
    | AdminCovenantErrorResponse
    | { ok: true; covenants: Array<{ userId: string; userName?: string }> },
) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(body));
}

function extractUserId(pathname: string): string | null {
  // Expected: /api/admin/covenants/:userId
  if (!pathname.startsWith(ADMIN_COVENANT_PREFIX)) {
    return null;
  }
  const rest = pathname.slice(ADMIN_COVENANT_PREFIX.length);
  if (!rest.startsWith("/")) {
    return null;
  }
  const userId = rest.slice(1).split("/")[0];
  if (!userId || userId.length === 0) {
    return null;
  }
  return decodeURIComponent(userId);
}

/**
 * Handle admin covenant API requests.
 *
 * Endpoints:
 * - GET /api/admin/covenants/:userId - Get covenant summary for a user
 *
 * Returns true if the request was handled, false to pass to next handler.
 */
export async function handleAdminCovenantRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  // Only handle /api/admin/covenants paths
  if (!pathname.startsWith(ADMIN_COVENANT_PREFIX)) {
    return false;
  }

  // GET /api/admin/covenants - List all covenants (future)
  if (pathname === ADMIN_COVENANT_PREFIX || pathname === `${ADMIN_COVENANT_PREFIX}/`) {
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Method Not Allowed");
      return true;
    }
    // TODO: List covenants (requires workspace scan)
    sendJson(res, 200, { ok: true, covenants: [] });
    return true;
  }

  // GET /api/admin/covenants/:userId
  const userId = extractUserId(pathname);
  if (!userId) {
    sendJson(res, 400, { ok: false, error: "Invalid user ID in path" });
    return true;
  }

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method Not Allowed");
    return true;
  }

  try {
    // Load or create default covenant
    const covenant = await ensureCovenant(userId);
    const summary = buildCovenantSummary(covenant);

    const response: AdminCovenantResponse = {
      ok: true,
      userId,
      covenant: summary,
      raw: {
        id: covenant.id,
        createdAt: covenant.createdAt,
        updatedAt: covenant.updatedAt,
      },
    };

    sendJson(res, 200, response);
    return true;
  } catch (err) {
    console.error("[admin-covenant] Failed to load covenant:", err);
    sendJson(res, 500, {
      ok: false,
      error: "Failed to load covenant",
    });
    return true;
  }
}
