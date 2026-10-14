// Policy as code (KoLo 2.0, M13): where the policy document, its attestation and the runtime
// meters live under KOLO_HOME. Nothing here reads or writes at import time.
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type PolicyLocations = {
  home: string;
  /** `<KOLO_HOME>/policy` */
  dir: string;
  /** `<KOLO_HOME>/policy/policy.yaml` — the declarative policy. */
  policyPath: string;
  /** `<KOLO_HOME>/policy/policy.yaml.sig` — detached owner signature over the policy bytes. */
  signaturePath: string;
  /** `<KOLO_HOME>/policy/owners.json` — the owner public keys a signature must come from. */
  ownersPath: string;
  /** `<KOLO_HOME>/secrets/policy-owner.json` — the local owner signing key (0600). */
  ownerKeyPath: string;
  /** `<KOLO_HOME>/run/budgets.json` — persisted budget meters. */
  budgetsPath: string;
  /** `<KOLO_HOME>/run/policy-kill.json` — runtime kill switch state (survives restarts). */
  killStatePath: string;
};

/** Relative patterns the integrity registry covers once a policy exists (M13 item 3). */
export const POLICY_INTEGRITY_PATTERNS = [
  "policy/policy.yaml",
  "policy/policy.yaml.sig",
  "policy/owners.json",
] as const;

export function resolvePolicyLocations(env: NodeJS.ProcessEnv = process.env): PolicyLocations {
  const home = resolveStateDir(env);
  const dir = path.join(home, "policy");
  const keyOverride = env.KOLO_POLICY_OWNER_KEY_FILE?.trim();
  return {
    home,
    dir,
    policyPath: path.join(dir, "policy.yaml"),
    signaturePath: path.join(dir, "policy.yaml.sig"),
    ownersPath: path.join(dir, "owners.json"),
    ownerKeyPath: keyOverride
      ? path.resolve(keyOverride)
      : path.join(home, "secrets", "policy-owner.json"),
    budgetsPath: path.join(home, "run", "budgets.json"),
    killStatePath: path.join(home, "run", "policy-kill.json"),
  };
}

export type PolicyMode = "enforce" | "audit" | "off";

/**
 * Enforcement mode: KOLO_POLICY_MODE wins, then `policy.mode` in the config, then `enforce`.
 * The mode is deliberately outside the policy file: a document cannot downgrade its own gate.
 */
export function resolvePolicyMode(
  env: NodeJS.ProcessEnv = process.env,
  configured?: string | null,
): PolicyMode {
  const raw = (env.KOLO_POLICY_MODE?.trim() || configured?.trim() || "enforce").toLowerCase();
  return raw === "audit" || raw === "off" ? raw : "enforce";
}
