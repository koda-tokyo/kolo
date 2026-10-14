// `code_mode_run` agent tool (KoLo 2.0, M6): the model writes one script that calls many tools
// through `tools.*` and returns a value — one round trip instead of N. The tool list the script
// sees is the agent's own filtered list (policy, capability, hooks already applied), minus this
// tool itself; the .d.ts in the description is generated from those tools' schemas.
import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { jsonResult } from "../agents/tools/common.js";
import { buildToolsDts } from "./dts.js";
import { DEFAULT_CODE_MODE_LIMITS, runCodeModeScript, type CodeModeLimits } from "./runner.js";

export const CODE_MODE_TOOL_NAME = "code_mode_run";

const CodeModeRunSchema = Type.Object({
  script: Type.String({
    description:
      "JavaScript or TypeScript body. Runs as the body of an async function: use `await` and `return`. " +
      "Call tools as `await tools.<name>({...})`; each resolves to {text, details?}.",
  }),
  language: Type.Optional(
    Type.Unsafe<"js" | "ts">({
      type: "string",
      enum: ["js", "ts"],
      description: "Default: detect.",
    }),
  ),
  allowTools: Type.Optional(
    Type.Array(Type.String(), {
      description: "Restrict this run to these tool ids (globs like `mcp:docs:*`). Default: all.",
    }),
  ),
  timeoutMs: Type.Optional(
    Type.Integer({ minimum: 1000, maximum: 600_000, description: "Wall clock; default 60000." }),
  ),
});

export type CreateCodeModeToolOptions = {
  /** The tools the script may call; resolved per run so filtering applied later still counts. */
  resolveTools: () => readonly AnyAgentTool[];
  agentId?: string;
  sessionKey?: string;
  limits?: Partial<CodeModeLimits>;
  /** Description cap for the generated .d.ts (keeps the tool description bounded). */
  maxDtsChars?: number;
};

export function describeCodeModeTool(tools: readonly AnyAgentTool[], maxDtsChars = 24_000): string {
  const own = tools.filter((t) => t.name !== CODE_MODE_TOOL_NAME);
  let dts = buildToolsDts(own, { maxDescriptionChars: 240 });
  if (dts.length > maxDtsChars) {
    dts = `${dts.slice(0, maxDtsChars)}\n// … (truncated: ${own.length} tools in total)\n`;
  }
  return (
    "Code Mode: run ONE small script that calls MANY tools and returns a value, instead of one " +
    "tool call per turn. Use it for loops, filtering, joining results, or any multi-step job where " +
    "intermediate data need not reach the model. The script is the body of an async function in " +
    "a sandbox (no require/import/process/fetch/fs; only `tools`, `console`, `sleep`). Return a " +
    `JSON-serialisable value; console output comes back with it. Limits: ${
      DEFAULT_CODE_MODE_LIMITS.wallClockMs / 1000
    } s wall clock (override timeoutMs), ${DEFAULT_CODE_MODE_LIMITS.maxToolCalls} tool calls, ` +
    `${DEFAULT_CODE_MODE_LIMITS.maxOldGenerationSizeMb} MB heap.\n\n` +
    "Available functions (TypeScript declarations):\n```ts\n" +
    dts +
    "```"
  );
}

export function createCodeModeTool(opts: CreateCodeModeToolOptions): AnyAgentTool {
  const tool: AnyAgentTool = {
    name: CODE_MODE_TOOL_NAME,
    label: "Code Mode",
    description: "Code Mode: run one script that calls many tools (description resolved per run).",
    parameters: CodeModeRunSchema,
    execute: async (toolCallId, args, signal) => {
      const params = (args ?? {}) as {
        script?: unknown;
        language?: unknown;
        allowTools?: unknown;
        timeoutMs?: unknown;
      };
      const script = typeof params.script === "string" ? params.script : "";
      const language =
        params.language === "js" || params.language === "ts" ? params.language : undefined;
      const allowTools = Array.isArray(params.allowTools)
        ? params.allowTools.filter((p): p is string => typeof p === "string")
        : undefined;
      const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : undefined;
      const available = opts.resolveTools().filter((t) => t.name !== CODE_MODE_TOOL_NAME);
      const result = await runCodeModeScript({
        script,
        language,
        tools: available,
        allowTools,
        limits: { ...opts.limits, ...(timeoutMs ? { wallClockMs: timeoutMs } : {}) },
        runId: `cm_${toolCallId}`,
        audit: { agentId: opts.agentId, sessionKey: opts.sessionKey, source: "code-mode:tool" },
        signal,
      });
      const payload = {
        ok: result.ok,
        runId: result.runId,
        ...(result.ok ? { value: result.value } : { error: result.error }),
        toolCalls: result.toolCalls,
        calls: result.calls,
        logs: result.logs,
        ...(result.logsTruncated ? { logsTruncated: true } : {}),
        durationMs: result.durationMs,
      };
      if (!result.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Code Mode failed (${result.error?.code}): ${result.error?.message}\n${JSON.stringify(
                { logs: result.logs, calls: result.calls },
                null,
                2,
              )}`,
            },
          ],
          details: payload,
        };
      }
      return jsonResult(payload);
    },
  };
  return tool;
}

export type CodeModeToolRef = { tools: AnyAgentTool[] };

/**
 * After policy filtering and wrapping: point the Code Mode tool at the final list (minus
 * itself) and render its description from those tools' schemas. Wrappers copy tool objects, so
 * this works on the final list, not the one `createCodeModeTool` was given.
 */
export function finalizeCodeModeTool(finalTools: AnyAgentTool[], ref: CodeModeToolRef): void {
  const codeMode = finalTools.find((t) => t.name === CODE_MODE_TOOL_NAME);
  if (!codeMode) {
    ref.tools = [];
    return;
  }
  ref.tools = finalTools.filter((t) => t.name !== CODE_MODE_TOOL_NAME);
  codeMode.description = describeCodeModeTool(ref.tools);
}
