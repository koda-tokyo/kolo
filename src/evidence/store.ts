// Evidence store (KoLo 2.0, M12): where a job's evidence lives, how its events are chained and
// how its manifest is signed and verified. Pure functions plus file readers; no timers, no
// sockets, nothing at import time.
//
//   <KOLO_HOME>/evidence/<jobId>/events.jsonl    hash-chained event log (one JSON per line)
//   <KOLO_HOME>/evidence/<jobId>/manifest.json   signed at job end (Ed25519, continuity key)
import fs from "node:fs";
import path from "node:path";
import type { EvidenceConfig } from "../config/types.evidence.js";
import type { ManifestSigner } from "../continuity-suite/types.js";
import { AUDIT_GENESIS } from "../audit/audit-log.js";
import { resolveStateDir } from "../config/paths.js";
import {
  canonicalJson,
  loadSigningKey,
  sha256Hex,
  type SigningKey,
  signerFromKey,
} from "../continuity-suite/manifest.js";
import { signDevicePayload, verifyDeviceSignature } from "../infra/device-identity.js";
import { deriveDeviceIdFromPublicKey } from "../infra/device-identity.js";
import {
  EVIDENCE_VERSION,
  type EvidenceEvent,
  type EvidenceFileEntry,
  type EvidenceManifest,
} from "./types.js";

export const EVIDENCE_GENESIS = AUDIT_GENESIS;
export const EVENTS_FILE = "events.jsonl";
export const MANIFEST_FILE = "manifest.json";

export type EvidenceLimits = {
  enabled: boolean;
  includePrompts: boolean;
  includeReasoning: boolean;
  maxEvents: number;
  maxEventBytes: number;
  maxBytesPerJob: number;
  retentionDays: number;
};

export const EVIDENCE_DEFAULTS: EvidenceLimits = {
  enabled: true,
  includePrompts: false,
  includeReasoning: false,
  maxEvents: 5000,
  maxEventBytes: 8192,
  maxBytesPerJob: 16 * 1024 * 1024,
  retentionDays: 30,
};

export function resolveEvidenceLimits(config?: EvidenceConfig): EvidenceLimits {
  return {
    enabled: config?.enabled ?? EVIDENCE_DEFAULTS.enabled,
    includePrompts: config?.includePrompts ?? EVIDENCE_DEFAULTS.includePrompts,
    includeReasoning: config?.includeReasoning ?? EVIDENCE_DEFAULTS.includeReasoning,
    maxEvents: config?.maxEvents ?? EVIDENCE_DEFAULTS.maxEvents,
    maxEventBytes: config?.maxEventBytes ?? EVIDENCE_DEFAULTS.maxEventBytes,
    maxBytesPerJob: config?.maxBytesPerJob ?? EVIDENCE_DEFAULTS.maxBytesPerJob,
    retentionDays: config?.retentionDays ?? EVIDENCE_DEFAULTS.retentionDays,
  };
}

const JOB_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Job ids are path segments under the evidence dir; anything else is refused. */
export function isSafeJobId(id: string): boolean {
  return JOB_ID_RE.test(id) && !id.includes("..");
}

export function resolveEvidenceRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "evidence");
}

export function resolveJobEvidenceDir(jobId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!isSafeJobId(jobId)) {
    throw new Error(`invalid job id: ${jobId}`);
  }
  return path.join(resolveEvidenceRoot(env), jobId);
}

// ── chain ───────────────────────────────────────────────────────────────────────────────────

export function eventBody(event: Omit<EvidenceEvent, "prev" | "hash">): string {
  return canonicalJson({
    seq: event.seq,
    ts: event.ts,
    type: event.type,
    jobId: event.jobId,
    data: event.data,
  });
}

export function eventHash(prev: string, event: Omit<EvidenceEvent, "prev" | "hash">): string {
  return sha256Hex(`${prev}\n${eventBody(event)}`);
}

export type ChainCheck = {
  ok: boolean;
  root: string;
  count: number;
  firstBreak?: number;
  reason?: string;
};

/** Re-walk a list of events: every prev, hash and seq must follow from the one before. */
export function verifyEventChain(events: EvidenceEvent[]): ChainCheck {
  let prev = EVIDENCE_GENESIS;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.seq !== i + 1) {
      return {
        ok: false,
        root: prev,
        count: i,
        firstBreak: i,
        reason: `event ${i} has seq ${e.seq}, expected ${i + 1}`,
      };
    }
    if (e.prev !== prev) {
      return {
        ok: false,
        root: prev,
        count: i,
        firstBreak: i,
        reason: `event ${i} (${e.type}) prev does not match the previous hash`,
      };
    }
    const expected = eventHash(prev, e);
    if (expected !== e.hash) {
      return {
        ok: false,
        root: prev,
        count: i,
        firstBreak: i,
        reason: `event ${i} (${e.type}) does not recompute`,
      };
    }
    prev = e.hash;
  }
  return { ok: true, root: prev, count: events.length };
}

function isEventShape(value: unknown): value is EvidenceEvent {
  const e = value as Partial<EvidenceEvent> | null;
  return (
    Boolean(e) &&
    typeof e === "object" &&
    typeof e!.seq === "number" &&
    typeof e!.ts === "string" &&
    typeof e!.type === "string" &&
    typeof e!.jobId === "string" &&
    Boolean(e!.data) &&
    typeof e!.data === "object" &&
    typeof e!.prev === "string" &&
    typeof e!.hash === "string"
  );
}

/** Parse an event log. Throws on a line that is not JSON or not shaped like an event. */
export function parseEventsText(text: string): EvidenceEvent[] {
  const out: EvidenceEvent[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`line ${i + 1} is not valid JSON`);
    }
    if (!isEventShape(parsed)) {
      throw new Error(`line ${i + 1} is not an evidence event`);
    }
    out.push(parsed);
  }
  return out;
}

export function readEventsFile(file: string): EvidenceEvent[] {
  return parseEventsText(fs.readFileSync(file, "utf8"));
}

export function readJobEvents(jobId: string, env?: NodeJS.ProcessEnv): EvidenceEvent[] {
  const file = path.join(resolveJobEvidenceDir(jobId, env), EVENTS_FILE);
  return fs.existsSync(file) ? readEventsFile(file) : [];
}

export function readManifestFile(file: string): EvidenceManifest | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as EvidenceManifest;
  } catch {
    return null;
  }
}

export function readJobManifest(jobId: string, env?: NodeJS.ProcessEnv): EvidenceManifest | null {
  return readManifestFile(path.join(resolveJobEvidenceDir(jobId, env), MANIFEST_FILE));
}

export type EvidenceListRow = {
  jobId: string;
  agent: string | null;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  events: number;
  signed: boolean;
  bytes: number;
};

/** Every job dir under the evidence root, newest start first. */
export function listEvidenceJobs(env?: NodeJS.ProcessEnv): EvidenceListRow[] {
  const root = resolveEvidenceRoot(env);
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const rows: EvidenceListRow[] = [];
  for (const name of names) {
    if (!isSafeJobId(name)) {
      continue;
    }
    const dir = path.join(root, name);
    const eventsPath = path.join(dir, EVENTS_FILE);
    let bytes = 0;
    try {
      bytes = fs.statSync(eventsPath).size;
    } catch {
      continue;
    }
    const manifest = readManifestFile(path.join(dir, MANIFEST_FILE));
    let events = manifest?.events.count ?? 0;
    let first: EvidenceEvent | undefined;
    if (!manifest) {
      try {
        const parsed = readEventsFile(eventsPath);
        events = parsed.length;
        first = parsed[0];
      } catch {
        // unreadable: listed with what we know
      }
    }
    rows.push({
      jobId: name,
      agent: manifest?.agent ?? (first?.data.agent as string | undefined) ?? null,
      status: manifest?.status ?? (first ? "running" : null),
      startedAt: manifest?.startedAt ?? first?.ts ?? null,
      endedAt: manifest?.endedAt ?? null,
      events,
      signed: Boolean(manifest?.signature),
      bytes,
    });
  }
  return rows.toSorted((a, b) => ((a.startedAt ?? "") < (b.startedAt ?? "") ? 1 : -1));
}

// ── manifest signing ────────────────────────────────────────────────────────────────────────

export function filesDigest(files: Record<string, EvidenceFileEntry>): string {
  return sha256Hex(canonicalJson(files));
}

export function evidenceSigningInput(
  m: Pick<
    EvidenceManifest,
    "version" | "jobId" | "createdAt" | "events" | "files" | "status" | "endedAt"
  >,
): string {
  return [
    "kolo-evidence-manifest",
    String(m.version),
    m.jobId,
    m.status,
    m.endedAt,
    m.createdAt,
    String(m.events.count),
    m.events.root,
    filesDigest(m.files),
  ].join("\n");
}

export function signEvidenceManifest(
  unsigned: Omit<EvidenceManifest, "signer" | "signature">,
  key: SigningKey,
): EvidenceManifest {
  const signer = signerFromKey(key);
  const signature = signDevicePayload(key.privateKeyPem, evidenceSigningInput(unsigned));
  return { ...unsigned, signer, signature };
}

export function verifyEvidenceSignature(
  m: Pick<
    EvidenceManifest,
    "version" | "jobId" | "createdAt" | "events" | "files" | "status" | "endedAt"
  >,
  signer: ManifestSigner,
  signature: string,
): { keyIdOk: boolean; signatureOk: boolean } {
  const keyIdOk =
    signer?.alg === "ed25519" && deriveDeviceIdFromPublicKey(signer.publicKey) === signer.keyId;
  let signatureOk = false;
  if (keyIdOk) {
    try {
      signatureOk = verifyDeviceSignature(signer.publicKey, evidenceSigningInput(m), signature);
    } catch {
      signatureOk = false;
    }
  }
  return { keyIdOk, signatureOk };
}

export function fileEntryOf(file: string): EvidenceFileEntry {
  const buf = fs.readFileSync(file);
  return { sha256: sha256Hex(buf), size: buf.length };
}

export function resolveEvidenceSigningKey(env: NodeJS.ProcessEnv = process.env): SigningKey {
  return loadSigningKey(resolveStateDir(env));
}

export { EVIDENCE_VERSION };
