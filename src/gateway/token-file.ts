// Per-gateway token file (KoLo 2.0, M1b).
//
// Each gateway reads its shared-secret token from `<KOLO_HOME>/secrets/gateway.token`
// (mode 0600) instead of a `gateway.auth.token` value that every gateway on the host
// copied from one kolo.json and that clients then passed on argv (visible in `ps`).
//
// Clients (`kolo tui`, `kolo agent`, `kolo health`, the gateway client) resolve the same
// file, so a client running with the gateway's KOLO_HOME needs no token argument at all.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GatewayAuthConfig } from "../config/types.gateway.js";
import { koloSecretsDir, resolveKoloHome } from "../config/kolo-home.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveUserPath } from "../utils.js";

export const GATEWAY_TOKEN_FILENAME = "gateway.token";
/** Env override for the token file path (lets a launcher point a client at another gateway's file). */
export const GATEWAY_TOKEN_FILE_ENV = "KOLO_GATEWAY_TOKEN_FILE";

export type GatewayTokenSource = "flag" | "file" | "env" | "config";

const log = createSubsystemLogger("gateway/auth");
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) {
    return;
  }
  warned.add(key);
  log.warn(message);
}

/** Test hook: forget which one-time warnings were already printed. */
export function resetGatewayTokenWarningsForTest(): void {
  warned.clear();
}

/** Default token file for a state root: `<home>/secrets/gateway.token`. Does not touch disk. */
export function defaultGatewayTokenFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveKoloHome({ env }), "secrets", GATEWAY_TOKEN_FILENAME);
}

/**
 * Resolve the token file path. Returns null when the file source is disabled
 * (`gateway.auth.tokenFile: false`).
 */
export function resolveGatewayTokenFilePath(params: {
  authConfig?: Pick<GatewayAuthConfig, "tokenFile"> | null;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const env = params.env ?? process.env;
  const fromEnv = env[GATEWAY_TOKEN_FILE_ENV]?.trim();
  if (fromEnv) {
    return resolveUserPath(fromEnv);
  }
  const configured = params.authConfig?.tokenFile;
  if (configured === false) {
    return null;
  }
  if (typeof configured === "string" && configured.trim()) {
    return resolveUserPath(configured.trim());
  }
  return defaultGatewayTokenFilePath(env);
}

/** Read a token file. Missing/empty/unreadable → undefined (never throws). */
export function readGatewayTokenFile(filePath: string): string | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  const token = raw.trim();
  if (!token) {
    return undefined;
  }
  if (process.platform !== "win32") {
    try {
      const mode = fs.statSync(filePath).mode & 0o777;
      if (mode & 0o077) {
        warnOnce(
          `perm:${filePath}`,
          `gateway token file ${filePath} is readable by group/others (mode ${mode.toString(8)}); run: chmod 600 ${filePath}`,
        );
      }
    } catch {
      // best-effort
    }
  }
  return token;
}

/** Generate a fresh token: 32 random bytes, hex. */
export function generateGatewayToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Create the token file (0600, parent 0700) if it does not exist and return its token.
 * Uses an exclusive create so two processes racing on first start agree on one token.
 */
export function ensureGatewayTokenFile(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env,
): { token: string; created: boolean } {
  const existing = readGatewayTokenFile(filePath);
  if (existing) {
    return { token: existing, created: false };
  }
  const dir = path.dirname(filePath);
  if (path.resolve(filePath) === path.resolve(defaultGatewayTokenFilePath(env))) {
    koloSecretsDir(resolveKoloHome({ env }));
  } else {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const token = generateGatewayToken();
  try {
    // An empty leftover file would make "wx" fail; remove it first.
    if (fs.existsSync(filePath) && !readGatewayTokenFile(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    fs.writeFileSync(filePath, `${token}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") {
      const raced = readGatewayTokenFile(filePath);
      if (raced) {
        return { token: raced, created: false };
      }
    }
    throw err;
  }
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // best-effort; umask already applied 0600 on create
    }
  }
  log.debug(`generated gateway token file ${filePath} (0600)`);
  return { token, created: true };
}

function trimmed(value: string | undefined | null): string | undefined {
  const t = typeof value === "string" ? value.trim() : "";
  return t || undefined;
}

/**
 * Shared-token precedence for gateways AND local clients:
 *   1. token file (`gateway.auth.tokenFile`, default `<KOLO_HOME>/secrets/gateway.token`,
 *      path overridable with KOLO_GATEWAY_TOKEN_FILE)
 *   2. KOLO_GATEWAY_TOKEN (or legacy CLAWDBOT_GATEWAY_TOKEN) env
 *   3. legacy `gateway.auth.token` in kolo.json (deprecated; one-time warning)
 * An explicit `override` (deprecated `--token` flags) beats all three for that process only.
 */
export function resolveGatewayTokenWithSource(params: {
  authConfig?: Pick<GatewayAuthConfig, "token" | "tokenFile"> | null;
  env?: NodeJS.ProcessEnv;
  override?: string | null;
}): { token?: string; source?: GatewayTokenSource; tokenFile: string | null } {
  const env = params.env ?? process.env;
  const tokenFile = resolveGatewayTokenFilePath({ authConfig: params.authConfig, env });
  const override = trimmed(params.override);
  if (override) {
    return { token: override, source: "flag", tokenFile };
  }
  const fileToken = tokenFile ? readGatewayTokenFile(tokenFile) : undefined;
  if (fileToken) {
    if (trimmed(params.authConfig?.token)) {
      warnOnce(
        "legacy-ignored",
        `gateway.auth.token in kolo.json is ignored because ${tokenFile} exists; remove it from config.`,
      );
    }
    return { token: fileToken, source: "file", tokenFile };
  }
  const envToken = trimmed(env.KOLO_GATEWAY_TOKEN) ?? trimmed(env.CLAWDBOT_GATEWAY_TOKEN);
  if (envToken) {
    return { token: envToken, source: "env", tokenFile };
  }
  const legacy = trimmed(params.authConfig?.token);
  if (legacy) {
    warnOnce(
      "legacy-used",
      `gateway.auth.token in kolo.json is deprecated (shared across gateways, copied onto argv). ` +
        `Move it to ${tokenFile ?? "a token file"} (0600) or remove it to have the gateway generate a per-gateway token.`,
    );
    return { token: legacy, source: "config", tokenFile };
  }
  return { token: undefined, source: undefined, tokenFile };
}

/**
 * Convenience for local clients/commands: the shared token a process with this config + env
 * would use (token file → KOLO_GATEWAY_TOKEN → legacy gateway.auth.token). Never reads argv.
 */
export function resolveLocalGatewayToken(
  cfg:
    | { gateway?: { auth?: Pick<GatewayAuthConfig, "token" | "tokenFile"> | null } }
    | null
    | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return resolveGatewayTokenWithSource({ authConfig: cfg?.gateway?.auth, env }).token;
}

/**
 * Persist an explicitly chosen token (e.g. `kolo gateway install --token`, onboarding) to the
 * token file (0600, parent 0700), replacing what is there. Used so service units can carry
 * KOLO_GATEWAY_TOKEN_FILE instead of the token value.
 */
export function writeGatewayTokenFile(
  filePath: string,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const value = token.trim();
  if (!value) {
    throw new Error("refusing to write an empty gateway token");
  }
  if (readGatewayTokenFile(filePath) === value) {
    return;
  }
  if (path.resolve(filePath) === path.resolve(defaultGatewayTokenFilePath(env))) {
    koloSecretsDir(resolveKoloHome({ env }));
  } else {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  }
  // Write to a sibling temp file then rename, so a reader never sees a partial token.
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${value}\n`, { mode: 0o600 });
  if (process.platform !== "win32") {
    fs.chmodSync(tmp, 0o600);
  }
  fs.renameSync(tmp, filePath);
}
