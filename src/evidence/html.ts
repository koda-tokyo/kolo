// Read-only HTML timeline for one job's evidence (KoLo 2.0, M12c), served at GET /evidence/{id}.
// Static markup, no scripts, no external assets; everything is escaped.
import type { EvidenceEvent, EvidenceManifest, EvidenceSummary } from "./types.js";
import { describeEvent, stateAt } from "./replay.js";

export const EVIDENCE_VIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root{color-scheme:light;--fg:#1a1a1a;--muted:#5c5c5c;--line:#d9d9d9;--bg:#fff;--card:#f7f7f7;--ok:#1b6e3a;--bad:#a11a1a}
body{margin:0;padding:24px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:var(--bg)}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600}code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.muted{color:var(--muted)}.ok{color:var(--ok)}.bad{color:var(--bad)}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:12px 0}
.facts dt{color:var(--muted)}.facts dd{margin:0}
.ev{margin:0 0 10px;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:4px}
.ev .head{display:flex;gap:12px;flex-wrap:wrap}.ev .head .t{color:var(--muted);min-width:120px}
.ev .state{margin-top:6px;color:var(--muted)}pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
`;

function eventDetail(e: EvidenceEvent): string {
  const d = e.data;
  switch (e.type) {
    case "tool.call":
      return `<pre>${esc(typeof d.args === "string" ? d.args : JSON.stringify(d.args, null, 2))}</pre>`;
    case "tool.result":
      return d.result ? `<pre>${esc(d.result)}${d.resultClipped ? "\n…(clipped)" : ""}</pre>` : "";
    case "model.turn": {
      const text = d.text ?? d.excerpt;
      return text
        ? `<pre>${esc(text)}${d.textClipped || d.excerptClipped ? "\n…(clipped)" : ""}</pre>`
        : "";
    }
    case "job.start":
      return d.prompt ? `<pre>${esc(d.prompt)}${d.promptClipped ? "\n…(clipped)" : ""}</pre>` : "";
    case "permission":
      return d.reason ? `<pre>${esc(d.reason)}</pre>` : "";
    case "loop_guard":
      return `<pre>${esc(d.summary)}</pre>`;
    default:
      return "";
  }
}

export function renderEvidenceHtml(input: {
  jobId: string;
  events: EvidenceEvent[];
  manifest: EvidenceManifest | null;
  summary: EvidenceSummary;
}): string {
  const { jobId, events, manifest, summary: s } = input;
  const rows = events
    .map((e, i) => {
      const st = stateAt(events, i + 1);
      return `<div class="ev" id="e${e.seq}"><div class="head"><span class="t">${esc(e.seq)} · +${esc(st.elapsedMs ?? 0)} ms</span><strong>${esc(e.type)}</strong><span>${esc(describeEvent(e))}</span></div>${eventDetail(e)}<div class="state">after this step: ${esc(st.modelTurns)} model turns · ${esc(st.toolCalls)} tool calls (${esc(st.toolErrors)} failed) · ${esc(st.filesTouched.length)} files · ${esc(st.permissions.allowed)} allowed / ${esc(st.permissions.denied)} denied · <code>${esc(e.hash.slice(0, 16))}</code></div></div>`;
    })
    .join("\n");
  const signed = manifest
    ? `<span class="ok">signed</span> key <code>${esc(manifest.signer.keyId)}</code>, root <code>${esc(manifest.events.root)}</code>`
    : `<span class="bad">unsigned</span> (job still running or manifest missing)`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Evidence ${esc(jobId)}</title><style>${STYLE}</style></head>
<body>
<h1>Evidence for job <code>${esc(jobId)}</code></h1>
<p class="muted">Read-only timeline. Verify offline with <code>kolo evidence verify</code> on an exported bundle.</p>
<dl class="facts">
<dt>Agent</dt><dd>${esc(s.agent)}</dd>
<dt>Session</dt><dd>${esc(s.sessionKey)}</dd>
<dt>Status</dt><dd>${esc(s.status)}${s.error ? ` <span class="bad">${esc(s.error)}</span>` : ""}</dd>
<dt>Started</dt><dd>${esc(s.startedAt)}</dd>
<dt>Ended</dt><dd>${esc(s.endedAt ?? "running")}</dd>
<dt>Events</dt><dd>${esc(s.events)}${s.truncated ? " (truncated by the size cap)" : ""}</dd>
<dt>Model turns</dt><dd>${esc(s.modelTurns)} (input ${esc(s.usage.input ?? 0)}, output ${esc(s.usage.output ?? 0)} tokens)</dd>
<dt>Tool calls</dt><dd>${esc(s.toolCalls)} (${esc(s.toolErrors)} failed)</dd>
<dt>Files</dt><dd>${s.filesChanged.length ? s.filesChanged.map((f) => `<code>${esc(f)}</code>`).join(", ") : "none"}</dd>
<dt>Policy</dt><dd>${esc(s.permissions.allowed)} allowed, ${esc(s.permissions.denied)} denied, ${esc(s.loopStops)} loop stops</dd>
<dt>Prompt</dt><dd>sha256 <code>${esc(s.promptDigest ?? "n/a")}</code> (${esc(s.promptChars ?? 0)} chars)</dd>
<dt>Integrity</dt><dd>${signed}</dd>
</dl>
<h2>Timeline</h2>
${rows || '<p class="muted">No events.</p>'}
</body></html>
`;
}
