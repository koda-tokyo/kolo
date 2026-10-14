import { createHash } from "node:crypto";

/**
 * Doom-loop detector + step limiter for embedded agent runs.
 *
 * Pure logic (no I/O): the run wiring records tool start/end events and asks
 * for a verdict. When a verdict says stop, the caller summarises state,
 * aborts the run, and writes an audit entry (action `agent.loop_stopped`).
 *
 * Rules (defaults):
 * - maxSteps: hard cap on tool steps per run (200).
 * - maxIdenticalCalls: N identical tool calls in a row — same tool name and
 *   same canonicalised args (4).
 * - noProgressSteps: window of steps with no successful write-class tool call
 *   and no changed tool result for a repeated call (12). Errors never count
 *   as progress.
 */

export const DEFAULT_LOOP_LIMITS = {
  maxSteps: 200,
  maxIdenticalCalls: 4,
  noProgressSteps: 12,
} as const;

export type LoopLimits = {
  maxSteps: number;
  maxIdenticalCalls: number;
  noProgressSteps: number;
};

export type LoopStopReason = "max_steps" | "identical_calls" | "no_progress";

export type LoopVerdict = { stop: false } | { stop: true; reason: LoopStopReason; summary: string };

export type LoopLimitsInput =
  | {
      maxSteps?: number | null;
      doomLoop?: {
        maxIdenticalCalls?: number | null;
        noProgressSteps?: number | null;
      } | null;
    }
  | null
  | undefined;

function pickInt(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/** Merge per-agent entry limits over agent defaults over built-in defaults. */
export function resolveLoopLimits(entry?: LoopLimitsInput, defaults?: LoopLimitsInput): LoopLimits {
  return {
    maxSteps: pickInt(entry?.maxSteps, pickInt(defaults?.maxSteps, DEFAULT_LOOP_LIMITS.maxSteps)),
    maxIdenticalCalls: pickInt(
      entry?.doomLoop?.maxIdenticalCalls,
      pickInt(defaults?.doomLoop?.maxIdenticalCalls, DEFAULT_LOOP_LIMITS.maxIdenticalCalls),
    ),
    noProgressSteps: pickInt(
      entry?.doomLoop?.noProgressSteps,
      pickInt(defaults?.doomLoop?.noProgressSteps, DEFAULT_LOOP_LIMITS.noProgressSteps),
    ),
  };
}

/** Deterministic JSON stringify with sorted object keys (bounded depth). */
function stableStringify(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (depth > 12) {
    return '"[deep]"';
  }
  const t = typeof value;
  if (t === "number" || t === "boolean") {
    return String(value);
  }
  if (t === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, depth + 1)).join(",")}]`;
  }
  if (t === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], depth + 1)}`)
      .join(",")}}`;
  }
  return `"${t}"`;
}

const WRITE_CLASS_TOOLS = new Set(["write", "edit", "apply_patch", "multi_edit"]);
const DIGEST_MAX_INPUT_CHARS = 64 * 1024;
const MAX_TRACKED_KEYS = 1024;

function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

export class LoopGuard {
  readonly limits: LoopLimits;

  private steps = 0;
  private stepsSinceProgress = 0;
  private identicalRun = 0;
  private lastCallKey: string | undefined;
  private lastCallTool: string | undefined;
  private readonly callKeyByToolCallId = new Map<string, string>();
  private readonly lastDigestByKey = new Map<string, string>();

  constructor(limits?: Partial<LoopLimits>) {
    this.limits = { ...DEFAULT_LOOP_LIMITS, ...limits };
  }

  getSteps(): number {
    return this.steps;
  }

  getStepsSinceProgress(): number {
    return this.stepsSinceProgress;
  }

  /** Record the start of a tool step. Call check() right after. */
  recordToolStart(toolCallId: string, toolName: string, args: unknown): void {
    this.steps += 1;
    this.stepsSinceProgress += 1;

    const callKey = shortHash(`${toolName}\u0000${stableStringify(args)}`);
    this.callKeyByToolCallId.set(toolCallId, callKey);

    if (callKey === this.lastCallKey) {
      this.identicalRun += 1;
    } else {
      this.identicalRun = 1;
      this.lastCallKey = callKey;
      this.lastCallTool = toolName;
    }
  }

  /**
   * Record the end of a tool step. Progress resets the no-progress window:
   * a successful write-class tool call, or a result digest that differs from
   * the previous result of the same call (including first occurrence).
   */
  recordToolEnd(
    toolCallId: string,
    toolName: string,
    resultText: string | undefined,
    isError: boolean,
  ): void {
    const callKey = this.callKeyByToolCallId.get(toolCallId);
    this.callKeyByToolCallId.delete(toolCallId);
    if (!callKey) {
      return;
    }

    const digest = shortHash((resultText ?? "").slice(0, DIGEST_MAX_INPUT_CHARS));
    const prevDigest = this.lastDigestByKey.get(callKey);

    if (this.lastDigestByKey.size >= MAX_TRACKED_KEYS) {
      this.lastDigestByKey.clear();
    }
    this.lastDigestByKey.set(callKey, digest);

    if (isError) {
      return;
    }
    const isWriteClass = WRITE_CLASS_TOOLS.has(toolName.trim().toLowerCase());
    const digestChanged = prevDigest === undefined || prevDigest !== digest;
    if (isWriteClass || digestChanged) {
      this.stepsSinceProgress = 0;
    }
  }

  /** Evaluate all three rules. Cheap enough to call after every event. */
  check(): LoopVerdict {
    if (this.steps > this.limits.maxSteps) {
      return {
        stop: true,
        reason: "max_steps",
        summary: `Stopped: tool step limit reached (${this.limits.maxSteps} steps completed, step ${this.steps} attempted).`,
      };
    }
    if (this.identicalRun >= this.limits.maxIdenticalCalls) {
      return {
        stop: true,
        reason: "identical_calls",
        summary: `Stopped: ${this.identicalRun} identical ${this.lastCallTool ?? "tool"} calls in a row with the same arguments.`,
      };
    }
    if (this.stepsSinceProgress >= this.limits.noProgressSteps) {
      return {
        stop: true,
        reason: "no_progress",
        summary: `Stopped: no progress in the last ${this.stepsSinceProgress} tool steps (no successful file write and no changed tool result).`,
      };
    }
    return { stop: false };
  }
}
