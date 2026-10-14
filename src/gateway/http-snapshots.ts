// HTTP handlers for session file snapshots (KoLo 2.0, M10): list, undo, redo and restore to a
// snapshot. The router has authenticated the request (minimum scope: attach); the session
// allowlist of a paired device is applied through session discovery, so a restricted credential
// never sees or touches a session it was not invited to (404).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext } from "./http-registry.js";
import { auditSafe } from "../audit/index.js";
import { loadConfig } from "../config/config.js";
import { resolveSnapshotLimits, type RestoreReport, SnapshotStore } from "../snapshots/store.js";
import { sendJson } from "./http-common.js";
import { getHttpPrincipal } from "./pair-auth.js";
import { allowlistOf, findSession } from "./session-discovery.js";

const MAX_BODY_BYTES = 16 * 1024;

export type RestoreAction = "undo" | "redo" | "restore";

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      return null;
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function summary(report: RestoreReport) {
  return {
    id: report.entry.id,
    at: report.entry.at,
    tool: report.entry.tool,
    restored: report.restored,
    removed: report.removed,
    skipped: report.skipped,
  };
}

export function createSnapshotsHttpHandlers(
  options: { storeFor?: (key: string) => SnapshotStore } = {},
) {
  const storeFor =
    options.storeFor ??
    ((key: string) => new SnapshotStore(key, resolveSnapshotLimits(loadConfig().snapshots)));

  const resolve = (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
    const session = findSession({
      cfg: loadConfig(),
      allowlist: allowlistOf(getHttpPrincipal(req)),
      target: ctx.params.id ?? "",
    });
    res.setHeader("Cache-Control", "no-store");
    if (!session) {
      sendJson(res, 404, { ok: false, error: `No session found: ${ctx.params.id ?? ""}` });
      return null;
    }
    return session;
  };

  return {
    listSnapshots: (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const session = resolve(req, res, ctx);
      if (!session) {
        return true;
      }
      const index = storeFor(session.key).list();
      sendJson(res, 200, {
        ok: true,
        session: session.key,
        cursor: index.cursor,
        snapshots: index.entries.map((entry, position) => ({
          id: entry.id,
          at: entry.at,
          tool: entry.tool,
          applied: position < index.cursor,
          files: entry.files.map((file) => ({
            path: file.path,
            existed: file.existed,
            size: file.size,
            ...(file.skipped ? { skipped: file.skipped } : {}),
          })),
        })),
      });
      return true;
    },

    restoreSnapshot: async (req: IncomingMessage, res: ServerResponse, ctx: RouteContext) => {
      const session = resolve(req, res, ctx);
      if (!session) {
        return true;
      }
      const body = await readJsonBody(req);
      if (!body) {
        sendJson(res, 400, { ok: false, error: "body must be a JSON object under 16 KiB" });
        return true;
      }
      const id = typeof body.id === "string" ? body.id.trim() : "";
      const action: RestoreAction | null =
        body.action === "undo" || body.action === "redo"
          ? body.action
          : id
            ? "restore"
            : body.action === undefined
              ? "undo"
              : null;
      if (!action) {
        sendJson(res, 400, {
          ok: false,
          error: 'action must be "undo" or "redo", or give a snapshot id',
        });
        return true;
      }
      const store = storeFor(session.key);
      let reports: RestoreReport[] | null;
      if (action === "undo") {
        const one = store.undo();
        reports = one ? [one] : null;
      } else if (action === "redo") {
        const one = store.redo();
        reports = one ? [one] : null;
      } else {
        reports = store.restoreTo(id);
      }
      const principal = getHttpPrincipal(req);
      const identity = principal?.kind === "pair" ? principal.fingerprint : "owner";
      if (!reports) {
        void auditSafe({
          identity,
          scope: session.key,
          action: "session.snapshot_restore",
          outcome: "failed",
          source: "gateway.snapshots",
          detail: { action, id: id || undefined, reason: "nothing to restore" },
        });
        sendJson(res, 409, {
          ok: false,
          error:
            action === "undo"
              ? "nothing to undo"
              : action === "redo"
                ? "nothing to redo"
                : `snapshot not found or already undone: ${id}`,
        });
        return true;
      }
      void auditSafe({
        identity,
        scope: session.key,
        action: "session.snapshot_restore",
        outcome: "ok",
        source: "gateway.snapshots",
        detail: {
          action,
          id: id || undefined,
          steps: reports.map((report) => ({
            id: report.entry.id,
            restored: report.restored.length,
            removed: report.removed.length,
            skipped: report.skipped.length,
          })),
        },
      });
      sendJson(res, 200, {
        ok: true,
        action,
        cursor: store.list().cursor,
        steps: reports.map(summary),
      });
      return true;
    },
  };
}
