import type {
  ContinuityManifest,
  Disruption,
  DisruptionOutcome,
  InvariantResult,
  ProbeSnapshot,
} from "./types.js";
// Invariant scorer (KoLo 2.0, M11b). Pure: given the two manifests, the two probe snapshots, the
// disruption outcome and the leak scan, it decides pass/fail/skip per invariant. The ids match
// docs/continuity-spec.md; `kolo continuity verify` re-runs this on a saved report and expects
// the same statuses, so nothing here may depend on the clock or the environment.
import { diffKind, entriesByKind, verifyManifest } from "./manifest.js";
import { JOB_SESSION_SUFFIX, PROBE_SESSION_SUFFIX } from "./probes.js";

export const RECALL_THRESHOLD = 0.8;
const TERMINAL = new Set(["succeeded", "failed", "cancelled", "loop_stopped", "denied"]);
const INTERRUPTING: ReadonlySet<Disruption> = new Set<Disruption>(["restart", "move"]);

export type ScoreInput = {
  disruption: Disruption;
  before: { manifest: ContinuityManifest; probes: ProbeSnapshot };
  after: { manifest: ContinuityManifest; probes: ProbeSnapshot };
  outcome: DisruptionOutcome;
  leakScan: { scanned: number; leaked: boolean; where: string[] };
  /** Identity marker the resident must keep answering with, when a deterministic provider is used. */
  expectedMarker?: string;
  recallThreshold?: number;
};

export const INVARIANTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "C0", name: "disruption applied" },
  { id: "C1", name: "identity files unchanged" },
  { id: "C2", name: "memory retained and recalled" },
  { id: "C3", name: "role and permissions unchanged" },
  { id: "C4", name: "unfinished work resumes or is reported" },
  { id: "C5", name: "audit chain continuous" },
  { id: "C6", name: "no secret leaves the state dir" },
  { id: "C7", name: "same signer before and after" },
  { id: "C8", name: "sessions and transcripts retained" },
  { id: "C9", name: "resident answers as itself" },
];

function result(
  id: string,
  status: InvariantResult["status"],
  detail: string,
  evidence?: Record<string, unknown>,
): InvariantResult {
  const name = INVARIANTS.find((i) => i.id === id)?.name ?? id;
  return { id, name, status, detail, ...(evidence ? { evidence } : {}) };
}

function hitRate(snapshot: ProbeSnapshot): number | null {
  if (snapshot.recall.length === 0) {
    return null;
  }
  return snapshot.recall.filter((r) => r.hit).length / snapshot.recall.length;
}

export function scoreRun(input: ScoreInput): InvariantResult[] {
  const { before, after, outcome, disruption } = input;
  const expectedMarker = input.expectedMarker ?? outcome.expectedMarker;
  const out: InvariantResult[] = [];
  const threshold = input.recallThreshold ?? RECALL_THRESHOLD;

  // C0 — the disruption really happened (otherwise the comparison proves nothing).
  out.push(
    outcome.applied
      ? result("C0", "pass", outcome.detail)
      : result("C0", "fail", `disruption not applied: ${outcome.detail}`),
  );

  // C1 — identity files byte-identical.
  const identity = diffKind(before.manifest, after.manifest, "identity");
  if (identity.same.length + identity.changed.length + identity.removed.length === 0) {
    out.push(result("C1", "skip", "the resident has no identity files to compare"));
  } else if (identity.changed.length || identity.removed.length || identity.added.length) {
    out.push(
      result(
        "C1",
        "fail",
        "identity files differ after the disruption",
        identity as unknown as Record<string, unknown>,
      ),
    );
  } else {
    out.push(
      result(
        "C1",
        "pass",
        `${identity.same.length} identity file(s) unchanged (${identity.same.join(", ")})`,
      ),
    );
  }

  // C2 — memory files unchanged and seeded facts still recalled.
  const memory = diffKind(before.manifest, after.manifest, "memory");
  const rateBefore = hitRate(before.probes);
  const rateAfter = hitRate(after.probes);
  if (memory.changed.length || memory.removed.length) {
    out.push(
      result(
        "C2",
        "fail",
        "memory files changed or disappeared",
        memory as unknown as Record<string, unknown>,
      ),
    );
  } else if (rateBefore === null) {
    out.push(
      result(
        "C2",
        memory.same.length ? "pass" : "skip",
        memory.same.length
          ? `${memory.same.length} memory file(s) unchanged; no recall probes were given, so recall itself is not measured`
          : "no memory files and no recall probes",
      ),
    );
  } else if (rateBefore < threshold) {
    out.push(
      result(
        "C2",
        "skip",
        `baseline recall ${fmt(rateBefore)} is below the threshold ${fmt(threshold)}; nothing to preserve`,
        { rateBefore, rateAfter },
      ),
    );
  } else if ((rateAfter ?? 0) < threshold) {
    out.push(
      result(
        "C2",
        "fail",
        `recall dropped from ${fmt(rateBefore)} to ${fmt(rateAfter ?? 0)} (threshold ${fmt(threshold)})`,
        {
          rateBefore,
          rateAfter,
          missed: after.probes.recall.filter((r) => !r.hit).map((r) => r.query),
        },
      ),
    );
  } else {
    out.push(
      result(
        "C2",
        "pass",
        `${memory.same.length} memory file(s) unchanged; recall ${fmt(rateAfter ?? 0)} of ${after.probes.recall.length} facts (threshold ${fmt(threshold)})`,
        { rateBefore, rateAfter },
      ),
    );
  }

  // C3 — role (config minus model), paired devices and the owner credential gate.
  const role = diffKind(before.manifest, after.manifest, "role");
  const devicesSame =
    JSON.stringify(before.probes.devices) === JSON.stringify(after.probes.devices);
  if (role.changed.length || role.removed.length) {
    out.push(
      result(
        "C3",
        "fail",
        "the resident's role (agent config, tool policy) changed",
        role as unknown as Record<string, unknown>,
      ),
    );
  } else if (!devicesSame) {
    out.push(
      result("C3", "fail", "the set of paired devices or their scopes changed", {
        before: before.probes.devices,
        after: after.probes.devices,
      }),
    );
  } else if (!after.probes.authEnforced) {
    out.push(result("C3", "fail", "a wrong owner token was not rejected after the disruption"));
  } else {
    out.push(
      result(
        "C3",
        "pass",
        `role unchanged, ${after.probes.devices.length} paired device(s) unchanged, wrong token still rejected`,
      ),
    );
  }

  // C4 — the job that was running when the disruption hit.
  const jobId = outcome.unfinishedJobId;
  if (!jobId) {
    out.push(result("C4", "skip", "no job was running when the disruption hit"));
  } else {
    const job = after.probes.jobs.find((j) => j.id === jobId);
    if (!job) {
      out.push(result("C4", "fail", `job ${jobId} is no longer listed after the disruption`));
    } else if (!TERMINAL.has(job.status)) {
      out.push(
        result(
          "C4",
          "fail",
          `job ${jobId} is still "${job.status}" after the disruption; it can neither resume nor be reported`,
          { job },
        ),
      );
    } else if (INTERRUPTING.has(disruption) && job.status === "succeeded") {
      out.push(
        result("C4", "fail", `job ${jobId} claims success although the process that ran it ended`, {
          job,
        }),
      );
    } else if (INTERRUPTING.has(disruption) && !job.error) {
      out.push(
        result("C4", "fail", `job ${jobId} ended as "${job.status}" without a reason`, { job }),
      );
    } else {
      out.push(
        result(
          "C4",
          "pass",
          INTERRUPTING.has(disruption)
            ? `job ${jobId} reported as "${job.status}": ${job.error}`
            : `job ${jobId} finished as "${job.status}" across the disruption`,
          { job },
        ),
      );
    }
  }

  // C5 — audit chain verifies after, grew monotonically, and the old head is an ancestor.
  const a0 = before.probes.audit;
  const a1 = after.probes.audit;
  if (!a1.ok) {
    out.push(
      result("C5", "fail", "the audit chain does not verify after the disruption", { after: a1 }),
    );
  } else if (a1.lastSeq < a0.lastSeq) {
    out.push(result("C5", "fail", `audit chain shrank from seq ${a0.lastSeq} to ${a1.lastSeq}`));
  } else if (a0.lastSeq > 0 && a0.headHash && after.probes.auditAnchor?.hash !== a0.headHash) {
    out.push(
      result(
        "C5",
        "fail",
        `the audit head before the disruption (seq ${a0.lastSeq}) is not an ancestor of the head after`,
        { before: a0, anchor: after.probes.auditAnchor ?? null },
      ),
    );
  } else {
    out.push(
      result(
        "C5",
        "pass",
        `audit chain verified: seq ${a0.lastSeq} -> ${a1.lastSeq}, previous head anchored`,
      ),
    );
  }

  // C6 — secrets.
  const manifestLeak = [before.manifest, after.manifest].some((m) =>
    m.entries.some((e) => e.name.startsWith("secrets/") || e.name.includes("gateway.token")),
  );
  if (input.leakScan.leaked || manifestLeak) {
    out.push(
      result("C6", "fail", "a secret was found in a public response, a manifest or the report", {
        where: input.leakScan.where,
      }),
    );
  } else {
    out.push(
      result(
        "C6",
        "pass",
        `${input.leakScan.scanned} response(s) and both manifests scanned; no credential or private key found`,
      ),
    );
  }

  // C7 — both manifests verify and were signed by the same key.
  const v0 = verifyManifest(before.manifest);
  const v1 = verifyManifest(after.manifest);
  if (!v0.ok || !v1.ok) {
    out.push(
      result(
        "C7",
        "fail",
        `manifest verification failed (${v0.ok ? "after" : "before"}: ${(v0.ok ? v1 : v0).reason ?? "unknown"})`,
      ),
    );
  } else if (before.manifest.signer.keyId !== after.manifest.signer.keyId) {
    out.push(
      result("C7", "fail", "the two manifests were signed by different keys", {
        before: before.manifest.signer.keyId,
        after: after.manifest.signer.keyId,
      }),
    );
  } else {
    out.push(
      result(
        "C7",
        "pass",
        `both manifests verify; signer ${before.manifest.signer.keyId.slice(0, 12)}`,
      ),
    );
  }

  // C8 — every session key survives and every transcript known before is still there. Sessions
  // the suite itself drives (probe, job, the one it closed) may advance and so may their
  // transcripts; any other session or transcript moving is a finding.
  const sessions = diffKind(before.manifest, after.manifest, "session");
  const transcripts = diffKind(before.manifest, after.manifest, "transcript");
  const closed = outcome.closedSessionKey;
  const driven = (key: string) =>
    key === closed ||
    key.endsWith(`:${PROBE_SESSION_SUFFIX}`) ||
    key.endsWith(`:${JOB_SESSION_SUFFIX}`);
  const sessionOfTranscript = new Map<string, string>();
  for (const [key, entry] of entriesByKind(before.manifest, "session")) {
    const id = (entry.value as { sessionId?: string } | undefined)?.sessionId;
    if (id) {
      sessionOfTranscript.set(`${id}.jsonl`, key);
    }
  }
  const unexplainedSessions = sessions.changed.filter((k) => !driven(k));
  const unexplainedTranscripts = transcripts.changed.filter((name) => {
    const key = sessionOfTranscript.get(name);
    return !key || !driven(key);
  });
  if (sessions.removed.length) {
    out.push(result("C8", "fail", `session(s) disappeared: ${sessions.removed.join(", ")}`));
  } else if (transcripts.removed.length) {
    out.push(
      result(
        "C8",
        "fail",
        `transcript(s) known before the disruption are missing: ${transcripts.removed.join(", ")}`,
      ),
    );
  } else if (unexplainedTranscripts.length) {
    out.push(
      result(
        "C8",
        "fail",
        `transcript(s) changed without a probe touching their session: ${unexplainedTranscripts.join(", ")}`,
      ),
    );
  } else if (disruption === "close" && closed && !sessions.changed.includes(closed)) {
    out.push(result("C8", "fail", `session ${closed} was not closed (same session id)`));
  } else if (unexplainedSessions.length) {
    out.push(
      result(
        "C8",
        "fail",
        `session(s) changed without a probe touching them: ${unexplainedSessions.join(", ")}`,
      ),
    );
  } else {
    const kept = transcripts.same.length + transcripts.changed.length;
    out.push(
      result(
        "C8",
        "pass",
        `${sessions.same.length + sessions.changed.length} session(s) and ${kept} transcript(s) retained${closed ? `; ${closed} closed, its transcript kept` : ""}`,
      ),
    );
  }

  // C9 — the resident still answers, as itself, and (model swap) with the new profile.
  const c0 = before.probes.chat;
  const c1 = after.probes.chat;
  if (!c0 || !c1) {
    out.push(
      result("C9", "skip", "no chat probe (attached mode without a deterministic provider)"),
    );
  } else if (!c1.ok) {
    out.push(
      result(
        "C9",
        "fail",
        `the resident did not answer after the disruption: ${c1.error ?? "unknown"}`,
      ),
    );
  } else if (expectedMarker && c1.marker !== expectedMarker) {
    out.push(
      result(
        "C9",
        "fail",
        `identity marker ${expectedMarker} missing from the answer (got ${c1.marker ?? "none"})`,
        { text: c1.text },
      ),
    );
  } else if (!expectedMarker && c0.ok && c0.marker && c0.marker !== c1.marker) {
    out.push(
      result("C9", "fail", `identity marker changed from ${c0.marker} to ${c1.marker ?? "none"}`),
    );
  } else if (
    disruption === "model-swap" &&
    outcome.modelAfter &&
    c1.model !== outcome.modelAfter.split("/").pop()
  ) {
    out.push(
      result(
        "C9",
        "fail",
        `answer still comes from ${c1.model ?? "?"}; expected profile ${outcome.modelAfter}`,
        { text: c1.text },
      ),
    );
  } else if (disruption === "model-swap" && c0.ok && c0.model === c1.model) {
    out.push(result("C9", "fail", `model profile did not change (${c1.model ?? "?"})`));
  } else {
    out.push(
      result(
        "C9",
        "pass",
        disruption === "model-swap"
          ? `answered as itself from profile ${c1.model ?? "?"} (was ${c0.model ?? "?"})`
          : `answered as itself (marker ${c1.marker ?? "n/a"})`,
      ),
    );
  }

  return out;
}

function fmt(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function summarize(results: InvariantResult[]): {
  pass: number;
  fail: number;
  skip: number;
} {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
}
