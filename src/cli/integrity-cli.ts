// `kurahi integrity …` — boot integrity registry (KoLo 2.0, M2b). Operator actions only:
// agent tools are refused `kurahi integrity init|update` by the core write policy.
import type { Command } from "commander";
import os from "node:os";
import path from "node:path";
import { appendAudit, flushAudit } from "../audit/audit-log.js";
import { loadConfig } from "../config/config.js";
import { INTEGRITY_EXIT_CODE, resolveIntegrityMode } from "../integrity/gate.js";
import { expandIntegrityPatterns } from "../integrity/glob.js";
import {
  initRegistry,
  readRegistryFile,
  resolveIntegrityLocations,
  updateRegistry,
  verifyRegistry,
} from "../integrity/registry.js";
import { POLICY_INTEGRITY_PATTERNS } from "../policy/paths.js";
import { defaultRuntime } from "../runtime.js";
import { promptYesNo } from "./prompt.js";

type JsonOpt = { json?: boolean };

function operatorIdentity(): string {
  try {
    return `operator:${os.userInfo().username}`;
  } catch {
    return "operator";
  }
}

function configuredPatterns(): string[] {
  // M13: the policy document, its signature and the owner key list are protected files too.
  const policyPatterns = [...POLICY_INTEGRITY_PATTERNS];
  try {
    return [...(loadConfig().integrity?.paths ?? []), ...policyPatterns];
  } catch {
    return policyPatterns;
  }
}

async function confirm(question: string, yes?: boolean): Promise<boolean> {
  if (yes) {
    return true;
  }
  if (!process.stdin.isTTY) {
    defaultRuntime.error(
      "kurahi integrity: not a terminal; pass --yes to confirm this operator action",
    );
    return false;
  }
  return await promptYesNo(question, false);
}

function fail(message: string, code = 1): never {
  defaultRuntime.error(`kurahi integrity: ${message}`);
  return defaultRuntime.exit(code);
}

export async function runIntegrityInit(
  opts: JsonOpt & { path?: string[]; force?: boolean; yes?: boolean; dryRun?: boolean },
) {
  const loc = resolveIntegrityLocations();
  const patterns = [...configuredPatterns(), ...(opts.path ?? [])];
  const files = expandIntegrityPatterns(patterns, { baseDir: loc.home });
  if (opts.dryRun) {
    defaultRuntime.log(
      opts.json
        ? JSON.stringify({ ok: true, dryRun: true, patterns, files }, null, 2)
        : [
            `${files.length} file(s) would be registered from ${patterns.length} pattern(s):`,
            ...files.map((f) => `  ${f}`),
          ].join("\n"),
    );
    return;
  }
  if (
    !(await confirm(
      `Register ${files.length} protected policy file(s) in ${loc.registryPath}?`,
      opts.yes,
    ))
  ) {
    fail("aborted");
  }
  let result: ReturnType<typeof initRegistry>;
  try {
    result = initRegistry({ patterns, loc, force: opts.force });
  } catch (err) {
    await appendAudit({
      identity: operatorIdentity(),
      device: os.hostname(),
      action: "integrity.init",
      outcome: "failed",
      source: "cli",
      detail: { error: String(err) },
    }).catch(() => null);
    return fail(err instanceof Error ? err.message : String(err));
  }
  await appendAudit({
    identity: operatorIdentity(),
    device: os.hostname(),
    action: "integrity.init",
    outcome: "ok",
    source: "cli",
    detail: {
      registry: loc.registryPath,
      force: Boolean(opts.force),
      patterns,
      entries: result.registry.entries.map((e) => ({ path: e.path, sha256: e.sha256 })),
      createdKey: result.createdKey,
    },
  });
  await flushAudit();
  if (opts.json) {
    defaultRuntime.log(
      JSON.stringify(
        {
          ok: true,
          registry: loc.registryPath,
          entries: result.registry.entries.length,
          createdKey: result.createdKey,
        },
        null,
        2,
      ),
    );
    return;
  }
  defaultRuntime.log(
    [
      `Registered ${result.registry.entries.length} file(s) in ${loc.registryPath}`,
      result.createdKey
        ? `  signing key created: ${loc.keyPath} (0600; back it up off this machine)`
        : `  signing key: ${loc.keyPath}`,
      ...result.registry.entries.map((e) => `  ${e.sha256.slice(0, 12)}  ${e.path}`),
    ].join("\n"),
  );
}

export async function runIntegrityUpdate(
  paths: string[],
  opts: JsonOpt & { remove?: boolean; yes?: boolean },
) {
  const loc = resolveIntegrityLocations();
  const abs = paths.map((p) => path.resolve(p));
  const verb = opts.remove ? "Remove" : "Re-register";
  if (
    !(await confirm(
      `${verb} ${abs.length} path(s) in the integrity registry?\n${abs.map((p) => `  ${p}`).join("\n")}\n`,
      opts.yes,
    ))
  ) {
    fail("aborted");
  }
  let result: ReturnType<typeof updateRegistry>;
  try {
    result = updateRegistry({ paths: abs, remove: opts.remove, loc });
  } catch (err) {
    await appendAudit({
      identity: operatorIdentity(),
      device: os.hostname(),
      action: "integrity.update",
      outcome: "failed",
      source: "cli",
      detail: { paths: abs, remove: Boolean(opts.remove), error: String(err) },
    }).catch(() => null);
    return fail(err instanceof Error ? err.message : String(err));
  }
  await appendAudit({
    identity: operatorIdentity(),
    device: os.hostname(),
    action: "integrity.update",
    outcome: "ok",
    source: "cli",
    detail: { registry: loc.registryPath, changes: result.changes },
  });
  await flushAudit();
  if (opts.json) {
    defaultRuntime.log(JSON.stringify({ ok: true, changes: result.changes }, null, 2));
    return;
  }
  for (const c of result.changes) {
    const hashes =
      c.change === "updated" ? ` ${c.from?.slice(0, 12)} -> ${c.to?.slice(0, 12)}` : "";
    defaultRuntime.log(`${c.change.padEnd(9)} ${c.path}${hashes}`);
  }
}

export function runIntegrityStatus(opts: JsonOpt & { unregistered?: boolean }) {
  const loc = resolveIntegrityLocations();
  const result = verifyRegistry(loc);
  const mode = resolveIntegrityMode();
  let unregistered: string[] | undefined;
  if (opts.unregistered) {
    const known = new Set(readRegistryFile(loc)?.entries.map((e) => e.path) ?? []);
    unregistered = expandIntegrityPatterns(configuredPatterns(), { baseDir: loc.home }).filter(
      (f) => !known.has(f),
    );
  }
  if (opts.json) {
    defaultRuntime.log(
      JSON.stringify({ ...result, mode, keyPath: loc.keyPath, unregistered }, null, 2),
    );
  } else {
    defaultRuntime.log(
      `integrity: ${result.state} (${result.checked} file(s), registry ${loc.registryPath}, mode ${mode})`,
    );
    for (const p of result.problems) {
      defaultRuntime.log(`  ${p.kind.padEnd(10)} ${p.message}`);
    }
    for (const f of unregistered ?? []) {
      defaultRuntime.log(`  unregistered ${f}`);
    }
  }
  if (result.state === "failed") {
    defaultRuntime.exit(INTEGRITY_EXIT_CODE);
  }
}

export function registerIntegrityCli(program: Command) {
  const cmd = program
    .command("integrity")
    .description("Boot integrity registry for protected policy files");

  cmd
    .command("init")
    .description(
      "Hash every file matched by config integrity.paths (+ --path) and write the signed registry",
    )
    .option(
      "--path <glob>",
      "extra glob (repeatable; relative to KOLO_HOME or absolute)",
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option("--force", "rebuild an existing registry")
    .option("--dry-run", "list the files that would be registered")
    .option("--yes", "do not prompt")
    .option("--json", "JSON output")
    .action(async (opts) => {
      await runIntegrityInit(opts);
    });

  cmd
    .command("update")
    .description("Re-hash (or add) registered paths after an intended change; audited")
    .argument("<path...>", "file path(s)")
    .option("--remove", "drop the path(s) from the registry")
    .option("--yes", "do not prompt")
    .option("--json", "JSON output")
    .action(async (paths: string[], opts) => {
      await runIntegrityUpdate(paths, opts);
    });

  for (const name of ["status", "verify"]) {
    cmd
      .command(name)
      .description("Verify every registered file now (exit 3 on failure)")
      .option("--unregistered", "also list files matching integrity.paths that are not registered")
      .option("--json", "JSON output")
      .action((opts) => {
        runIntegrityStatus(opts);
      });
  }
}
