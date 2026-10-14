// Summary of one job's evidence (KoLo 2.0, M12b): derived from the events alone, so an exported
// bundle and the live store produce the same numbers.
import type { EvidenceEvent, EvidenceSummary, EvidenceUsage } from "./types.js";

const EDIT_TOOLS = new Set(["write", "edit", "apply_patch"]);

function addUsage(total: EvidenceUsage, usage: unknown): void {
  if (!usage || typeof usage !== "object") {
    return;
  }
  const u = usage as Record<string, unknown>;
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    const value = u[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      total[key] = (total[key] ?? 0) + value;
    }
  }
}

/** Paths an edit tool call touches, from its (redacted) args. */
export function pathsOfToolCall(name: string, args: unknown): string[] {
  if (!EDIT_TOOLS.has(name) || !args || typeof args !== "object") {
    return [];
  }
  const rec = args as Record<string, unknown>;
  const raw = rec.path ?? rec.file_path ?? rec.filePath;
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  const patch = rec.input ?? rec.patch;
  if (typeof patch === "string") {
    const out: string[] = [];
    for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      out.push(m[1].trim());
    }
    return out;
  }
  return [];
}

export function summarizeEvents(
  events: EvidenceEvent[],
  opts: { signed?: boolean } = {},
): EvidenceSummary {
  const first = events[0];
  const start = first?.type === "job.start" ? first.data : {};
  const end = events.find((e) => e.type === "job.end")?.data ?? null;
  const summary: EvidenceSummary = {
    jobId: first?.jobId ?? "",
    agent: String(start.agent ?? ""),
    sessionKey: String(start.sessionKey ?? ""),
    kind: String(start.kind ?? ""),
    status: end ? String(end.status) : "running",
    startedAt: String(start.startedAt ?? first?.ts ?? ""),
    endedAt: end ? String(end.endedAt) : null,
    durationMs: end && typeof end.durationMs === "number" ? end.durationMs : null,
    events: events.length,
    modelTurns: 0,
    toolCalls: 0,
    toolErrors: 0,
    filesChanged: [],
    tools: {},
    usage: {},
    permissions: { allowed: 0, denied: 0 },
    loopStops: 0,
    auditSeqs: [],
    promptDigest: typeof start.promptDigest === "string" ? start.promptDigest : null,
    promptChars: typeof start.promptChars === "number" ? start.promptChars : null,
    finalTextDigest: null,
    finalTextExcerpt: null,
    error: end && typeof end.error === "string" ? end.error : null,
    truncated: false,
    signed: Boolean(opts.signed),
  };
  const files = new Set<string>();
  for (const e of events) {
    switch (e.type) {
      case "model.turn": {
        summary.modelTurns += 1;
        addUsage(summary.usage, e.data.usage);
        summary.finalTextDigest = typeof e.data.textDigest === "string" ? e.data.textDigest : null;
        const text = e.data.text ?? e.data.excerpt;
        summary.finalTextExcerpt = typeof text === "string" ? text : null;
        break;
      }
      case "tool.call": {
        summary.toolCalls += 1;
        const name = String(e.data.name ?? "?");
        summary.tools[name] = (summary.tools[name] ?? 0) + 1;
        for (const p of pathsOfToolCall(name, e.data.args)) {
          files.add(p);
        }
        break;
      }
      case "tool.result":
        if (e.data.isError === true) {
          summary.toolErrors += 1;
        }
        break;
      case "snapshot":
        for (const f of (e.data.files as Array<{ path?: string }> | undefined) ?? []) {
          if (typeof f?.path === "string") {
            files.add(f.path);
          }
        }
        break;
      case "permission":
        if (e.data.decision === "deny") {
          summary.permissions.denied += 1;
        } else {
          summary.permissions.allowed += 1;
        }
        break;
      case "loop_guard":
        summary.loopStops += 1;
        break;
      case "audit":
        if (typeof e.data.seq === "number") {
          summary.auditSeqs.push(e.data.seq);
        }
        break;
      case "truncated":
        summary.truncated = true;
        break;
      default:
        break;
    }
  }
  summary.filesChanged = [...files].toSorted();
  return summary;
}
