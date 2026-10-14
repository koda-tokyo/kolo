// Evidence bundles (KoLo 2.0, M12b): export one job's evidence as a directory or a zip, and
// verify a bundle offline. A bundle holds:
//
//   manifest.json         signed (Ed25519) list of every other file with its SHA-256, the event
//                         chain root and count, and the signature the recorder made at job end
//   events.jsonl          the hash-chained event log, byte for byte as recorded
//   audit-slice.jsonl     audit entries written during the job for its session (each line keeps
//                         its own prev/hash so it can be checked against the full audit log)
//   snapshots/index.json  pre-edit snapshots the job took; objects under snapshots/objects/<sha>
//   REPORT.md             the human summary
//
// Verification needs nothing but the bundle: no gateway, no state dir, no network.
import fs from "node:fs";
import path from "node:path";
import type { AuditEntry } from "../audit/audit-log.js";
import type { SigningKey } from "../continuity-suite/manifest.js";
import type { EvidenceFileEntry, EvidenceManifest, EvidenceSummary } from "./types.js";
import { auditFileForMonth, listAuditMonths, resolveAuditDir } from "../audit/audit-log.js";
import { resolveStateDir } from "../config/paths.js";
import { sha256Hex } from "../continuity-suite/manifest.js";
import { snapshotDirName, snapshotsRoot } from "../snapshots/store.js";
import { renderReportMarkdown } from "./report.js";
import {
  EVENTS_FILE,
  EVIDENCE_VERSION,
  type EvidenceLimits,
  MANIFEST_FILE,
  parseEventsText,
  readManifestFile,
  resolveEvidenceSigningKey,
  resolveJobEvidenceDir,
  signEvidenceManifest,
  verifyEventChain,
} from "./store.js";
import { summarizeEvents } from "./summary.js";
import { type BundleFiles, writeZip } from "./zip.js";

export const AUDIT_SLICE_FILE = "audit-slice.jsonl";
export const REPORT_FILE = "REPORT.md";
export const SNAPSHOT_INDEX_FILE = "snapshots/index.json";
export const SNAPSHOT_OBJECTS_DIR = "snapshots/objects";
/** Audit entries this close to the job window still count (clocks and fsync lag). */
const AUDIT_WINDOW_SLACK_MS = 2000;

export type SnapshotIndexEntry = {
  snapshotId: string;
  tool: string;
  at: string;
  files: Array<{
    path: string;
    existed: boolean;
    hash: string | null;
    size: number;
    skipped: string | null;
    included: boolean;
  }>;
};

// ── audit slice ─────────────────────────────────────────────────────────────────────────────

/** Audit entries for the job: inside its time window and written for its session or job id. */
export function sliceAuditLog(opts: {
  auditDir: string;
  jobId: string;
  sessionKey: string;
  runId?: string | null;
  startedAt: string;
  endedAt: string;
}): AuditEntry[] {
  const from = Date.parse(opts.startedAt) - AUDIT_WINDOW_SLACK_MS;
  const to = Date.parse(opts.endedAt) + AUDIT_WINDOW_SLACK_MS;
  const wanted = new Set<string>();
  const months = listAuditMonths(opts.auditDir).filter((m) => {
    const monthStart = Date.parse(`${m}-01T00:00:00.000Z`);
    const next = new Date(monthStart);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next.getTime() >= from && monthStart <= to;
  });
  for (const m of months) {
    wanted.add(m);
  }
  const out: AuditEntry[] = [];
  const sessionKey = opts.sessionKey.trim().toLowerCase();
  for (const month of wanted) {
    let text: string;
    try {
      text = fs.readFileSync(auditFileForMonth(opts.auditDir, month), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      let entry: AuditEntry;
      try {
        entry = JSON.parse(line) as AuditEntry;
      } catch {
        continue;
      }
      const ts = Date.parse(entry.ts);
      if (!Number.isFinite(ts) || ts < from || ts > to) {
        continue;
      }
      const detail = (
        entry.detail && typeof entry.detail === "object" ? entry.detail : {}
      ) as Record<string, unknown>;
      const matches =
        (entry.scope ?? "").toLowerCase() === sessionKey ||
        detail.jobId === opts.jobId ||
        (opts.runId ? detail.runId === opts.runId : false);
      if (matches) {
        out.push(entry);
      }
    }
  }
  return out.toSorted((a, b) => a.seq - b.seq);
}

// ── export ──────────────────────────────────────────────────────────────────────────────────

export type ExportOptions = {
  jobId: string;
  /** Target directory, or a path ending in `.zip`. */
  out: string;
  env?: NodeJS.ProcessEnv;
  key?: SigningKey;
  now?: () => Date;
  gatewayVersion?: string;
  limits?: Pick<EvidenceLimits, "maxBytesPerJob">;
};

export type ExportResult = {
  path: string;
  format: "dir" | "zip";
  manifest: EvidenceManifest;
  summary: EvidenceSummary;
  files: string[];
  bytes: number;
};

export class EvidenceNotFoundError extends Error {}
export class EvidenceUnfinishedError extends Error {}

function snapshotObjectCandidates(
  sessionKey: string,
  env: NodeJS.ProcessEnv,
  hash: string,
): string[] {
  const dirName = snapshotDirName(sessionKey);
  const roots = new Set<string>([snapshotsRoot(resolveStateDir(env)), snapshotsRoot()]);
  return [...roots].map((root) => path.join(root, dirName, "objects", hash));
}

/** Build the bundle in memory. Exported for the HTTP handler and tests; `exportEvidenceBundle` writes it. */
export async function buildEvidenceBundle(
  opts: Omit<ExportOptions, "out">,
): Promise<{ files: BundleFiles; manifest: EvidenceManifest; summary: EvidenceSummary }> {
  const env = opts.env ?? process.env;
  const dir = resolveJobEvidenceDir(opts.jobId, env);
  const eventsPath = path.join(dir, EVENTS_FILE);
  if (!fs.existsSync(eventsPath)) {
    throw new EvidenceNotFoundError(`no evidence for job ${opts.jobId}`);
  }
  const recorded = readManifestFile(path.join(dir, MANIFEST_FILE));
  if (!recorded) {
    throw new EvidenceUnfinishedError(
      `job ${opts.jobId} has not finished (no signed manifest yet)`,
    );
  }
  const eventsRaw = fs.readFileSync(eventsPath);
  const events = parseEventsText(eventsRaw.toString("utf8"));
  const files: BundleFiles = new Map();
  files.set(EVENTS_FILE, eventsRaw);

  // Snapshots the job took, with the pre-edit objects that still exist.
  const index: SnapshotIndexEntry[] = [];
  let objects = 0;
  for (const e of events) {
    if (e.type !== "snapshot") {
      continue;
    }
    const entry: SnapshotIndexEntry = {
      snapshotId: String(e.data.snapshotId),
      tool: String(e.data.tool),
      at: e.ts,
      files: [],
    };
    for (const f of (e.data.files as Array<Record<string, unknown>> | undefined) ?? []) {
      const hash = typeof f.hash === "string" ? f.hash : null;
      let included = false;
      if (hash && !files.has(`${SNAPSHOT_OBJECTS_DIR}/${hash}`)) {
        for (const candidate of snapshotObjectCandidates(recorded.sessionKey, env, hash)) {
          try {
            const data = fs.readFileSync(candidate);
            if (sha256Hex(data) === hash) {
              files.set(`${SNAPSHOT_OBJECTS_DIR}/${hash}`, data);
              objects += 1;
              included = true;
              break;
            }
          } catch {
            // next candidate
          }
        }
      } else if (hash) {
        included = true;
      }
      entry.files.push({
        path: String(f.path ?? ""),
        existed: f.existed === true,
        hash,
        size: typeof f.size === "number" ? f.size : 0,
        skipped: typeof f.skipped === "string" ? f.skipped : null,
        included,
      });
    }
    index.push(entry);
  }
  files.set(SNAPSHOT_INDEX_FILE, Buffer.from(`${JSON.stringify(index, null, 2)}\n`, "utf8"));

  const runId = events[0]?.type === "job.start" ? (events[0].data.runId as string | null) : null;
  const slice = sliceAuditLog({
    auditDir: resolveAuditDir(env),
    jobId: opts.jobId,
    sessionKey: recorded.sessionKey,
    runId,
    startedAt: recorded.startedAt,
    endedAt: recorded.endedAt,
  });
  files.set(
    AUDIT_SLICE_FILE,
    Buffer.from(slice.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8"),
  );

  const summary = summarizeEvents(events, { signed: true });
  const unsignedBase = {
    version: EVIDENCE_VERSION,
    jobId: recorded.jobId,
    agent: recorded.agent,
    sessionKey: recorded.sessionKey,
    kind: recorded.kind,
    status: recorded.status,
    startedAt: recorded.startedAt,
    endedAt: recorded.endedAt,
    createdAt: (opts.now ?? (() => new Date()))().toISOString(),
    gatewayVersion: opts.gatewayVersion ?? recorded.gatewayVersion,
    events: {
      count: events.length,
      root: verifyEventChain(events).root,
      truncated: recorded.events.truncated,
    },
    recorded: {
      createdAt: recorded.createdAt,
      root: recorded.events.root,
      count: recorded.events.count,
      signer: recorded.signer,
      signature: recorded.signature,
    },
  };
  files.set(
    REPORT_FILE,
    Buffer.from(
      renderReportMarkdown({
        manifest: { ...unsignedBase, files: {}, signer: recorded.signer },
        summary,
        events,
        auditSlice: slice.length,
        snapshotObjects: objects,
      }),
      "utf8",
    ),
  );
  const fileEntries: Record<string, EvidenceFileEntry> = {};
  for (const [name, data] of files) {
    fileEntries[name] = { sha256: sha256Hex(data), size: data.length };
  }
  const manifest = signEvidenceManifest(
    { ...unsignedBase, files: fileEntries },
    opts.key ?? resolveEvidenceSigningKey(env),
  );
  files.set(MANIFEST_FILE, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"));
  return { files, manifest, summary };
}

export async function exportEvidenceBundle(opts: ExportOptions): Promise<ExportResult> {
  const { files, manifest, summary } = await buildEvidenceBundle(opts);
  const out = path.resolve(opts.out);
  const format: "dir" | "zip" = out.toLowerCase().endsWith(".zip") ? "zip" : "dir";
  let bytes = 0;
  if (format === "zip") {
    const data = await writeZip(files);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data, { mode: 0o600 });
    bytes = data.length;
  } else {
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    for (const [name, data] of files) {
      const target = path.join(out, ...name.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, data, { mode: 0o600 });
      bytes += data.length;
    }
  }
  return { path: out, format, manifest, summary, files: [...files.keys()].toSorted(), bytes };
}
