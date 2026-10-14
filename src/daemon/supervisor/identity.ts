// Service identity: one OS service per KoLo identity, each with its own state root and port.
//
// Names (stable, documented in docs/gateway/service.md):
//   systemd --user  kolo-gateway@<id>.service
//   launchd         com.kodasoken.kolo.<id>   (~/Library/LaunchAgents/<label>.plist)
//   Windows         \KoLo\gateway-<id>        (Task Scheduler folder "KoLo")
import fs from "node:fs";
import path from "node:path";
import { resolveKoloHome } from "../../config/kolo-home.js";

export const DEFAULT_SERVICE_ID = "default";
export const DEFAULT_GATEWAY_PORT = 18789;
export const SYSTEMD_UNIT_PREFIX = "kolo-gateway@";
export const LAUNCHD_LABEL_PREFIX = "com.kodasoken.kolo.";
export const WINDOWS_TASK_FOLDER = "KoLo";

const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export type ServiceEnv = Record<string, string | undefined>;

export type ServiceIdentity = {
  id: string;
  /** State root for this identity (KOLO_HOME of the service process). */
  home: string;
  port: number;
  /** Where the port came from, for status output. */
  portSource: "flag" | "service.json" | "config" | "default";
  systemdUnit: string;
  launchdLabel: string;
  windowsTaskName: string;
  envFile: string;
  logDir: string;
  runDir: string;
  /** Install metadata written by `kolo service install` (port, entry, platform). */
  metadataFile: string;
};

export function normalizeServiceId(raw?: string): string {
  const id = (raw ?? DEFAULT_SERVICE_ID).trim().toLowerCase();
  if (!ID_PATTERN.test(id)) {
    throw new Error(
      `invalid service id "${raw}": use 1-32 chars of a-z, 0-9, "-" or "_", starting with a letter or digit`,
    );
  }
  return id;
}

/** Base state root for the current process (KOLO_HOME, else the per-OS default). */
export function resolveBaseKoloHome(env: ServiceEnv = process.env, homedir?: string): string {
  return resolveKoloHome({
    env: env as NodeJS.ProcessEnv,
    ...(homedir ? { homedir: () => homedir } : {}),
  });
}

/** KOLO_HOME/KOLO_STATE_DIR stripped: what resolveKoloHome() yields with no override set. */
function withoutHomeOverrides(env: ServiceEnv): NodeJS.ProcessEnv {
  const {
    KOLO_HOME: _home,
    KOLO_STATE_DIR: _state,
    CLAWDBOT_STATE_DIR: _legacy,
    ...rest
  } = env as NodeJS.ProcessEnv;
  return rest;
}

/**
 * State root for an identity, always via resolveKoloHome(): `default` uses the base root
 * (KOLO_HOME, or ~/.kolo / %LOCALAPPDATA%\KoLo); any other id gets a sibling `<default>-<id>`
 * (~/.kolo-<id>) of the per-OS default (so running inside one identity's service, where
 * KOLO_HOME points at that identity, does not nest ids), unless `--home` is given.
 */
export function resolveIdentityHome(params: {
  id: string;
  home?: string;
  env?: ServiceEnv;
  homedir?: string;
}): string {
  if (params.home?.trim()) {
    return path.resolve(params.home.trim());
  }
  const env = params.env ?? process.env;
  // The target env's HOME (a service env may differ from this process's).
  const homedir = params.homedir ?? env.HOME ?? env.USERPROFILE;
  if (params.id === DEFAULT_SERVICE_ID) {
    return resolveBaseKoloHome(env, homedir);
  }
  const base = resolveBaseKoloHome(withoutHomeOverrides(env), homedir);
  return `${base}-${params.id}`;
}

function readJsonSafe(file: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function asPort(value: unknown): number | null {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : value;
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

export function parsePortFlag(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const port = asPort(raw);
  if (port === null) {
    throw new Error(`invalid port: ${JSON.stringify(raw)}`);
  }
  return port;
}

export function resolveServiceIdentity(params: {
  id?: string;
  port?: number;
  home?: string;
  env?: ServiceEnv;
  homedir?: string;
}): ServiceIdentity {
  const id = normalizeServiceId(params.id);
  const home = resolveIdentityHome({
    id,
    home: params.home,
    env: params.env,
    homedir: params.homedir,
  });
  const metadataFile = path.join(home, "service", "service.json");

  let port: number | null = params.port ?? null;
  let portSource: ServiceIdentity["portSource"] = "flag";
  if (port === null) {
    port = asPort(readJsonSafe(metadataFile)?.port);
    portSource = "service.json";
  }
  if (port === null) {
    const gateway = readJsonSafe(path.join(home, "kolo.json"))?.gateway as
      | Record<string, unknown>
      | undefined;
    port = asPort(gateway?.port);
    portSource = "config";
  }
  if (port === null) {
    port = DEFAULT_GATEWAY_PORT;
    portSource = "default";
  }

  return {
    id,
    home,
    port,
    portSource,
    systemdUnit: `${SYSTEMD_UNIT_PREFIX}${id}.service`,
    launchdLabel: `${LAUNCHD_LABEL_PREFIX}${id}`,
    windowsTaskName: `${WINDOWS_TASK_FOLDER}\\gateway-${id}`,
    envFile: path.join(home, "env"),
    logDir: path.join(home, "logs"),
    runDir: path.join(home, "run"),
    metadataFile,
  };
}

/** Environment every service process gets, on every platform. Secrets come from the env file. */
export function buildIdentityEnvironment(
  identity: ServiceIdentity,
  extra: ServiceEnv = {},
): Record<string, string> {
  const out: Record<string, string> = {
    KOLO_HOME: identity.home,
    // Current resolvers still read KOLO_STATE_DIR; keep both until kolo-home.ts lands everywhere.
    KOLO_STATE_DIR: identity.home,
    KOLO_SERVICE_ID: identity.id,
    KOLO_GATEWAY_PORT: String(identity.port),
    KOLO_SERVICE_MARKER: "KoLo",
    KOLO_SERVICE_KIND: "gateway",
  };
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === "string" && value !== "") {
      out[key] = value;
    }
  }
  return out;
}
