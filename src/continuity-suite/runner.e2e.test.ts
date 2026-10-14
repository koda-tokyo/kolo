// End-to-end: a throwaway gateway (built dist/entry.js) with the fake provider and a seeded
// resident, one model swap and one restart, scored and verified. `pnpm continuity:check` runs
// the same path through the CLI for every disruption; this test keeps the library path honest.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { verifyReport } from "./report.js";
import { runContinuity } from "./runner.js";
import { resolveGatewayEntry } from "./throwaway.js";

const hasDist = (() => {
  try {
    resolveGatewayEntry();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasDist)("continuity suite end to end", () => {
  test("model swap and restart keep the resident the same", { timeout: 240_000 }, async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cont-e2e-"));
    const lines: string[] = [];
    const report = await runContinuity({
      mode: "throwaway",
      home,
      disruptions: ["model-swap", "restart"],
      log: (l) => lines.push(l),
    });
    expect(report.gateway.mode).toBe("throwaway");
    expect(report.runs.map((r) => r.disruption)).toEqual(["model-swap", "restart"]);
    for (const run of report.runs) {
      const failed = run.invariants.filter((i) => i.status === "fail");
      expect(
        failed,
        `${run.disruption}: ${failed.map((f) => `${f.id} ${f.detail}`).join("; ")}`,
      ).toEqual([]);
      expect(run.before.manifest.signer.keyId).toBe(run.after.manifest.signer.keyId);
      expect(run.outcome.applied).toBe(true);
      expect(run.outcome.unfinishedJobId).toBeTruthy();
    }
    const swap = report.runs[0];
    expect(swap.before.probes.chat?.model).toBe("alpha");
    expect(swap.after.probes.chat?.model).toBe("beta");
    expect(swap.after.probes.chat?.marker).toBe(swap.before.probes.chat?.marker);
    const restart = report.runs[1];
    expect(restart.after.probes.health.pid).not.toBe(restart.before.probes.health.pid);
    const job = restart.after.probes.jobs.find((j) => j.id === restart.outcome.unfinishedJobId);
    expect(job?.status).toBe("failed");
    expect(job?.error).toContain("interrupted");
    expect(report.summary.verdict).toBe("PASS");
    expect(verifyReport(report).ok).toBe(true);
    expect(JSON.stringify(report)).not.toContain("PRIVATE KEY");
    expect(fs.existsSync(home)).toBe(false);
  });
});
