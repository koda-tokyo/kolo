// Contract of the `oauth-sources` operator overlay (private/overlay/oauth-sources.cjs, loaded by
// src/infra/private-overlay.ts). This is a leaf module: the auth-profile store, the gateway
// refresher and provider usage all import it, so it must not import them.

import { loadPrivateOverlay } from "./private-overlay.js";

export type OAuthRefreshOutcome = {
  ok: boolean;
  refreshed: boolean;
  /** Expiry of the credential after the call (ms since epoch), when known. */
  expiresAt?: number;
  error?: string;
};

export type OAuthRefreshTarget = {
  /** Stable id used in logs and for the default lock file name. */
  id: string;
  provider: string;
  /** Refresh when the credential expires within `minValidMs`; `force` refreshes regardless. */
  refresh: (opts: { minValidMs: number; force?: boolean }) => Promise<OAuthRefreshOutcome>;
  /**
   * Lock shared by every process that may refresh this credential. Defaults to
   * `<KOLO_HOME>/run/oauth-refresh-<id>.lock`.
   */
  lockPath?: string;
};

/** Contract of `private/overlay/oauth-sources.cjs` (see private/README.md). */
export type OAuthSourcesOverlay = {
  listSources?: (ctx: { koloHome: string; env: NodeJS.ProcessEnv }) => OAuthRefreshTarget[];
  listExternalCliCredentials?: (ctx: { ttlMs: number }) => ExternalCliCredentialSource[];
  readExternalApiKey?: (provider: string) => string | undefined;
};

export type ExternalCliCredentialSource = {
  profileId: string;
  provider: string;
  sourceLabel: string;
  readCredentials: () => ExternalCliCredential | null;
};

export type ExternalCliCredential =
  | {
      type: "oauth";
      provider: string;
      access: string;
      refresh: string;
      expires: number;
      [key: string]: unknown;
    }
  | { type: "token"; provider: string; token: string; expires?: number; email?: string };

export function loadOAuthSourcesOverlay(): OAuthSourcesOverlay | null {
  return loadPrivateOverlay<OAuthSourcesOverlay>("oauth-sources");
}
