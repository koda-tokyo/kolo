// Model bench (KoLo 2.0, KODA tested catalogue phase 1): shared types for the task suite, the
// runner, the scorer, the signed report and the catalogue. Nothing here runs at import time.
import type { Message } from "@mariozechner/pi-ai";
import type { PolicyDocument } from "../policy/schema.js";

export const BENCH_REPORT_VERSION = 1 as const;
export const BENCH_SUITE_VERSION = "2026.10.1";

/** Scored axes. `efficiency` is derived from latency and tokens of every task, not its own tasks. */
export const BENCH_AXES = [
  "toolUse",
  "policy",
  "continuity",
  "coding",
  "japanese",
  "portuguese",
  "efficiency",
] as const;
export type BenchAxis = (typeof BENCH_AXES)[number];
export type TaskAxis = Exclude<BenchAxis, "efficiency">;

/** Weights of the overall score; they sum to 1. */
export const AXIS_WEIGHTS: Record<BenchAxis, number> = {
  toolUse: 0.2,
  policy: 0.2,
  continuity: 0.2,
  coding: 0.15,
  japanese: 0.075,
  portuguese: 0.075,
  efficiency: 0.1,
};

/** Tool kits a task can expose; the harness builds each from the real tool layer or a fake. */
export const BENCH_TOOL_KITS = [
  "files",
  "memory",
  "calendar",
  "tickets",
  "inventory",
  "rates",
  "shell",
  "messaging",
  "payments",
  "fetch",
  "approval",
  "mcp",
  "codeMode",
] as const;
export type BenchToolKit = (typeof BENCH_TOOL_KITS)[number];

/** One conversation. Sessions of a task run in order; a new session is a closed-and-reopened one. */
export type BenchSession = {
  prompt: string;
  /**
   * Turns that precede the prompt, produced by a different model (a model swap). Assistant
   * turns here carry the previous model's provider and id.
   */
  history?: Message[];
  /** Continue the previous session's transcript instead of starting fresh. */
  continueTranscript?: boolean;
};

export type ToolCallTrace = {
  name: string;
  args: Record<string, unknown>;
  decision: "allow" | "deny" | "ask";
  ruleId: string;
  isError: boolean;
  result: string;
  /** Script text for `code_mode_run`, tool names called inside it. */
  inner?: string[];
};

export type SessionTrace = {
  finalText: string;
  toolCalls: ToolCallTrace[];
  /** Calls made from inside `code_mode_run` scripts. */
  innerCalls?: ToolCallTrace[];
  turns: number;
  error?: string;
};

export type TaskContext = {
  workspaceDir: string;
  agentId: string;
  /** Per-run identity marker written into IDENTITY.md. */
  marker: string;
};

export type CheckContext = TaskContext & {
  sessions: SessionTrace[];
  /** Run a fixture test file under a restricted node; resolves to its exit status. */
  runNodeTest: (relPath: string) => Promise<{ ok: boolean; output: string }>;
};

export type TaskCheck = {
  /** 0..1 */
  score: number;
  detail: string;
};

export type BenchTask = {
  id: string;
  axis: TaskAxis;
  title: string;
  /** Part of the reduced subset (`--subset quick`) used for slow local models. */
  quick?: boolean;
  kits: BenchToolKit[];
  policy?: PolicyDocument;
  /** Body the fake `web_fetch` tool returns. */
  fetchContent?: string;
  setup?: (ctx: TaskContext) => void;
  sessions: BenchSession[] | ((ctx: TaskContext) => BenchSession[]);
  check: (ctx: CheckContext) => TaskCheck | Promise<TaskCheck>;
  /** Model turns per session (default 6). */
  maxTurns?: number;
};

export type TaskStatus = "pass" | "partial" | "fail" | "error" | "not_run";

export type TaskResult = {
  id: string;
  axis: TaskAxis;
  status: TaskStatus;
  score: number;
  detail: string;
  latencyMs: number;
  turns: number;
  tokens: { input: number; output: number; total: number };
  cost: number;
  toolCalls: number;
  /** Why the task did not run (budget, subset, unsupported). */
  reason?: string;
};

export type ModelPrice = {
  /** Price per million input tokens (cache miss). */
  input: number;
  /** Price per million output tokens. */
  output: number;
  currency: string;
  source: string;
  asOf: string;
};

export type BenchModelRef = { provider: string; model: string };

export type AxisScore = { score: number | null; run: number; total: number };

export type ModelBenchResult = {
  provider: string;
  model: string;
  status: "complete" | "budget_stopped" | "error" | "partial";
  startedAt: string;
  endedAt: string;
  subset: "full" | "quick";
  tasks: TaskResult[];
  axes: Record<BenchAxis, AxisScore>;
  overall: number | null;
  /** Tasks run / tasks in the suite. */
  coverage: number;
  usage: { input: number; output: number; total: number; cost: number; currency: string | null };
  latency: { p50Ms: number | null; p90Ms: number | null };
  costPerResidentHour: number | null;
  budget: { tokenCap: number; stoppedAt?: string };
  /** One evidence job per run that contributed tasks (several after a merge). */
  evidence: Array<{ jobId: string; root: string; events: number; bundle?: string }>;
  error?: string;
};

export type BenchReport = {
  version: typeof BENCH_REPORT_VERSION;
  kind: "kolo-model-bench";
  suite: { version: string; tasks: number; subset: "full" | "quick" | "mixed" };
  createdAt: string;
  judge: { kind: "deterministic"; detail: string };
  budget: { perModelTokens: number; globalTokens: number };
  models: ModelBenchResult[];
  /** Hashes of the signed reports this one was merged from (chunked runs). */
  mergedFrom?: string[];
  /** sha256 of canonicalJson(report without hash, signer, signature). */
  hash: string;
  signer: { alg: "ed25519"; keyId: string; publicKey: string };
  signature: string;
};
