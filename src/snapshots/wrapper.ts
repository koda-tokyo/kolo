import path from "node:path";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import { extractPatchPaths } from "../agents/permissions.js";
import { emitEvidenceSignal } from "../evidence/bus.js";
import { resolveSnapshotLimits, SnapshotStore } from "./store.js";

/**
 * Record a snapshot of the files a tool is about to write, before it runs. Any failure to
 * snapshot is swallowed: a missing snapshot must never block an edit.
 */

const EDIT_TOOL_NAMES = new Set(["write", "edit", "apply_patch"]);

export function filesAboutToChange(
  toolName: string,
  params: Record<string, unknown>,
  workspaceDir: string,
): string[] {
  if (toolName === "apply_patch") {
    return extractPatchPaths(params.input ?? params.patch).map((p) =>
      path.resolve(workspaceDir, p),
    );
  }
  const raw = params.path ?? params.file_path ?? params.filePath;
  return typeof raw === "string" && raw.trim() ? [path.resolve(workspaceDir, raw.trim())] : [];
}

export function wrapToolWithSnapshots(
  tool: AnyAgentTool,
  options: {
    config?: KoLoConfig;
    workspaceDir?: string;
    sessionKey?: string;
    store?: SnapshotStore;
  },
): AnyAgentTool {
  const sessionKey = options.sessionKey?.trim();
  if (
    !EDIT_TOOL_NAMES.has(tool.name) ||
    options.config?.snapshots?.enabled === false ||
    (!sessionKey && !options.store)
  ) {
    return tool;
  }
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const workspaceDir = options.workspaceDir ?? process.cwd();
  let store = options.store ?? null;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      try {
        const files = filesAboutToChange(
          tool.name,
          (params ?? {}) as Record<string, unknown>,
          workspaceDir,
        );
        if (files.length > 0) {
          store ??= new SnapshotStore(
            sessionKey as string,
            resolveSnapshotLimits(options.config?.snapshots),
          );
          const entry = store.record(tool.name, files);
          if (entry && sessionKey) {
            emitEvidenceSignal({
              kind: "snapshot",
              sessionKey,
              snapshotId: entry.id,
              tool: entry.tool,
              files: entry.files,
            });
          }
        }
      } catch {
        // Never block the edit on a snapshot failure.
      }
      return await execute(toolCallId, params, signal, onUpdate);
    },
  };
}
