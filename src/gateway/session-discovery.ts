// Session discovery (KoLo 2.0, M3b): the view of live sessions that `GET /api/sessions`,
// `GET /api/sessions/{id}`, WS `sessions.discover` and `kurahi attach` share. Rows come from the
// gateway's combined session store (every agent), enriched with the attach registry (clients)
// and the embedded runner (state). An attach-scope credential with a session allowlist only
// sees matching sessions; owner/admin and unrestricted credentials see everything.
import fs from "node:fs";
import type { KoLoConfig } from "../config/config.js";
import type { PairPrincipal } from "./pair-store.js";
import { isEmbeddedPiRunActive } from "../agents/pi-embedded-runner/runs.js";
import { resolveAgentMainSessionKey } from "../config/sessions/main-session.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";
import {
  type SessionAllowlist,
  sessionAllowed,
  type SessionIdentity,
} from "./session-allowlist.js";
import {
  attachmentView,
  getSessionAttachRegistry,
  type SessionAttachmentView,
} from "./session-attach.js";
import {
  type GatewaySessionRow,
  listSessionsFromStore,
  loadCombinedSessionStoreForGateway,
  resolveSessionTranscriptCandidates,
} from "./session-utils.js";

export type SessionState = "running" | "idle";

export type SessionDiscoveryRow = {
  /** Stable id: the transcript session id when the store has one, else the key. */
  id: string;
  key: string;
  agent: string;
  kind: GatewaySessionRow["kind"];
  label?: string;
  displayName?: string;
  channel?: string;
  model?: string;
  /** ISO time the transcript was created, when it exists on disk. */
  started: string | null;
  /** ISO time of the last store update. */
  lastActivity: string | null;
  /** Clients currently attached through `session.attach`. */
  clients: number;
  state: SessionState;
};

export type SessionDiscoveryDetail = SessionDiscoveryRow & {
  attachments: SessionAttachmentView[];
};

export type SessionDiscoveryResult = {
  ts: number;
  count: number;
  sessions: SessionDiscoveryRow[];
};

export type DiscoverOptions = {
  cfg: KoLoConfig;
  /** Session allowlist of the caller (undefined = unrestricted). */
  allowlist?: SessionAllowlist;
  agentId?: string;
  search?: string;
  limit?: number;
  includeGlobal?: boolean;
  /** Only sessions active within the last N minutes. */
  activeMinutes?: number;
};

const MAX_LIMIT = 500;

/** The allowlist a principal is bound to (owner and unrestricted devices: none). */
export function allowlistOf(
  principal: PairPrincipal | { kind: "owner" } | null | undefined,
): SessionAllowlist | undefined {
  if (!principal || principal.kind !== "pair") {
    return undefined;
  }
  return principal.sessions && principal.sessions.length > 0 ? principal.sessions : undefined;
}

function startedAt(row: GatewaySessionRow, storePath: string, agentId: string): string | null {
  if (!row.sessionId) {
    return null;
  }
  const entry = (row as { entry?: { sessionFile?: string } }).entry;
  for (const candidate of resolveSessionTranscriptCandidates(
    row.sessionId,
    storePath,
    entry?.sessionFile,
    agentId,
  )) {
    try {
      const stat = fs.statSync(candidate);
      const ms = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
      return new Date(ms).toISOString();
    } catch {
      // next candidate
    }
  }
  return null;
}

export function identityOfRow(row: Pick<GatewaySessionRow, "key" | "sessionId" | "label">) {
  const key = row.key.trim().toLowerCase();
  return {
    key,
    sessionId: row.sessionId,
    label: row.label,
    agentId: parseAgentSessionKey(key)?.agentId,
  } satisfies SessionIdentity;
}

function toRow(
  row: GatewaySessionRow,
  storePath: string,
  clients: Map<string, number>,
): SessionDiscoveryRow {
  const key = row.key.trim().toLowerCase();
  const agent = parseAgentSessionKey(key)?.agentId ?? "";
  return {
    id: row.sessionId ?? key,
    key,
    agent,
    kind: row.kind,
    ...(row.label ? { label: row.label } : {}),
    ...(row.displayName ? { displayName: row.displayName } : {}),
    ...(row.channel ? { channel: row.channel } : {}),
    ...(row.model ? { model: row.model } : {}),
    started: startedAt(row, storePath, agent),
    lastActivity: typeof row.updatedAt === "number" ? new Date(row.updatedAt).toISOString() : null,
    clients: clients.get(key) ?? 0,
    state: row.sessionId && isEmbeddedPiRunActive(row.sessionId) ? "running" : "idle",
  };
}

/** Every session the caller may see, newest activity first. */
export function discoverSessions(opts: DiscoverOptions): SessionDiscoveryResult {
  const { cfg } = opts;
  const { storePath, store } = loadCombinedSessionStoreForGateway(cfg);
  const limit = Math.max(1, Math.min(MAX_LIMIT, opts.limit ?? 200));
  const listed = listSessionsFromStore({
    cfg,
    storePath,
    store,
    opts: {
      includeGlobal: opts.includeGlobal === true,
      includeUnknown: false,
      ...(opts.agentId ? { agentId: normalizeAgentId(opts.agentId) } : {}),
      ...(opts.search ? { search: opts.search } : {}),
      ...(opts.activeMinutes ? { activeMinutes: opts.activeMinutes } : {}),
      // Over-fetch so the allowlist filter below still fills `limit`.
      limit: MAX_LIMIT,
    },
  });
  const clients = getSessionAttachRegistry().counts();
  const sessions = listed.sessions
    .filter((row) => sessionAllowed(opts.allowlist, identityOfRow(row)))
    .slice(0, limit)
    .map((row) => toRow(row, storePath, clients));
  return { ts: Date.now(), count: sessions.length, sessions };
}

/**
 * Resolve `target` to one visible session: an exact session id, a session key (canonical or as
 * the store holds it), a label, or an agent id (its main session, else its most recent). The
 * allowlist applies before matching, so a restricted credential cannot probe for keys it may
 * not see: "not found" is the only answer.
 */
export function findSession(opts: {
  cfg: KoLoConfig;
  allowlist?: SessionAllowlist;
  target: string;
}): SessionDiscoveryDetail | null {
  const target = opts.target.trim();
  if (!target) {
    return null;
  }
  const lower = target.toLowerCase();
  const { sessions } = discoverSessions({
    cfg: opts.cfg,
    allowlist: opts.allowlist,
    includeGlobal: true,
    limit: MAX_LIMIT,
  });
  const pick =
    sessions.find((s) => s.id === target || s.id.toLowerCase() === lower) ??
    sessions.find((s) => s.key === lower) ??
    sessions.find((s) => s.label?.toLowerCase() === lower) ??
    resolveByAgent(opts.cfg, sessions, lower);
  if (!pick) {
    return null;
  }
  return withAttachments(pick);
}

function resolveByAgent(
  cfg: KoLoConfig,
  sessions: SessionDiscoveryRow[],
  agentIdRaw: string,
): SessionDiscoveryRow | undefined {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(agentIdRaw)) {
    return undefined;
  }
  const agentId = normalizeAgentId(agentIdRaw);
  const mainKey = resolveAgentMainSessionKey({ cfg, agentId }).toLowerCase();
  const ofAgent = sessions.filter((s) => s.agent === agentId);
  return ofAgent.find((s) => s.key === mainKey) ?? ofAgent[0];
}

export function withAttachments(row: SessionDiscoveryRow): SessionDiscoveryDetail {
  const attachments = getSessionAttachRegistry().attachmentsOf(row.key).map(attachmentView);
  return { ...row, clients: attachments.length, attachments };
}
