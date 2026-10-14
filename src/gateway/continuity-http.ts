// HTTP handlers for the continuity read-only routes (KoLo 2.0, M11a), declared in
// http-routes.ts: getContinuityManifest, recallMemory, getAuditChain. Auth (owner token or an
// admin credential) is enforced by the router before these run. Nothing here writes resident
// state; the only side effect is the one-time creation of the gateway signing key.
import fs from "node:fs";
import type { RouteHandler } from "./http-registry.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import {
  auditFileForMonth,
  type AuditEntry,
  listAuditMonths,
  resolveAuditDir,
} from "../audit/audit-log.js";
import { verifyAuditChain } from "../audit/verify.js";
import { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  buildContinuityManifest,
  resolveResidentWorkspaceDir,
} from "../continuity-suite/manifest.js";
import {
  keywordRecall,
  RECALL_MAX_LIMIT,
  RECALL_MAX_QUERY_CHARS,
} from "../continuity-suite/recall.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { sendJson } from "./http-common.js";

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function resolveAgentParam(raw: string | null, cfg: ReturnType<typeof loadConfig>): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return resolveDefaultAgentId(cfg);
  }
  const id = normalizeAgentId(trimmed);
  if (!AGENT_ID_RE.test(id)) {
    return null;
  }
  const known = (cfg.agents?.list ?? []).some((entry) => normalizeAgentId(entry.id) === id);
  return known || id === resolveDefaultAgentId(cfg) ? id : null;
}

export function createContinuityHttpHandlers(deps: { gatewayVersion?: string } = {}) {
  const getContinuityManifest: RouteHandler = async (_req, res, ctx) => {
    const cfg = loadConfig();
    const agentId = resolveAgentParam(ctx.url.searchParams.get("agent"), cfg);
    if (!agentId) {
      sendJson(res, 404, { ok: false, error: "unknown agent" });
      return;
    }
    try {
      const manifest = await buildContinuityManifest({
        cfg,
        agentId,
        stateDir: resolveStateDir(),
        gatewayVersion: deps.gatewayVersion,
      });
      sendJson(res, 200, { ok: true, manifest });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: `manifest failed: ${String(err)}` });
    }
  };

  const recallMemory: RouteHandler = async (_req, res, ctx) => {
    const cfg = loadConfig();
    const q = ctx.url.searchParams;
    const agentId = resolveAgentParam(q.get("agent"), cfg);
    if (!agentId) {
      sendJson(res, 404, { ok: false, error: "unknown agent" });
      return;
    }
    const query = (q.get("q") ?? "").trim();
    if (!query) {
      sendJson(res, 400, { ok: false, error: "q required" });
      return;
    }
    if (query.length > RECALL_MAX_QUERY_CHARS) {
      sendJson(res, 400, {
        ok: false,
        error: `q longer than ${RECALL_MAX_QUERY_CHARS} characters`,
      });
      return;
    }
    const limitRaw = q.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    if (
      limitRaw &&
      (!Number.isFinite(limit) || (limit as number) < 1 || (limit as number) > RECALL_MAX_LIMIT)
    ) {
      sendJson(res, 400, { ok: false, error: `limit must be 1-${RECALL_MAX_LIMIT}` });
      return;
    }
    const hits = await keywordRecall({
      workspaceDir: resolveResidentWorkspaceDir(cfg, agentId),
      query,
      limit,
    });
    sendJson(res, 200, { ok: true, agent: agentId, backend: "keyword", query, hits });
  };

  const getAuditChain: RouteHandler = (_req, res, ctx) => {
    const dir = resolveAuditDir();
    const seqRaw = ctx.url.searchParams.get("seq");
    const seq = seqRaw ? Number.parseInt(seqRaw, 10) : undefined;
    if (seqRaw && (!Number.isFinite(seq) || (seq as number) < 1)) {
      sendJson(res, 400, { ok: false, error: "seq must be a positive integer" });
      return;
    }
    const result = verifyAuditChain(dir);
    const head = findAuditEntry(dir, result.lastSeq);
    const anchor = seq !== undefined ? findAuditEntry(dir, seq) : undefined;
    sendJson(res, 200, {
      ok: true,
      verified: result.ok,
      entries: result.entries,
      lastSeq: result.lastSeq,
      months: result.months,
      head: head ? { seq: head.seq, hash: head.hash, ts: head.ts } : null,
      anchor:
        seq === undefined
          ? undefined
          : anchor
            ? { seq: anchor.seq, hash: anchor.hash, prev: anchor.prev }
            : null,
      firstBreak: result.firstBreak ?? null,
    });
  };

  return { getContinuityManifest, recallMemory, getAuditChain };
}

/** The audit entry with `seq`, scanning month files newest first; null when absent. */
export function findAuditEntry(dir: string, seq: number): AuditEntry | null {
  if (!Number.isFinite(seq) || seq < 1) {
    return null;
  }
  const months = listAuditMonths(dir);
  for (let i = months.length - 1; i >= 0; i--) {
    let text: string;
    try {
      text = fs.readFileSync(auditFileForMonth(dir, months[i]), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line) as AuditEntry;
        if (entry.seq === seq) {
          return entry;
        }
      } catch {
        // a corrupt line is reported by verifyAuditChain, not here
      }
    }
  }
  return null;
}
