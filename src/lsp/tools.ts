import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import path from "node:path";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import type { LspAvailability, LspManager } from "./manager.js";
import { jsonResult, readNumberParam, readStringParam } from "../agents/tools/common.js";
import { formatDiagnostics, getLspManager, uriToPath } from "./manager.js";

/**
 * Agent tools over the language server manager (KoLo 2.0, M9b): lsp_diagnostics,
 * lsp_definition, lsp_references, lsp_hover. Registered with the core tools so they flow through
 * the tool registry and Code Mode like any other tool.
 */

export type LspToolsOptions = {
  config?: KoLoConfig;
  workspaceDir?: string;
  /** Test seam; defaults to the shared manager for the config. */
  manager?: LspManager;
};

const PathSchema = Type.Object({
  path: Type.String({ description: "File path, absolute or relative to the workspace" }),
});

const PositionSchema = Type.Object({
  path: Type.String({ description: "File path, absolute or relative to the workspace" }),
  line: Type.Number({ description: "1-based line number" }),
  character: Type.Number({ description: "1-based column number" }),
});

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: {} };
}

export function describeUnavailable(avail: LspAvailability, filePath: string): string {
  if (avail.ok) {
    return "";
  }
  switch (avail.reason) {
    case "disabled":
      return "language server integration is disabled (lsp.enabled is false).";
    case "no-server":
      return `no language server is configured for ${path.extname(filePath) || "this file type"}.`;
    case "not-installed":
      return `language server command ${avail.server?.command ?? ""} is not installed; install it or set lsp.servers.${avail.server?.language ?? "<lang>"}.command.`;
    default:
      return "language server unavailable.";
  }
}

export function createLspTools(options: LspToolsOptions = {}): AnyAgentTool[] {
  const workspaceDir = options.workspaceDir ?? process.cwd();
  const manager = () => options.manager ?? getLspManager(options.config);
  const resolvePath = (raw: string) => path.resolve(workspaceDir, raw);
  const readPosition = (params: Record<string, unknown>) => {
    const line = readNumberParam(params, "line", { required: true, integer: true });
    const character = readNumberParam(params, "character", { required: true, integer: true });
    return {
      line: Math.max(0, (line ?? 1) - 1),
      character: Math.max(0, (character ?? 1) - 1),
    };
  };
  const locationsPayload = (
    locations: Array<{ uri: string; range: { start: { line: number; character: number } } }>,
  ) =>
    locations.map((loc) => ({
      path: uriToPath(loc.uri),
      line: loc.range.start.line + 1,
      character: loc.range.start.character + 1,
    }));

  const diagnosticsTool: AnyAgentTool = {
    name: "lsp_diagnostics",
    label: "lsp_diagnostics",
    description:
      "Diagnostics (errors, warnings) for one file from the matching language server. Returns one line per diagnostic as path:line:col severity message.",
    parameters: PathSchema,
    execute: async (_toolCallId, params) => {
      const filePath = resolvePath(readStringParam(params, "path", { required: true }));
      const mgr = manager();
      const avail = mgr.availability(filePath);
      if (!avail.ok) {
        return textResult(describeUnavailable(avail, filePath));
      }
      const diagnostics = await mgr.diagnosticsFor(filePath);
      if (diagnostics.length === 0) {
        return textResult(`no diagnostics for ${filePath}.`);
      }
      return textResult(
        formatDiagnostics(diagnostics, { filePath, maxChars: mgr.maxDiagnosticsChars }),
      );
    },
  };

  const definitionTool: AnyAgentTool = {
    name: "lsp_definition",
    label: "lsp_definition",
    description: "Definition location(s) of the symbol at a position (1-based line and column).",
    parameters: PositionSchema,
    execute: async (_toolCallId, params) => {
      const filePath = resolvePath(readStringParam(params, "path", { required: true }));
      const mgr = manager();
      const avail = mgr.availability(filePath);
      if (!avail.ok) {
        return textResult(describeUnavailable(avail, filePath));
      }
      const locations = await mgr.definition(filePath, readPosition(params));
      return jsonResult({ locations: locationsPayload(locations) });
    },
  };

  const referencesTool: AnyAgentTool = {
    name: "lsp_references",
    label: "lsp_references",
    description: "Reference locations of the symbol at a position (1-based line and column).",
    parameters: PositionSchema,
    execute: async (_toolCallId, params) => {
      const filePath = resolvePath(readStringParam(params, "path", { required: true }));
      const mgr = manager();
      const avail = mgr.availability(filePath);
      if (!avail.ok) {
        return textResult(describeUnavailable(avail, filePath));
      }
      const locations = await mgr.references(filePath, readPosition(params));
      return jsonResult({ locations: locationsPayload(locations) });
    },
  };

  const hoverTool: AnyAgentTool = {
    name: "lsp_hover",
    label: "lsp_hover",
    description: "Hover text (type, signature, documentation) for the symbol at a position.",
    parameters: PositionSchema,
    execute: async (_toolCallId, params) => {
      const filePath = resolvePath(readStringParam(params, "path", { required: true }));
      const mgr = manager();
      const avail = mgr.availability(filePath);
      if (!avail.ok) {
        return textResult(describeUnavailable(avail, filePath));
      }
      const hover = await mgr.hover(filePath, readPosition(params));
      const text = hoverText(hover?.contents);
      return textResult(text || `no hover information at that position in ${filePath}.`);
    },
  };

  return [diagnosticsTool, definitionTool, referencesTool, hoverTool];
}

export function hoverText(contents: unknown): string {
  if (!contents) {
    return "";
  }
  if (typeof contents === "string") {
    return contents.trim();
  }
  if (Array.isArray(contents)) {
    return contents
      .map((entry) => hoverText(entry))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof contents === "object") {
    const record = contents as { value?: unknown; language?: unknown };
    if (typeof record.value === "string") {
      return record.value.trim();
    }
  }
  return "";
}
