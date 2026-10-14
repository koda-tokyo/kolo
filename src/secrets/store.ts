// Backend selection for the secrets store.
// Order: KOLO_SECRETS_BACKEND → the backend recorded in <secrets>/backend (written on first
// `set`, so the CLI and a headless gateway always agree) → existing store.enc → an OS keyring
// that answers a probe → encrypted file.
import fs from "node:fs";
import path from "node:path";
import type { SecretBackendId, SecretStore } from "./types.js";
import { resolveKoloHome } from "../config/kolo-home.js";
import { defaultExecSync, type ExecSync, findOnPath } from "./exec.js";
import { FileSecretStore } from "./file-backend.js";
import { DpapiStore, KeychainStore, SecretServiceStore } from "./keyring-backends.js";

export const SECRET_BACKENDS: SecretBackendId[] = ["file", "secret-service", "keychain", "dpapi"];

export type ResolveSecretStoreOptions = {
  env?: NodeJS.ProcessEnv;
  homedir?: () => string;
  /** Explicit state root (defaults to resolveKoloHome). */
  home?: string;
  platform?: NodeJS.Platform;
  exec?: ExecSync;
  /** Force a backend (CLI `--backend`). */
  backend?: SecretBackendId;
  /** Test hook for the file backend's scrypt cost. */
  scryptN?: number;
};

export function secretsDirFor(home: string): string {
  return path.join(home, "secrets");
}

function readMarker(dir: string): SecretBackendId | undefined {
  try {
    const raw = fs.readFileSync(path.join(dir, "backend"), "utf8").trim();
    return SECRET_BACKENDS.includes(raw as SecretBackendId) ? (raw as SecretBackendId) : undefined;
  } catch {
    return undefined;
  }
}

export function writeBackendMarker(dir: string, backend: SecretBackendId) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "backend"), `${backend}\n`, { mode: 0o600 });
}

/** Detects a usable OS keyring. Probes with a short timeout so a locked/absent daemon never hangs. */
export function detectKeyringBackend(opts: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  exec: ExecSync;
}): SecretBackendId | null {
  const { env, platform, exec } = opts;
  if (platform === "darwin") {
    return findOnPath("security", env, platform) || fs.existsSync("/usr/bin/security")
      ? "keychain"
      : null;
  }
  if (platform === "win32") {
    return findOnPath("powershell", env, platform) ? "dpapi" : null;
  }
  if (platform === "linux") {
    if (!env.DBUS_SESSION_BUS_ADDRESS?.trim() || !findOnPath("secret-tool", env, platform)) {
      return null;
    }
    // exit 0 (found) or 1 (not found) = the Secret Service answered.
    const res = exec("secret-tool", ["lookup", "service", "kolo", "name", "__kolo_probe__"], {
      env,
      timeoutMs: 3000,
    });
    return !res.timedOut && (res.status === 0 || res.status === 1) ? "secret-service" : null;
  }
  return null;
}

function parseBackend(raw: string | undefined): SecretBackendId | undefined {
  const value = raw?.trim();
  if (!value) {
    return undefined;
  }
  if (!SECRET_BACKENDS.includes(value as SecretBackendId)) {
    throw new Error(`KOLO_SECRETS_BACKEND must be one of ${SECRET_BACKENDS.join(", ")}`);
  }
  return value as SecretBackendId;
}

function build(
  backend: SecretBackendId,
  ctx: { dir: string; home: string; env: NodeJS.ProcessEnv; exec: ExecSync; scryptN?: number },
): SecretStore {
  switch (backend) {
    case "file":
      return new FileSecretStore({ dir: ctx.dir, env: ctx.env, scryptN: ctx.scryptN });
    case "secret-service":
      return new SecretServiceStore(ctx);
    case "keychain":
      return new KeychainStore(ctx);
    case "dpapi":
      return new DpapiStore(ctx);
  }
}

/** Wraps a store so the first successful `set` records the backend choice. */
function withMarker(store: SecretStore, dir: string): SecretStore {
  let marked = readMarker(dir) === store.backend;
  return {
    backend: store.backend,
    location: store.location,
    get: (name) => store.get(name),
    list: () => store.list(),
    delete: (name) => store.delete(name),
    set: (name, value) => {
      store.set(name, value);
      if (!marked) {
        writeBackendMarker(dir, store.backend);
        marked = true;
      }
    },
  };
}

const storeCache = new Map<string, SecretStore>();

export function resolveSecretStore(opts: ResolveSecretStoreOptions = {}): SecretStore {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExecSync;
  const home = opts.home ?? resolveKoloHome({ env, homedir: opts.homedir, platform });
  const dir = secretsDirFor(home);
  const forced = opts.backend ?? parseBackend(env.KOLO_SECRETS_BACKEND);
  const marker = readMarker(dir);
  let backend: SecretBackendId;
  if (forced) {
    backend = forced;
  } else if (marker) {
    backend = marker;
  } else if (fs.existsSync(path.join(dir, "store.enc"))) {
    backend = "file";
  } else {
    backend = detectKeyringBackend({ env, platform, exec }) ?? "file";
  }
  // Cache per (dir, backend, key source) when using real exec, so loaders reuse decrypted state.
  const cacheable = !opts.exec && opts.scryptN === undefined;
  const cacheKey = `${dir}\0${backend}\0${env.KOLO_SECRETS_KEY ? "env" : "file"}`;
  if (cacheable) {
    const hit = storeCache.get(cacheKey);
    if (hit) {
      return hit;
    }
  }
  const store = withMarker(build(backend, { dir, home, env, exec, scryptN: opts.scryptN }), dir);
  if (cacheable) {
    storeCache.set(cacheKey, store);
  }
  return store;
}

export function clearSecretStoreCache() {
  storeCache.clear();
}
