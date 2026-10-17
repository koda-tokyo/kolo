// Pre-execution permission flags for CLI agent backends (Kurahi 2.0.3).
//
// The tool capability (tool-capability.ts) is enforced in two layers:
//   1. preventive (this file): flags passed to the CLI so it cannot run a tool outside the
//      capability in the first place;
//   2. detective (cli-runner.ts, enforceCliToolCapability): after the run, any tool call the CLI
//      reports under tools=none is rejected and audited.
// Bypass flags are never part of the defaults. They are added only with the explicit opt-in
// `agents.defaults.cliBackends.<id>.unsafeSkipPermissions: true`, and every such run is audited.
// Flags verified against the installed CLIs' --help (claude 2.1.x, codex exec 0.15x).
import type { CliBackendConfig } from "../config/types.js";
import type { ToolCapability } from "./tool-capability.js";
import { recordAuditEvent } from "../security/audit-log.js";

/** Flags that switch a CLI's own permission checks or sandbox off. */
const BYPASS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--allow-dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
]);
const BYPASS_VALUES: Record<string, Set<string>> = {
  "--permission-mode": new Set(["bypassPermissions"]),
  "--sandbox": new Set(["danger-full-access"]),
  "-s": new Set(["danger-full-access"]),
};
/** Flags this module owns; configured copies are dropped so the capability decides. */
const OWNED_WITH_VALUE: Record<string, string[]> = {
  "claude-cli": [
    "--permission-mode",
    "--tools",
    "--allowedTools",
    "--allowed-tools",
    "--disallowedTools",
    "--disallowed-tools",
  ],
  "codex-cli": ["--sandbox", "-s"],
};

export type CliPermissionPlan = {
  /** Base args with bypass flags (and flags this module owns) removed. */
  baseArgs: string[];
  /** Flags to append for this run. */
  extraArgs: string[];
  /** Bypass flags removed from configured args because the opt-in was not set. */
  stripped: string[];
  unsafe: boolean;
};

function stripArgs(
  args: string[],
  backendId: string,
  unsafe: boolean,
): { kept: string[]; stripped: string[] } {
  const owned = new Set(OWNED_WITH_VALUE[backendId] ?? []);
  const kept: string[] = [];
  const stripped: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const [flag, inlineValue] = arg.includes("=")
      ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)]
      : [arg, undefined];
    if (BYPASS_FLAGS.has(flag)) {
      if (!unsafe) stripped.push(flag);
      continue;
    }
    const bypassValues = BYPASS_VALUES[flag];
    if (bypassValues || owned.has(flag)) {
      const value = inlineValue ?? args[i + 1];
      if (inlineValue === undefined) i += 1;
      if (bypassValues?.has(value ?? "") && !unsafe) stripped.push(`${flag} ${value}`);
      if (owned.has(flag)) continue;
      // A non-owned flag with a bypass value is dropped; any other value is kept as configured.
      if (bypassValues?.has(value ?? "")) continue;
      kept.push(flag, ...(value !== undefined ? [value] : []));
      continue;
    }
    kept.push(arg);
  }
  return { kept, stripped };
}

function list(values: string[] | undefined): string[] {
  return (values ?? []).map((v) => v.trim()).filter(Boolean);
}

/** Decide the permission flags for one CLI run from its backend id, config and capability. */
export function planCliPermissions(params: {
  backendId: string;
  backend: CliBackendConfig;
  capability: ToolCapability;
  baseArgs: string[];
}): CliPermissionPlan {
  const unsafe = params.backend.unsafeSkipPermissions === true;
  const { kept, stripped } = stripArgs(params.baseArgs, params.backendId, unsafe);
  const extraArgs: string[] = [];
  if (params.backendId === "claude-cli") {
    if (unsafe) {
      extraArgs.push("--dangerously-skip-permissions");
    } else if (params.capability === "none") {
      // No built-in tools at all, and nothing may prompt.
      extraArgs.push("--tools", "", "--permission-mode", "dontAsk");
    } else {
      // dontAsk: a tool that would need permission is denied unless allowedTools pre-approves it.
      extraArgs.push("--permission-mode", "dontAsk");
      const allowed = list(params.backend.allowedTools);
      if (allowed.length > 0) extraArgs.push("--allowedTools", allowed.join(","));
    }
    const disallowed = list(params.backend.disallowedTools);
    if (disallowed.length > 0) extraArgs.push("--disallowedTools", disallowed.join(","));
  } else if (params.backendId === "codex-cli") {
    const mode = unsafe
      ? "danger-full-access"
      : params.capability === "none"
        ? "read-only"
        : "workspace-write";
    extraArgs.push("--sandbox", mode);
  }
  return { baseArgs: kept, extraArgs, stripped, unsafe };
}

/** Audit what the plan did: an opt-in bypass, or bypass flags removed from configured args. */
export function auditCliPermissionPlan(
  plan: CliPermissionPlan,
  ctx: { backendId: string; agentId?: string; sessionKey?: string },
): void {
  if (plan.unsafe) {
    recordAuditEvent({
      action: "cli.permissions",
      outcome: "allowed",
      identity: ctx.agentId,
      scope: ctx.sessionKey,
      source: "cli-runner",
      detail: {
        backend: ctx.backendId,
        mode: "unsafeSkipPermissions",
        warning: "CLI permission checks bypassed by opt-in",
      },
    });
  } else if (plan.stripped.length > 0) {
    recordAuditEvent({
      action: "cli.permissions",
      outcome: "denied",
      identity: ctx.agentId,
      scope: ctx.sessionKey,
      source: "cli-runner",
      detail: { backend: ctx.backendId, stripped: plan.stripped },
    });
  }
}
