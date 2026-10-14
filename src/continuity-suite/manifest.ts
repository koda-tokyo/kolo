// Continuity manifest (KoLo 2.0, M11a): a signed, hash-chained snapshot of what makes a resident
// the same resident — identity files, memory files, role, open jobs, session index, transcripts
// and the audit chain head. Paths are relative (workspace or state dir), never absolute, so two
// manifests taken before and after a state-dir move compare equal when nothing else changed.
//
// Chain: entry[i].hash = sha256(entry[i-1].hash + "\n" + canonicalJson(entry[i] minus hash)),
// genesis 64 zeros; `root` is the last hash. Signature: Ed25519 over `manifestSigningInput`
// with the resident's gateway signing key (<KOLO_HOME>/identity/continuity-signing.json, 0600,
// created on first use). Verification needs only the manifest: the raw public key travels in it
// and `keyId` must equal sha256(publicKey).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { KoLoConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { resolveAgentConfig, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { listJobs } from "../agents/jobs.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { AUDIT_GENESIS, resolveAuditDir } from "../audit/audit-log.js";
import { verifyAuditChain } from "../audit/verify.js";
import { resolveSharedKoloHome } from "../config/kolo-home.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveSessionTranscriptsDirForAgent } from "../config/sessions/paths.js";
import {
  deriveDeviceIdFromPublicKey,
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  verifyDeviceSignature,
} from "../infra/device-identity.js";
import { listMemoryFiles } from "../memory/internal.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import {
  CONTINUITY_MANIFEST_VERSION,
  type ContinuityManifest,
  MANIFEST_ENTRY_KINDS,
  type ManifestEntry,
  type ManifestEntryKind,
  type ManifestSigner,
  type ManifestVerification,
} from "./types.js";

export const CHAIN_GENESIS = AUDIT_GENESIS;

/** Workspace files that carry who the resident is. Only the ones that exist are listed. */
export const IDENTITY_FILES = [
  "IDENTITY.md",
  "SOUL.md",
  "AGENTS.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
] as const;

const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|privatekey|private_key)/i;

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Deterministic JSON: object keys sorted recursively, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).toSorted()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) {
        out[key] = sortValue(v);
      }
    }
    return out;
  }
  return value;
}

/** Replace values under secret-looking keys; the manifest must never carry a credential. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return "[depth]";
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SECRET_KEY_RE.test(k) && typeof v === "string" ? "[redacted]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function entryHash(prev: string, entry: Omit<ManifestEntry, "hash">): string {
  return sha256Hex(`${prev}\n${canonicalJson(entry)}`);
}

/** Chain the entries in order (identity, memory, role, model, job, session, transcript, audit). */
export function chainEntries(entries: Array<Omit<ManifestEntry, "hash">>): {
  entries: ManifestEntry[];
  root: string;
} {
  let prev = CHAIN_GENESIS;
  const chained = entries.map((entry) => {
    const hash = entryHash(prev, entry);
    prev = hash;
    return { ...entry, hash };
  });
  return { entries: chained, root: prev };
}

export function manifestSigningInput(
  m: Pick<ContinuityManifest, "version" | "resident" | "createdAt" | "root"> & {
    entries: unknown[];
  },
): string {
  return [
    "kolo-continuity-manifest",
    String(m.version),
    m.resident,
    m.createdAt,
    String(m.entries.length),
    m.root,
  ].join("\n");
}

export type SigningKey = { privateKeyPem: string; publicKeyPem: string };

export function resolveSigningKeyPath(stateDir: string = resolveStateDir()): string {
  return path.join(stateDir, "identity", "continuity-signing.json");
}

/** The resident's gateway signing key; created (0600) on first use. */
export function loadSigningKey(stateDir: string = resolveStateDir()): SigningKey {
  const id = loadOrCreateDeviceIdentity(resolveSigningKeyPath(stateDir));
  return { privateKeyPem: id.privateKeyPem, publicKeyPem: id.publicKeyPem };
}

export function signerFromKey(key: Pick<SigningKey, "publicKeyPem">): ManifestSigner {
  const publicKey = publicKeyRawBase64UrlFromPem(key.publicKeyPem);
  return { alg: "ed25519", keyId: deriveDeviceIdFromPublicKey(publicKey) ?? "", publicKey };
}

export function signManifest(
  unsigned: Omit<ContinuityManifest, "signer" | "signature">,
  key: SigningKey,
): ContinuityManifest {
  const signer = signerFromKey(key);
  const signature = signDevicePayload(key.privateKeyPem, manifestSigningInput(unsigned));
  return { ...unsigned, signer, signature };
}

export function verifyManifest(manifest: ContinuityManifest): ManifestVerification {
  const result: ManifestVerification = {
    ok: false,
    chainOk: true,
    rootOk: false,
    signatureOk: false,
    keyIdOk: false,
  };
  let prev = CHAIN_GENESIS;
  for (let i = 0; i < manifest.entries.length; i++) {
    const { hash, ...rest } = manifest.entries[i];
    const expected = entryHash(prev, rest);
    if (expected !== hash) {
      result.chainOk = false;
      result.firstBreak = i;
      result.reason = `entry ${i} (${rest.kind} ${rest.name}) does not recompute`;
      break;
    }
    prev = hash;
  }
  result.rootOk = result.chainOk && prev === manifest.root;
  if (result.chainOk && !result.rootOk) {
    result.reason = "root does not match the chain head";
  }
  const signer = manifest.signer;
  result.keyIdOk =
    signer?.alg === "ed25519" && deriveDeviceIdFromPublicKey(signer.publicKey) === signer.keyId;
  if (!result.keyIdOk) {
    result.reason ??= "signer keyId does not match the public key";
  }
  try {
    result.signatureOk =
      result.keyIdOk &&
      verifyDeviceSignature(signer.publicKey, manifestSigningInput(manifest), manifest.signature);
  } catch {
    result.signatureOk = false;
  }
  if (result.keyIdOk && !result.signatureOk) {
    result.reason ??= "signature does not verify";
  }
  result.ok = result.chainOk && result.rootOk && result.keyIdOk && result.signatureOk;
  return result;
}

/**
 * The resident's workspace, resolved against `env` rather than the process environment at
 * import time, so a manifest built for a state dir always looks inside that state dir.
 */
export function resolveResidentWorkspaceDir(
  cfg: KoLoConfig,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.workspace?.trim();
  if (configured) {
    return resolveUserPath(configured);
  }
  if (id === resolveDefaultAgentId(cfg)) {
    const fallback = cfg.agents?.defaults?.workspace?.trim();
    return fallback ? resolveUserPath(fallback) : resolveDefaultAgentWorkspaceDir(env);
  }
  return path.join(resolveSharedKoloHome({ env }), `workspace-${id}`);
}

function fileEntry(
  kind: ManifestEntryKind,
  name: string,
  file: string,
): Omit<ManifestEntry, "hash"> {
  const buf = fs.readFileSync(file);
  return { kind, name, sha256: sha256Hex(buf), size: buf.length };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function readSessionStore(storePath: string): Record<string, SessionEntry> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, SessionEntry>)
      : {};
  } catch {
    return {};
  }
}

export type BuildManifestParams = {
  cfg: KoLoConfig;
  agentId: string;
  stateDir?: string;
  gatewayVersion?: string;
  now?: () => Date;
  /** Injected for tests; defaults to the resident's gateway signing key under the state dir. */
  key?: SigningKey;
};

/** Everything a resident is, as hashes and small structured values. Never file contents. */
export async function collectManifestEntries(params: {
  cfg: KoLoConfig;
  agentId: string;
  stateDir: string;
}): Promise<Array<Omit<ManifestEntry, "hash">>> {
  const { cfg, agentId, stateDir } = params;
  const env: NodeJS.ProcessEnv = { ...process.env, KOLO_HOME: stateDir };
  const entries: Array<Omit<ManifestEntry, "hash">> = [];
  const workspaceDir = resolveResidentWorkspaceDir(cfg, agentId, env);

  for (const name of IDENTITY_FILES) {
    const file = path.join(workspaceDir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      entries.push(fileEntry("identity", name, file));
    }
  }

  const memoryFiles = await listMemoryFiles(workspaceDir);
  for (const file of memoryFiles.toSorted()) {
    entries.push(fileEntry("memory", toPosix(path.relative(workspaceDir, file)), file));
  }

  // Role: the agent's own entry and the defaults that shape what it may do. The model is
  // recorded separately so a profile swap changes `model`, never `role`.
  const agentEntry = (resolveAgentConfig(cfg, agentId) ?? {}) as Record<string, unknown>;
  const { model: _agentModel, ...agentRest } = agentEntry;
  const defaults = (cfg.agents?.defaults ?? {}) as Record<string, unknown>;
  const { model: _defaultModel, ...defaultsRest } = defaults;
  entries.push({
    kind: "role",
    name: "agent",
    value: redactValue({
      agent: agentRest,
      defaults: defaultsRest,
      tools: cfg.tools ?? null,
      commands: cfg.commands ?? null,
    }) as Record<string, unknown>,
  });

  const model = resolveDefaultModelForAgent({ cfg, agentId });
  entries.push({
    kind: "model",
    name: "primary",
    value: { provider: model.provider, model: model.model },
  });

  for (const job of listJobs({ agent: agentId, limit: 500 }).toSorted((a, b) =>
    a.id < b.id ? -1 : 1,
  )) {
    entries.push({
      kind: "job",
      name: job.id,
      value: {
        status: job.status,
        kind: job.kind,
        sessionKey: job.sessionKey,
        startedAt: job.startedAt,
        endedAt: job.endedAt ?? null,
        error: job.error ?? null,
      },
    });
  }

  const sessionsDir = resolveSessionTranscriptsDirForAgent(agentId, env);
  const store = readSessionStore(path.join(sessionsDir, "sessions.json"));
  for (const key of Object.keys(store).toSorted()) {
    const entry = store[key];
    entries.push({
      kind: "session",
      name: key,
      value: {
        sessionId: entry.sessionId,
        label: entry.label ?? null,
        model: entry.model ?? null,
        updatedAt: entry.updatedAt,
      },
    });
  }
  if (fs.existsSync(sessionsDir)) {
    const transcripts = fs
      .readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .toSorted();
    for (const name of transcripts) {
      entries.push(fileEntry("transcript", name, path.join(sessionsDir, name)));
    }
  }

  const auditDir = resolveAuditDir(env);
  const audit = verifyAuditChain(auditDir);
  entries.push({
    kind: "audit",
    name: "chain",
    value: { ok: audit.ok, entries: audit.entries, lastSeq: audit.lastSeq, months: audit.months },
  });
  return entries;
}

export async function buildContinuityManifest(
  params: BuildManifestParams,
): Promise<ContinuityManifest> {
  const stateDir = params.stateDir ?? resolveStateDir();
  const raw = await collectManifestEntries({ cfg: params.cfg, agentId: params.agentId, stateDir });
  const { entries, root } = chainEntries(raw);
  const counts = Object.fromEntries(MANIFEST_ENTRY_KINDS.map((k) => [k, 0])) as Record<
    ManifestEntryKind,
    number
  >;
  for (const e of entries) {
    counts[e.kind] += 1;
  }
  const unsigned: Omit<ContinuityManifest, "signer" | "signature"> = {
    version: CONTINUITY_MANIFEST_VERSION,
    resident: params.agentId,
    createdAt: (params.now ?? (() => new Date()))().toISOString(),
    gatewayVersion: params.gatewayVersion,
    counts,
    entries,
    root,
  };
  return signManifest(unsigned, params.key ?? loadSigningKey(stateDir));
}

/** Entries of one kind keyed by name, for before/after comparison. */
export function entriesByKind(
  manifest: ContinuityManifest,
  kind: ManifestEntryKind,
): Map<string, ManifestEntry> {
  const out = new Map<string, ManifestEntry>();
  for (const e of manifest.entries) {
    if (e.kind === kind) {
      out.set(e.name, e);
    }
  }
  return out;
}

/** Content fingerprint of an entry, ignoring its chain position. */
export function entryFingerprint(e: ManifestEntry): string {
  return e.sha256 ?? sha256Hex(canonicalJson(e.value ?? null));
}

export type KindDiff = {
  kind: ManifestEntryKind;
  same: string[];
  changed: string[];
  added: string[];
  removed: string[];
};

export function diffKind(
  before: ContinuityManifest,
  after: ContinuityManifest,
  kind: ManifestEntryKind,
): KindDiff {
  const a = entriesByKind(before, kind);
  const b = entriesByKind(after, kind);
  const diff: KindDiff = { kind, same: [], changed: [], added: [], removed: [] };
  for (const [name, entry] of a) {
    const other = b.get(name);
    if (!other) {
      diff.removed.push(name);
    } else if (entryFingerprint(entry) === entryFingerprint(other)) {
      diff.same.push(name);
    } else {
      diff.changed.push(name);
    }
  }
  for (const name of b.keys()) {
    if (!a.has(name)) {
      diff.added.push(name);
    }
  }
  return diff;
}
