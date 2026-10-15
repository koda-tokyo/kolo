// Policy loading (KoLo 2.0, M13a): read, parse, validate, attest. Pure apart from reads; the
// engine decides what to do with the result (boot gate, hot reload, CLI).
import fs from "node:fs";
import YAML from "yaml";
import { type AttestationResult, attestationFor, sha256Hex } from "./attestation.js";
import { type PolicyLocations, type PolicyMode } from "./paths.js";
import { type PolicyDocument, validatePolicyDocument } from "./schema.js";

export type PolicyLoadResult =
  | { state: "absent"; path: string }
  | { state: "invalid"; path: string; errors: string[]; warnings: string[] }
  | {
      state: "loaded";
      path: string;
      policy: PolicyDocument;
      sha256: string;
      bytes: number;
      attestation: AttestationResult;
      warnings: string[];
    };

/** Parse YAML (or JSON, which YAML accepts) and validate; attestation is checked on the bytes. */
export function parsePolicyText(text: string): ReturnType<typeof validatePolicyDocument> {
  let raw: unknown;
  try {
    raw = YAML.parse(text, { strict: true });
  } catch (err) {
    return { ok: false, errors: [`not valid YAML (${String(err)})`], warnings: [] };
  }
  return validatePolicyDocument(raw);
}

export function loadPolicyFile(
  loc: PolicyLocations,
  opts: { path?: string; attest?: boolean } = {},
): PolicyLoadResult {
  const file = opts.path ?? loc.policyPath;
  if (!fs.existsSync(file)) {
    return { state: "absent", path: file };
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (err) {
    return { state: "invalid", path: file, errors: [`unreadable (${String(err)})`], warnings: [] };
  }
  const parsed = parsePolicyText(bytes.toString("utf8"));
  if (!parsed.ok) {
    return { state: "invalid", path: file, errors: parsed.errors, warnings: parsed.warnings };
  }
  const attestation =
    opts.attest === false
      ? ({ state: "unsigned", reason: "not checked" } satisfies AttestationResult)
      : attestationFor(loc, bytes);
  return {
    state: "loaded",
    path: file,
    policy: parsed.policy,
    sha256: sha256Hex(bytes),
    bytes: bytes.length,
    attestation,
    warnings: parsed.warnings,
  };
}

export type PolicyAcceptance =
  | { accepted: true; warnings: string[] }
  | { accepted: false; reason: string; warnings: string[] };

/**
 * Whether a loaded document may become the active policy under `mode`:
 *   enforce  signed, or the document itself says `attestation.required: false`
 *   audit    anything that parses (unsigned documents are warned about, not refused)
 *   off      nothing is loaded; the engine is inert
 */
export function acceptPolicy(result: PolicyLoadResult, mode: PolicyMode): PolicyAcceptance {
  if (mode === "off") {
    return { accepted: false, reason: "policy mode is off", warnings: [] };
  }
  if (result.state === "absent") {
    return { accepted: false, reason: `no policy at ${result.path}`, warnings: [] };
  }
  if (result.state === "invalid") {
    return {
      accepted: false,
      reason: `policy invalid: ${result.errors.join("; ")}`,
      warnings: result.warnings,
    };
  }
  const warnings = [...result.warnings];
  const att = result.attestation;
  if (att.state === "signed") {
    return { accepted: true, warnings };
  }
  const detail = `${att.state}${att.reason ? ` (${att.reason})` : ""}`;
  if (result.policy.attestation?.required === false) {
    warnings.push(`policy attestation ${detail}; loaded because attestation.required is false`);
    return { accepted: true, warnings };
  }
  if (mode === "audit") {
    warnings.push(`policy attestation ${detail}; loaded because the policy mode is audit`);
    return { accepted: true, warnings };
  }
  return {
    accepted: false,
    reason: `policy attestation ${detail}; sign it with \`kurahi policy sign\` or run with KOLO_POLICY_MODE=audit`,
    warnings,
  };
}
