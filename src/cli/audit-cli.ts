// `kolo audit …` — hash-chained audit log (KoLo 2.0, M2b).
import type { Command } from "commander";
import { resolveAuditDir } from "../audit/audit-log.js";
import { formatAuditEntry, tailAudit, verifyAuditChain } from "../audit/verify.js";
import { defaultRuntime } from "../runtime.js";

export function registerAuditCli(program: Command) {
  const cmd = program.command("audit").description("Append-only hash-chained audit log");

  cmd
    .command("verify")
    .description("Re-walk the hash chain and report the first break (exit 1 on a break)")
    .option("--month <YYYY-MM>", "verify one month only")
    .option("--json", "JSON output")
    .action((opts: { month?: string; json?: boolean }) => {
      if (opts.month && !/^\d{4}-\d{2}$/.test(opts.month)) {
        defaultRuntime.error("kolo audit: --month must be YYYY-MM");
        defaultRuntime.exit(2);
      }
      const dir = resolveAuditDir();
      const result = verifyAuditChain(dir, { month: opts.month });
      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ dir, ...result }, null, 2));
      } else if (result.ok) {
        defaultRuntime.log(
          `audit chain ok: ${result.entries} entr${result.entries === 1 ? "y" : "ies"} in ${result.months.length} month file(s), last seq ${result.lastSeq} (${dir})`,
        );
      } else {
        const b = result.firstBreak!;
        defaultRuntime.log(
          `audit chain BROKEN at ${b.file}${b.line ? `:${b.line}` : ""}${b.seq !== undefined ? ` (seq ${b.seq})` : ""}: ${b.reason}`,
        );
        defaultRuntime.log(
          `  ${result.entries} entr${result.entries === 1 ? "y" : "ies"} verified before the break`,
        );
      }
      if (!result.ok) {
        defaultRuntime.exit(1);
      }
    });

  cmd
    .command("tail")
    .description("Print the last entries (secret values redacted)")
    .option("-n, --lines <n>", "number of entries", "50")
    .option("--json", "JSON lines output")
    .action((opts: { lines?: string; json?: boolean }) => {
      const n = Math.max(1, Math.min(10_000, Number.parseInt(opts.lines ?? "50", 10) || 50));
      for (const e of tailAudit(resolveAuditDir(), n)) {
        defaultRuntime.log(opts.json ? JSON.stringify(e) : formatAuditEntry(e));
      }
    });
}
