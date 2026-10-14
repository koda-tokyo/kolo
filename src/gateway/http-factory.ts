// HTTP handlers for the factory (KoLo 2.0, M15c), declared in http-routes.ts: listFactoryBoards,
// listFactoryCards, createFactoryCard, getFactoryCard, moveFactoryCard, runFactoryCard,
// cancelFactoryCard, getFactoryView. The router authenticates (attach for reads, admin for
// writes); the handlers only validate input and talk to the store and the runner.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { KoLoConfig } from "../config/config.js";
import type { RouteHandler } from "./http-registry.js";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { FACTORY_VIEW_CSP, renderFactoryHtml } from "../factory/kanban-html.js";
import { getFactoryRunner } from "../factory/runtime.js";
import { parseColumn } from "../factory/state.js";
import {
  createCard,
  FactoryInputError,
  FactoryNotFoundError,
  FactoryTransitionError,
  getCard,
  listBoards,
  listCards,
  moveCard,
} from "../factory/store.js";
import { FACTORY_COLUMNS, summarizeCard } from "../factory/types.js";
import { sendJson } from "./http-common.js";
import { getHttpPrincipal, principalIdentity } from "./pair-auth.js";

const MAX_BODY_BYTES = 64 * 1024;

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

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identityOf(req: IncomingMessage): string {
  const principal = getHttpPrincipal(req);
  return principal ? principalIdentity(principal) : "owner:token";
}

/** Owner credentials may request the merge gate; a pairing credential never can. */
function isOwner(req: IncomingMessage): boolean {
  const principal = getHttpPrincipal(req);
  return !principal || principal.kind === "owner";
}

function storeError(res: ServerResponse, err: unknown): boolean {
  if (err instanceof FactoryNotFoundError) {
    sendJson(res, 404, { ok: false, error: err.message, code: "not_found" });
    return true;
  }
  if (err instanceof FactoryTransitionError) {
    sendJson(res, 409, { ok: false, error: err.message, code: "transition" });
    return true;
  }
  if (err instanceof FactoryInputError) {
    sendJson(res, 400, { ok: false, error: err.message, code: "input" });
    return true;
  }
  return false;
}

export function createFactoryHttpHandlers(deps: {
  getConfig: () => KoLoConfig;
  gatewayVersion?: string;
  env?: NodeJS.ProcessEnv;
}) {
  const runner = () =>
    getFactoryRunner({
      getConfig: deps.getConfig,
      gatewayVersion: deps.gatewayVersion,
      env: deps.env,
    });

  const listFactoryBoards: RouteHandler = (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const boards = listBoards().map((board) => {
      const counts: Record<string, number> = {};
      for (const column of FACTORY_COLUMNS) {
        counts[column] = 0;
      }
      for (const card of listCards({ boardId: board.id, limit: 1000 })) {
        counts[card.column] = (counts[card.column] ?? 0) + 1;
      }
      return { ...board, counts };
    });
    sendJson(res, 200, { ok: true, boards });
    return true;
  };

  const listFactoryCards: RouteHandler = (_req, res, ctx) => {
    res.setHeader("Cache-Control", "no-store");
    const q = ctx.url.searchParams;
    const columnRaw = q.get("column");
    const column = columnRaw ? parseColumn(columnRaw) : undefined;
    if (columnRaw && !column) {
      sendJson(res, 400, { ok: false, error: `unknown column: ${columnRaw}`, code: "input" });
      return true;
    }
    const limitRaw = q.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    if (limitRaw && (!Number.isInteger(limit) || (limit as number) < 1)) {
      sendJson(res, 400, { ok: false, error: "limit must be a positive integer", code: "input" });
      return true;
    }
    const cards = listCards({
      boardId: str(q.get("board")),
      column: column ?? undefined,
      owner: str(q.get("owner")),
      limit,
    });
    sendJson(res, 200, { ok: true, cards: cards.map(summarizeCard) });
    return true;
  };

  const createFactoryCard: RouteHandler = async (req, res) => {
    const body = await readJsonBody(req);
    if (body === null) {
      sendJson(res, 400, {
        ok: false,
        error: "body must be a JSON object under 64 KiB",
        code: "input",
      });
      return true;
    }
    const config = deps.getConfig();
    const by = identityOf(req);
    try {
      const card = createCard({
        goal: typeof body.goal === "string" ? body.goal : "",
        title: str(body.title),
        repo: str(body.repo) ?? config.factory?.defaultRepo,
        boardId: str(body.board) ?? config.factory?.defaultBoard,
        owner: str(body.owner) ?? resolveDefaultAgentId(config),
        policy: { autoMerge: body.autoMerge === true },
        by,
      });
      if (body.run === true) {
        const started = runner().start(card.id, {
          requestedBy: by,
          mergeAllowed: isOwner(req) ? undefined : false,
        });
        if (!started.ok) {
          sendJson(res, 409, { ok: false, error: started.error, code: started.code, card });
          return true;
        }
        sendJson(res, 200, { ok: true, card: getCard(card.id) ?? card, jobId: started.jobId });
        return true;
      }
      sendJson(res, 200, { ok: true, card });
    } catch (err) {
      if (!storeError(res, err)) {
        sendJson(res, 500, { ok: false, error: String(err) });
      }
    }
    return true;
  };

  const getFactoryCard: RouteHandler = (_req, res, ctx) => {
    res.setHeader("Cache-Control", "no-store");
    const id = ctx.params.id ?? "";
    const card = getCard(id);
    if (!card) {
      sendJson(res, 404, { ok: false, error: `card not found: ${id}`, code: "not_found" });
      return true;
    }
    sendJson(res, 200, { ok: true, card, running: runner().isRunning(id) });
    return true;
  };

  const moveFactoryCard: RouteHandler = async (req, res, ctx) => {
    const id = ctx.params.id ?? "";
    const body = await readJsonBody(req);
    if (body === null) {
      sendJson(res, 400, { ok: false, error: "body must be a JSON object", code: "input" });
      return true;
    }
    const to = parseColumn(body.to);
    if (!to) {
      sendJson(res, 400, {
        ok: false,
        error: `to must be one of ${FACTORY_COLUMNS.join(", ")}`,
        code: "input",
      });
      return true;
    }
    if (!getCard(id)) {
      sendJson(res, 404, { ok: false, error: `card not found: ${id}`, code: "not_found" });
      return true;
    }
    if (runner().isRunning(id)) {
      sendJson(res, 409, {
        ok: false,
        error: "a run is in progress; cancel it before moving the card",
        code: "running",
      });
      return true;
    }
    try {
      const card = moveCard(id, to, { by: identityOf(req), reason: str(body.reason) });
      sendJson(res, 200, { ok: true, card });
    } catch (err) {
      if (!storeError(res, err)) {
        sendJson(res, 500, { ok: false, error: String(err) });
      }
    }
    return true;
  };

  const runFactoryCard: RouteHandler = async (req, res, ctx) => {
    const id = ctx.params.id ?? "";
    const body = (await readJsonBody(req)) ?? {};
    if (!getCard(id)) {
      sendJson(res, 404, { ok: false, error: `card not found: ${id}`, code: "not_found" });
      return true;
    }
    const mergeRequested = body.merge === true && isOwner(req);
    const started = runner().start(id, {
      requestedBy: identityOf(req),
      profile: str(body.profile),
      // Owner asked for the gate: allowed. Otherwise the owner resident's rules decide, and a
      // pairing credential can never widen that.
      mergeAllowed: mergeRequested ? true : isOwner(req) ? undefined : false,
    });
    if (!started.ok) {
      sendJson(res, started.code === "not_found" ? 404 : 409, {
        ok: false,
        error: started.error,
        code: started.code,
      });
      return true;
    }
    sendJson(res, 200, { ok: true, jobId: started.jobId, card: summarizeCard(started.card) });
    return true;
  };

  const cancelFactoryCard: RouteHandler = (req, res, ctx) => {
    const id = ctx.params.id ?? "";
    const result = runner().cancel(id, identityOf(req));
    if (!result.ok) {
      sendJson(res, result.code === "not_found" ? 404 : 409, {
        ok: false,
        error: result.error,
        code: result.code,
      });
      return true;
    }
    sendJson(res, 200, { ok: true, jobId: result.jobId });
    return true;
  };

  const getFactoryView: RouteHandler = (_req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Security-Policy", FACTORY_VIEW_CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.end(renderFactoryHtml());
    return true;
  };

  return {
    listFactoryBoards,
    listFactoryCards,
    createFactoryCard,
    getFactoryCard,
    moveFactoryCard,
    runFactoryCard,
    cancelFactoryCard,
    getFactoryView,
  };
}
