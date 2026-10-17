import path from "node:path";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { KoLoConfig } from "../config/config.js";
import { extractPatchPaths, globToRegExp } from "../agents/permissions.js";
import { emitEvidenceSignal } from "../evidence/bus.js";
import { recordAuditEvent } from "../security/audit-log.js";
import { resolveSnapshotLimits, SnapshotStore } from "./store.js";

/**
 * Record a snapshot of the files a tool is about to write, before it runs. By default a failure to
 * snapshot is swallowed: a missing snapshot never blocks an edit. With `snapshots.required` set
 * (globally or for matching paths) the edit is refused when its recovery snapshot cannot be
 * captured, and the refusal is reported as an evidence signal and an audit event.
 */

export class SnapshotRequiredError extends Error {
  constructor(
    readonly files: string[],
    readonly reason: string,
  ) {
    super(
      `Edit refused: a recovery snapshot is required (snapshots.required) but could not be captured for ${files.join(", ")} (${reason}).`,
    );
    this.name = "SnapshotRequiredError";
  }
}

/** Files among `files` that require a snapshot under `required`. */
export function filesRequiringSnapshot(
  required: boolean | string[] | undefined,
  files: string[],
  workspaceDir: string,
): string[] {
  if (required === true) {
    return files;
  }
  if (!Array.isArray(required) || required.length === 0) {
    return [];
  }
  const patterns = required.map((g) => globToRegExp(g.trim(), "path"));
  return files.filter((file) => {
    const abs = path.resolve(file).split(path.sep).join("/");
    const rel = path.relative(workspaceDir, file).split(path.sep).join("/");
    return patterns.some((re) => re.test(abs) || (!rel.startsWith("..") && re.test(rel)));
  });
}

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
      let mustSnapshot: string[] = [];
      try {
        const files = filesAboutToChange(
          tool.name,
          (params ?? {}) as Record<string, unknown>,
          workspaceDir,
        );
        mustSnapshot = filesRequiringSnapshot(
          options.config?.snapshots?.required,
          files,
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
          if (mustSnapshot.length > 0) {
            const required = new Set(mustSnapshot.map((f) => path.resolve(f)));
            const missed = (entry?.files ?? []).filter((f) => required.has(f.path) && f.skipped);
            if (!entry) {
              throw new SnapshotRequiredError(mustSnapshot, "no snapshot recorded");
            }
            if (missed.length > 0) {
              throw new SnapshotRequiredError(
                missed.map((f) => f.path),
                missed.map((f) => f.skipped).join(", "),
              );
            }
          }
        }
      } catch (err) {
        if (mustSnapshot.length === 0) {
          // Not required: never block the edit on a snapshot failure.
        } else {
          const refusal =
            err instanceof SnapshotRequiredError
              ? err
              : new SnapshotRequiredError(
                  mustSnapshot,
                  err instanceof Error ? err.message : String(err),
                );
          if (sessionKey) {
            emitEvidenceSignal({
              kind: "permission",
              sessionKey,
              tool: tool.name,
              decision: "deny",
              rule: "snapshots.required",
              target: refusal.files.join(", "),
              reason: refusal.reason,
            });
          }
          recordAuditEvent({
            action: "snapshot.required",
            outcome: "denied",
            scope: sessionKey,
            source: "snapshots",
            detail: { tool: tool.name, files: refusal.files, reason: refusal.reason },
          });
          throw refusal;
        }
      }
      return await execute(toolCallId, params, signal, onUpdate);
    },
  };
}
