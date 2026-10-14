// REPORT.md for an evidence bundle (KoLo 2.0, M12b): what was asked, what was done, which files
// changed, which tools ran, which policy decisions were made, and how to verify the bundle.
import type { EvidenceEvent, EvidenceManifest, EvidenceSummary } from "./types.js";

function fmtDuration(ms: number | null): string {
  if (ms === null) {
    return "n/a";
  }
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const s = Math.round(ms / 100) / 10;
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

function cell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function short(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 16) : "n/a";
}

export function renderReportMarkdown(input: {
  manifest: Omit<EvidenceManifest, "signer" | "signature"> &
    Partial<Pick<EvidenceManifest, "signer" | "signature">>;
  summary: EvidenceSummary;
  events: EvidenceEvent[];
  auditSlice: number;
  snapshotObjects: number;
}): string {
  const { manifest: m, summary: s, events } = input;
  const lines: string[] = [];
  lines.push(`# Evidence report: job ${m.jobId}`);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("|---|---|");
  lines.push(`| Agent | ${cell(m.agent)} |`);
  lines.push(`| Session | ${cell(m.sessionKey)} |`);
  lines.push(`| Kind | ${cell(m.kind)} |`);
  lines.push(`| Status | ${cell(m.status)} |`);
  lines.push(`| Started | ${cell(m.startedAt)} |`);
  lines.push(`| Ended | ${cell(m.endedAt)} |`);
  lines.push(`| Duration | ${fmtDuration(s.durationMs)} |`);
  lines.push(
    `| Events | ${events.length}${s.truncated ? " (log truncated by the size cap)" : ""} |`,
  );
  lines.push(`| Chain root | \`${m.events.root}\` |`);
  lines.push(`| Signing key | \`${m.signer?.keyId ?? "unsigned"}\` |`);
  if (m.gatewayVersion) {
    lines.push(`| Gateway | ${cell(m.gatewayVersion)} |`);
  }
  lines.push("");

  lines.push("## What was asked");
  lines.push("");
  const start = events[0]?.type === "job.start" ? events[0].data : {};
  if (typeof start.prompt === "string") {
    lines.push("```text");
    lines.push(start.prompt);
    lines.push("```");
    if (start.promptClipped) {
      lines.push("");
      lines.push("(prompt clipped by `evidence.maxEventBytes`)");
    }
  } else {
    lines.push(
      `The prompt is recorded as a digest (\`evidence.includePrompts\` is off): SHA-256 \`${s.promptDigest ?? "n/a"}\`, ${s.promptChars ?? 0} characters.`,
    );
  }
  lines.push("");

  lines.push("## What was done");
  lines.push("");
  lines.push(
    `${s.modelTurns} model turn${s.modelTurns === 1 ? "" : "s"}, ${s.toolCalls} tool call${s.toolCalls === 1 ? "" : "s"} (${s.toolErrors} failed). Tokens: input ${s.usage.input ?? 0}, output ${s.usage.output ?? 0}${s.usage.cacheRead ? `, cache read ${s.usage.cacheRead}` : ""}.`,
  );
  if (s.finalTextExcerpt) {
    lines.push("");
    lines.push("Final assistant text (redacted excerpt):");
    lines.push("");
    lines.push("```text");
    lines.push(s.finalTextExcerpt);
    lines.push("```");
  }
  if (s.error) {
    lines.push("");
    lines.push(`Outcome error: ${cell(s.error)}`);
  }
  lines.push("");

  lines.push("## Files changed");
  lines.push("");
  if (s.filesChanged.length === 0) {
    lines.push("No file edits were recorded.");
  } else {
    for (const f of s.filesChanged) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
    lines.push(
      `${input.snapshotObjects} pre-edit snapshot object${input.snapshotObjects === 1 ? "" : "s"} included under \`snapshots/\`.`,
    );
  }
  lines.push("");

  lines.push("## Tools run");
  lines.push("");
  const calls = events.filter((e) => e.type === "tool.call");
  if (calls.length === 0) {
    lines.push("No tools ran.");
  } else {
    lines.push("| # | Tool | Meta | Args digest | Result | Duration |");
    lines.push("|---|---|---|---|---|---|");
    const results = new Map<string, EvidenceEvent>();
    for (const e of events) {
      if (e.type === "tool.result") {
        results.set(String(e.data.toolCallId), e);
      }
    }
    calls.forEach((e, i) => {
      const r = results.get(String(e.data.toolCallId));
      const outcome = r ? (r.data.isError ? "error" : "ok") : "no result";
      lines.push(
        `| ${i + 1} | ${cell(e.data.name)} | ${cell(e.data.meta ?? "")} | \`${short(e.data.argsDigest as string)}\` | ${outcome} | ${fmtDuration((r?.data.durationMs as number | null) ?? null)} |`,
      );
    });
  }
  lines.push("");

  lines.push("## Policy decisions");
  lines.push("");
  const decisions = events.filter((e) => e.type === "permission" || e.type === "loop_guard");
  if (decisions.length === 0) {
    lines.push("No permission rules were active and the loop guard did not stop the run.");
  } else {
    for (const e of decisions) {
      if (e.type === "permission") {
        lines.push(
          `- permission ${cell(e.data.decision)}: ${cell(e.data.tool)}${e.data.target ? ` on \`${cell(e.data.target)}\`` : ""}${e.data.rule ? ` (${cell(e.data.rule)})` : ""}`,
        );
      } else {
        lines.push(`- loop guard stop (${cell(e.data.reason)}): ${cell(e.data.summary)}`);
      }
    }
  }
  if (s.auditSeqs.length > 0) {
    lines.push("");
    lines.push(
      `Linked audit entries: seq ${s.auditSeqs.join(", ")} (see \`audit-slice.jsonl\`, ${input.auditSlice} entries).`,
    );
  } else if (input.auditSlice > 0) {
    lines.push("");
    lines.push(
      `\`audit-slice.jsonl\` holds ${input.auditSlice} audit entr${input.auditSlice === 1 ? "y" : "ies"} written during the job.`,
    );
  }
  lines.push("");

  lines.push("## How to verify");
  lines.push("");
  lines.push("```");
  lines.push("kolo evidence verify <this bundle>");
  lines.push("```");
  lines.push("");
  lines.push(
    "Offline: every line of `events.jsonl` carries `prev` and `hash` (SHA-256 of the previous hash and the canonical JSON of the line); the last hash is `manifest.json` → `events.root`; every file listed in `manifest.json` → `files` has its SHA-256 there; the manifest is signed with Ed25519 by the key in `signer.publicKey` whose SHA-256 must equal `signer.keyId`. The procedure is written out in the documentation page `evidence`.",
  );
  lines.push("");
  return lines.join("\n");
}
