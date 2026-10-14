import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import path from "node:path";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import { formatDiagnostics, getLspManager, type LspManager } from "./manager.js";

/**
 * After a file-edit tool (write, edit, apply_patch) succeeds, ask the matching language server for
 * diagnostics and append them to the result so the agent sees errors immediately (KoLo 2.0, M9b).
 * Bounded in size and time; any LSP failure leaves the edit result untouched.
 */

const EDIT_TOOL_NAMES = new Set(["write", "edit", "apply_patch"]);

export function touchedFilesFor(
  toolName: string,
  params: Record<string, unknown>,
  result: AgentToolResult<unknown>,
  workspaceDir: string,
): string[] {
  if (toolName === "apply_patch") {
    const summary = (result.details as { summary?: Record<string, unknown> } | undefined)?.summary;
    const files: string[] = [];
    for (const key of ["added", "modified"]) {
      const list = summary?.[key];
      if (Array.isArray(list)) {
        for (const entry of list) {
          if (typeof entry === "string" && entry.trim()) {
            files.push(path.resolve(workspaceDir, entry.trim()));
          }
        }
      }
    }
    return files;
  }
  const raw = params.path ?? params.file_path ?? params.filePath;
  return typeof raw === "string" && raw.trim() ? [path.resolve(workspaceDir, raw.trim())] : [];
}

export function wrapToolWithLspDiagnostics(
  tool: AnyAgentTool,
  options: { config?: KoLoConfig; workspaceDir?: string; manager?: LspManager },
): AnyAgentTool {
  if (!EDIT_TOOL_NAMES.has(tool.name) || options.config?.lsp?.enabled === false) {
    return tool;
  }
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const workspaceDir = options.workspaceDir ?? process.cwd();
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const result = await execute(toolCallId, params, signal, onUpdate);
      try {
        const record = (params ?? {}) as Record<string, unknown>;
        const files = touchedFilesFor(tool.name, record, result, workspaceDir);
        if (files.length === 0) {
          return result;
        }
        const manager = options.manager ?? getLspManager(options.config);
        const blocks: string[] = [];
        let budget = manager.maxDiagnosticsChars;
        for (const file of files) {
          const avail = manager.availability(file);
          if (!avail.ok || budget <= 0) {
            continue;
          }
          const diagnostics = await manager.diagnosticsFor(file, {
            timeoutMs: manager.diagnosticsTimeoutMs,
          });
          if (diagnostics.length === 0) {
            continue;
          }
          const text = formatDiagnostics(diagnostics, { filePath: file, maxChars: budget });
          budget -= text.length;
          blocks.push(`diagnostics (${avail.server.language}):\n${text}`);
        }
        if (blocks.length === 0) {
          return result;
        }
        return {
          ...result,
          content: [...result.content, { type: "text", text: blocks.join("\n\n") }],
        };
      } catch {
        return result;
      }
    },
  };
}
