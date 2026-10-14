import type { AuthProfileCredential, AuthProfileStore } from "./types.js";
import { loadOAuthSourcesOverlay } from "../../infra/oauth-sources-overlay.js";
import { EXTERNAL_CLI_NEAR_EXPIRY_MS, EXTERNAL_CLI_SYNC_TTL_MS, log } from "./constants.js";

type ExternalCliCredential = Extract<AuthProfileCredential, { type: "oauth" | "token" }>;

type ExternalCliSyncSource = {
  profileId: string;
  provider: string;
  sourceLabel: string;
  readCredentials: () => ExternalCliCredential | null;
};

function shallowEqualExternalCredentials(
  a: ExternalCliCredential | undefined,
  b: ExternalCliCredential,
): boolean {
  if (!a) {
    return false;
  }
  if (a.type !== b.type || a.provider !== b.provider) {
    return false;
  }
  if (a.type === "token" && b.type === "token") {
    return a.token === b.token && a.expires === b.expires && a.email === b.email;
  }
  if (a.type === "oauth" && b.type === "oauth") {
    return (
      a.access === b.access &&
      a.refresh === b.refresh &&
      a.expires === b.expires &&
      a.email === b.email &&
      a.enterpriseUrl === b.enterpriseUrl &&
      a.projectId === b.projectId &&
      a.accountId === b.accountId
    );
  }
  return false;
}

function isExternalProfileFresh(
  cred: AuthProfileCredential | undefined,
  provider: string,
  now: number,
): boolean {
  if (!cred) {
    return false;
  }
  if (cred.type !== "oauth" && cred.type !== "token") {
    return false;
  }
  if (cred.provider !== provider) {
    return false;
  }
  if (typeof cred.expires !== "number") {
    return true;
  }
  return cred.expires > now + EXTERNAL_CLI_NEAR_EXPIRY_MS;
}

/** Sync external CLI credentials into the store for a given provider. */
function syncExternalCliCredentialsForProvider(
  store: AuthProfileStore,
  profileId: string,
  provider: string,
  sourceLabel: string,
  readCredentials: () => ExternalCliCredential | null,
  now: number,
): boolean {
  const existing = store.profiles[profileId];

  // Skip sync for credentials pinned by this agent — per-sibling independent OAuth.
  // Each sibling gets their own (access_token, refresh_token) lifecycle and must
  // not be overwritten by the main agent's token rotation.
  if (existing?.type === "oauth" && existing.pinnedByAgent) {
    return false;
  }

  const shouldSync =
    !existing || existing.provider !== provider || !isExternalProfileFresh(existing, provider, now);
  const creds = shouldSync ? readCredentials() : null;
  if (!creds) {
    return false;
  }

  const existingExternal: ExternalCliCredential | undefined =
    existing && (existing.type === "oauth" || existing.type === "token") ? existing : undefined;
  const existingExpiry =
    existingExternal && typeof existingExternal.expires === "number" ? existingExternal.expires : 0;
  const nextExpiry = typeof creds.expires === "number" ? creds.expires : Number.POSITIVE_INFINITY;
  const shouldUpdate =
    !existingExternal ||
    existingExternal.provider !== provider ||
    existingExpiry <= now ||
    nextExpiry > existingExpiry;

  if (shouldUpdate && !shallowEqualExternalCredentials(existingExternal, creds)) {
    store.profiles[profileId] = creds;
    log.info(`synced ${provider} ${creds.type} credentials from ${sourceLabel}`, {
      profileId,
      expires:
        typeof creds.expires === "number" ? new Date(creds.expires).toISOString() : undefined,
    });
    return true;
  }

  return false;
}

// Importing credentials from other programs' files is opt-in (`kolo doctor --verbose`, or
// KOLO_EXTERNAL_CLI_SYNC=1 for the gateway); a buyer reads an unannounced import as harvesting.
// The readers themselves are not part of the product tree: the `oauth-sources` operator overlay
// (private/overlay/oauth-sources.cjs) lists them, and a clean checkout has none to sync.
let externalCliSyncEnabled = /^(1|true|yes|on)$/i.test(
  (process.env.KOLO_EXTERNAL_CLI_SYNC ?? "").trim(),
);

export function setExternalCliSyncEnabled(enabled: boolean): void {
  externalCliSyncEnabled = enabled;
}

export function isExternalCliSyncEnabled(): boolean {
  return externalCliSyncEnabled;
}

/** External credential sources from the overlay, in the shape the sync loop expects. */
function listExternalSources(): ExternalCliSyncSource[] {
  const overlay = loadOAuthSourcesOverlay();
  if (!overlay?.listExternalCliCredentials) {
    return [];
  }
  try {
    return overlay
      .listExternalCliCredentials({ ttlMs: EXTERNAL_CLI_SYNC_TTL_MS })
      .filter((source) => source && typeof source.readCredentials === "function")
      .map((source) => ({
        profileId: source.profileId,
        provider: source.provider,
        sourceLabel: source.sourceLabel,
        readCredentials: () => source.readCredentials() as ExternalCliCredential | null,
      }));
  } catch (err) {
    log.warn("oauth-sources overlay failed to list external credentials", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Sync credentials from external sources into the store. Returns true if any profile changed.
 */
export function syncExternalCliCredentials(store: AuthProfileStore): boolean {
  if (!externalCliSyncEnabled) {
    return false;
  }
  let mutated = false;
  const now = Date.now();
  for (const source of listExternalSources()) {
    if (
      syncExternalCliCredentialsForProvider(
        store,
        source.profileId,
        source.provider,
        source.sourceLabel,
        source.readCredentials,
        now,
      )
    ) {
      mutated = true;
    }
  }
  return mutated;
}
