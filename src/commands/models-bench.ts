// `kurahi models bench` and `kurahi models tested` (KoLo 2.0, KODA tested catalogue).
//
// bench: runs the resident task suite against provider/model refs, under token caps, and writes
// a signed report plus evidence bundles. Keys come from the auth profile store or the provider's
// environment variable, never from argv. tested: the shipped catalogue as a table.
// Exit codes: 0 ok, 1 failed, 2 usage, 4 no key for a requested provider.
import fs from "node:fs";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import { resolveKoLoAgentDir } from "../agents/agent-paths.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { type KoLoConfig, loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { loadSigningKey } from "../continuity-suite/manifest.js";
import {
  type Catalogue,
  filterCatalogue,
  loadCatalogue,
  mergeReport,
  RESIDENCIES,
  type Residency,
  validateCatalogue,
} from "../model-bench/catalogue.js";
import {
  type BenchModelClient,
  BenchUnsupportedError,
  benchSupportsProvider,
  createPiAiClient,
  parseBenchModelRef,
} from "../model-bench/client.js";
import { mergeBenchReports } from "../model-bench/merge.js";
import { readBenchReport, writeBenchReport } from "../model-bench/report.js";
import {
  type BenchProgress,
  type BenchTarget,
  DEFAULT_MODEL_TOKEN_CAP,
  runModelBench,
} from "../model-bench/runner.js";
import { BENCH_AXES, type BenchReport } from "../model-bench/types.js";
import { getModelPrice, type ProviderRegistryEntry } from "../providers/registry.js";
import { renderTable } from "../terminal/table.js";
import { resolveProviderKey } from "./providers/shared.js";

export const BENCH_EXIT = { ok: 0, error: 1, usage: 2, auth: 4 } as const;

export class BenchCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = BENCH_EXIT.error,
  ) {
    super(message);
  }
}

export type ModelsBenchOptions = {
  model?: string[];
  quickModel?: string[];
  only?: string;
  maxTokens?: string;
  globalMaxTokens?: string;
  timeout?: string;
  baseUrl?: string;
  out?: string;
  updateCatalogue?: string;
  json?: boolean;
};

export type ModelsBenchDeps = {
  loadConfig?: () => KoLoConfig;
  agentDir?: () => string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Builds the client for a ref (tests pass a fake). */
  createClient?: (params: {
    entry: ProviderRegistryEntry;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    timeoutMs: number;
  }) => BenchModelClient;
};

function positiveInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BenchCommandError(`${flag} must be a positive integer`, BENCH_EXIT.usage);
  }
  return n;
}

function progressLine(event: BenchProgress): string {
  switch (event.type) {
    case "model.start":
      return `bench  ${event.model}  ${event.tasks} tasks`;
    case "task.end":
      return `  ${event.status.padEnd(7)} ${event.task}  score ${event.score.toFixed(2)}  ${event.tokens} tokens`;
    case "model.stop":
      return `  stopped: ${event.reason}`;
    case "model.end":
      return `  overall ${event.overall ?? "n/a"}  ${event.tokens} tokens`;
  }
}

export async function modelsBenchCommand(
  opts: ModelsBenchOptions,
  runtime: RuntimeEnv,
  d: ModelsBenchDeps = {},
): Promise<BenchReport> {
  const env = d.env ?? process.env;
  const refs = [
    ...(opts.model ?? []).map((ref) => ({ ref, subset: "full" as const })),
    ...(opts.quickModel ?? []).map((ref) => ({ ref, subset: "quick" as const })),
  ];
  if (refs.length === 0) {
    throw new BenchCommandError(
      "give at least one --model <provider/model> or --quick-model <provider/model>",
      BENCH_EXIT.usage,
    );
  }
  const perModelTokens = positiveInt(opts.maxTokens, "--max-tokens") ?? DEFAULT_MODEL_TOKEN_CAP;
  const globalTokens = positiveInt(opts.globalMaxTokens, "--global-max-tokens");
  const timeoutOverride = positiveInt(opts.timeout, "--timeout");
  const cfg = (d.loadConfig ?? loadConfig)();
  const store = ensureAuthProfileStore((d.agentDir ?? resolveKoLoAgentDir)(), {
    allowKeychainPrompt: false,
  });
  const create = d.createClient ?? createPiAiClient;
  const targets: BenchTarget[] = [];
  for (const { ref, subset } of refs) {
    let parsed: ReturnType<typeof parseBenchModelRef>;
    try {
      parsed = parseBenchModelRef(ref);
    } catch (err) {
      throw new BenchCommandError(String((err as Error).message), BENCH_EXIT.usage);
    }
    const { entry, model } = parsed;
    if (!benchSupportsProvider(entry)) {
      throw new BenchCommandError(
        `provider "${entry.id}" uses the ${entry.apiStyle} API style; the bench covers OpenAI-compatible endpoints only`,
        BENCH_EXIT.usage,
      );
    }
    const key = resolveProviderKey({ entry, cfg, store, env });
    if (!key.configured) {
      throw new BenchCommandError(
        `provider "${entry.id}" has no key. Add one with: kurahi providers add ${entry.id} --api-key-stdin`,
        BENCH_EXIT.auth,
      );
    }
    const baseUrl = opts.baseUrl?.trim() || cfg.models?.providers?.[entry.id]?.baseUrl || undefined;
    const timeoutMs = timeoutOverride ?? (entry.apiStyle === "ollama" ? 600_000 : 120_000);
    try {
      targets.push({
        client: create({ entry, model, apiKey: key.apiKey, baseUrl, timeoutMs }),
        price: getModelPrice(entry.id, model),
        subset,
      });
    } catch (err) {
      if (err instanceof BenchUnsupportedError) {
        throw new BenchCommandError(err.message, BENCH_EXIT.usage);
      }
      throw err;
    }
  }
  const now = d.now ?? (() => new Date());
  const stamp = now()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const stateDir = resolveStateDir(env);
  const outDir = path.resolve(opts.out?.trim() || path.join(stateDir, "bench", stamp));
  const workRoot = path.join(outDir, "work");
  const report = await runModelBench({
    targets,
    only: opts.only
      ? opts.only
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined,
    perModelTokens,
    globalTokens,
    workRoot,
    outDir,
    key: loadSigningKey(stateDir),
    env,
    now,
    onProgress: opts.json ? undefined : (event) => runtime.log(progressLine(event)),
  });
  // Task workspaces are scratch; the report and the evidence bundles are what remain.
  fs.rmSync(workRoot, { recursive: true, force: true });
  if (opts.updateCatalogue) {
    updateCatalogueFile(opts.updateCatalogue, report);
  }
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        {
          ok: true,
          outDir,
          hash: report.hash,
          models: report.models.map((m) => ({
            ref: `${m.provider}/${m.model}`,
            status: m.status,
            overall: m.overall,
            coverage: m.coverage,
            tokens: m.usage.total,
            cost: m.usage.cost,
            currency: m.usage.currency,
          })),
        },
        null,
        2,
      ),
    );
  } else {
    runtime.log(`report  ${path.join(outDir, "bench-report.md")}`);
    runtime.log(`hash    ${report.hash}`);
  }
  return report;
}

/** Merge a signed report into a catalogue file; refuses to write an invalid catalogue. */
export function updateCatalogueFile(fileArg: string, report: BenchReport): void {
  const file = path.resolve(fileArg);
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Catalogue;
  const merged = mergeReport(loadCatalogue(raw), report);
  const issues = validateCatalogue(merged);
  if (issues.length > 0) {
    throw new BenchCommandError(`catalogue would be invalid: ${issues.join("; ")}`);
  }
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
}

export type ModelsBenchMergeOptions = { out: string; updateCatalogue?: string; json?: boolean };

/** `kurahi models bench-merge <report.json...> --out <dir>`: one signed report from chunked runs. */
export function modelsBenchMergeCommand(
  files: string[],
  opts: ModelsBenchMergeOptions,
  runtime: RuntimeEnv,
  d: Pick<ModelsBenchDeps, "env" | "now"> = {},
): BenchReport {
  if (files.length === 0) {
    throw new BenchCommandError("give one or more bench-report.json files", BENCH_EXIT.usage);
  }
  if (!opts.out?.trim()) {
    throw new BenchCommandError("--out <dir> is required", BENCH_EXIT.usage);
  }
  const reports = files.map((f) => readBenchReport(path.resolve(f)));
  let report: BenchReport;
  try {
    report = mergeBenchReports({
      reports,
      key: loadSigningKey(resolveStateDir(d.env ?? process.env)),
      createdAt: (d.now ?? (() => new Date()))().toISOString(),
    });
  } catch (err) {
    throw new BenchCommandError(err instanceof Error ? err.message : String(err));
  }
  const outDir = path.resolve(opts.out);
  writeBenchReport(outDir, report);
  if (opts.updateCatalogue) {
    updateCatalogueFile(opts.updateCatalogue, report);
  }
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        { ok: true, outDir, hash: report.hash, mergedFrom: report.mergedFrom },
        null,
        2,
      ),
    );
  } else {
    runtime.log(`report  ${path.join(outDir, "bench-report.md")}`);
    runtime.log(`hash    ${report.hash}  (from ${reports.length} reports)`);
  }
  return report;
}

export type ModelsTestedOptions = {
  residency?: string;
  minScore?: string;
  testedOnly?: boolean;
  json?: boolean;
};

const cell = (v: number | null | undefined) => (v === null || v === undefined ? "-" : v.toFixed(0));

export function modelsTestedCommand(
  opts: ModelsTestedOptions,
  runtime: RuntimeEnv,
  catalogue: Catalogue = loadCatalogue(),
): void {
  let residency: Residency | undefined;
  if (opts.residency) {
    const r = opts.residency.trim().toLowerCase();
    if (!RESIDENCIES.includes(r as Residency)) {
      throw new BenchCommandError(
        `--residency must be one of ${RESIDENCIES.join(", ")}`,
        BENCH_EXIT.usage,
      );
    }
    residency = r as Residency;
  }
  let minScore: number | undefined;
  if (opts.minScore !== undefined) {
    minScore = Number(opts.minScore);
    if (!Number.isFinite(minScore) || minScore < 0 || minScore > 100) {
      throw new BenchCommandError("--min-score must be a number from 0 to 100", BENCH_EXIT.usage);
    }
  }
  const rows = filterCatalogue(catalogue, {
    residency,
    minScore,
    status: opts.testedOnly ? "tested" : undefined,
  });
  if (opts.json) {
    runtime.log(
      JSON.stringify(
        { suite: catalogue.suite, updatedAt: catalogue.updatedAt, models: rows },
        null,
        2,
      ),
    );
    return;
  }
  if (rows.length === 0) {
    runtime.log("No models match.");
    return;
  }
  const short: Record<string, string> = {
    toolUse: "Tools",
    policy: "Policy",
    continuity: "Contin.",
    coding: "Code",
    japanese: "JA",
    portuguese: "PT",
    efficiency: "Eff.",
  };
  runtime.log(
    renderTable({
      columns: [
        { key: "model", header: "Model", flex: true },
        { key: "residency", header: "Region" },
        { key: "overall", header: "Overall", align: "right" },
        ...BENCH_AXES.map((a) => ({ key: a, header: short[a] ?? a, align: "right" as const })),
        { key: "cost", header: "Cost/res-hour", align: "right" },
        { key: "date", header: "Benchmarked" },
      ],
      rows: rows.map((m) => ({
        model: `${m.provider}/${m.model}`,
        residency: m.residency.region,
        overall:
          m.status === "pending"
            ? "pending"
            : `${cell(m.overall)}${m.subset === "quick" ? "*" : ""}`,
        ...Object.fromEntries(BENCH_AXES.map((a) => [a, cell(m.scores?.[a])])),
        cost: m.costPerResidentHour
          ? `${m.costPerResidentHour.amount.toFixed(4)} ${m.costPerResidentHour.currency}`
          : "-",
        date: m.lastBenchmarked ?? "-",
      })),
    }),
  );
  if (rows.some((m) => m.subset === "quick")) {
    runtime.log("* quick subset: scored on fewer tasks; see the coverage in --json.");
  }
  runtime.log(
    `Suite ${catalogue.suite}, updated ${catalogue.updatedAt}. Reproduce with: kurahi models bench`,
  );
}
