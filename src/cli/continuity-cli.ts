// `kurahi continuity …` — proven continuity of a resident (KoLo 2.0, M11c).
//
//   kurahi continuity run --resident <id> [--disruption model-swap|restart|move|close|all] --out <dir>
//        [--throwaway [--home <dir>] [--port N]]      own a fresh gateway with the fake provider (CI)
//        [--gateway <url>] [--swap-to <provider/model>] [--facts <file>] [--chat]
//   kurahi continuity verify <report.json>              recompute hashes, signatures and scores
//   kurahi continuity badge [<report.json>]             print the one-line badge
//
// The owner credential is discovered like every other client (KOLO_HOME lock + token file, or
// KOLO_GATEWAY_TOKEN); it is never taken from argv. Exit codes: 0 pass, 1 an invariant failed or
// a report does not verify, 2 usage, 3 gateway unreachable, 4 authentication failed.
import type { Command } from "commander";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ContinuityReport, FactProbe } from "../continuity-suite/types.js";
import { readReport, REPORT_JSON, verifyReport, writeReport } from "../continuity-suite/report.js";
import { parseDisruptions, type RunOptions, runContinuity } from "../continuity-suite/runner.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { formatCliCommand } from "./command-format.js";

export const CONTINUITY_EXIT = { ok: 0, failed: 1, usage: 2, unreachable: 3, auth: 4 } as const;

class UsageError extends Error {}

export type ContinuityCliDeps = {
  runtime?: RuntimeEnv;
  run?: typeof runContinuity;
  discover?: () => Promise<{ baseUrl: string; token?: string; tokenSource: string }>;
};

type RunOpts = {
  resident?: string;
  disruption?: string;
  out?: string;
  throwaway?: boolean;
  home?: string;
  port?: string;
  entry?: string;
  gateway?: string;
  swapTo?: string;
  facts?: string;
  chat?: boolean;
  keep?: boolean;
  json?: boolean;
  quiet?: boolean;
};

const RESIDENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function readFactsFile(file: string): FactProbe[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new UsageError(`${file}: expected a JSON array of {query, expect}`);
  }
  return parsed.map((entry, i) => {
    const row = entry as { query?: unknown; expect?: unknown };
    if (typeof row?.query !== "string" || typeof row?.expect !== "string") {
      throw new UsageError(`${file}: entry ${i} needs string fields query and expect`);
    }
    return { query: row.query, expect: row.expect };
  });
}

async function defaultDiscover() {
  const { discover } = await import("@kodasoken/kurahi-client");
  const found = await discover();
  return { baseUrl: found.baseUrl, token: found.token, tokenSource: found.tokenSource };
}

export async function buildRunOptions(
  opts: RunOpts,
  deps: ContinuityCliDeps,
  log: (line: string) => void,
): Promise<RunOptions> {
  let disruptions: ReturnType<typeof parseDisruptions>;
  try {
    disruptions = parseDisruptions(opts.disruption);
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : String(err));
  }
  if (opts.throwaway) {
    const resident = opts.resident?.trim() || "alice";
    if (!RESIDENT_ID.test(resident)) {
      throw new UsageError(`--resident must match ${RESIDENT_ID}`);
    }
    const port = opts.port ? Number.parseInt(opts.port, 10) : undefined;
    if (opts.port && (!Number.isInteger(port) || (port as number) <= 0)) {
      throw new UsageError(`--port must be a positive integer; got "${opts.port}"`);
    }
    const home =
      opts.home?.trim() ||
      process.env.KOLO_SMOKE_HOME?.trim() ||
      path.join(os.tmpdir(), "kolo-continuity.kolo-test");
    return {
      mode: "throwaway",
      home,
      port:
        port ??
        (process.env.KOLO_SMOKE_PORT
          ? Number.parseInt(process.env.KOLO_SMOKE_PORT, 10)
          : undefined),
      entry: opts.entry,
      resident,
      disruptions,
      keep: opts.keep,
      log,
    };
  }
  const resident = opts.resident?.trim();
  if (!resident) {
    throw new UsageError("--resident <id> is required (or pass --throwaway for a seeded resident)");
  }
  if (!RESIDENT_ID.test(resident)) {
    throw new UsageError(`--resident must match ${RESIDENT_ID}`);
  }
  const found = await (deps.discover ?? defaultDiscover)();
  const baseUrl = opts.gateway?.trim() || found.baseUrl;
  const token = process.env.KOLO_GATEWAY_TOKEN?.trim() || found.token;
  if (!token) {
    throw new UsageError(
      "no owner credential found: set KOLO_GATEWAY_TOKEN or run against a KOLO_HOME with secrets/gateway.token",
    );
  }
  return {
    mode: "attached",
    baseUrl,
    token,
    resident,
    disruptions,
    swapTo: opts.swapTo?.trim() || undefined,
    facts: opts.facts ? readFactsFile(opts.facts) : undefined,
    chat: Boolean(opts.chat),
    log,
  };
}

function summaryLines(
  report: ContinuityReport,
  files?: { json: string; md: string; badge: string },
): string[] {
  const lines: string[] = [];
  lines.push(`resident     ${report.resident}`);
  lines.push(`gateway      ${report.gateway.baseUrl} (${report.gateway.mode})`);
  lines.push(
    `verdict      ${report.summary.verdict} (${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.skip} skip)`,
  );
  for (const run of report.runs) {
    const failed = run.invariants.filter((i) => i.status === "fail");
    const skipped = run.invariants.filter((i) => i.status === "skip");
    const state = failed.length ? `FAIL ${failed.map((f) => f.id).join(" ")}` : "pass";
    lines.push(
      `${run.disruption.padEnd(12)} ${state}${skipped.length ? ` (skip ${skipped.map((s) => s.id).join(" ")})` : ""}  ${run.before.manifest.root.slice(0, 8)} -> ${run.after.manifest.root.slice(0, 8)}`,
    );
    for (const f of failed) {
      lines.push(`  ${f.id} ${f.name}: ${f.detail}`);
    }
  }
  for (const s of report.skipped) {
    lines.push(`${s.disruption.padEnd(12)} not run: ${s.reason}`);
  }
  if (files) {
    lines.push(`report       ${files.json}`);
    lines.push(`markdown     ${files.md}`);
  }
  lines.push(`badge        ${report.summary.badge}`);
  return lines;
}

function classifyError(err: unknown): { code: number; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof UsageError) {
    return { code: CONTINUITY_EXIT.usage, message };
  }
  if (/HTTP 401|HTTP 403|ws connect rejected/.test(message)) {
    return { code: CONTINUITY_EXIT.auth, message };
  }
  if (
    /\/health HTTP|ECONNREFUSED|fetch failed|unreachable|not found; run `pnpm build`/.test(message)
  ) {
    return { code: CONTINUITY_EXIT.unreachable, message };
  }
  return { code: CONTINUITY_EXIT.failed, message };
}

export async function runContinuityRun(
  opts: RunOpts,
  deps: ContinuityCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  const run = deps.run ?? runContinuity;
  const outDir = path.resolve(opts.out?.trim() || "continuity-out");
  try {
    const log = (line: string) => {
      if (!opts.quiet && !opts.json) {
        runtime.error(`continuity: ${line}`);
      }
    };
    const options = await buildRunOptions(opts, deps, log);
    const report = await run(options);
    const files = writeReport(outDir, report);
    if (opts.json) {
      runtime.log(JSON.stringify(report, null, 2));
    } else {
      runtime.log(summaryLines(report, files).join("\n"));
    }
    return report.summary.verdict === "PASS" ? CONTINUITY_EXIT.ok : CONTINUITY_EXIT.failed;
  } catch (err) {
    const { code, message } = classifyError(err);
    runtime.error(`kurahi continuity run: ${message}`);
    return code;
  }
}

export function runContinuityVerify(
  file: string | undefined,
  opts: { json?: boolean },
  deps: ContinuityCliDeps = {},
): number {
  const runtime = deps.runtime ?? defaultRuntime;
  const target = file?.trim() || REPORT_JSON;
  let report: ContinuityReport;
  try {
    report = readReport(target);
  } catch (err) {
    runtime.error(`kurahi continuity verify: ${err instanceof Error ? err.message : String(err)}`);
    return CONTINUITY_EXIT.usage;
  }
  const result = verifyReport(report);
  if (opts.json) {
    runtime.log(JSON.stringify({ file: target, ...result }, null, 2));
  } else {
    const lines = [
      `report       ${target}`,
      `resident     ${report.resident}`,
      `verdict      ${report.summary.verdict} (as recorded)`,
    ];
    for (const r of result.runs) {
      const state = r.beforeManifest && r.afterManifest && r.scoresMatch ? "ok" : "MISMATCH";
      lines.push(
        `${r.disruption.padEnd(12)} ${state}  manifests ${r.beforeManifest && r.afterManifest ? "verify" : "do not verify"}, scores ${r.scoresMatch ? "recompute" : r.mismatches.join("; ")}`,
      );
    }
    lines.push(
      `summary      ${result.summaryMatches ? "matches" : "does not match"} the invariants`,
    );
    lines.push(`badge        ${result.badgeMatches ? "matches" : "does not match"} the report`);
    lines.push(
      `integrity    ${result.ok ? "ok: every hash, signature and score recomputes" : `BROKEN: ${result.reason ?? "unknown"}`}`,
    );
    runtime.log(lines.join("\n"));
  }
  return result.ok ? CONTINUITY_EXIT.ok : CONTINUITY_EXIT.failed;
}

export function runContinuityBadge(file: string | undefined, deps: ContinuityCliDeps = {}): number {
  const runtime = deps.runtime ?? defaultRuntime;
  const target = file?.trim() || REPORT_JSON;
  try {
    const report = readReport(target);
    const result = verifyReport(report);
    runtime.log(result.ok ? report.summary.badge : `${report.summary.badge} | UNVERIFIED`);
    return result.ok ? CONTINUITY_EXIT.ok : CONTINUITY_EXIT.failed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      runtime.error(
        `kurahi continuity badge: no report at ${target}. Run: kurahi continuity run --out <dir>, then: kurahi continuity badge <dir>/continuity-report.json`,
      );
      return CONTINUITY_EXIT.usage;
    }
    runtime.error(`kurahi continuity badge: ${err instanceof Error ? err.message : String(err)}`);
    return CONTINUITY_EXIT.usage;
  }
}

export function registerContinuityCli(program: Command, deps: ContinuityCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  const cmd = program
    .command("continuity")
    .description(
      "Prove a resident is the same after a model swap, restart, state-dir move or session close",
    )
    .addHelpText("after", () =>
      [
        "",
        theme.muted("Examples:"),
        `  ${formatCliCommand("kurahi continuity run --throwaway --disruption all --out ./continuity-out")}`,
        `  ${formatCliCommand("kurahi continuity run --resident alice --disruption restart,close --out ./continuity-out")}`,
        `  ${formatCliCommand("kurahi continuity verify ./continuity-out/continuity-report.json")}`,
        "",
        "Exit codes: 0 pass, 1 an invariant failed or the report does not verify, 2 usage, 3 gateway unreachable, 4 authentication failed.",
        `Docs: ${formatDocsLink("/continuity")}`,
        "",
      ].join("\n"),
    );

  cmd
    .command("run")
    .description("Snapshot, disrupt, snapshot again and score the invariants")
    .option("--resident <id>", "agent id of the resident (default in throwaway mode: alice)")
    .option(
      "--disruption <list>",
      "model-swap, restart, move, close, or all; comma-separated (all)",
      "all",
    )
    .option("--out <dir>", "directory for the JSON, Markdown and badge files (continuity-out)")
    .option(
      "--throwaway",
      "own a fresh gateway with a deterministic provider and a seeded resident",
      false,
    )
    .option(
      "--home <dir>",
      "throwaway: state dir, under the temp dir or ending in .kolo-test (KOLO_SMOKE_HOME)",
    )
    .option("--port <n>", "throwaway: gateway port (KOLO_SMOKE_PORT, else a free port)")
    .option("--entry <file>", "throwaway: gateway entry script (dist/entry.js)")
    .option("--keep", "throwaway: keep the state dir after the run", false)
    .option("--gateway <url>", "attached: gateway base URL (default: discovered from KOLO_HOME)")
    .option(
      "--swap-to <model>",
      "attached: provider/model to swap to for the model-swap disruption",
    )
    .option("--facts <file>", "attached: JSON array of {query, expect} recall probes")
    .option(
      "--chat",
      "attached: also run the chat probe (the resident must be able to answer)",
      false,
    )
    .option("--json", "print the report as JSON on stdout and nothing else", false)
    .option("--quiet", "no progress on stderr", false)
    .action(async (opts: RunOpts) => {
      const code = await runContinuityRun(opts, deps);
      if (code !== CONTINUITY_EXIT.ok) {
        runtime.exit(code);
      }
    });

  cmd
    .command("verify [report]")
    .description("Recompute every manifest hash, signature and score of a saved report")
    .option("--json", "JSON output", false)
    .action((file: string | undefined, opts: { json?: boolean }) => {
      const code = runContinuityVerify(file, opts, deps);
      if (code !== CONTINUITY_EXIT.ok) {
        runtime.exit(code);
      }
    });

  cmd
    .command("badge [report]")
    .description(
      "Print the one-line badge of a saved report (marked UNVERIFIED when it does not recompute)",
    )
    .action((file: string | undefined) => {
      const code = runContinuityBadge(file, deps);
      if (code !== CONTINUITY_EXIT.ok) {
        runtime.exit(code);
      }
    });
}
