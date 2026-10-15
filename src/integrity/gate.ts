// Boot integrity gate (KoLo 2.0, M2b).
//
// `startGatewayServer` calls `runBootIntegrityGate()` before plugins and channels load. On any
// missing or mismatched constitution file the gateway refuses to start (the CLI exits 3), unless
// KOLO_INTEGRITY=warn — a development-only setting that logs and continues.

import { auditSafe } from "../audit/audit-log.js";
import {
  resolveIntegrityLocations,
  verifyRegistry,
  type IntegrityLocations,
  type IntegrityVerifyResult,
} from "./registry.js";

export const INTEGRITY_EXIT_CODE = 3;

/** `/health` field. */
export type IntegrityHealth = "ok" | "warn" | "failed";

export type IntegrityMode = "enforce" | "warn";

export class IntegrityGateError extends Error {
  readonly exitCode = INTEGRITY_EXIT_CODE;
  readonly result: IntegrityVerifyResult;
  constructor(result: IntegrityVerifyResult) {
    super(formatIntegrityFailure(result));
    this.name = "IntegrityGateError";
    this.result = result;
  }
}

export function isIntegrityGateError(err: unknown): err is IntegrityGateError {
  return (
    err instanceof IntegrityGateError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "IntegrityGateError")
  );
}

export function resolveIntegrityMode(env: NodeJS.ProcessEnv = process.env): IntegrityMode {
  return env.KOLO_INTEGRITY?.trim().toLowerCase() === "warn" ? "warn" : "enforce";
}

export function formatIntegrityFailure(result: IntegrityVerifyResult): string {
  const lines = result.problems.slice(0, 20).map((p) => `  - ${p.message}`);
  if (result.problems.length > 20) {
    lines.push(`  … and ${result.problems.length - 20} more`);
  }
  return [
    `integrity gate: ${result.problems.length} protected policy file problem(s) (registry ${result.registryPath}):`,
    ...lines,
    "If the change is intended, the operator re-registers it with `kurahi integrity update <path>`.",
  ].join("\n");
}

type GateState = {
  mode: IntegrityMode;
  result: IntegrityVerifyResult | null;
  checkedAtMs: number;
};

const state: GateState = { mode: "enforce", result: null, checkedAtMs: 0 };
const RECHECK_MS = 60_000;

function healthFor(result: IntegrityVerifyResult | null, mode: IntegrityMode): IntegrityHealth {
  if (!result || result.state !== "failed") {
    return "ok";
  }
  return mode === "warn" ? "warn" : "failed";
}

let lastAuditedFailure = "";

function recordFailure(
  result: IntegrityVerifyResult,
  phase: "boot" | "runtime",
  mode: IntegrityMode,
) {
  // One audit line per distinct failure set, not one per health probe.
  const key = `${phase}:${result.problems.map((p) => `${p.kind}:${p.path}`).join("|")}`;
  if (key === lastAuditedFailure) {
    return;
  }
  lastAuditedFailure = key;
  void auditSafe({
    identity: "gateway",
    action: "integrity.verify",
    outcome: "failed",
    source: `integrity.${phase}`,
    detail: {
      mode,
      registry: result.registryPath,
      problems: result.problems.map((p) => ({
        path: p.path,
        kind: p.kind,
        expected: p.expected,
        actual: p.actual,
      })),
    },
  });
}

export type BootGateLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

/**
 * Verify the registry at boot. Throws {@link IntegrityGateError} on failure in enforce mode.
 * Returns the result otherwise (also recorded for `/health` and `integrity.status`).
 */
export async function runBootIntegrityGate(params: {
  log: BootGateLogger;
  env?: NodeJS.ProcessEnv;
  loc?: IntegrityLocations;
}): Promise<IntegrityVerifyResult> {
  const env = params.env ?? process.env;
  const mode = resolveIntegrityMode(env);
  const loc = params.loc ?? resolveIntegrityLocations(env);
  const result = verifyRegistry(loc);
  state.mode = mode;
  state.result = result;
  state.checkedAtMs = Date.now();
  if (result.state === "unconfigured") {
    params.log.info(
      "integrity gate: no registry (run `kurahi integrity init` to register the protected policy files)",
    );
    return result;
  }
  if (result.state === "ok") {
    params.log.info(`integrity gate: ${result.checked} protected policy file(s) verified`);
    return result;
  }
  recordFailure(result, "boot", mode);
  if (mode === "warn") {
    params.log.warn(
      `${formatIntegrityFailure(result)}\nKOLO_INTEGRITY=warn (development only): continuing despite the failure.`,
    );
    return result;
  }
  params.log.error(formatIntegrityFailure(result));
  throw new IntegrityGateError(result);
}

/** Live re-verification (cached for 60 s unless `force`). Never throws. */
export function getIntegrityStatus(opts: { force?: boolean; loc?: IntegrityLocations } = {}): {
  integrity: IntegrityHealth;
  mode: IntegrityMode;
  result: IntegrityVerifyResult | null;
} {
  const fresh = Date.now() - state.checkedAtMs < RECHECK_MS;
  if (opts.force || !fresh || !state.result) {
    try {
      const result = verifyRegistry(opts.loc ?? resolveIntegrityLocations());
      state.result = result;
      state.checkedAtMs = Date.now();
      if (result.state === "failed") {
        recordFailure(result, "runtime", state.mode);
      }
    } catch {
      // keep the previous result
    }
  }
  return { integrity: healthFor(state.result, state.mode), mode: state.mode, result: state.result };
}

/** Cheap `/health` field (re-verifies at most once a minute). */
export function integrityHealthField(): IntegrityHealth {
  return getIntegrityStatus().integrity;
}

export const __testing = {
  reset() {
    state.mode = "enforce";
    state.result = null;
    state.checkedAtMs = 0;
    lastAuditedFailure = "";
  },
};
