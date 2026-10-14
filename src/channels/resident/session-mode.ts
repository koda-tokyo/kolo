// Session model for channel-native residents (KoLo 2.0, M14a).
//
// `channels.sessionMode` decides where an inbound channel conversation lands:
//   per-conversation  one session per conversation per channel (DM: per channel peer, group: per group)
//   shared            every channel conversation joins the resident's main session
// A webhook account may override the mode for itself. When the key is absent the legacy
// `session.dmScope` applies unchanged, so existing configs keep their session keys.
import type { KoLoConfig } from "../../config/config.js";
import type { DmScope } from "../../config/types.base.js";
import type { ChannelSessionMode } from "../../config/types.channels-resident.js";

export const DEFAULT_CHANNEL_SESSION_MODE: ChannelSessionMode = "per-conversation";

function accountSessionMode(
  cfg: KoLoConfig,
  channel: string,
  accountId?: string | null,
): ChannelSessionMode | undefined {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const entry = channels?.[channel.toLowerCase()];
  if (!entry || typeof entry !== "object") {
    return undefined;
  }
  const rec = entry as { sessionMode?: unknown; accounts?: Record<string, unknown> };
  const acct =
    accountId && rec.accounts && typeof rec.accounts === "object"
      ? (rec.accounts[accountId] as { sessionMode?: unknown } | undefined)
      : undefined;
  const raw = acct?.sessionMode ?? rec.sessionMode;
  return raw === "shared" || raw === "per-conversation" ? raw : undefined;
}

/** The configured session mode, or null when the legacy `session.dmScope` rules apply. */
export function resolveChannelSessionMode(
  cfg: KoLoConfig,
  channel?: string | null,
  accountId?: string | null,
): ChannelSessionMode | null {
  if (channel) {
    const perAccount = accountSessionMode(cfg, channel, accountId);
    if (perAccount) {
      return perAccount;
    }
  }
  const raw = cfg.channels?.sessionMode;
  return raw === "shared" || raw === "per-conversation" ? raw : null;
}

/**
 * The dm scope the route builder should use. `per-conversation` keeps a finer explicit
 * `session.dmScope` (per-account-channel-peer) and otherwise isolates per channel peer.
 */
export function dmScopeForSessionMode(
  mode: ChannelSessionMode | null,
  configured: DmScope | undefined,
): DmScope {
  if (mode === "shared") {
    return "main";
  }
  if (mode === "per-conversation") {
    return configured === "per-account-channel-peer" ? configured : "per-channel-peer";
  }
  return configured ?? "main";
}
