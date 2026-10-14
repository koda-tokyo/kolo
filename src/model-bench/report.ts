// Signed bench report. The body is hashed (sha256 of its canonical JSON) and the hash is signed
// with the gateway's continuity signing key (Ed25519), the same key and signer format as the
// continuity manifest, so one public key verifies both. The catalogue records the hash.
import fs from "node:fs";
import path from "node:path";
import {
  canonicalJson,
  sha256Hex,
  type SigningKey,
  signerFromKey,
} from "../continuity-suite/manifest.js";
import {
  deriveDeviceIdFromPublicKey,
  signDevicePayload,
  verifyDeviceSignature,
} from "../infra/device-identity.js";
import {
  BENCH_AXES,
  BENCH_REPORT_VERSION,
  BENCH_SUITE_VERSION,
  type BenchReport,
  type ModelBenchResult,
} from "./types.js";

export const BENCH_REPORT_JSON = "bench-report.json";
export const BENCH_REPORT_MD = "bench-report.md";

type UnsignedReport = Omit<BenchReport, "hash" | "signer" | "signature">;

export function benchReportSigningInput(createdAt: string, hash: string): string {
  return ["kolo-model-bench-report", String(BENCH_REPORT_VERSION), createdAt, hash].join("\n");
}

export function hashReportBody(body: UnsignedReport): string {
  return sha256Hex(canonicalJson(body));
}

export function buildBenchReport(params: {
  models: ModelBenchResult[];
  suiteTasks: number;
  perModelTokens: number;
  globalTokens: number;
  createdAt: string;
  key: SigningKey;
  mergedFrom?: string[];
}): BenchReport {
  const subsets = new Set(params.models.map((m) => m.subset));
  const body: UnsignedReport = {
    version: BENCH_REPORT_VERSION,
    kind: "kolo-model-bench",
    suite: {
      version: BENCH_SUITE_VERSION,
      tasks: params.suiteTasks,
      subset: subsets.size === 1 ? [...subsets][0] : "mixed",
    },
    createdAt: params.createdAt,
    judge: {
      kind: "deterministic",
      detail: "Rubrics over transcripts, tool calls, files and fixture tests; no model judge.",
    },
    budget: { perModelTokens: params.perModelTokens, globalTokens: params.globalTokens },
    models: params.models,
    ...(params.mergedFrom ? { mergedFrom: params.mergedFrom } : {}),
  };
  const hash = hashReportBody(body);
  return {
    ...body,
    hash,
    signer: signerFromKey(params.key),
    signature: signDevicePayload(
      params.key.privateKeyPem,
      benchReportSigningInput(body.createdAt, hash),
    ),
  };
}

export type BenchReportVerification = {
  ok: boolean;
  hashOk: boolean;
  signatureOk: boolean;
  reason?: string;
};

export function verifyBenchReport(report: BenchReport): BenchReportVerification {
  const { hash, signer, signature, ...body } = report;
  const hashOk = hashReportBody(body) === hash;
  let signatureOk = false;
  try {
    signatureOk =
      signer?.alg === "ed25519" &&
      deriveDeviceIdFromPublicKey(signer.publicKey) === signer.keyId &&
      verifyDeviceSignature(
        signer.publicKey,
        benchReportSigningInput(report.createdAt, hash),
        signature,
      );
  } catch {
    signatureOk = false;
  }
  const reason = !hashOk
    ? "report body does not match its hash"
    : !signatureOk
      ? "signature does not verify"
      : undefined;
  return { ok: hashOk && signatureOk, hashOk, signatureOk, ...(reason ? { reason } : {}) };
}

const fmt = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? "–" : v.toFixed(digits);

export function benchReportToMarkdown(report: BenchReport): string {
  const lines: string[] = [
    "# Model bench report",
    "",
    `- Created: ${report.createdAt}`,
    `- Suite: ${report.suite.version} (${report.suite.tasks} tasks, subset ${report.suite.subset})`,
    `- Judge: ${report.judge.kind} — ${report.judge.detail}`,
    `- Budget: ${report.budget.perModelTokens} tokens per model, ${report.budget.globalTokens} in total`,
    `- Report hash: \`${report.hash}\``,
    `- Signer key id: \`${report.signer.keyId}\``,
    "",
    "## Scores",
    "",
    `| Model | Overall | ${BENCH_AXES.join(" | ")} | Coverage | Tokens | Cost | p50 latency |`,
    `|---|---|${BENCH_AXES.map(() => "---").join("|")}|---|---|---|---|`,
  ];
  for (const m of report.models) {
    lines.push(
      `| ${m.provider}/${m.model} | ${fmt(m.overall)} | ${BENCH_AXES.map((a) => fmt(m.axes[a]?.score)).join(" | ")} | ${Math.round(m.coverage * 100)}% | ${m.usage.total} | ${m.usage.currency ? `${m.usage.cost.toFixed(4)} ${m.usage.currency}` : "–"} | ${m.latency.p50Ms === null ? "–" : `${(m.latency.p50Ms / 1000).toFixed(1)} s`} |`,
    );
  }
  for (const m of report.models) {
    lines.push("", `## ${m.provider}/${m.model}`, "");
    lines.push(
      `Status: ${m.status}${m.error ? ` (${m.error})` : ""}. Evidence: ${m.evidence.length > 0 ? m.evidence.map((e) => `${e.jobId} (${e.events} events, root \`${e.root}\`)`).join("; ") : "none"}.`,
    );
    lines.push(
      "",
      "| Task | Axis | Status | Score | Turns | Tokens | Latency | Detail |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const t of m.tasks) {
      lines.push(
        `| ${t.id} | ${t.axis} | ${t.status} | ${t.status === "not_run" ? "–" : t.score.toFixed(2)} | ${t.turns} | ${t.tokens.total} | ${(t.latencyMs / 1000).toFixed(1)} s | ${(t.reason ?? t.detail).replace(/\|/g, "/")} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function writeBenchReport(dir: string, report: BenchReport): { json: string; md: string } {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = path.join(dir, BENCH_REPORT_JSON);
  const md = path.join(dir, BENCH_REPORT_MD);
  fs.writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(md, benchReportToMarkdown(report), { mode: 0o600 });
  return { json, md };
}

export function readBenchReport(file: string): BenchReport {
  return JSON.parse(fs.readFileSync(file, "utf8")) as BenchReport;
}
