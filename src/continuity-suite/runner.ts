// Continuity runner (KoLo 2.0, M11b): one resident, one or more disruptions, two signed
// manifests and two probe snapshots per disruption, scored into a report.
//
// Two modes:
//   throwaway  the runner owns a fresh gateway (fake provider, seeded resident) and can stop,
//              restart and move it; this is what CI runs.
//   attached   the runner talks to a gateway someone else operates, through the public API
//              only; model swap and restart go through config.patch / config.apply, close
//              through sessions.reset, and a state-dir move is not possible.
import fs from "node:fs";
import path from "node:path";
import { ProbeClient, waitFor } from "./client.js";
import {
  FAKE_PROFILES,
  type FakeProfile,
  fakeModelRef,
  startFakeProvider,
} from "./fake-provider.js";
import {
  fetchManifest,
  jobSessionKey,
  probeSessionKey,
  startUnfinishedJob,
  takeSnapshot,
} from "./probes.js";
import { buildReport } from "./report.js";
import { scoreRun } from "./scorer.js";
import { SEED_FACTS } from "./seed.js";
import { ThrowawayGateway } from "./throwaway.js";
import {
  type ContinuityReport,
  type ContinuityRun,
  type Disruption,
  DISRUPTIONS,
  type DisruptionOutcome,
  type FactProbe,
} from "./types.js";

const SLOW_JOB_MS = 15_000;
const JOB_SETTLE_MS = 45_000;
const RESTART_TIMEOUT_MS = 90_000;

export type RunnerLog = (line: string) => void;

export type ThrowawayRunOptions = {
  mode: "throwaway";
  home: string;
  port?: number;
  entry?: string;
  resident?: string;
  disruptions: Disruption[];
  log?: RunnerLog;
  /** Keep the state dir after the run (default: removed). */
  keep?: boolean;
};

export type AttachedRunOptions = {
  mode: "attached";
  baseUrl: string;
  token: string;
  resident: string;
  disruptions: Disruption[];
  facts?: FactProbe[];
  /** Model ref (provider/model) to swap to; without it the model-swap disruption is skipped. */
  swapTo?: string;
  /** Run the chat probe (needs a provider the resident can answer with). Default: off. */
  chat?: boolean;
  log?: RunnerLog;
};

export type RunOptions = ThrowawayRunOptions | AttachedRunOptions;

export function parseDisruptions(raw: string | undefined): Disruption[] {
  const value = (raw ?? "all").trim();
  if (value === "all") {
    return [...DISRUPTIONS];
  }
  const parts = value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const bad = parts.filter((p) => !(DISRUPTIONS as readonly string[]).includes(p));
  if (bad.length) {
    throw new Error(
      `unknown disruption: ${bad.join(", ")} (choose from ${DISRUPTIONS.join(", ")}, all)`,
    );
  }
  return [...new Set(parts)] as Disruption[];
}

/** Strings that must never appear in a public response or in the report. */
export function scanForLeaks(
  texts: Array<{ where: string; text: string }>,
  secrets: string[],
): { scanned: number; leaked: boolean; where: string[] } {
  const needles = [
    ...secrets.filter((s) => s.length >= 8),
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN OPENSSH PRIVATE KEY-----",
  ];
  const where: string[] = [];
  for (const { where: w, text } of texts) {
    for (const needle of needles) {
      if (text.includes(needle)) {
        where.push(`${w}: ${needle.startsWith("-----") ? needle : "owner credential"}`);
      }
    }
  }
  return { scanned: texts.length, leaked: where.length > 0, where: [...new Set(where)] };
}

/** `<home>-moved`, keeping a `.kolo-test` suffix where the throwaway guard needs it. */
export function movedHomeOf(home: string): string {
  const resolved = path.resolve(home);
  return resolved.endsWith(".kolo-test")
    ? `${resolved.slice(0, -".kolo-test".length)}-moved.kolo-test`
    : `${resolved}-moved`;
}

type Driver = {
  swapModel: (outcome: DisruptionOutcome) => Promise<void>;
  restart: (outcome: DisruptionOutcome) => Promise<void>;
  move: ((outcome: DisruptionOutcome) => Promise<void>) | null;
  closeSession: (outcome: DisruptionOutcome) => Promise<void>;
};

async function runDisruption(params: {
  client: ProbeClient;
  resident: string;
  disruption: Disruption;
  facts: FactProbe[];
  chat: boolean;
  expectedMarker?: string;
  driver: Driver;
  log: RunnerLog;
}): Promise<ContinuityRun> {
  const { client, resident, disruption, facts, driver, log } = params;
  log(`${disruption}: probing before`);
  const beforeProbes = await takeSnapshot(client, resident, { facts, chat: params.chat });
  const beforeManifest = await fetchManifest(client, resident);
  const outcome: DisruptionOutcome = {
    disruption,
    applied: false,
    detail: "",
    startedAt: new Date().toISOString(),
    endedAt: "",
    expectedMarker: params.expectedMarker,
  };
  let unfinished: Awaited<ReturnType<typeof startUnfinishedJob>> | undefined;
  if (params.chat) {
    log(`${disruption}: starting a job that will still be running`);
    unfinished = await startUnfinishedJob(client, resident, { slowMs: SLOW_JOB_MS });
    outcome.unfinishedJobId = unfinished.jobId;
  }
  try {
    log(`${disruption}: applying`);
    switch (disruption) {
      case "model-swap":
        await driver.swapModel(outcome);
        break;
      case "restart":
        await driver.restart(outcome);
        break;
      case "move":
        if (!driver.move) {
          throw new Error("move is not possible in attached mode");
        }
        await driver.move(outcome);
        break;
      case "close":
        outcome.closedSessionKey = probeSessionKey(resident);
        await driver.closeSession(outcome);
        break;
    }
  } catch (err) {
    outcome.applied = false;
    outcome.detail = `failed: ${String(err)}`;
  }
  outcome.endedAt = new Date().toISOString();
  if (unfinished) {
    const jobId = unfinished.jobId;
    log(`${disruption}: waiting for job ${jobId.slice(0, 8)} to settle`);
    await waitFor(
      async () => {
        const res = await client.get<{ job?: { status: string } }>(
          `/api/jobs/${encodeURIComponent(jobId)}`,
        );
        const status = res.body.job?.status;
        return status && !["queued", "running"].includes(status)
          ? status
          : res.status === 404
            ? "missing"
            : false;
      },
      { timeoutMs: JOB_SETTLE_MS, intervalMs: 2000, what: `job ${jobId} to settle` },
    ).catch((err) => log(`${disruption}: ${String(err)}`));
    unfinished.abort();
    await unfinished.done;
  }
  log(`${disruption}: probing after`);
  const afterProbes = await takeSnapshot(client, resident, {
    facts,
    chat: params.chat,
    anchorSeq: beforeProbes.audit.lastSeq || undefined,
  });
  const afterManifest = await fetchManifest(client, resident);
  const recorded = [
    ...client.recorded,
    { where: "manifest before", text: JSON.stringify(beforeManifest) },
    { where: "manifest after", text: JSON.stringify(afterManifest) },
  ];
  const leakScan = scanForLeaks(recorded, [client.token]);
  const run: ContinuityRun = {
    disruption,
    before: { manifest: beforeManifest, probes: beforeProbes },
    outcome,
    after: { manifest: afterManifest, probes: afterProbes },
    invariants: [],
    leakScan,
  };
  run.invariants = scoreRun({
    disruption,
    before: run.before,
    after: run.after,
    outcome,
    leakScan,
    expectedMarker: params.expectedMarker,
  });
  client.recorded.length = 0;
  const failed = run.invariants.filter((i) => i.status === "fail").map((i) => i.id);
  log(`${disruption}: ${failed.length ? `FAIL ${failed.join(" ")}` : "pass"}`);
  return run;
}

async function throwawayDriver(
  gw: ThrowawayGateway,
  client: ProbeClient,
): Promise<{ driver: Driver; profile: () => FakeProfile }> {
  let profile: FakeProfile = "alpha";
  const driver: Driver = {
    swapModel: async (outcome) => {
      const next: FakeProfile = FAKE_PROFILES.find((p) => p !== profile) ?? "beta";
      outcome.modelBefore = fakeModelRef(profile);
      outcome.modelAfter = gw.setProfile(next);
      profile = next;
      // The gateway reads agent defaults per run; give the config watcher a moment anyway.
      await new Promise((r) => setTimeout(r, 1500));
      outcome.applied = true;
      outcome.detail = `model profile swapped ${outcome.modelBefore} -> ${outcome.modelAfter} in kolo.json`;
    },
    restart: async (outcome) => {
      const pidBefore = gw.pid;
      const stop = await gw.stop();
      const { pid, bootMs } = await gw.start();
      outcome.applied = pid !== pidBefore;
      outcome.detail = `gateway process ${pidBefore} stopped (${stop}) and started again as ${pid} in ${bootMs} ms`;
    },
    move: async (outcome) => {
      const from = gw.home;
      await gw.move(movedHomeOf(from));
      const health = await client.get<{ readiness?: string }>("/health");
      outcome.applied = health.status === 200;
      outcome.detail = `state dir moved from ${path.basename(from)} to ${path.basename(gw.home)} and the gateway started from the new KOLO_HOME`;
    },
    closeSession: async (outcome) => {
      const key = outcome.closedSessionKey ?? probeSessionKey(gw.agentId);
      const res = await client.ws("sessions.reset", { key });
      outcome.applied = res.ok;
      outcome.detail = res.ok
        ? `session ${key} closed (sessions.reset)`
        : `sessions.reset failed: ${JSON.stringify(res.error).slice(0, 200)}`;
    },
  };
  return { driver, profile: () => profile };
}

function attachedDriver(client: ProbeClient, opts: AttachedRunOptions): Driver {
  const readConfig = async () => {
    const res = await client.ws("config.get");
    if (!res.ok) {
      throw new Error(`config.get failed: ${JSON.stringify(res.error).slice(0, 200)}`);
    }
    const payload = res.payload as {
      raw?: string;
      hash?: string;
      config?: Record<string, unknown>;
    };
    return { raw: payload.raw ?? "", hash: payload.hash, config: payload.config ?? {} };
  };
  return {
    swapModel: async (outcome) => {
      if (!opts.swapTo) {
        throw new Error("no --swap-to model given");
      }
      const current = await readConfig();
      const agents = (current.config.agents ?? {}) as {
        defaults?: { model?: { primary?: string } | string };
      };
      const model = agents.defaults?.model;
      outcome.modelBefore = typeof model === "string" ? model : model?.primary;
      const res = await client.ws("config.patch", {
        raw: JSON.stringify({ agents: { defaults: { model: { primary: opts.swapTo } } } }),
        baseHash: current.hash,
        note: "continuity suite: model profile swap",
      });
      if (!res.ok) {
        throw new Error(`config.patch failed: ${JSON.stringify(res.error).slice(0, 200)}`);
      }
      outcome.modelAfter = opts.swapTo;
      await waitForRestart(client, RESTART_TIMEOUT_MS);
      outcome.applied = true;
      outcome.detail = `model profile swapped ${outcome.modelBefore ?? "?"} -> ${opts.swapTo} through config.patch (the gateway restarted itself in-process)`;
    },
    restart: async (outcome) => {
      const current = await readConfig();
      const res = await client.ws("config.apply", {
        raw: current.raw,
        baseHash: current.hash,
        restartDelayMs: 0,
        note: "continuity suite: restart",
      });
      if (!res.ok) {
        throw new Error(`config.apply failed: ${JSON.stringify(res.error).slice(0, 200)}`);
      }
      await waitForRestart(client, RESTART_TIMEOUT_MS);
      outcome.applied = true;
      outcome.detail = "gateway restarted itself through config.apply (supervisor API)";
    },
    move: null,
    closeSession: async (outcome) => {
      const key = outcome.closedSessionKey ?? probeSessionKey(opts.resident);
      const res = await client.ws("sessions.reset", { key });
      outcome.applied = res.ok;
      outcome.detail = res.ok
        ? `session ${key} closed (sessions.reset)`
        : `sessions.reset failed: ${JSON.stringify(res.error).slice(0, 200)}`;
    },
  };
}

/** An in-process restart keeps the pid; the uptime drops. A supervisor restart changes the pid. */
async function waitForRestart(client: ProbeClient, timeoutMs: number): Promise<void> {
  const start = await client.get<{ pid?: number; uptime?: number }>("/health");
  const pid = start.body.pid;
  const uptime = start.body.uptime ?? 0;
  const t0 = Date.now();
  await waitFor(
    async () => {
      const res = await client.get<{ pid?: number; uptime?: number; readiness?: string }>(
        "/health",
      );
      if (res.status !== 200) {
        return false;
      }
      const elapsed = (Date.now() - t0) / 1000;
      const restarted = res.body.pid !== pid || (res.body.uptime ?? 0) < uptime + elapsed - 1;
      return restarted &&
        ["gateway_ready", "consciousness_ready", "degraded"].includes(res.body.readiness ?? "")
        ? res.body
        : false;
    },
    { timeoutMs, intervalMs: 1500, what: "gateway restart" },
  );
}

export async function runContinuity(opts: RunOptions): Promise<ContinuityReport> {
  const log = opts.log ?? (() => {});
  if (opts.mode === "throwaway") {
    const provider = await startFakeProvider();
    let gw: ThrowawayGateway | undefined;
    try {
      gw = await ThrowawayGateway.create({
        home: opts.home,
        port: opts.port,
        entry: opts.entry,
        providerBaseUrl: provider.baseUrl,
        agentId: opts.resident,
      });
      const { pid, bootMs } = await gw.start();
      log(
        `throwaway gateway ${pid} on ${gw.baseUrl} (${bootMs} ms), resident ${gw.agentId}, home ${gw.home}`,
      );
      const client = new ProbeClient(gw.baseUrl, gw.token);
      const { driver } = await throwawayDriver(gw, client);
      const runs: ContinuityRun[] = [];
      for (const disruption of opts.disruptions) {
        runs.push(
          await runDisruption({
            client,
            resident: gw.agentId,
            disruption,
            facts: gw.facts,
            chat: true,
            expectedMarker: gw.marker,
            driver,
            log,
          }),
        );
      }
      const report = buildReport({
        resident: gw.agentId,
        gateway: { baseUrl: gw.baseUrl, mode: "throwaway" },
        runs,
      });
      return report;
    } finally {
      if (gw) {
        if (opts.keep) {
          await gw.stop().catch(() => {});
        } else {
          await gw.destroy().catch(() => {});
          fs.rmSync(movedHomeOf(opts.home), { recursive: true, force: true });
        }
      }
      await provider.close();
    }
  }

  const client = new ProbeClient(opts.baseUrl, opts.token);
  const health = await client.get<{ readiness?: string }>("/health");
  if (health.status !== 200) {
    throw new Error(`gateway ${opts.baseUrl}: /health HTTP ${health.status}`);
  }
  const driver = attachedDriver(client, opts);
  const skipped: ContinuityReport["skipped"] = [];
  const runs: ContinuityRun[] = [];
  for (const disruption of opts.disruptions) {
    if (disruption === "move") {
      skipped.push({
        disruption,
        reason:
          "a state-dir move needs control of the gateway process; run in throwaway mode or move the state dir yourself and run `restart`",
      });
      continue;
    }
    if (disruption === "model-swap" && !opts.swapTo) {
      skipped.push({ disruption, reason: "no --swap-to <provider/model> given" });
      continue;
    }
    runs.push(
      await runDisruption({
        client,
        resident: opts.resident,
        disruption,
        facts: opts.facts ?? [],
        chat: opts.chat ?? false,
        driver,
        log,
      }),
    );
  }
  return buildReport({
    resident: opts.resident,
    gateway: { baseUrl: opts.baseUrl, mode: "attached" },
    runs,
    skipped,
  });
}

export { SEED_FACTS, jobSessionKey };
