// Code Mode runner (KoLo 2.0, M6): runs one agent-written script in a sandboxed worker thread
// and services its tool calls on the host. One model round trip can call many tools.
//
// Isolation: the script runs in a `node:vm` context inside a `worker_threads` Worker started
// from a source string (`eval: true` evaluates in the worker, never on the host). Only typed
// tool functions, `console` and `sleep` are reachable; see worker-source.ts for the realm rules.
// Limits: wall clock (terminate), V8 heap/stack via `resourceLimits` (the worker dies with
// ERR_WORKER_OUT_OF_MEMORY) plus a host-side heap watchdog (`worker.getHeapStatistics()`,
// sampled every 100 ms, works inside a tight loop) because a process-global
// `--max-old-space-size` (NODE_OPTIONS, PM2 node_args) silently overrides per-worker
// resourceLimits; tool calls per script; log bytes; result bytes. Every tool call is audited
// under the run id; a call to a tool outside the allowlist is denied and audited.
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { recordAuditEvent } from "../security/audit-log.js";
import { listSandboxTools, type SandboxToolSpec } from "./tool-names.js";
import { prepareScript } from "./transpile.js";
import { CODE_MODE_WORKER_SOURCE } from "./worker-source.js";

export type CodeModeLimits = {
  /** Wall clock for the whole script, ms. Default 60 000. */
  wallClockMs: number;
  /** Tool calls one script may make. Default 200. */
  maxToolCalls: number;
  /** V8 old-generation heap, MB. Default 128. */
  maxOldGenerationSizeMb: number;
  /** V8 young-generation heap, MB. Default 32. */
  maxYoungGenerationSizeMb: number;
  /** Thread stack, MB. Default 4. */
  stackSizeMb: number;
  /** Bytes of JSON the script may return. Default 1 MiB. */
  maxResultBytes: number;
  /** Bytes a single tool result may hand back into the sandbox. Default 4 MiB. */
  maxToolResultBytes: number;
  /** Bytes of console output kept. Default 64 KiB. */
  maxLogBytes: number;
  /** Script length in characters. Default 256 KiB. */
  maxScriptChars: number;
};

export const DEFAULT_CODE_MODE_LIMITS: CodeModeLimits = {
  wallClockMs: 60_000,
  maxToolCalls: 200,
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 32,
  stackSizeMb: 4,
  maxResultBytes: 1024 * 1024,
  maxToolResultBytes: 4 * 1024 * 1024,
  maxLogBytes: 64 * 1024,
  maxScriptChars: 256 * 1024,
};

/** Hard ceilings a caller cannot raise past (gateway requests pick their own, below these). */
export const CODE_MODE_LIMIT_CEILINGS = {
  wallClockMs: 10 * 60_000,
  maxToolCalls: 5_000,
  maxOldGenerationSizeMb: 1024,
};

export type CodeModeErrorCode =
  | "invalid_script"
  | "script_error"
  | "timeout"
  | "memory"
  | "tool_call_limit"
  | "result_too_large"
  | "worker_error"
  | "aborted";

export type CodeModeCall = {
  seq: number;
  tool: string;
  ok: boolean;
  ms: number;
  error?: string;
};

export type CodeModeLog = { level: string; text: string };

export type CodeModeRunResult = {
  ok: boolean;
  runId: string;
  /** JSON value the script returned (undefined when it returned nothing). */
  value?: unknown;
  error?: { code: CodeModeErrorCode; message: string; stack?: string };
  calls: CodeModeCall[];
  toolCalls: number;
  logs: CodeModeLog[];
  logsTruncated: boolean;
  durationMs: number;
  /** Tool ids the script could call (after policy, capability and allowlist). */
  tools: string[];
};

export type CodeModeAudit = {
  /** Agent id (identity column of the audit chain). */
  agentId?: string;
  sessionKey?: string;
  /** Subsystem that ran the script: "code-mode:tool" | "http:/api/code-mode/run" | "ws:codeMode.run". */
  source: string;
  /** Credential identity when the run came over the API. */
  principal?: string;
};

export type RunCodeModeOptions = {
  script: string;
  /** "ts" strips types before running; "js" runs as is; default: detect by trying to strip. */
  language?: "js" | "ts";
  tools: readonly AnyAgentTool[];
  /** Globs over tool ids (`read_file`, `mcp:srv:*`); absent = every tool in `tools`. */
  allowTools?: readonly string[];
  limits?: Partial<CodeModeLimits>;
  runId?: string;
  audit: CodeModeAudit;
  /** Policy gate run before each tool call (M2 capability, exec approvals …). */
  beforeToolCall?: (tool: AnyAgentTool, args: Record<string, unknown>) => void | Promise<void>;
  signal?: AbortSignal;
};

export function resolveCodeModeLimits(partial?: Partial<CodeModeLimits>): CodeModeLimits {
  const out = { ...DEFAULT_CODE_MODE_LIMITS };
  for (const key of Object.keys(out) as Array<keyof CodeModeLimits>) {
    const value = partial?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[key] = Math.floor(value);
    }
  }
  out.wallClockMs = Math.min(out.wallClockMs, CODE_MODE_LIMIT_CEILINGS.wallClockMs);
  out.maxToolCalls = Math.min(out.maxToolCalls, CODE_MODE_LIMIT_CEILINGS.maxToolCalls);
  out.maxOldGenerationSizeMb = Math.min(
    out.maxOldGenerationSizeMb,
    CODE_MODE_LIMIT_CEILINGS.maxOldGenerationSizeMb,
  );
  return out;
}

/** Text the tool handed back, plus its structured details, as the script sees it. */
export function toolResultForScript(
  result: unknown,
  maxBytes: number,
): { ok: true; value: unknown } | { ok: false; error: string; code: string } {
  const r = (result ?? {}) as { content?: unknown; details?: unknown };
  const content = Array.isArray(r.content) ? r.content : [];
  const text = content
    .map((c) => {
      const block = c as { type?: string; text?: string };
      return block?.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
  const images = content.filter((c) => (c as { type?: string })?.type === "image").length;
  const value = { text, details: r.details, ...(images > 0 ? { images } : {}) };
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch (err) {
    return {
      ok: false,
      code: "ToolResultError",
      error: `tool result is not serialisable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (json.length > maxBytes) {
    return {
      ok: false,
      code: "ToolResultTooLarge",
      error: `tool result is ${json.length} bytes; limit ${maxBytes}`,
    };
  }
  return { ok: true, value: JSON.parse(json) };
}

const HEAP_SAMPLE_MS = 100;

type WorkerMessage =
  | { t: "call"; id: number; tool: string; args: string }
  | { t: "log"; level: string; text: string }
  | { t: "done"; value?: string }
  | { t: "error"; code: string; message: string; stack?: string };

export async function runCodeModeScript(opts: RunCodeModeOptions): Promise<CodeModeRunResult> {
  const limits = resolveCodeModeLimits(opts.limits);
  const runId = opts.runId ?? `cm_${randomUUID()}`;
  const started = Date.now();
  const calls: CodeModeCall[] = [];
  const logs: CodeModeLog[] = [];
  let logsTruncated = false;
  const specs = listSandboxTools(opts.tools, opts.allowTools);
  const byId = new Map<string, { spec: SandboxToolSpec; tool: AnyAgentTool }>();
  for (const spec of specs) {
    byId.set(spec.id, { spec, tool: spec.tool });
  }
  const toolIds = specs.map((s) => s.id);

  const finish = (
    partial: Omit<
      CodeModeRunResult,
      "runId" | "calls" | "toolCalls" | "logs" | "logsTruncated" | "durationMs" | "tools"
    >,
  ): CodeModeRunResult => {
    const result: CodeModeRunResult = {
      ...partial,
      runId,
      calls,
      toolCalls: calls.length,
      logs,
      logsTruncated,
      durationMs: Date.now() - started,
      tools: toolIds,
    };
    recordAuditEvent({
      action: "code_mode.run",
      outcome: result.ok ? "allowed" : "error",
      identity: opts.audit.agentId,
      scope: opts.audit.sessionKey,
      source: opts.audit.source,
      detail: {
        runId,
        ok: result.ok,
        toolCalls: result.toolCalls,
        durationMs: result.durationMs,
        tools: toolIds.length,
        ...(opts.audit.principal ? { principal: opts.audit.principal } : {}),
        ...(result.error ? { error: result.error.code, message: result.error.message } : {}),
      },
    });
    return result;
  };

  if (typeof opts.script !== "string" || !opts.script.trim()) {
    return finish({ ok: false, error: { code: "invalid_script", message: "script is empty" } });
  }
  if (opts.script.length > limits.maxScriptChars) {
    return finish({
      ok: false,
      error: {
        code: "invalid_script",
        message: `script is ${opts.script.length} characters; limit ${limits.maxScriptChars}`,
      },
    });
  }
  const prepared = prepareScript(opts.script, opts.language);
  if (!prepared.ok) {
    return finish({ ok: false, error: { code: "invalid_script", message: prepared.error } });
  }
  if (opts.signal?.aborted) {
    return finish({ ok: false, error: { code: "aborted", message: "aborted before start" } });
  }

  recordAuditEvent({
    action: "code_mode.start",
    outcome: "allowed",
    identity: opts.audit.agentId,
    scope: opts.audit.sessionKey,
    source: opts.audit.source,
    detail: {
      runId,
      scriptChars: opts.script.length,
      tools: toolIds.length,
      wallClockMs: limits.wallClockMs,
      maxToolCalls: limits.maxToolCalls,
      ...(opts.audit.principal ? { principal: opts.audit.principal } : {}),
    },
  });

  const worker = new Worker(CODE_MODE_WORKER_SOURCE, {
    eval: true,
    workerData: {
      script: prepared.code,
      tools: specs.map((s) => ({ id: s.id, path: s.path })),
      maxLogBytes: limits.maxLogBytes,
    },
    resourceLimits: {
      maxOldGenerationSizeMb: limits.maxOldGenerationSizeMb,
      maxYoungGenerationSizeMb: limits.maxYoungGenerationSizeMb,
      stackSizeMb: limits.stackSizeMb,
    },
    env: {},
    stdout: true,
    stderr: true,
    argv: [],
    execArgv: [],
    name: `code-mode:${runId}`,
  });
  // Nothing the script prints bypasses the captured console; drain the raw streams.
  worker.stdout.resume();
  worker.stderr.resume();

  // Heap watchdog (see header). Bytes the whole worker isolate may use: old + young generation.
  const heapCapBytes =
    (limits.maxOldGenerationSizeMb + limits.maxYoungGenerationSizeMb) * 1024 * 1024;
  const heapStats = (
    worker as unknown as { getHeapStatistics?: () => Promise<{ used_heap_size: number }> }
  ).getHeapStatistics;
  let heapSampling = false;
  let heapExceeded = false;
  const heapTimer =
    typeof heapStats === "function"
      ? setInterval(() => {
          if (heapSampling || heapExceeded) {
            return;
          }
          heapSampling = true;
          heapStats
            .call(worker)
            .then((stats) => {
              if (stats.used_heap_size > heapCapBytes) {
                heapExceeded = true;
              }
            })
            .catch(() => {})
            .finally(() => {
              heapSampling = false;
              if (heapExceeded) {
                onHeapExceeded();
              }
            });
        }, HEAP_SAMPLE_MS)
      : null;
  heapTimer?.unref?.();
  let onHeapExceeded = () => {};

  const abortController = new AbortController();
  const callAbort = abortController.signal;
  let settled = false;
  let outcome: CodeModeRunResult | null = null;
  let inFlight = 0;

  const auditCall = (call: CodeModeCall, denied = false) => {
    recordAuditEvent({
      action: "code_mode.tool_call",
      outcome: denied ? "denied" : call.ok ? "allowed" : "error",
      identity: opts.audit.agentId,
      scope: opts.audit.sessionKey,
      source: opts.audit.source,
      detail: {
        runId,
        seq: call.seq,
        tool: call.tool,
        ms: call.ms,
        ...(call.error ? { error: call.error } : {}),
      },
    });
  };

  const result = await new Promise<CodeModeRunResult>((resolve) => {
    const settle = (partial: Parameters<typeof finish>[0]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (heapTimer) {
        clearInterval(heapTimer);
      }
      opts.signal?.removeEventListener("abort", onAbort);
      abortController.abort();
      outcome = finish(partial);
      void worker.terminate().catch(() => {});
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      settle({
        ok: false,
        error: { code: "timeout", message: `script exceeded ${limits.wallClockMs} ms` },
      });
    }, limits.wallClockMs);
    const onAbort = () => settle({ ok: false, error: { code: "aborted", message: "aborted" } });
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    onHeapExceeded = () =>
      settle({
        ok: false,
        error: {
          code: "memory",
          message: `script exceeded the ${limits.maxOldGenerationSizeMb} MB heap limit`,
        },
      });

    const reply = (id: number, payload: unknown) => {
      if (!settled) {
        worker.postMessage({ t: "result", id, payload: JSON.stringify(payload) });
      }
    };

    const handleCall = async (msg: Extract<WorkerMessage, { t: "call" }>) => {
      const seq = calls.length + 1;
      if (seq > limits.maxToolCalls) {
        const call: CodeModeCall = {
          seq,
          tool: msg.tool,
          ok: false,
          ms: 0,
          error: `tool call limit ${limits.maxToolCalls} exceeded`,
        };
        calls.push(call);
        auditCall(call, true);
        settle({
          ok: false,
          error: {
            code: "tool_call_limit",
            message: `script made more than ${limits.maxToolCalls} tool calls`,
          },
        });
        return;
      }
      const entry = byId.get(msg.tool);
      const t0 = Date.now();
      if (!entry) {
        const call: CodeModeCall = {
          seq,
          tool: msg.tool,
          ok: false,
          ms: 0,
          error: "tool not available in this run",
        };
        calls.push(call);
        auditCall(call, true);
        reply(msg.id, { ok: false, code: "ToolNotAvailable", error: call.error });
        return;
      }
      let args: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(msg.args);
        args =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
      } catch {
        args = {};
      }
      const call: CodeModeCall = { seq, tool: msg.tool, ok: false, ms: 0 };
      calls.push(call);
      inFlight += 1;
      try {
        await opts.beforeToolCall?.(entry.tool, args);
        const raw = await entry.tool.execute(`${runId}:${seq}`, args, callAbort);
        call.ms = Date.now() - t0;
        const encoded = toolResultForScript(raw, limits.maxToolResultBytes);
        if (encoded.ok) {
          call.ok = true;
          auditCall(call);
          reply(msg.id, { ok: true, value: encoded.value });
        } else {
          call.error = encoded.error;
          auditCall(call);
          reply(msg.id, { ok: false, code: encoded.code, error: encoded.error });
        }
      } catch (err) {
        call.ms = Date.now() - t0;
        call.error = err instanceof Error ? err.message : String(err);
        auditCall(call);
        reply(msg.id, { ok: false, code: "ToolError", error: call.error });
      } finally {
        inFlight -= 1;
      }
    };

    worker.on("message", (raw: WorkerMessage) => {
      if (settled || !raw || typeof raw !== "object") {
        return;
      }
      switch (raw.t) {
        case "call":
          void handleCall(raw);
          return;
        case "log": {
          const text = String(raw.text);
          if (logs.length >= 1000) {
            logsTruncated = true;
            return;
          }
          logs.push({ level: String(raw.level), text: text.slice(0, 8 * 1024) });
          if (text.length > 8 * 1024) {
            logsTruncated = true;
          }
          return;
        }
        case "done": {
          const json = raw.value;
          if (json !== undefined && json.length > limits.maxResultBytes) {
            settle({
              ok: false,
              error: {
                code: "result_too_large",
                message: `script returned ${json.length} bytes; limit ${limits.maxResultBytes}`,
              },
            });
            return;
          }
          let value: unknown;
          try {
            value = json === undefined ? undefined : JSON.parse(json);
          } catch {
            value = undefined;
          }
          settle({ ok: true, value });
          return;
        }
        case "error": {
          const code: CodeModeErrorCode =
            raw.code === "invalid_script" ? "invalid_script" : "script_error";
          settle({ ok: false, error: { code, message: String(raw.message), stack: raw.stack } });
          return;
        }
        default:
          return;
      }
    });
    worker.on("error", (err: Error & { code?: string }) => {
      if (err?.code === "ERR_WORKER_OUT_OF_MEMORY") {
        settle({
          ok: false,
          error: {
            code: "memory",
            message: `script exceeded the ${limits.maxOldGenerationSizeMb} MB heap limit`,
          },
        });
        return;
      }
      settle({ ok: false, error: { code: "worker_error", message: err?.message ?? String(err) } });
    });
    worker.on("exit", (code) => {
      if (!settled) {
        settle({
          ok: false,
          error: { code: "worker_error", message: `worker exited with code ${code}` },
        });
      }
    });
  });
  // Let a tool that is still running observe the abort before we return.
  if (inFlight > 0) {
    await new Promise((r) => setImmediate(r));
  }
  return result;
}
