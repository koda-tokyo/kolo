// Continuity suite (KoLo 2.0, M11): shared types for the manifest, the probes, the scorer and
// the report. Nothing in this module runs at import time.

export const CONTINUITY_MANIFEST_VERSION = 1 as const;
export const CONTINUITY_REPORT_VERSION = 1 as const;

export const DISRUPTIONS = ["model-swap", "restart", "move", "close"] as const;
export type Disruption = (typeof DISRUPTIONS)[number];

export const MANIFEST_ENTRY_KINDS = [
  "identity",
  "memory",
  "role",
  "model",
  "job",
  "session",
  "transcript",
  "audit",
] as const;
export type ManifestEntryKind = (typeof MANIFEST_ENTRY_KINDS)[number];

/**
 * One line of the manifest. `hash` chains the entry to the previous one:
 * `sha256(prevHash + "\n" + canonicalJson(entry without hash))`.
 */
export type ManifestEntry = {
  kind: ManifestEntryKind;
  /** Stable name inside its kind: a workspace-relative path, a job id, a session key. */
  name: string;
  /** SHA-256 of the file content for file-backed entries. */
  sha256?: string;
  size?: number;
  /** Structured value for non-file entries (job, session, audit, role, model). */
  value?: Record<string, unknown>;
  hash: string;
};

export type ManifestSigner = {
  alg: "ed25519";
  /** SHA-256 of the raw public key, hex. */
  keyId: string;
  /** Raw public key, base64url. */
  publicKey: string;
};

export type ContinuityManifest = {
  version: typeof CONTINUITY_MANIFEST_VERSION;
  resident: string;
  createdAt: string;
  /** Build/version of the gateway that produced the manifest, when known. */
  gatewayVersion?: string;
  counts: Record<ManifestEntryKind, number>;
  entries: ManifestEntry[];
  /** Head of the hash chain (`AUDIT_GENESIS`-style 64 zeros for an empty manifest). */
  root: string;
  signer: ManifestSigner;
  /** Ed25519 signature over `manifestSigningInput(manifest)`, base64url. */
  signature: string;
};

export type ManifestVerification = {
  ok: boolean;
  chainOk: boolean;
  rootOk: boolean;
  signatureOk: boolean;
  keyIdOk: boolean;
  /** First entry index whose hash did not recompute, when the chain is broken. */
  firstBreak?: number;
  reason?: string;
};

export type InvariantStatus = "pass" | "fail" | "skip";

export type InvariantResult = {
  id: string;
  name: string;
  status: InvariantStatus;
  /** One sentence a person can read. */
  detail: string;
  evidence?: Record<string, unknown>;
};

export type FactProbe = {
  /** Query sent to the recall endpoint. */
  query: string;
  /** Substring that must appear in one of the recalled snippets (case-insensitive). */
  expect: string;
};

export type FactResult = FactProbe & { hit: boolean; backend?: string };

export type RecallHit = {
  path: string;
  line: number;
  score: number;
  snippet: string;
};

export type ProbeSnapshot = {
  takenAt: string;
  health: { pid?: number; version?: string; status?: string; readiness?: string };
  sessions: Array<{ key: string; id: string; agent: string; label?: string; state?: string }>;
  jobs: Array<{ id: string; status: string; kind: string; sessionKey: string; error?: string }>;
  devices: Array<{ fingerprint: string; scope: string; status: string }>;
  recall: FactResult[];
  chat?: { ok: boolean; model?: string; text?: string; marker?: string; error?: string };
  audit: { ok: boolean; entries: number; lastSeq: number; headHash?: string };
  /** The audit entry at the previous snapshot's head seq (continuity check), when requested. */
  auditAnchor?: { seq: number; hash: string } | null;
  /** Owner credential still enforced: a wrong token is rejected. */
  authEnforced: boolean;
  /** Permission matrix observed through the public API (hashed by the scorer). */
  role: Record<string, unknown>;
};

export type DisruptionOutcome = {
  disruption: Disruption;
  applied: boolean;
  detail: string;
  startedAt: string;
  endedAt: string;
  /** Job that was running when the disruption hit, when the probe started one. */
  unfinishedJobId?: string;
  /** Session key the "close" disruption closed. */
  closedSessionKey?: string;
  /** Model profile before and after a swap. */
  modelBefore?: string;
  modelAfter?: string;
  /** Identity marker the resident is expected to answer with (deterministic provider only). */
  expectedMarker?: string;
};

export type ContinuityRun = {
  disruption: Disruption;
  before: { manifest: ContinuityManifest; probes: ProbeSnapshot };
  outcome: DisruptionOutcome;
  after: { manifest: ContinuityManifest; probes: ProbeSnapshot };
  invariants: InvariantResult[];
  /** Strings that must never appear in any public response or in the report. */
  leakScan: { scanned: number; leaked: boolean; where: string[] };
};

export type ContinuityReport = {
  version: typeof CONTINUITY_REPORT_VERSION;
  resident: string;
  createdAt: string;
  gateway: { baseUrl: string; mode: "throwaway" | "attached" };
  runs: ContinuityRun[];
  /** Disruptions that could not be exercised in this mode, with the reason. */
  skipped: Array<{ disruption: Disruption; reason: string }>;
  summary: {
    pass: number;
    fail: number;
    skip: number;
    verdict: "PASS" | "FAIL";
    badge: string;
  };
};
