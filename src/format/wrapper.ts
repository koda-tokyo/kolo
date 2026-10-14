import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import { touchedFilesFor } from "../lsp/diagnostics-wrapper.js";
import {
  FORMAT_DEFAULT_MAX_OUTPUT_CHARS,
  FORMAT_DEFAULT_TIMEOUT_MS,
  type FormatterSelection,
  formatterForFile,
  resolveFormatters,
} from "./defaults.js";
import { type FormatRunResult, runFormatter } from "./runner.js";

/**
 * After a file-edit tool succeeds, run the matching formatter on each touched file and append
 * one line per file to the result, the way language-server diagnostics are appended. Bounded in
 * time and output; a formatter that is absent, fails or times out never changes the edit result
 * beyond that line.
 */

const EDIT_TOOL_NAMES = new Set(["write", "edit", "apply_patch"]);

export type FormatterRunner = (
  selection: FormatterSelection,
  filePath: string,
  options: { timeoutMs: number; maxOutputChars: number },
) => Promise<FormatRunResult>;

export function formatRunLine(result: FormatRunResult, filePath: string): string {
  if (result.timedOut) {
    return `formatter timed out (${result.command}) after ${result.durationMs} ms: ${filePath}`;
  }
  if (!result.ok) {
    const detail = result.output.split("\n").find((line) => line.trim()) ?? "";
    const code = result.exitCode === null ? "" : ` exit ${result.exitCode}`;
    return `formatter failed (${result.command}${code}): ${filePath}${detail ? `\n${detail}` : ""}`;
  }
  return `${result.changed ? "formatted" : "already formatted"} (${result.command}): ${filePath}`;
}

export function wrapToolWithFormatter(
  tool: AnyAgentTool,
  options: {
    config?: KoLoConfig;
    workspaceDir?: string;
    runner?: FormatterRunner;
    detect?: (command: string) => string | undefined;
  },
): AnyAgentTool {
  if (!EDIT_TOOL_NAMES.has(tool.name) || options.config?.format?.enabled === false) {
    return tool;
  }
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const formatters = resolveFormatters(options.config);
  if (formatters.length === 0) {
    return tool;
  }
  const timeoutMs = options.config?.format?.timeoutMs ?? FORMAT_DEFAULT_TIMEOUT_MS;
  const maxOutputChars = options.config?.format?.maxOutputChars ?? FORMAT_DEFAULT_MAX_OUTPUT_CHARS;
  const runner = options.runner ?? runFormatter;
  const cache = new Map<string, string | undefined>();
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const result: AgentToolResult<unknown> = await execute(toolCallId, params, signal, onUpdate);
      try {
        const record = (params ?? {}) as Record<string, unknown>;
        const files = touchedFilesFor(tool.name, record, result, workspaceDir);
        const lines: string[] = [];
        for (const file of files) {
          const selection = formatterForFile(formatters, file, { detect: options.detect, cache });
          if (!selection) {
            continue;
          }
          const run = await runner(selection, file, { timeoutMs, maxOutputChars });
          lines.push(formatRunLine(run, file));
        }
        if (lines.length === 0) {
          return result;
        }
        return {
          ...result,
          content: [...result.content, { type: "text", text: lines.join("\n") }],
        };
      } catch {
        return result;
      }
    },
  };
}
