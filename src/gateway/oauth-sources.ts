// What the gateway OAuth refresher works on. Two kinds of target:
//
//   1. OAuth-kind auth profiles stored under KOLO_HOME (the product's own credential store,
//      `agents/<id>/agent/auth-profiles.json`). Refreshing those is provider code the tree
//      already ships (pi-ai providers, qwen-portal, chutes).
//   2. Sources provided by the `oauth-sources` operator overlay (`private/overlay/oauth-sources.cjs`,
//      loaded through src/infra/private-overlay.ts). Anything that reads or writes another
//      program's credential store lives there and is absent on a clean checkout.
//
// The public tree never names a vendor credential file.

import type { KoLoConfig } from "../config/config.js";
import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import { refreshOAuthProfileIfExpiring } from "../agents/auth-profiles/oauth.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles/store.js";
import { resolveKoloHome } from "../config/kolo-home.js";
import {
  loadOAuthSourcesOverlay,
  type OAuthRefreshOutcome,
  type OAuthRefreshTarget,
} from "../infra/oauth-sources-overlay.js";
import { defaultRefreshLockPath } from "../infra/refresh-lock.js";

export type {
  ExternalCliCredential,
  ExternalCliCredentialSource,
  OAuthRefreshOutcome,
  OAuthRefreshTarget,
  OAuthSourcesOverlay,
} from "../infra/oauth-sources-overlay.js";

function profileTarget(profileId: string, provider: string, agentDir: string): OAuthRefreshTarget {
  const id = `profile:${profileId}`;
  return {
    id,
    provider,
    refresh: async ({ minValidMs, force }) => {
      try {
        const result = await refreshOAuthProfileIfExpiring({
          profileId,
          agentDir,
          minValidMs: force ? Number.MAX_SAFE_INTEGER : minValidMs,
        });
        if (!result) {
          return { ok: false, refreshed: false, error: "profile is no longer an OAuth profile" };
        }
        return { ok: true, refreshed: result.refreshed, expiresAt: result.expires };
      } catch (err) {
        return {
          ok: false,
          refreshed: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

/** OAuth-kind profiles configured under KOLO_HOME, one target per (agent store, profile). */
export function listConfiguredOAuthProfileTargets(cfg: KoLoConfig): OAuthRefreshTarget[] {
  const targets: OAuthRefreshTarget[] = [];
  const seenDirs = new Set<string>();
  for (const agentId of listAgentIds(cfg)) {
    const agentDir = resolveAgentDir(cfg, agentId);
    if (seenDirs.has(agentDir)) {
      continue;
    }
    seenDirs.add(agentDir);
    let store;
    try {
      store = ensureAuthProfileStore(agentDir);
    } catch {
      continue;
    }
    for (const [profileId, cred] of Object.entries(store.profiles)) {
      if (cred.type === "oauth") {
        targets.push(profileTarget(profileId, cred.provider, agentDir));
      }
    }
  }
  return targets;
}

/** Everything the refresher should keep fresh: configured profiles, then overlay sources. */
export function resolveOAuthRefreshTargets(
  cfg: KoLoConfig,
  env: NodeJS.ProcessEnv = process.env,
): OAuthRefreshTarget[] {
  const targets = listConfiguredOAuthProfileTargets(cfg);
  const overlay = loadOAuthSourcesOverlay();
  if (overlay?.listSources) {
    try {
      for (const source of overlay.listSources({ koloHome: resolveKoloHome({ env }), env })) {
        if (source && typeof source.refresh === "function" && source.id) {
          targets.push(source);
        }
      }
    } catch {
      // An overlay that throws is treated as absent; it is the operator's code.
    }
  }
  return targets;
}

export function resolveTargetLockPath(target: OAuthRefreshTarget): string {
  return target.lockPath ?? defaultRefreshLockPath(`oauth-refresh-${safeName(target.id)}`);
}

function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "_");
}
