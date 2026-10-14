// Session allowlists for pairing credentials (KoLo 2.0, M3b).
//
// An invitation may carry a `sessions` allowlist: patterns over session keys (and, for
// convenience, bare agent ids and labels). A credential issued from it can only discover,
// attach to and drive sessions that match; owner/admin credentials and credentials without an
// allowlist see every session. Patterns are globs: `*` matches any run of characters (including
// `:`), `?` one character. Matching is case-insensitive, like session keys themselves.
//
//   agent:alice:main      exactly that session
//   agent:alice:*         every session of agent "alice"
//   alice                 bare agent id → agent:alice:*
//   label:ops             a session labelled "ops"
import { parseAgentSessionKey } from "../routing/session-key.js";

export const MAX_SESSION_PATTERNS = 32;
export const MAX_SESSION_PATTERN_LENGTH = 200;

export type SessionAllowlist = readonly string[];

/** Identity of one session, as seen by the allowlist. */
export type SessionIdentity = {
  key: string;
  sessionId?: string;
  label?: string;
  agentId?: string;
};

function normalizeSessionPattern(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw
    .trim()
    .toLowerCase()
    .replace(/[\p{Cc}\s]/gu, "");
  if (!value || value.length > MAX_SESSION_PATTERN_LENGTH) {
    return null;
  }
  return value;
}

/**
 * Validate and normalise an allowlist from an invitation request. Returns null when the input
 * is not an array of non-empty strings (the caller answers 400); an empty array means "no
 * restriction" and is returned as undefined so it is not stored.
 */
export function parseSessionAllowlist(
  raw: unknown,
): { ok: true; sessions?: string[] } | { ok: false; reason: string } {
  if (raw === undefined || raw === null) {
    return { ok: true };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, reason: "sessions must be an array of session patterns" };
  }
  if (raw.length > MAX_SESSION_PATTERNS) {
    return { ok: false, reason: `sessions holds more than ${MAX_SESSION_PATTERNS} patterns` };
  }
  const out: string[] = [];
  for (const item of raw) {
    const pattern = normalizeSessionPattern(item);
    if (!pattern) {
      return { ok: false, reason: "sessions must be non-empty strings" };
    }
    if (!out.includes(pattern)) {
      out.push(pattern);
    }
  }
  return out.length > 0 ? { ok: true, sessions: out } : { ok: true };
}

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  const cached = globCache.get(pattern);
  if (cached) {
    return cached;
  }
  let source = "^";
  for (const ch of pattern) {
    if (ch === "*") {
      source += ".*";
    } else if (ch === "?") {
      source += ".";
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  source += "$";
  const re = new RegExp(source, "i");
  if (globCache.size > 4096) {
    globCache.clear();
  }
  globCache.set(pattern, re);
  return re;
}

export function globMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

/** True when `pattern` admits the session. */
export function sessionPatternMatches(pattern: string, session: SessionIdentity): boolean {
  const key = session.key.trim().toLowerCase();
  if (globMatch(pattern, key)) {
    return true;
  }
  if (session.sessionId && globMatch(pattern, session.sessionId.toLowerCase())) {
    return true;
  }
  if (pattern.startsWith("label:")) {
    const label = session.label?.trim().toLowerCase();
    return Boolean(label) && globMatch(pattern.slice("label:".length), label as string);
  }
  // A bare agent id (no ":" and no wildcard on the agent part) admits every session of that agent.
  if (!pattern.includes(":")) {
    const agentId = session.agentId?.toLowerCase() ?? parseAgentSessionKey(key)?.agentId;
    return Boolean(agentId) && globMatch(pattern, agentId as string);
  }
  return false;
}

/** No allowlist (undefined / empty) admits everything. */
export function sessionAllowed(
  allowlist: SessionAllowlist | undefined,
  session: SessionIdentity,
): boolean {
  if (!allowlist || allowlist.length === 0) {
    return true;
  }
  return allowlist.some((pattern) => sessionPatternMatches(pattern, session));
}

/** Identity of a session from its key alone (agent id derived from `agent:<id>:…`). */
export function sessionIdentityFromKey(key: string, extra: Partial<SessionIdentity> = {}) {
  const normalized = key.trim().toLowerCase();
  return {
    key: normalized,
    agentId: extra.agentId ?? parseAgentSessionKey(normalized)?.agentId,
    ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    ...(extra.label ? { label: extra.label } : {}),
  } satisfies SessionIdentity;
}
