import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type DeviceAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
  /** Gateway this token was issued by (normalized URL). Absent on legacy role-only entries. */
  gateway?: string;
};

// Store layout. Keys are `<gateway>|<role>` (v2). Version 1 keyed by role only, so with several
// gateways on one host the store held whatever the LAST gateway issued and the next gateway
// rejected it (token_mismatch). Legacy role-only keys are still read as a fallback for any
// gateway and are dropped as soon as a gateway-keyed token for that role is stored.
type DeviceAuthStore = {
  version: 1 | 2;
  deviceId: string;
  tokens: Record<string, DeviceAuthEntry>;
};

const DEVICE_AUTH_FILE = "device-auth.json";
const KEY_SEPARATOR = "|";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

function resolveDeviceAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "identity", DEVICE_AUTH_FILE);
}

function normalizeRole(role: string): string {
  return role.trim();
}

/**
 * Normalize a gateway URL into a store key: scheme + host + port. All loopback spellings
 * (127.0.0.1, localhost, [::1]) collapse to `loopback` so the same local gateway is one key.
 */
export function normalizeGatewayKey(gatewayUrl: string): string {
  const raw = gatewayUrl.trim();
  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(/:$/, "").toLowerCase();
    const host = url.hostname.toLowerCase();
    const defaultPort = scheme === "wss" || scheme === "https" ? "443" : "80";
    const port = url.port || defaultPort;
    const hostKey = LOOPBACK_HOSTS.has(host) ? "loopback" : host;
    return `${scheme}://${hostKey}:${port}`;
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}

function storeKey(role: string, gatewayUrl?: string): string {
  const r = normalizeRole(role);
  return gatewayUrl ? `${normalizeGatewayKey(gatewayUrl)}${KEY_SEPARATOR}${r}` : r;
}

function isLegacyKey(key: string): boolean {
  return !key.includes(KEY_SEPARATOR);
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const out = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed) {
      out.add(trimmed);
    }
  }
  return [...out].toSorted();
}

function readStore(filePath: string): DeviceAuthStore | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    if ((parsed?.version !== 1 && parsed?.version !== 2) || typeof parsed.deviceId !== "string") {
      return null;
    }
    if (!parsed.tokens || typeof parsed.tokens !== "object") {
      return null;
    }
    // v1 → v2 on read: v1 keys are role-only and stay as legacy fallback entries.
    return { version: 2, deviceId: parsed.deviceId, tokens: parsed.tokens };
  } catch {
    return null;
  }
}

function writeStore(filePath: string, store: DeviceAuthStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function loadDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  /** Gateway the token is for. Omit only for single-gateway callers (legacy behavior). */
  gatewayUrl?: string;
  env?: NodeJS.ProcessEnv;
}): DeviceAuthEntry | null {
  const filePath = resolveDeviceAuthPath(params.env);
  const store = readStore(filePath);
  if (!store) {
    return null;
  }
  if (store.deviceId !== params.deviceId) {
    return null;
  }
  const keyed = store.tokens[storeKey(params.role, params.gatewayUrl)];
  if (keyed && typeof keyed.token === "string") {
    return keyed;
  }
  // Legacy role-only entry (issuer unknown): offered as a fallback; the client still prefers
  // its explicit shared token and a failed attempt clears it.
  const legacy = store.tokens[storeKey(params.role)];
  if (legacy && typeof legacy.token === "string") {
    return legacy;
  }
  return null;
}

export function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
  gatewayUrl?: string;
  env?: NodeJS.ProcessEnv;
}): DeviceAuthEntry {
  const filePath = resolveDeviceAuthPath(params.env);
  const existing = readStore(filePath);
  const role = normalizeRole(params.role);
  const next: DeviceAuthStore = {
    version: 2,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
  };
  const entry: DeviceAuthEntry = {
    token: params.token,
    role,
    scopes: normalizeScopes(params.scopes),
    updatedAtMs: Date.now(),
    ...(params.gatewayUrl ? { gateway: normalizeGatewayKey(params.gatewayUrl) } : {}),
  };
  next.tokens[storeKey(role, params.gatewayUrl)] = entry;
  if (params.gatewayUrl) {
    // Migration: the role-only legacy entry is superseded once a gateway-keyed one exists.
    delete next.tokens[storeKey(role)];
  }
  writeStore(filePath, next);
  return entry;
}

export function clearDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  gatewayUrl?: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const filePath = resolveDeviceAuthPath(params.env);
  const store = readStore(filePath);
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }
  const keys = [storeKey(params.role, params.gatewayUrl), storeKey(params.role)];
  if (!keys.some((key) => store.tokens[key])) {
    return;
  }
  const next: DeviceAuthStore = {
    version: 2,
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
  };
  for (const key of keys) {
    delete next.tokens[key];
  }
  writeStore(filePath, next);
}

/** Exposed for tests/diagnostics. */
export const __deviceAuthStoreInternals = { storeKey, isLegacyKey };
