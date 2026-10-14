// Outbound delivery queue (KoLo 2.0, M14c): every reply a channel sends goes through one
// per-channel FIFO with retry and exponential backoff, a dedupe key window, a dead-letter file
// and a health snapshot (`kolo channels status`, `GET /api/channels/status`). The queue never
// originates a message: it only carries what an inbound message, a terminal/CLI send or a
// human-initiated approval flow produced. `channels.delivery.policy` (default `human-triggered`)
// refuses anything marked `automated`; M13 `agents[].channels` will refine that per agent.
import fs from "node:fs";
import path from "node:path";
import type { KoLoConfig } from "../../config/config.js";
import { auditSafe } from "../../audit/audit-log.js";
import { resolveStateDir } from "../../config/paths.js";
import { createDedupeCache, type DedupeCache } from "../../infra/dedupe.js";

export type OutboundOrigin = "inbound" | "command" | "approval" | "cli" | "automated";

export type OutboundStatus = "sent" | "duplicate" | "dead_letter" | "policy";

export type OutboundJob = {
  channel: string;
  accountId?: string;
  to: string;
  /** Unique per logical message (provider message id + chunk index); repeats are dropped. */
  dedupeKey: string;
  origin: OutboundOrigin;
  /** Short description for the dead-letter record (never a secret). */
  text?: string;
  send: () => Promise<void>;
};

export type DeliveryLimits = {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs: number;
  dedupeTtlMs: number;
  policy: "human-triggered" | "allow-automated";
};

export const DELIVERY_DEFAULTS: DeliveryLimits = {
  maxRetries: 4,
  backoffMs: 1000,
  maxBackoffMs: 60_000,
  dedupeTtlMs: 10 * 60_000,
  policy: "human-triggered",
};

export type ChannelDeliveryHealth = {
  channel: string;
  queued: number;
  inFlight: number;
  sent: number;
  retried: number;
  deadLettered: number;
  duplicates: number;
  policyDenied: number;
  lastSentAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  /** Dead-letter file for this channel, when it exists. */
  deadLetterFile: string | null;
};

export type DeadLetterRecord = {
  ts: string;
  channel: string;
  accountId: string | null;
  to: string;
  dedupeKey: string;
  origin: OutboundOrigin;
  attempts: number;
  reason: "retries_exhausted" | "policy";
  error: string;
  text: string | null;
};

export function resolveDeliveryLimits(cfg?: KoLoConfig): DeliveryLimits {
  const c = cfg?.channels?.delivery;
  return {
    maxRetries: c?.maxRetries ?? DELIVERY_DEFAULTS.maxRetries,
    backoffMs: c?.backoffMs ?? DELIVERY_DEFAULTS.backoffMs,
    maxBackoffMs: c?.maxBackoffMs ?? DELIVERY_DEFAULTS.maxBackoffMs,
    dedupeTtlMs: c?.dedupeTtlMs ?? DELIVERY_DEFAULTS.dedupeTtlMs,
    policy: c?.policy ?? DELIVERY_DEFAULTS.policy,
  };
}

export function resolveDeadLetterDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "channels", "dead-letter");
}

export function resolveDeadLetterFile(channel: string, env?: NodeJS.ProcessEnv): string {
  const safe = channel.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "unknown";
  return path.join(resolveDeadLetterDir(env), `${safe}.jsonl`);
}

export function readDeadLetters(channel: string, env?: NodeJS.ProcessEnv): DeadLetterRecord[] {
  try {
    return fs
      .readFileSync(resolveDeadLetterFile(channel, env), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as DeadLetterRecord);
  } catch {
    return [];
  }
}

type ChannelState = {
  queue: OutboundJob[];
  running: boolean;
  health: ChannelDeliveryHealth;
};

export type OutboundQueueOptions = {
  limits?: Partial<DeliveryLimits>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Test seam: replaces setTimeout for backoff waits. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });

export class ChannelOutboundQueue {
  private readonly channels = new Map<string, ChannelState>();
  private readonly dedupe: DedupeCache;
  private readonly limits: DeliveryLimits;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: OutboundQueueOptions = {}) {
    this.limits = { ...DELIVERY_DEFAULTS, ...opts.limits };
    this.env = opts.env;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.dedupe = createDedupeCache({ ttlMs: this.limits.dedupeTtlMs, maxSize: 20_000 });
  }

  private stateOf(channel: string): ChannelState {
    const key = channel.toLowerCase();
    let state = this.channels.get(key);
    if (!state) {
      state = {
        queue: [],
        running: false,
        health: {
          channel: key,
          queued: 0,
          inFlight: 0,
          sent: 0,
          retried: 0,
          deadLettered: 0,
          duplicates: 0,
          policyDenied: 0,
          lastSentAt: null,
          lastError: null,
          lastErrorAt: null,
          deadLetterFile: null,
        },
      };
      this.channels.set(key, state);
    }
    return state;
  }

  /** Enqueue; resolves with the final status once the job is sent, dropped or dead-lettered. */
  enqueue(job: OutboundJob): Promise<OutboundStatus> {
    const state = this.stateOf(job.channel);
    if (this.dedupe.check(job.dedupeKey, this.now())) {
      state.health.duplicates += 1;
      return Promise.resolve("duplicate");
    }
    if (job.origin === "automated" && this.limits.policy !== "allow-automated") {
      state.health.policyDenied += 1;
      this.deadLetter(state, job, 0, "policy", "channels.delivery.policy is human-triggered");
      void auditSafe({
        scope: job.to,
        action: "channel.outbound.policy_denied",
        outcome: "denied",
        source: "channels.delivery",
        detail: { channel: job.channel, accountId: job.accountId ?? null, origin: job.origin },
      });
      return Promise.resolve("policy");
    }
    return new Promise<OutboundStatus>((resolve) => {
      state.queue.push({ ...job, send: this.wrapSend(job, resolve) });
      state.health.queued = state.queue.length;
      void this.drain(state);
    });
  }

  private wrapSend(
    job: OutboundJob,
    resolve: (status: OutboundStatus) => void,
  ): () => Promise<void> {
    return async () => {
      const state = this.stateOf(job.channel);
      let attempt = 0;
      for (;;) {
        try {
          await job.send();
          state.health.sent += 1;
          state.health.lastSentAt = this.now();
          state.health.inFlight = 0;
          resolve("sent");
          return;
        } catch (err) {
          attempt += 1;
          const message = String(err instanceof Error ? err.message : err).slice(0, 300);
          state.health.lastError = message;
          state.health.lastErrorAt = this.now();
          if (attempt > this.limits.maxRetries) {
            this.deadLetter(state, job, attempt, "retries_exhausted", message);
            state.health.inFlight = 0;
            resolve("dead_letter");
            return;
          }
          state.health.retried += 1;
          if (attempt === 1) {
            void auditSafe({
              scope: job.to,
              action: "channel.outbound.retry",
              outcome: "failed",
              source: "channels.delivery",
              detail: {
                channel: job.channel,
                accountId: job.accountId ?? null,
                dedupeKey: job.dedupeKey,
                error: message,
              },
            });
          }
          const delay = Math.min(
            this.limits.maxBackoffMs,
            this.limits.backoffMs * 2 ** (attempt - 1),
          );
          await this.sleep(delay);
        }
      }
    };
  }

  private deadLetter(
    state: ChannelState,
    job: OutboundJob,
    attempts: number,
    reason: DeadLetterRecord["reason"],
    error: string,
  ): void {
    state.health.deadLettered += 1;
    const record: DeadLetterRecord = {
      ts: new Date(this.now()).toISOString(),
      channel: job.channel.toLowerCase(),
      accountId: job.accountId ?? null,
      to: job.to,
      dedupeKey: job.dedupeKey,
      origin: job.origin,
      attempts,
      reason,
      error,
      text: job.text ? job.text.slice(0, 2000) : null,
    };
    try {
      const file = resolveDeadLetterFile(job.channel, this.env);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
      state.health.deadLetterFile = file;
    } catch {
      // The health snapshot still counts it.
    }
    void auditSafe({
      scope: job.to,
      action: "channel.outbound.dead_letter",
      outcome: "failed",
      source: "channels.delivery",
      detail: {
        channel: job.channel,
        accountId: job.accountId ?? null,
        dedupeKey: job.dedupeKey,
        origin: job.origin,
        attempts,
        reason,
        error,
      },
    });
  }

  private async drain(state: ChannelState): Promise<void> {
    if (state.running) {
      return;
    }
    state.running = true;
    try {
      while (state.queue.length > 0) {
        const job = state.queue.shift() as OutboundJob;
        state.health.queued = state.queue.length;
        state.health.inFlight = 1;
        await job.send();
        state.health.inFlight = 0;
      }
    } finally {
      state.running = false;
      state.health.inFlight = 0;
    }
  }

  snapshot(): Record<string, ChannelDeliveryHealth> {
    const out: Record<string, ChannelDeliveryHealth> = {};
    for (const [key, state] of this.channels) {
      out[key] = { ...state.health, queued: state.queue.length };
    }
    return out;
  }

  /** Resolves when every queued job of every channel has settled. */
  async idle(): Promise<void> {
    for (;;) {
      const busy = [...this.channels.values()].some((s) => s.running || s.queue.length > 0);
      if (!busy) {
        return;
      }
      await this.sleep(5);
    }
  }
}

let shared: ChannelOutboundQueue | null = null;

export function getOutboundQueue(cfg?: KoLoConfig): ChannelOutboundQueue {
  if (!shared) {
    shared = new ChannelOutboundQueue({ limits: resolveDeliveryLimits(cfg) });
  }
  return shared;
}

export function resetOutboundQueueForTest(queue?: ChannelOutboundQueue | null): void {
  shared = queue ?? null;
}

/** The delivery view for status surfaces: live counters plus dead-letter files on disk. */
export function deliverySnapshot(env?: NodeJS.ProcessEnv): {
  channels: Record<string, ChannelDeliveryHealth>;
  deadLetterDir: string;
  deadLetterFiles: Array<{ channel: string; file: string; records: number }>;
} {
  const channels = shared?.snapshot() ?? {};
  const dir = resolveDeadLetterDir(env);
  const files: Array<{ channel: string; file: string; records: number }> = [];
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".jsonl")) {
        continue;
      }
      const channel = name.slice(0, -".jsonl".length);
      files.push({
        channel,
        file: path.join(dir, name),
        records: readDeadLetters(channel, env).length,
      });
    }
  } catch {
    // No dead letters yet.
  }
  return { channels, deadLetterDir: dir, deadLetterFiles: files };
}
