// Chain verification and redacted tail for the audit log (KoLo 2.0, M2b).

import fs from "node:fs";
import path from "node:path";
import {
  AUDIT_GENESIS,
  auditFileForMonth,
  computeEntryHash,
  listAuditMonths,
  type AuditEntry,
  type AuditHead,
  sha256Hex,
} from "./audit-log.js";
import { redactAuditValue } from "./redact.js";

export type AuditBreak = {
  file: string;
  /** 1-based line number inside `file` (0 for HEAD/HEADS problems). */
  line: number;
  seq?: number;
  reason: string;
};

export type AuditVerifyResult = {
  ok: boolean;
  months: string[];
  entries: number;
  lastSeq: number;
  firstBreak?: AuditBreak;
};

function readLines(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function lastLineOf(file: string): string | null {
  try {
    const lines = readLines(file).filter((l) => l.trim().length > 0);
    return lines.length > 0 ? lines[lines.length - 1] : null;
  } catch {
    return null;
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Re-walk the chain. With `month`, only that month is walked, anchored to the last line of the
 * previous month file (if one exists). Without it, every month from the oldest is walked and
 * HEAD / HEADS.jsonl are checked against the chain (tail truncation).
 */
export function verifyAuditChain(dir: string, opts: { month?: string } = {}): AuditVerifyResult {
  const all = listAuditMonths(dir);
  const months = opts.month ? all.filter((m) => m === opts.month) : all;
  const result: AuditVerifyResult = { ok: true, months, entries: 0, lastSeq: 0 };
  const fail = (b: AuditBreak): AuditVerifyResult => ({ ...result, ok: false, firstBreak: b });
  if (opts.month && months.length === 0) {
    return fail({
      file: auditFileForMonth(dir, opts.month),
      line: 0,
      reason: "month file missing",
    });
  }

  let prevLine: string | null = null;
  let prevSeq: number | null = null;
  if (opts.month) {
    const earlier = all.filter((m) => m < opts.month!);
    for (let i = earlier.length - 1; i >= 0 && prevLine === null; i--) {
      prevLine = lastLineOf(auditFileForMonth(dir, earlier[i]));
    }
    if (prevLine) {
      try {
        prevSeq = Number((JSON.parse(prevLine) as AuditEntry).seq);
      } catch {
        prevSeq = null;
      }
    }
  }
  // seq → raw-line hash, for the HEAD / HEADS checks.
  const lineHashBySeq = new Map<number, string>();

  for (const month of months) {
    const file = auditFileForMonth(dir, month);
    let lines: string[];
    try {
      lines = readLines(file);
    } catch (err) {
      return fail({ file, line: 0, reason: `unreadable: ${String(err)}` });
    }
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const lineNo = i + 1;
      if (raw.trim().length === 0) {
        return fail({ file, line: lineNo, reason: "blank line inside the chain" });
      }
      let entry: AuditEntry;
      try {
        entry = JSON.parse(raw) as AuditEntry;
      } catch {
        return fail({ file, line: lineNo, reason: "not valid JSON" });
      }
      const expectedPrev = prevLine === null ? AUDIT_GENESIS : sha256Hex(prevLine);
      if (entry.prev !== expectedPrev) {
        return fail({
          file,
          line: lineNo,
          seq: entry.seq,
          reason:
            prevLine === null
              ? "first entry is not the genesis (earlier history missing)"
              : "prev does not match the previous line (line edited, removed or reordered)",
        });
      }
      if (prevSeq !== null && entry.seq !== prevSeq + 1) {
        return fail({
          file,
          line: lineNo,
          seq: entry.seq,
          reason: `seq ${entry.seq} does not follow ${prevSeq}`,
        });
      }
      if (computeEntryHash(entry) !== entry.hash) {
        return fail({
          file,
          line: lineNo,
          seq: entry.seq,
          reason: "entry hash mismatch (content edited)",
        });
      }
      lineHashBySeq.set(entry.seq, sha256Hex(raw));
      prevLine = raw;
      prevSeq = entry.seq;
      result.entries += 1;
      result.lastSeq = entry.seq;
    }
  }

  if (opts.month) {
    return result;
  }
  const checkHead = (head: AuditHead, file: string, line: number): AuditBreak | null => {
    if (head.seq > result.lastSeq) {
      return {
        file,
        line,
        seq: head.seq,
        reason: `head seq ${head.seq} beyond chain end ${result.lastSeq} (log truncated)`,
      };
    }
    const actual = lineHashBySeq.get(head.seq);
    if (actual !== head.lineHash) {
      return {
        file,
        line,
        seq: head.seq,
        reason: `head for seq ${head.seq} does not match the chain`,
      };
    }
    return null;
  };
  const headFile = path.join(dir, "HEAD");
  const head = readJson<AuditHead>(headFile);
  if (head) {
    const b = checkHead(head, headFile, 0);
    if (b) {
      return fail(b);
    }
  } else if (result.entries > 0 && fs.existsSync(headFile)) {
    return fail({ file: headFile, line: 0, reason: "HEAD unreadable" });
  }
  const headsFile = path.join(dir, "HEADS.jsonl");
  if (fs.existsSync(headsFile)) {
    const lines = readLines(headsFile);
    for (let i = 0; i < lines.length; i++) {
      let h: AuditHead;
      try {
        h = JSON.parse(lines[i]) as AuditHead;
      } catch {
        return fail({ file: headsFile, line: i + 1, reason: "not valid JSON" });
      }
      const b = checkHead(h, headsFile, i + 1);
      if (b) {
        return fail(b);
      }
    }
  }
  return result;
}

/** Last `n` entries across month files, redacted for display. */
export function tailAudit(dir: string, n = 50): AuditEntry[] {
  const months = listAuditMonths(dir);
  const out: AuditEntry[] = [];
  for (let i = months.length - 1; i >= 0 && out.length < n; i--) {
    let lines: string[];
    try {
      lines = readLines(auditFileForMonth(dir, months[i])).filter((l) => l.trim());
    } catch {
      continue;
    }
    for (let j = lines.length - 1; j >= 0 && out.length < n; j--) {
      try {
        const e = JSON.parse(lines[j]) as AuditEntry;
        out.push({ ...e, detail: redactAuditValue(e.detail) });
      } catch {
        // Unparseable lines show up in `kolo audit verify`, not here.
      }
    }
  }
  return out.toReversed();
}

export function formatAuditEntry(e: AuditEntry, maxDetail = 300): string {
  const detail = e.detail === null || e.detail === undefined ? "" : JSON.stringify(e.detail);
  const clipped = detail.length > maxDetail ? `${detail.slice(0, maxDetail)}…` : detail;
  const who = [
    e.identity,
    e.device ? `device=${e.device}` : null,
    e.scope ? `scope=${e.scope}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${e.ts} #${e.seq} ${e.action} ${e.outcome} src=${e.source}${who ? ` ${who}` : ""}${clipped ? ` ${clipped}` : ""}`;
}
