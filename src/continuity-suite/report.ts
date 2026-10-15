// Report (KoLo 2.0, M11b): JSON for machines, Markdown for people, one badge line for a README
// or a status page. `verifyReport` recomputes every manifest hash and signature and re-scores
// every run from the stored evidence, so a report that was edited after the fact is caught.
import fs from "node:fs";
import path from "node:path";
import { verifyManifest } from "./manifest.js";
import { type ScoreInput, scoreRun, summarize } from "./scorer.js";
import {
  CONTINUITY_REPORT_VERSION,
  type ContinuityReport,
  type ContinuityRun,
  type InvariantResult,
} from "./types.js";

export const REPORT_JSON = "continuity-report.json";
export const REPORT_MD = "continuity-report.md";
export const REPORT_BADGE = "continuity-badge.txt";

export function buildBadge(
  report: Omit<ContinuityReport, "summary"> & { summary?: unknown },
  counts: { pass: number; fail: number; skip: number },
): string {
  const verdict = counts.fail === 0 ? "PASS" : "FAIL";
  const disruptions = report.runs.map((r) => r.disruption).join(",") || "none";
  const roots = report.runs
    .map((r) => `${r.before.manifest.root.slice(0, 8)}>${r.after.manifest.root.slice(0, 8)}`)
    .join(" ");
  return `continuity ${verdict} | resident=${report.resident} | ${disruptions} | pass=${counts.pass} fail=${counts.fail} skip=${counts.skip} | ${roots} | ${report.createdAt}`;
}

export function buildReport(params: {
  resident: string;
  gateway: ContinuityReport["gateway"];
  runs: ContinuityRun[];
  skipped?: ContinuityReport["skipped"];
  createdAt?: string;
}): ContinuityReport {
  const counts = summarize(params.runs.flatMap((r) => r.invariants));
  const base = {
    version: CONTINUITY_REPORT_VERSION,
    resident: params.resident,
    createdAt: params.createdAt ?? new Date().toISOString(),
    gateway: params.gateway,
    runs: params.runs,
    skipped: params.skipped ?? [],
  };
  return {
    ...base,
    summary: {
      ...counts,
      verdict: counts.fail === 0 ? "PASS" : "FAIL",
      badge: buildBadge(base, counts),
    },
  };
}

function mark(status: InvariantResult["status"]): string {
  return status === "pass" ? "pass" : status === "fail" ? "FAIL" : "skip";
}

export function reportToMarkdown(report: ContinuityReport): string {
  const lines: string[] = [];
  lines.push(`# Continuity report: ${report.resident}`, "");
  lines.push(
    `Verdict: **${report.summary.verdict}** (${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skip} skip)`,
    "",
  );
  lines.push(
    `Gateway: ${report.gateway.baseUrl} (${report.gateway.mode}). Taken ${report.createdAt}.`,
    "",
  );
  lines.push("Badge:", "", "```", report.summary.badge, "```", "");
  for (const s of report.skipped) {
    lines.push(`Not exercised: ${s.disruption} (${s.reason})`, "");
  }
  for (const run of report.runs) {
    lines.push(`## Disruption: ${run.disruption}`, "");
    lines.push(`${run.outcome.detail} (${run.outcome.startedAt} to ${run.outcome.endedAt})`, "");
    lines.push("| | Before | After |", "|---|---|---|");
    lines.push(
      `| manifest root | \`${run.before.manifest.root}\` | \`${run.after.manifest.root}\` |`,
    );
    lines.push(
      `| signer | \`${run.before.manifest.signer.keyId.slice(0, 16)}\` | \`${run.after.manifest.signer.keyId.slice(0, 16)}\` |`,
    );
    lines.push(
      `| gateway pid | ${run.before.probes.health.pid ?? "?"} | ${run.after.probes.health.pid ?? "?"} |`,
    );
    lines.push(
      `| audit head seq | ${run.before.probes.audit.lastSeq} | ${run.after.probes.audit.lastSeq} |`,
    );
    lines.push(`| recall | ${rate(run.before)} | ${rate(run.after)} |`);
    if (run.before.probes.chat || run.after.probes.chat) {
      lines.push(
        `| answer | ${code(run.before.probes.chat?.text)} | ${code(run.after.probes.chat?.text)} |`,
      );
    }
    lines.push("", "| Invariant | Result | Detail |", "|---|---|---|");
    for (const inv of run.invariants) {
      lines.push(
        `| ${inv.id} ${inv.name} | ${mark(inv.status)} | ${inv.detail.replace(/\|/g, "\\|")} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "Verify this report with `kurahi continuity verify <path to continuity-report.json>`.",
    "",
  );
  return lines.join("\n");
}

function rate(side: ContinuityRun["before"]): string {
  const r = side.probes.recall;
  return r.length ? `${r.filter((x) => x.hit).length}/${r.length}` : "n/a";
}

function code(text: string | undefined): string {
  return text ? `\`${text.replace(/`/g, "'").slice(0, 120)}\`` : "n/a";
}

export function writeReport(
  outDir: string,
  report: ContinuityReport,
): { json: string; md: string; badge: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const json = path.join(outDir, REPORT_JSON);
  const md = path.join(outDir, REPORT_MD);
  const badge = path.join(outDir, REPORT_BADGE);
  fs.writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(md, reportToMarkdown(report));
  fs.writeFileSync(badge, `${report.summary.badge}\n`);
  return { json, md, badge };
}

export type ReportVerification = {
  ok: boolean;
  runs: Array<{
    disruption: string;
    beforeManifest: boolean;
    afterManifest: boolean;
    scoresMatch: boolean;
    mismatches: string[];
  }>;
  summaryMatches: boolean;
  badgeMatches: boolean;
  reason?: string;
};

/** Recompute hashes, signatures, scores, summary and badge from the evidence inside the report. */
export function verifyReport(report: ContinuityReport): ReportVerification {
  const runs = report.runs.map((run) => {
    const beforeManifest = verifyManifest(run.before.manifest).ok;
    const afterManifest = verifyManifest(run.after.manifest).ok;
    const input: ScoreInput = {
      disruption: run.disruption,
      before: run.before,
      after: run.after,
      outcome: run.outcome,
      leakScan: run.leakScan,
    };
    const rescored = scoreRun(input);
    const mismatches: string[] = [];
    for (const inv of rescored) {
      const stored = run.invariants.find((i) => i.id === inv.id);
      if (!stored || stored.status !== inv.status) {
        mismatches.push(
          `${inv.id}: stored ${stored?.status ?? "missing"}, recomputed ${inv.status}`,
        );
      }
    }
    if (run.invariants.length !== rescored.length) {
      mismatches.push(`invariant count ${run.invariants.length} vs ${rescored.length}`);
    }
    return {
      disruption: run.disruption,
      beforeManifest,
      afterManifest,
      scoresMatch: mismatches.length === 0,
      mismatches,
    };
  });
  const counts = summarize(report.runs.flatMap((r) => r.invariants));
  const summaryMatches =
    counts.pass === report.summary.pass &&
    counts.fail === report.summary.fail &&
    counts.skip === report.summary.skip &&
    report.summary.verdict === (counts.fail === 0 ? "PASS" : "FAIL");
  const { summary: _summary, ...base } = report;
  const badgeMatches = buildBadge(base, counts) === report.summary.badge;
  const ok =
    runs.every((r) => r.beforeManifest && r.afterManifest && r.scoresMatch) &&
    summaryMatches &&
    badgeMatches;
  return {
    ok,
    runs,
    summaryMatches,
    badgeMatches,
    reason: ok
      ? undefined
      : !summaryMatches
        ? "summary counts do not match the invariants"
        : !badgeMatches
          ? "badge does not match the report"
          : "a manifest or a score does not recompute",
  };
}

export function readReport(file: string): ContinuityReport {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as ContinuityReport;
  if (parsed?.version !== CONTINUITY_REPORT_VERSION || !Array.isArray(parsed.runs)) {
    throw new Error(`${file}: not a continuity report (version ${String(parsed?.version)})`);
  }
  return parsed;
}
