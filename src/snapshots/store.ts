import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SnapshotsConfig } from "../config/types.snapshots.js";
import { koloPath } from "../config/kolo-home.js";

/**
 * File snapshots with undo and redo (KoLo 2.0, M10). Before a tool writes files in a session,
 * the pre-images of the files it names are stored content-addressed under
 * `<KOLO_HOME>/snapshots/<session>/objects/<sha256>` and an entry is appended to the session's
 * index. Undo restores the pre-image of the newest entry after capturing the current content as
 * its post-image; redo puts the post-image back. No git, no working tree state outside the files
 * named by the tool. Bounded by count and bytes per session; files over the size limit are
 * recorded as skipped and cannot be restored.
 */

export const SNAPSHOT_DEFAULT_MAX_PER_SESSION = 50;
export const SNAPSHOT_DEFAULT_MAX_BYTES_PER_SESSION = 64 * 1024 * 1024;
export const SNAPSHOT_DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;

export type SnapshotFileRecord = {
  path: string;
  /** False when the file did not exist at capture time (undo deletes it). */
  existed: boolean;
  /** sha256 of the content when captured; absent when the file did not exist or was skipped. */
  hash?: string;
  size: number;
  skipped?: "too-large" | "unreadable";
};

export type SnapshotEntry = {
  id: string;
  at: string;
  tool: string;
  files: SnapshotFileRecord[];
  /** Captured on undo so redo can put the edit back. */
  after?: SnapshotFileRecord[];
};

export type SnapshotIndex = {
  version: 1;
  sessionKey: string;
  /** Entries before the cursor are applied (can be undone); entries at or after it were undone. */
  cursor: number;
  entries: SnapshotEntry[];
};

export type SnapshotLimits = {
  maxPerSession: number;
  maxBytesPerSession: number;
  maxFileBytes: number;
};

export type RestoreReport = {
  entry: SnapshotEntry;
  restored: string[];
  removed: string[];
  skipped: string[];
};

export function resolveSnapshotLimits(config?: SnapshotsConfig): SnapshotLimits {
  return {
    maxPerSession: config?.maxPerSession ?? SNAPSHOT_DEFAULT_MAX_PER_SESSION,
    maxBytesPerSession: config?.maxBytesPerSession ?? SNAPSHOT_DEFAULT_MAX_BYTES_PER_SESSION,
    maxFileBytes: config?.maxFileBytes ?? SNAPSHOT_DEFAULT_MAX_FILE_BYTES,
  };
}

/** Directory name for a session key: readable prefix plus a short hash so keys never collide. */
export function snapshotDirName(sessionKey: string): string {
  const safe = sessionKey
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const digest = createHash("sha256").update(sessionKey).digest("hex").slice(0, 8);
  return `${safe || "session"}-${digest}`;
}

export function snapshotsRoot(home?: string): string {
  return home ? path.join(home, "snapshots") : koloPath("snapshots");
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function writeAtomic(filePath: string, data: string | Buffer): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export class SnapshotStore {
  readonly dir: string;
  private readonly objectsDir: string;
  private readonly indexPath: string;

  constructor(
    readonly sessionKey: string,
    readonly limits: SnapshotLimits = resolveSnapshotLimits(),
    home?: string,
  ) {
    this.dir = path.join(snapshotsRoot(home), snapshotDirName(sessionKey));
    this.objectsDir = path.join(this.dir, "objects");
    this.indexPath = path.join(this.dir, "index.json");
  }

  readIndex(): SnapshotIndex {
    try {
      const raw = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as Partial<SnapshotIndex>;
      if (raw && raw.version === 1 && Array.isArray(raw.entries)) {
        const entries = raw.entries;
        const cursor =
          typeof raw.cursor === "number"
            ? Math.max(0, Math.min(entries.length, Math.floor(raw.cursor)))
            : entries.length;
        return { version: 1, sessionKey: this.sessionKey, cursor, entries };
      }
    } catch {
      // Missing or unreadable: start empty.
    }
    return { version: 1, sessionKey: this.sessionKey, cursor: 0, entries: [] };
  }

  private writeIndex(index: SnapshotIndex): void {
    fs.mkdirSync(this.objectsDir, { recursive: true, mode: 0o700 });
    writeAtomic(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
  }

  private objectPath(hash: string): string {
    return path.join(this.objectsDir, hash);
  }

  /** Capture the current content of each path as records; objects are written as needed. */
  private capture(files: string[]): SnapshotFileRecord[] {
    fs.mkdirSync(this.objectsDir, { recursive: true, mode: 0o700 });
    const records: SnapshotFileRecord[] = [];
    for (const file of files) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        records.push({ path: file, existed: false, size: 0 });
        continue;
      }
      if (!stat.isFile()) {
        records.push({ path: file, existed: true, size: 0, skipped: "unreadable" });
        continue;
      }
      if (stat.size > this.limits.maxFileBytes) {
        records.push({ path: file, existed: true, size: stat.size, skipped: "too-large" });
        continue;
      }
      try {
        const data = fs.readFileSync(file);
        const hash = sha256(data);
        const target = this.objectPath(hash);
        if (!fs.existsSync(target)) {
          writeAtomic(target, data);
        }
        records.push({ path: file, existed: true, hash, size: data.length });
      } catch {
        records.push({ path: file, existed: true, size: stat.size, skipped: "unreadable" });
      }
    }
    return records;
  }

  private bytesOf(index: SnapshotIndex): number {
    const seen = new Set<string>();
    let total = 0;
    for (const entry of index.entries) {
      for (const record of [...entry.files, ...(entry.after ?? [])]) {
        if (record.hash && !seen.has(record.hash)) {
          seen.add(record.hash);
          total += record.size;
        }
      }
    }
    return total;
  }

  /** Delete objects no entry references any more. */
  private collect(index: SnapshotIndex): void {
    const live = new Set<string>();
    for (const entry of index.entries) {
      for (const record of [...entry.files, ...(entry.after ?? [])]) {
        if (record.hash) {
          live.add(record.hash);
        }
      }
    }
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.objectsDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (!live.has(name) && !name.endsWith(".tmp")) {
        fs.rmSync(this.objectPath(name), { force: true });
      }
    }
  }

  private enforce(index: SnapshotIndex): void {
    while (
      index.entries.length > 0 &&
      (index.entries.length > this.limits.maxPerSession ||
        this.bytesOf(index) > this.limits.maxBytesPerSession)
    ) {
      index.entries.shift();
      index.cursor = Math.max(0, index.cursor - 1);
    }
  }

  /**
   * Record the pre-images of `files` before a tool writes them. Entries after the cursor (undone
   * edits) are discarded, as in any editor. Returns null when there is nothing to record.
   */
  record(tool: string, files: string[]): SnapshotEntry | null {
    const unique = [...new Set(files.map((f) => path.resolve(f)))];
    if (unique.length === 0) {
      return null;
    }
    const index = this.readIndex();
    index.entries = index.entries.slice(0, index.cursor);
    const entry: SnapshotEntry = {
      id: `${Date.now().toString(36)}-${createHash("sha256")
        .update(`${this.sessionKey}:${index.entries.length}:${unique.join("\0")}:${Math.random()}`)
        .digest("hex")
        .slice(0, 8)}`,
      at: new Date().toISOString(),
      tool,
      files: this.capture(unique),
    };
    index.entries.push(entry);
    index.cursor = index.entries.length;
    this.enforce(index);
    this.collect(index);
    this.writeIndex(index);
    return entry;
  }

  list(): SnapshotIndex {
    return this.readIndex();
  }

  private restoreRecords(records: SnapshotFileRecord[]): Omit<RestoreReport, "entry"> {
    const restored: string[] = [];
    const removed: string[] = [];
    const skipped: string[] = [];
    for (const record of records) {
      if (record.skipped) {
        skipped.push(record.path);
        continue;
      }
      if (!record.existed) {
        try {
          fs.rmSync(record.path, { force: true });
          removed.push(record.path);
        } catch {
          skipped.push(record.path);
        }
        continue;
      }
      try {
        const data = fs.readFileSync(this.objectPath(record.hash ?? ""));
        fs.mkdirSync(path.dirname(record.path), { recursive: true });
        fs.writeFileSync(record.path, data);
        restored.push(record.path);
      } catch {
        skipped.push(record.path);
      }
    }
    return { restored, removed, skipped };
  }

  /** Undo the newest applied entry. Null when there is nothing to undo. */
  undo(): RestoreReport | null {
    const index = this.readIndex();
    if (index.cursor === 0) {
      return null;
    }
    const entry = index.entries[index.cursor - 1];
    entry.after = this.capture(entry.files.map((record) => record.path));
    const report = this.restoreRecords(entry.files);
    index.cursor -= 1;
    this.writeIndex(index);
    return { entry, ...report };
  }

  /** Redo the newest undone entry. Null when there is nothing to redo. */
  redo(): RestoreReport | null {
    const index = this.readIndex();
    if (index.cursor >= index.entries.length) {
      return null;
    }
    const entry = index.entries[index.cursor];
    if (!entry.after) {
      return null;
    }
    const report = this.restoreRecords(entry.after);
    index.cursor += 1;
    this.writeIndex(index);
    return { entry, ...report };
  }

  /** Undo every entry from the newest down to and including `id`; null when `id` is unknown or already undone. */
  restoreTo(id: string): RestoreReport[] | null {
    const index = this.readIndex();
    const position = index.entries.findIndex((entry) => entry.id === id);
    if (position < 0 || position >= index.cursor) {
      return null;
    }
    const reports: RestoreReport[] = [];
    for (let step = index.cursor; step > position; step -= 1) {
      const report = this.undo();
      if (!report) {
        break;
      }
      reports.push(report);
    }
    return reports;
  }

  /** Remove every snapshot of this session. */
  clear(): void {
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}
