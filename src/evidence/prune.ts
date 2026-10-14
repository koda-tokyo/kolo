// Retention for evidence dirs (KoLo 2.0, M12): a job's evidence is removed once its end time (or,
// for a log that never got a manifest, its last write) is older than `evidence.retentionDays`.
import fs from "node:fs";
import path from "node:path";
import {
  EVENTS_FILE,
  isSafeJobId,
  MANIFEST_FILE,
  readManifestFile,
  resolveEvidenceRoot,
} from "./store.js";

export type PruneRow = { jobId: string; endedAt: string; bytes: number; removed: boolean };

export type PruneResult = { root: string; cutoff: string; removed: PruneRow[]; kept: number };

function dirBytes(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile()) {
        total += fs.statSync(p).size;
      }
    }
  };
  try {
    walk(dir);
  } catch {
    // partial total is fine for a report
  }
  return total;
}

/**
 * Remove evidence older than `days`. `days: 0` keeps nothing older than now, i.e. everything
 * finished; a running job (no manifest, recent writes) is never removed.
 */
export function pruneEvidence(opts: {
  days: number;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}): PruneResult {
  const root = resolveEvidenceRoot(opts.env);
  const now = (opts.now ?? (() => new Date()))();
  const cutoffMs = now.getTime() - Math.max(0, opts.days) * 86_400_000;
  const cutoff = new Date(cutoffMs).toISOString();
  const result: PruneResult = { root, cutoff, removed: [], kept: 0 };
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return result;
  }
  for (const name of names) {
    if (!isSafeJobId(name)) {
      continue;
    }
    const dir = path.join(root, name);
    const manifest = readManifestFile(path.join(dir, MANIFEST_FILE));
    let endedAt: string | null = manifest?.endedAt ?? null;
    if (!endedAt) {
      try {
        const st = fs.statSync(path.join(dir, EVENTS_FILE));
        // No manifest: treat as abandoned only after a full day of silence.
        if (now.getTime() - st.mtimeMs < 86_400_000) {
          result.kept += 1;
          continue;
        }
        endedAt = new Date(st.mtimeMs).toISOString();
      } catch {
        result.kept += 1;
        continue;
      }
    }
    if (Date.parse(endedAt) >= cutoffMs) {
      result.kept += 1;
      continue;
    }
    const row: PruneRow = { jobId: name, endedAt, bytes: dirBytes(dir), removed: false };
    if (!opts.dryRun) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        row.removed = true;
      } catch {
        row.removed = false;
      }
    }
    result.removed.push(row);
  }
  return result;
}
