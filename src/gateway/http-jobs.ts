import type { ServerResponse } from "node:http";
import type { RouteHandler } from "./http-registry.js";
import { cancelJob, getJob, JOB_STATUSES, listJobs, type JobStatus } from "../agents/jobs.js";

/**
 * HTTP handlers for the M5 jobs API (routes declared in http-routes.ts:
 * listJobs, getJob, cancelJob). The registry itself lives in agents/jobs.ts.
 */

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(JSON.stringify(body));
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.min(parsed, 500);
}

function parseStatus(raw: string | null): JobStatus | undefined {
  if (!raw) {
    return undefined;
  }
  return (JOB_STATUSES as readonly string[]).includes(raw) ? (raw as JobStatus) : undefined;
}

export const listJobsHandler: RouteHandler = (req, res, ctx) => {
  const query = ctx.url.searchParams;
  const agent = query.get("agent")?.trim() || undefined;
  const status = parseStatus(query.get("status"));
  const limit = parseLimit(query.get("limit"));
  sendJson(res, 200, { ok: true, jobs: listJobs({ agent, status, limit }) });
};

export const getJobHandler: RouteHandler = (_req, res, ctx) => {
  const id = ctx.params.id ?? "";
  const job = getJob(id);
  if (!job) {
    sendJson(res, 404, { ok: false, error: `job not found: ${id}` });
    return;
  }
  sendJson(res, 200, { ok: true, job });
};

export const cancelJobHandler: RouteHandler = (_req, res, ctx) => {
  const id = ctx.params.id ?? "";
  const existing = getJob(id);
  if (!existing) {
    sendJson(res, 404, { ok: false, error: `job not found: ${id}` });
    return;
  }
  const result = cancelJob(id, { requestedBy: "operator (http)" });
  if (!result.ok) {
    sendJson(res, 200, { ok: false, reason: result.reason, job: result.job });
    return;
  }
  sendJson(res, 200, { ok: true, job: result.job });
};
