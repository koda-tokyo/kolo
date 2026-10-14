// Channel identities (KoLo 2.0, M14a): who the sender is to the resident.
//
// `channels.<id>.identities` (and `channels.<id>.accounts.<acct>.identities`) map a sender id, as
// the channel reports it, to a role. Roles are ordered owner > admin > attach. Without any
// identities configured on a channel, the channel's own command authorization (allowlist /
// pairing owner) stands in for `owner`, so existing setups keep working.
import type { KoLoConfig } from "../../config/config.js";
import type { ChannelIdentityRole } from "../../config/types.channels-resident.js";

const ROLE_RANK: Record<ChannelIdentityRole, number> = { attach: 1, admin: 2, owner: 3 };

export type ChannelIdentity = {
  role: ChannelIdentityRole;
  /** `configured` when the role came from `identities`; `channel` when the channel's own authorization stood in. */
  source: "configured" | "channel";
  /** The identity key that matched, when configured. */
  matched?: string;
};

function identitiesOf(
  cfg: KoLoConfig,
  channel: string,
  accountId?: string | null,
): Record<string, string> | null {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const entry = channels?.[channel.toLowerCase()];
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const rec = entry as { identities?: unknown; accounts?: Record<string, unknown> };
  const out: Record<string, string> = {};
  let any = false;
  if (rec.identities && typeof rec.identities === "object") {
    for (const [k, v] of Object.entries(rec.identities as Record<string, unknown>)) {
      if (typeof v === "string") {
        out[k.trim().toLowerCase()] = v;
        any = true;
      }
    }
  }
  const acct =
    accountId && rec.accounts && typeof rec.accounts === "object"
      ? (rec.accounts[accountId] as { identities?: unknown } | undefined)
      : undefined;
  if (acct?.identities && typeof acct.identities === "object") {
    for (const [k, v] of Object.entries(acct.identities as Record<string, unknown>)) {
      if (typeof v === "string") {
        out[k.trim().toLowerCase()] = v;
        any = true;
      }
    }
  }
  return any ? out : null;
}

export function hasConfiguredIdentities(
  cfg: KoLoConfig,
  channel: string,
  accountId?: string | null,
): boolean {
  return identitiesOf(cfg, channel, accountId) !== null;
}

/**
 * Resolve the sender's role. Candidates are tried in order (sender id, username, E.164, From);
 * a `channel:` prefix is accepted on keys (`line:U123`) so one table can hold several channels.
 */
export function resolveChannelIdentity(input: {
  cfg: KoLoConfig;
  channel: string;
  accountId?: string | null;
  candidates: Array<string | undefined | null>;
  commandAuthorized?: boolean;
}): ChannelIdentity | null {
  const table = identitiesOf(input.cfg, input.channel, input.accountId);
  const channel = input.channel.toLowerCase();
  if (!table) {
    return input.commandAuthorized ? { role: "owner", source: "channel" } : null;
  }
  for (const raw of input.candidates) {
    const value = raw?.toString().trim().toLowerCase();
    if (!value) {
      continue;
    }
    const stripped = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
    for (const key of [value, `${channel}:${value}`, stripped, `${channel}:${stripped}`]) {
      const role = table[key];
      if (role === "owner" || role === "admin" || role === "attach") {
        return { role, source: "configured", matched: key };
      }
    }
  }
  return null;
}

export function roleAtLeast(
  role: ChannelIdentityRole | null | undefined,
  required: ChannelIdentityRole,
): boolean {
  return Boolean(role) && ROLE_RANK[role as ChannelIdentityRole] >= ROLE_RANK[required];
}
