// KOLO_HOME — the one state root (KoLo 2.0, M1a).
//
// Every piece of mutable state (config, sessions, logs, locks, secrets,
// workspaces) lives under one directory. No module may build a machine path
// (`/home/<user>`, a WSL mount, `/tmp/KoLo`, `$HOME + "/.kolo"`) on its own; it
// asks this module instead.
//
// Precedence:
//   1. KOLO_HOME            (canonical)
//   2. KOLO_STATE_DIR       (legacy alias, still set by profiles and services)
//   3. CLAWDBOT_STATE_DIR   (pre-rebrand alias)
//   4. per-OS default:      Linux/macOS `~/.kolo`, Windows `%LOCALAPPDATA%\KoLo`
//      (if the default does not exist but a legacy dir does, the legacy dir wins
//      so existing installs keep their state)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type KoloHomeOptions = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: () => string;
  /** Injected for tests; defaults to fs.existsSync. */
  exists?: (p: string) => boolean;
};

const POSIX_DIRNAME = ".kolo";
const WINDOWS_DIRNAME = "KoLo";
const LEGACY_DIRNAMES = [".clawdbot", ".moltbot", ".moldbot"] as const;

function pathFor(platform: NodeJS.Platform): typeof path.posix {
  return platform === "win32" ? path.win32 : path.posix;
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function expandUser(input: string, homedir: () => string, platform: NodeJS.Platform): string {
  const p = pathFor(platform);
  const trimmed = input.trim();
  if (trimmed.startsWith("~")) {
    return p.resolve(trimmed.replace(/^~(?=$|[\\/])/, homedir()));
  }
  return p.resolve(trimmed);
}

/** Explicit state-root override from the environment, if any (unresolved). */
export function readKoloHomeOverride(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return (
    env.KOLO_HOME?.trim() ||
    env.KOLO_STATE_DIR?.trim() ||
    env.CLAWDBOT_STATE_DIR?.trim() ||
    undefined
  );
}

/** The per-OS default state root, ignoring env overrides and legacy dirs. */
export function defaultKoloHome(opts: KoloHomeOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const homedir = opts.homedir ?? os.homedir;
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    const base = localAppData || path.win32.join(homedir(), "AppData", "Local");
    return path.win32.join(base, WINDOWS_DIRNAME);
  }
  return path.posix.join(homedir(), POSIX_DIRNAME);
}

/**
 * Pre-KOLO_HOME locations that may still hold state. On Windows this includes
 * `~/.kolo` (the old POSIX-style default).
 */
export function legacyKoloHomes(opts: KoloHomeOptions = {}): string[] {
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? os.homedir;
  const p = pathFor(platform);
  const dirs: string[] = [];
  if (platform === "win32") {
    dirs.push(p.join(homedir(), POSIX_DIRNAME));
  }
  for (const name of LEGACY_DIRNAMES) {
    dirs.push(p.join(homedir(), name));
  }
  return dirs;
}

/** Resolve the state root. Pure apart from the existence probe for legacy dirs. */
export function resolveKoloHome(opts: KoloHomeOptions = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? os.homedir;
  const exists = opts.exists ?? safeExists;
  const override = readKoloHomeOverride(env);
  if (override) {
    return expandUser(override, homedir, platform);
  }
  const def = defaultKoloHome({ env, platform, homedir });
  if (exists(def)) {
    return def;
  }
  const legacy = legacyKoloHomes({ platform, homedir }).find((dir) => exists(dir));
  return legacy ?? def;
}

/** Join segments under the state root. */
export function koloPath(...segments: string[]): string {
  return path.join(resolveKoloHome(), ...segments);
}

/** `<home>/logs` — replaces the old `/tmp/KoLo` log dir. */
export function koloLogDir(home: string = resolveKoloHome()): string {
  return path.join(home, "logs");
}

/** `<home>/run` — locks, pid files, sockets. */
export function koloRunDir(home: string = resolveKoloHome()): string {
  return path.join(home, "run");
}

/** `<home>/tmp` — scratch files (browser downloads, traces); replaces `/tmp/KoLo`. */
export function koloTmpDir(home: string = resolveKoloHome()): string {
  return path.join(home, "tmp");
}

/** `<home>/secrets` — created with mode 0700 (best-effort on Windows). */
export function koloSecretsDir(home: string = resolveKoloHome()): string {
  const dir = path.join(home, "secrets");
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      fs.chmodSync(dir, 0o700);
    }
  } catch {
    // Caller surfaces the error when it actually reads/writes a secret.
  }
  return dir;
}

/** mkdir -p helper that returns the directory. */
export function ensureKoloDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Not our directory to tighten (e.g. shared mount); doctor reports it.
    }
  }
  return dir;
}

/**
 * The state root shared by the agents of one install: `workspace-<agent>` dirs, the device
 * identity, exec approvals, the canvas root. `KOLO_SHARED_HOME` wins; otherwise it is the state
 * root itself (`KOLO_HOME` when set, else the per-OS default). An install that sets `KOLO_HOME`
 * therefore never touches the per-OS default; only the legacy multi-gateway layout, where several
 * gateways run without `KOLO_HOME` and federate through `KOLO_SHARED_HOME`, has a separate root.
 */
export function resolveSharedKoloHome(opts: KoloHomeOptions = {}): string {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const homedir = opts.homedir ?? os.homedir;
  const shared = env.KOLO_SHARED_HOME?.trim();
  if (shared) {
    return expandUser(shared, homedir, platform);
  }
  return resolveKoloHome(opts);
}

/** `<shared>/workspace-<agentId>` — a (sibling) agent workspace on this host. */
export function resolveSharedAgentWorkspaceDir(
  agentId: string,
  opts: KoloHomeOptions = {},
): string {
  return path.join(resolveSharedKoloHome(opts), `workspace-${agentId}`);
}

export type SiblingLocator = {
  id: string;
  stateDir?: string;
  workspaceDir?: string;
  url?: string;
};

/**
 * Resolve a sibling's workspace dir. Prefers `siblings[].workspaceDir`, then
 * `siblings[].stateDir/workspace-<id>`, then the shared family root. The last step
 * is a documented legacy fallback for the pre-2.0 federated layout.
 */
export function resolveSiblingWorkspaceDir(
  siblingId: string,
  siblings: readonly SiblingLocator[] | undefined,
  opts: KoloHomeOptions = {},
): string {
  const homedir = opts.homedir ?? os.homedir;
  const platform = opts.platform ?? process.platform;
  const entry = siblings?.find((s) => s.id.toLowerCase() === siblingId.toLowerCase());
  if (entry?.workspaceDir) {
    return expandUser(entry.workspaceDir, homedir, platform);
  }
  if (entry?.stateDir) {
    return path.join(expandUser(entry.stateDir, homedir, platform), `workspace-${siblingId}`);
  }
  return resolveSharedAgentWorkspaceDir(siblingId, opts);
}

/**
 * Resolve a sibling's state root. `siblings[].stateDir` wins; legacy fallback is
 * `<home>/../.kolo-<id>` (the pre-2.0 per-sibling layout).
 */
export function resolveSiblingStateDir(
  siblingId: string,
  siblings: readonly SiblingLocator[] | undefined,
  opts: KoloHomeOptions = {},
): string {
  const homedir = opts.homedir ?? os.homedir;
  const platform = opts.platform ?? process.platform;
  const entry = siblings?.find((s) => s.id.toLowerCase() === siblingId.toLowerCase());
  if (entry?.stateDir) {
    return expandUser(entry.stateDir, homedir, platform);
  }
  const p = pathFor(platform);
  return p.join(p.dirname(resolveKoloHome({ ...opts, platform, homedir })), `.kolo-${siblingId}`);
}
