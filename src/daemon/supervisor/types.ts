import type { ServiceExec } from "./exec.js";
import type { ServiceEnv, ServiceIdentity } from "./identity.js";
import type { ServiceLaunchSpec } from "./render.js";

export type ServiceManager = "systemd" | "launchd" | "schtasks";

export type ServiceState =
  | "running"
  | "starting"
  | "stopping"
  | "stopped"
  | "failed"
  | "not-installed"
  | "unknown";

/** Process state as reported by the OS service manager (never from a lease or pid file alone). */
export type ServiceStatus = {
  manager: ServiceManager;
  name: string;
  installed: boolean;
  enabled?: boolean;
  state: ServiceState;
  pid?: number;
  restarts?: number;
  lastExitCode?: number;
  since?: string;
  /** Raw manager state, e.g. "active (running)" or "Ready". */
  detail?: string;
  definitionPath: string;
};

export type ServiceBackendDeps = {
  exec: ServiceExec;
  env: ServiceEnv;
  homedir: string;
  uid?: number;
  user?: string;
};

export type ServiceBackend = {
  manager: ServiceManager;
  definitionPath: (identity: ServiceIdentity) => string;
  install: (spec: ServiceLaunchSpec, opts: { start: boolean }) => Promise<string[]>;
  uninstall: (identity: ServiceIdentity) => Promise<string[]>;
  start: (identity: ServiceIdentity) => Promise<void>;
  stop: (identity: ServiceIdentity) => Promise<void>;
  restart: (identity: ServiceIdentity) => Promise<void>;
  status: (identity: ServiceIdentity) => Promise<ServiceStatus>;
  logs: (identity: ServiceIdentity, opts: { lines: number; maxBytes: number }) => Promise<string>;
};

export function assertOk(
  res: { code: number; stdout: string; stderr: string },
  what: string,
): void {
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().slice(0, 600);
    throw new Error(`${what} failed (exit ${res.code})${detail ? `: ${detail}` : ""}`);
  }
}
