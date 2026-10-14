// Evidence recorder (KoLo 2.0, M12a): one per job. Appends an ordered, hash-chained event log
// under <KOLO_HOME>/evidence/<jobId>/events.jsonl while the job runs and signs a manifest when it
// ends. Everything written is redacted with the audit patterns and bounded by `evidence.*`; raw
// prompts and assistant text are digests unless `evidence.includePrompts` is on.
//
// Failures never reach the run: every write is wrapped, and a recorder that cannot write simply
// stops recording (the manifest then says how many events it holds).
import fs from "node:fs";
import path from "node:path";
import type { JobRecord } from "../agents/jobs.js";
import type { LoopLimits, LoopVerdict } from "../agents/loop-guard.js";
import type { AuditEntry } from "../audit/audit-log.js";
import type { KoLoConfig } from "../config/config.js";
import type { SigningKey } from "../continuity-suite/manifest.js";
import type { EvidenceEvent, EvidenceEventType, EvidenceUsage, EvidenceManifest } from "./types.js";
import { emitEvidenceSignal, subscribeEvidenceSignals, type EvidenceSignal } from "./bus.js";
import { pruneEvidence } from "./prune.js";
import { boundedText, boundedValue, digestOf, resultText } from "./redact.js";
import {
  EVENTS_FILE,
  EVIDENCE_GENESIS,
  EVIDENCE_VERSION,
  type EvidenceLimits,
  eventHash,
  fileEntryOf,
  MANIFEST_FILE,
  resolveEvidenceLimits,
  resolveEvidenceSigningKey,
  resolveJobEvidenceDir,
  signEvidenceManifest,
} from "./store.js";

export { emitEvidenceSignal };

export type RecorderOptions = {
  limits?: EvidenceLimits;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  key?: SigningKey;
  gatewayVersion?: string;
  /** Where write failures are reported (default: stderr, once). */
  onError?: (message: string) => void;
};

export type ModelTurnInput = {
  provider?: string;
  model?: string;
  profileId?: string;
  usage?: EvidenceUsage;
  stopReason?: string;
  text?: string;
  /** Reasoning of this turn; recorded only with `evidence.includeReasoning`. */
  reasoning?: string;
  errorMessage?: string;
};

export class EvidenceRecorder {
  readonly jobId: string;
  readonly dir: string;
  readonly limits: EvidenceLimits;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;
  private readonly key?: SigningKey;
  private readonly gatewayVersion?: string;
  private readonly onError: (message: string) => void;
  private readonly toolStarts = new Map<string, number>();
  private readonly unsubscribe: () => void;
  private seq = 0;
  private prev = EVIDENCE_GENESIS;
  private bytes = 0;
  private turns = 0;
  private truncated = false;
  private failed = false;
  private finished = false;
  private manifest: EvidenceManifest | null = null;
  private readonly job: Pick<JobRecord, "id" | "agent" | "sessionKey" | "kind" | "startedAt">;

  constructor(
    job: Pick<JobRecord, "id" | "agent" | "sessionKey" | "kind" | "startedAt">,
    opts: RecorderOptions = {},
  ) {
    this.job = job;
    this.jobId = job.id;
    this.env = opts.env ?? process.env;
    this.limits = opts.limits ?? resolveEvidenceLimits();
    this.now = opts.now ?? (() => new Date());
    this.key = opts.key;
    this.gatewayVersion = opts.gatewayVersion;
    let reported = false;
    this.onError =
      opts.onError ??
      ((message) => {
        if (!reported) {
          reported = true;
          process.stderr.write(`${message}\n`);
        }
      });
    this.dir = resolveJobEvidenceDir(job.id, this.env);
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch (err) {
      this.fail(`evidence: cannot create ${this.dir}: ${String(err)}`);
    }
    this.unsubscribe = subscribeEvidenceSignals(job.sessionKey, (signal) => this.onSignal(signal));
  }

  get eventCount(): number {
    return this.seq;
  }

  get root(): string {
    return this.prev;
  }

  get isTruncated(): boolean {
    return this.truncated;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get signedManifest(): EvidenceManifest | null {
    return this.manifest;
  }

  private fail(message: string): void {
    if (!this.failed) {
      this.failed = true;
      this.onError(message);
    }
  }

  /** Append one event; the only writer of the chain. Caps close the log with `truncated`. */
  append(type: EvidenceEventType, data: Record<string, unknown>): EvidenceEvent | null {
    if (this.failed || this.finished) {
      return null;
    }
    if (this.truncated) {
      return type === "job.end" ? this.write(type, data) : null;
    }
    if (
      type !== "job.end" &&
      (this.seq >= this.limits.maxEvents || this.bytes >= this.limits.maxBytesPerJob)
    ) {
      this.truncated = true;
      return this.write("truncated", {
        reason: this.seq >= this.limits.maxEvents ? "max_events" : "max_bytes",
        events: this.seq,
        bytes: this.bytes,
      });
    }
    return this.write(type, data);
  }

  private write(type: EvidenceEventType, data: Record<string, unknown>): EvidenceEvent | null {
    const base = { seq: this.seq + 1, ts: this.now().toISOString(), type, jobId: this.jobId, data };
    const hash = eventHash(this.prev, base);
    const event: EvidenceEvent = { ...base, prev: this.prev, hash };
    const line = `${JSON.stringify(event)}\n`;
    try {
      fs.appendFileSync(path.join(this.dir, EVENTS_FILE), line, { mode: 0o600 });
    } catch (err) {
      this.fail(`evidence: append failed for job ${this.jobId}: ${String(err)}`);
      return null;
    }
    this.seq = base.seq;
    this.prev = hash;
    this.bytes += Buffer.byteLength(line, "utf8");
    return event;
  }

  start(input: {
    prompt?: string;
    provider?: string;
    model?: string;
    runId?: string;
    workspaceDir?: string;
    parentJobId?: string;
  }): void {
    const prompt = input.prompt ?? "";
    const data: Record<string, unknown> = {
      agent: this.job.agent,
      sessionKey: this.job.sessionKey,
      kind: this.job.kind,
      startedAt: this.job.startedAt,
      runId: input.runId ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      workspaceDir: input.workspaceDir ?? null,
      parentJobId: input.parentJobId ?? null,
      promptDigest: digestOf(prompt),
      promptChars: prompt.length,
      includePrompts: this.limits.includePrompts,
      limits: {
        maxEvents: this.limits.maxEvents,
        maxEventBytes: this.limits.maxEventBytes,
        maxBytesPerJob: this.limits.maxBytesPerJob,
      },
    };
    if (this.limits.includePrompts) {
      const bounded = boundedText(prompt, this.limits.maxEventBytes);
      data.prompt = bounded.text;
      data.promptClipped = bounded.clipped;
    }
    this.append("job.start", data);
  }

  modelTurn(input: ModelTurnInput): void {
    this.turns += 1;
    const text = input.text ?? "";
    const data: Record<string, unknown> = {
      index: this.turns,
      provider: input.provider ?? null,
      model: input.model ?? null,
      profileId: input.profileId ?? null,
      usage: input.usage ?? null,
      stopReason: input.stopReason ?? null,
      textDigest: digestOf(text),
      textChars: text.length,
      error: input.errorMessage ? boundedText(input.errorMessage, 1024).text : null,
    };
    if (this.limits.includePrompts) {
      const bounded = boundedText(text, this.limits.maxEventBytes);
      data.text = bounded.text;
      data.textClipped = bounded.clipped;
    } else {
      // A short redacted excerpt so a reviewer can follow the run without the full text.
      const excerpt = boundedText(text, Math.min(512, this.limits.maxEventBytes));
      data.excerpt = excerpt.text;
      data.excerptClipped = excerpt.clipped;
    }
    const reasoning = input.reasoning?.trim() ?? "";
    if (this.limits.includeReasoning && reasoning) {
      // Digest of the raw text (so a reviewer holding it can match), text redacted and bounded.
      const bounded = boundedText(reasoning, this.limits.maxEventBytes);
      data.reasoningDigest = digestOf(reasoning);
      data.reasoningChars = reasoning.length;
      data.reasoning = bounded.text;
      data.reasoningClipped = bounded.clipped;
    }
    this.append("model.turn", data);
  }

  toolStart(input: { toolCallId: string; name: string; args: unknown; meta?: string }): void {
    this.toolStarts.set(input.toolCallId, Date.now());
    const bounded = boundedValue(input.args, this.limits.maxEventBytes);
    this.append("tool.call", {
      toolCallId: input.toolCallId,
      name: input.name,
      meta: input.meta ?? null,
      argsDigest: digestOf(input.args ?? null),
      args: bounded.value,
      argsClipped: bounded.clipped,
    });
  }

  toolEnd(input: {
    toolCallId: string;
    name: string;
    result: unknown;
    isError: boolean;
    error?: string;
  }): void {
    const startedAt = this.toolStarts.get(input.toolCallId);
    this.toolStarts.delete(input.toolCallId);
    const text = resultText(input.result);
    const bounded = boundedText(text, this.limits.maxEventBytes);
    this.append("tool.result", {
      toolCallId: input.toolCallId,
      name: input.name,
      isError: input.isError,
      error: input.error ? boundedText(input.error, 1024).text : null,
      durationMs: startedAt ? Math.max(0, Date.now() - startedAt) : null,
      resultDigest: digestOf(text),
      resultChars: text.length,
      result: bounded.text,
      resultClipped: bounded.clipped,
    });
  }

  loopStop(
    verdict: Extract<LoopVerdict, { stop: true }>,
    extra: { steps: number; limits: LoopLimits },
  ): void {
    this.append("loop_guard", {
      reason: verdict.reason,
      summary: boundedText(verdict.summary, 1024).text,
      steps: extra.steps,
      limits: extra.limits,
    });
  }

  /** Link an audit entry written for this job (its seq and hash, never its detail). */
  audit(
    entry: Pick<AuditEntry, "seq" | "hash" | "action" | "outcome" | "ts"> | null | undefined,
  ): void {
    if (!entry) {
      return;
    }
    this.append("audit", {
      seq: entry.seq,
      hash: entry.hash,
      action: entry.action,
      outcome: entry.outcome,
      ts: entry.ts,
    });
  }

  private onSignal(signal: EvidenceSignal): void {
    if (signal.kind === "permission") {
      this.append("permission", {
        tool: signal.tool,
        decision: signal.decision,
        class: signal.toolClass ?? null,
        target: signal.target ? boundedText(signal.target, 1024).text : null,
        rule: signal.rule ?? null,
        reason: signal.reason ? boundedText(signal.reason, 1024).text : null,
        auditSeq: signal.auditSeq ?? null,
      });
      return;
    }
    this.append("snapshot", {
      snapshotId: signal.snapshotId,
      tool: signal.tool,
      files: signal.files.map((f) => ({
        path: f.path,
        existed: f.existed,
        hash: f.hash ?? null,
        size: f.size,
        skipped: f.skipped ?? null,
      })),
    });
  }

  /**
   * Close the log with the job's outcome and sign the manifest. Idempotent; a second call is a
   * no-op. Returns the manifest, or null when the log could not be written or signed.
   */
  finish(
    job: Pick<JobRecord, "status" | "steps" | "toolCalls" | "endedAt" | "error" | "summary">,
  ): EvidenceManifest | null {
    if (this.finished) {
      return this.manifest;
    }
    this.unsubscribe();
    const endedAt = job.endedAt ?? this.now().toISOString();
    const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(this.job.startedAt));
    this.append("job.end", {
      status: job.status,
      steps: job.steps,
      toolCalls: job.toolCalls,
      endedAt,
      durationMs: Number.isFinite(durationMs) ? durationMs : null,
      error: job.error ? boundedText(job.error, 1024).text : null,
      summary: job.summary ? boundedText(job.summary, 1024).text : null,
    });
    this.finished = true;
    if (this.failed) {
      return null;
    }
    try {
      const eventsPath = path.join(this.dir, EVENTS_FILE);
      const unsigned: Omit<EvidenceManifest, "signer" | "signature"> = {
        version: EVIDENCE_VERSION,
        jobId: this.jobId,
        agent: this.job.agent,
        sessionKey: this.job.sessionKey,
        kind: String(this.job.kind),
        status: job.status,
        startedAt: this.job.startedAt,
        endedAt,
        createdAt: this.now().toISOString(),
        gatewayVersion: this.gatewayVersion,
        events: { count: this.seq, root: this.prev, truncated: this.truncated },
        files: { [EVENTS_FILE]: fileEntryOf(eventsPath) },
      };
      const manifest = signEvidenceManifest(
        unsigned,
        this.key ?? resolveEvidenceSigningKey(this.env),
      );
      const target = path.join(this.dir, MANIFEST_FILE);
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, target);
      this.manifest = manifest;
      return manifest;
    } catch (err) {
      this.fail(`evidence: manifest failed for job ${this.jobId}: ${String(err)}`);
      return null;
    }
  }
}

// ── process-wide registry: the runner starts a recorder per job and finishes it ─────────────

const recorders = new Map<string, EvidenceRecorder>();
let autoPruned = false;

/** Start recording a job. Returns null when evidence is disabled. Never throws. */
export function startEvidence(
  job: Pick<JobRecord, "id" | "agent" | "sessionKey" | "kind" | "startedAt">,
  opts: { config?: KoLoConfig; gatewayVersion?: string; env?: NodeJS.ProcessEnv } = {},
): EvidenceRecorder | null {
  const limits = resolveEvidenceLimits(opts.config?.evidence);
  if (!limits.enabled) {
    return null;
  }
  try {
    if (!autoPruned) {
      autoPruned = true;
      // Once per process, best effort: retention is enforced without an operator in the loop.
      pruneEvidence({ days: limits.retentionDays, env: opts.env });
    }
    const recorder = new EvidenceRecorder(job, {
      limits,
      gatewayVersion: opts.gatewayVersion,
      env: opts.env,
    });
    recorders.set(job.id, recorder);
    return recorder;
  } catch {
    return null;
  }
}

export function getEvidenceRecorder(jobId: string): EvidenceRecorder | undefined {
  return recorders.get(jobId);
}

/** Close and sign a job's evidence; the recorder is dropped from the registry either way. */
export function finishEvidence(
  jobId: string,
  job: Parameters<EvidenceRecorder["finish"]>[0],
): EvidenceManifest | null {
  const recorder = recorders.get(jobId);
  recorders.delete(jobId);
  if (!recorder) {
    return null;
  }
  try {
    return recorder.finish(job);
  } catch {
    return null;
  }
}

/** Test helper. */
export function __resetEvidenceForTest(): void {
  for (const recorder of recorders.values()) {
    try {
      recorder.finish({ status: "failed", steps: 0, toolCalls: 0, error: "test reset" });
    } catch {
      // ignore
    }
  }
  recorders.clear();
  autoPruned = false;
}
