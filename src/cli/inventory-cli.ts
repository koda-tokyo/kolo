// `kurahi inventory …` — the AI inventory (AI bill of materials) of this runtime.
//
//   kurahi inventory [--json|--csv] [--host]         print it (table by default)
//   kurahi inventory export [-o file] [--csv] [--no-sign] [--host]
//   kurahi inventory verify <file>                    check digest and signature (exit 1 if bad)
//
// Exit codes: 0 ok, 1 verification failed, 2 usage.
import type { Command } from "commander";
import fs from "node:fs";
import type { KoLoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { loadConfig } from "../config/io.js";
import { resolveEvidenceSigningKey } from "../evidence/store.js";
import {
  buildInventory,
  finalizeInventory,
  type Inventory,
  type InventoryBody,
  inventoryToCsv,
  verifyInventory,
} from "../inventory/inventory.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";

export const INVENTORY_EXIT = { ok: 0, failed: 1, usage: 2 } as const;

export type InventoryCliDeps = {
  runtime?: RuntimeEnv;
  env?: NodeJS.ProcessEnv;
  config?: KoLoConfig;
  now?: Date;
};

function ctxOf(deps: InventoryCliDeps = {}) {
  return {
    runtime: deps.runtime ?? defaultRuntime,
    env: deps.env ?? process.env,
    config: deps.config ?? loadConfig(),
    now: deps.now,
  };
}

const list = (xs: string[] | null | undefined, empty = "-") =>
  xs && xs.length > 0 ? xs.join(", ") : empty;

function printTable(runtime: RuntimeEnv, inv: InventoryBody) {
  const t = inv.totals;
  runtime.log(
    `AI inventory · KoLo ${inv.runtime.version} · ${t.agents} agent(s), ${t.models} model(s) from ${t.providers} provider(s), ${t.mcpServers} MCP server(s), ${t.channels} channel(s), ${t.evidenceJobs} evidence job(s)`,
  );
  const p = inv.policy;
  runtime.log(
    `policy: ${p.state}${p.attestation ? ` (${p.attestation})` : ""} · mode ${p.mode}${p.fleetStopped ? " · FLEET STOPPED" : ""}`,
  );
  runtime.log("");
  for (const a of inv.agents) {
    runtime.log(
      `${a.id}${a.default ? " (default)" : ""}${a.name ? ` · ${a.name}` : ""}${a.policy.stopped ? " · STOPPED" : ""}`,
    );
    runtime.log(
      `  model     ${a.model.primary ?? "-"}${a.model.fallbacks.length ? `  fallbacks: ${a.model.fallbacks.join(", ")}` : ""}`,
    );
    runtime.log(
      `  tools     profile ${a.tools.profile ?? "default"} · allow ${list(a.tools.allow)} · deny ${list(a.tools.deny)} · sandbox ${a.sandbox}`,
    );
    runtime.log(
      `  policy    rules ${list(a.policy.rules, "none")} · models ${list(a.policy.allowedModels, "any")} · approvals ${list(a.policy.approvals, "none")} · budget ${a.policy.budget ? "yes" : "no"}`,
    );
    runtime.log(
      `  evidence  ${a.evidence.jobs} job(s)${a.evidence.lastStartedAt ? `, last ${a.evidence.lastStartedAt}` : ""}`,
    );
  }
  if (inv.mcpServers.length > 0) {
    runtime.log("");
    runtime.log("MCP servers");
    for (const s of inv.mcpServers) {
      runtime.log(
        `  ${s.id} · ${s.transport} ${s.endpoint ?? ""}${s.enabled ? "" : " · disabled"} · tools ${list(s.allowTools, "default")}`,
      );
    }
  }
  if (inv.channels.length > 0) {
    runtime.log("");
    runtime.log(
      `channels: ${inv.channels.map((c) => `${c.id}${c.enabled ? "" : " (off)"}`).join(", ")}`,
    );
  }
}

export async function runInventoryShow(
  opts: { json?: boolean; csv?: boolean; host?: boolean },
  deps?: InventoryCliDeps,
) {
  const ctx = ctxOf(deps);
  if (opts.json && opts.csv) {
    ctx.runtime.error("kurahi inventory: pass --json or --csv, not both");
    ctx.runtime.exit(INVENTORY_EXIT.usage);
    return;
  }
  const body = buildInventory(ctx.config, { env: ctx.env, now: ctx.now, includeHost: opts.host });
  if (opts.json) {
    ctx.runtime.log(JSON.stringify(finalizeInventory(body), null, 2));
  } else if (opts.csv) {
    ctx.runtime.log(inventoryToCsv(body).trimEnd());
  } else {
    printTable(ctx.runtime, body);
  }
}

export async function runInventoryExport(
  opts: { output?: string; csv?: boolean; sign?: boolean; host?: boolean },
  deps?: InventoryCliDeps,
) {
  const ctx = ctxOf(deps);
  const body = buildInventory(ctx.config, { env: ctx.env, now: ctx.now, includeHost: opts.host });
  const stamp = body.generatedAt.slice(0, 10);
  let text: string;
  let file: string;
  if (opts.csv) {
    text = inventoryToCsv(body);
    file = opts.output ?? `kolo-inventory-${stamp}.csv`;
  } else {
    const key = opts.sign === false ? undefined : resolveEvidenceSigningKey(ctx.env);
    text = JSON.stringify(finalizeInventory(body, key), null, 2) + "\n";
    file = opts.output ?? `kolo-inventory-${stamp}.json`;
  }
  if (file === "-") {
    ctx.runtime.log(text.trimEnd());
    return;
  }
  fs.writeFileSync(file, text, { mode: 0o644 });
  ctx.runtime.log(
    `wrote ${file} (${body.totals.agents} agent(s)${opts.csv ? ", CSV" : opts.sign === false ? ", unsigned" : ", signed"})`,
  );
}

export async function runInventoryVerify(
  file: string,
  opts: { json?: boolean },
  deps?: InventoryCliDeps,
) {
  const runtime = deps?.runtime ?? defaultRuntime;
  let inv: Inventory;
  try {
    inv = JSON.parse(fs.readFileSync(file, "utf8")) as Inventory;
  } catch (err) {
    runtime.error(`kurahi inventory verify: cannot read ${file} (${String(err)})`);
    runtime.exit(INVENTORY_EXIT.usage);
    return;
  }
  const r = verifyInventory(inv);
  if (opts.json) {
    runtime.log(JSON.stringify({ file, ...r }, null, 2));
  } else if (r.ok) {
    runtime.log(
      `inventory ok: digest matches${r.signed ? `, signed by ${r.keyId}` : ", unsigned"} (${file})`,
    );
  } else {
    const why = !r.digestOk
      ? "content does not match its digest (edited after export?)"
      : !r.keyIdOk
        ? "signer key id does not match its public key"
        : "signature does not verify";
    runtime.log(`inventory FAILED: ${why} (${file})`);
  }
  if (!r.ok) {
    runtime.exit(INVENTORY_EXIT.failed);
  }
}

export function registerInventoryCli(program: Command) {
  const cmd = program
    .command("inventory")
    .description("AI inventory: every agent, model, tool, policy rule, MCP server and channel")
    .option("--json", "JSON output (with digest)")
    .option("--csv", "one CSV row per agent")
    .option("--host", "include this machine's host name")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  kurahi inventory",
        "  kurahi inventory export -o inventory.json      # signed with the gateway key",
        "  kurahi inventory export --csv -o inventory.csv",
        "  kurahi inventory verify inventory.json",
        "",
        "Never included: secrets, environment values, headers, command arguments, prompts, memory.",
        `Docs: ${formatDocsLink("/inventory")}`,
      ].join("\n"),
    )
    .action(async (opts) => {
      await runInventoryShow(opts);
    });

  cmd
    .command("export")
    .description("Write the inventory to a file (signed JSON by default, or CSV)")
    .option("-o, --output <file>", "output file, or - for stdout")
    .option("--csv", "CSV instead of signed JSON")
    .option("--no-sign", "do not sign the JSON")
    .option("--host", "include this machine's host name")
    .action(async (opts) => {
      await runInventoryExport(opts);
    });

  cmd
    .command("verify")
    .description("Check an exported inventory's digest and signature (exit 1 on failure)")
    .argument("<file>", "inventory JSON")
    .option("--json", "JSON output")
    .action(async (file: string, opts) => {
      await runInventoryVerify(file, opts);
    });
}
