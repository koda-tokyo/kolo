// `kolo service` core: pick the OS backend, build the launch spec, legacy PM2 detection, health.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ServiceIdentity } from "./identity.js";
import type { ServiceLaunchSpec } from "./render.js";
import type { ServiceBackend, ServiceBackendDeps } from "./types.js";
import { buildMinimalServicePath } from "../service-env.js";
import { createLaunchdBackend } from "./backend-launchd.js";
import { createSchtasksBackend } from "./backend-schtasks.js";
import { createSystemdBackend } from "./backend-systemd.js";
import { execService } from "./exec.js";
import { buildIdentityEnvironment, type ServiceEnv } from "./identity.js";

export * from "./identity.js";
export type * from "./types.js";

export function defaultBackendDeps(env: ServiceEnv = process.env): ServiceBackendDeps {
  let user: string | undefined;
  try {
    user = os.userInfo().username;
  } catch {
    user = env.USER ?? env.USERNAME;
  }
  return {
    exec: execService,
    env,
    homedir: env.HOME ?? env.USERPROFILE ?? os.homedir(),
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    user,
  };
}

export function resolveServiceBackend(
  platform: NodeJS.Platform = process.platform,
  deps: ServiceBackendDeps = defaultBackendDeps(),
): ServiceBackend {
  switch (platform) {
    case "linux":
      return createSystemdBackend(deps);
    case "darwin":
      return createLaunchdBackend(deps);
    case "win32":
      return createSchtasksBackend(deps);
    default:
      throw new Error(`kolo service: unsupported platform ${platform}`);
  }
}

/** dist/ root of the running install (this file lives at dist/daemon/supervisor/index.js). */
export function resolveDistRoot(moduleUrl: string = import.meta.url): string {
  const root = path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..", "..");
  // Running from source (tsx/bun): services still launch the built dist/.
  return path.basename(root) === "src" ? path.join(path.dirname(root), "dist") : root;
}

export function resolveLaunchSpec(params: {
  identity: ServiceIdentity;
  env?: ServiceEnv;
  platform?: NodeJS.Platform;
  nodePath?: string;
  distRoot?: string;
  version?: string;
}): ServiceLaunchSpec {
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  const distRoot = params.distRoot ?? resolveDistRoot();
  const entryPath = path.join(distRoot, "entry.js");
  const runnerPath = path.join(distRoot, "daemon", "supervisor", "runner.js");
  // Prefer the node that runs this CLI; services must not depend on a login-shell PATH.
  const nodePath = params.nodePath ?? process.execPath;
  const extra: ServiceEnv = {
    HOME: env.HOME,
    PATH: buildMinimalServicePath({ env, platform }),
  };
  if (platform === "win32") {
    extra.USERPROFILE = env.USERPROFILE;
  }
  return {
    identity: params.identity,
    nodePath,
    entryPath,
    runnerPath,
    environment: buildIdentityEnvironment(params.identity, extra),
    version: params.version,
  };
}

export function assertDistBuilt(spec: ServiceLaunchSpec): void {
  for (const file of [spec.entryPath, spec.runnerPath]) {
    if (!fs.existsSync(file)) {
      throw new Error(`missing ${file}; run \`pnpm build\` (or reinstall KoLo) first`);
    }
  }
}

export function writeServiceMetadata(spec: ServiceLaunchSpec, platform: NodeJS.Platform) {
  const { identity } = spec;
  fs.mkdirSync(path.dirname(identity.metadataFile), { recursive: true, mode: 0o700 });
  const payload = {
    id: identity.id,
    port: identity.port,
    home: identity.home,
    platform,
    entry: spec.entryPath,
    node: spec.nodePath,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(identity.metadataFile, `${JSON.stringify(payload, null, 2)}\n`, {
    mode: 0o600,
  });
}

export type Pm2GatewayProcess = { name: string; pid: number };

/**
 * PM2 is legacy for KoLo. Detect gateways it still manages by reading its pid files
 * (`$PM2_HOME/pids/<name>-<n>.pid`); no process-name matching, no pm2 binary needed.
 */
export function detectPm2Gateways(env: ServiceEnv = process.env): Pm2GatewayProcess[] {
  const pm2Home = env.PM2_HOME?.trim() || path.join(env.HOME ?? os.homedir(), ".pm2");
  const dir = path.join(pm2Home, "pids");
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: Pm2GatewayProcess[] = [];
  for (const file of entries) {
    const m = file.match(/^(.*)-\d+\.pid$/);
    if (!m || !/gateway/i.test(m[1] ?? "")) {
      continue;
    }
    const pid = Number.parseInt(fs.readFileSync(path.join(dir, file), "utf8").trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0) {
      continue;
    }
    try {
      process.kill(pid, 0);
      found.push({ name: m[1] ?? file, pid });
    } catch {
      // stale pid file
    }
  }
  return found;
}

/**
 * One line, a count only. The processes belong to another supervisor and were not installed by
 * this command, so their names and pids are not printed.
 */
export function formatPm2Notice(found: Pm2GatewayProcess[]): string | null {
  if (found.length === 0) {
    return null;
  }
  const n = found.length;
  return `notice: ${n} other gateway process${n === 1 ? "" : "es"} managed by PM2 (not by kolo service). Move each identity to \`kolo service install --id <id>\`.`;
}

export type HealthProbe = { ok: boolean; status?: number; readiness?: string; error?: string };

export async function probeGatewayHealth(port: number, timeoutMs = 1500): Promise<HealthProbe> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    let readiness: string | undefined;
    try {
      readiness = ((await res.json()) as { readiness?: string }).readiness;
    } catch {
      readiness = undefined;
    }
    return { ok: res.status === 200, status: res.status, readiness };
  } catch (err) {
    return { ok: false, error: (err as Error).name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}
