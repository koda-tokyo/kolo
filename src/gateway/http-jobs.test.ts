import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteHandler } from "./http-registry.js";
import { __resetJobsForTest, markJobRunning, registerJobCancel, startJob } from "../agents/jobs.js";
import { cancelJobHandler, getJobHandler, listJobsHandler } from "./http-jobs.js";
import { GATEWAY_ROUTES } from "./http-routes.js";
import { jobsHandlers } from "./server-methods/jobs.js";

let tmpHome = "";

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-jobs-http-"));
  process.env.KOLO_STATE_DIR = tmpHome;
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  delete process.env.KOLO_STATE_DIR;
});

beforeEach(() => {
  __resetJobsForTest();
});

function makeReq(method: string, url: string): IncomingMessage {
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: "",
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      res.body = chunk ?? "";
    },
  };
  return res as typeof res & ServerResponse;
}

function call(
  handler: RouteHandler,
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { url: URL; params: Record<string, string> },
) {
  const out = handler(req, res, ctx);
  if (out instanceof Promise) {
    throw new Error("jobs handlers are synchronous");
  }
  return JSON.parse((res as unknown as { body: string }).body || "null");
}

describe("jobs routes are registered", () => {
  it("declares list, get and cancel operations", () => {
    const byId = new Map(GATEWAY_ROUTES.map((route) => [route.operationId, route]));
    const list = byId.get("listJobs");
    const get = byId.get("getJob");
    const cancel = byId.get("cancelJob");
    expect(list?.method).toBe("GET");
    expect(list?.path).toBe("/api/jobs");
    expect(get?.method).toBe("GET");
    expect(get?.path).toBe("/api/jobs/{id}");
    expect(cancel?.method).toBe("POST");
    expect(cancel?.path).toBe("/api/jobs/{id}/cancel");
    for (const route of [list, get, cancel]) {
      expect(route?.auth).toEqual(["gateway-token", "session-admin"]);
    }
  });
});

describe("jobs HTTP API: list → get → cancel", () => {
  it("serves the full lifecycle", () => {
    const job = startJob({ agent: "main", sessionKey: "agent:main:main", kind: "agent" });
    markJobRunning(job.id);
    const abort = vi.fn();
    registerJobCancel(job.id, abort);

    // list (with filters)
    let res = makeRes();
    let body = call(listJobsHandler, makeReq("GET", "/api/jobs"), res, {
      url: new URL("http://gateway/api/jobs"),
      params: {},
    });
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].id).toBe(job.id);
    expect(body.jobs[0].status).toBe("running");

    res = makeRes();
    body = call(
      listJobsHandler,
      makeReq("GET", "/api/jobs?agent=main&status=running&limit=10"),
      res,
      {
        url: new URL("http://gateway/api/jobs?agent=main&status=running&limit=10"),
        params: {},
      },
    );
    expect(body.jobs).toHaveLength(1);

    res = makeRes();
    body = call(listJobsHandler, makeReq("GET", "/api/jobs?agent=nobody"), res, {
      url: new URL("http://gateway/api/jobs?agent=nobody"),
      params: {},
    });
    expect(body.jobs).toHaveLength(0);

    // get
    res = makeRes();
    body = call(getJobHandler, makeReq("GET", `/api/jobs/${job.id}`), res, {
      url: new URL(`http://gateway/api/jobs/${job.id}`),
      params: { id: job.id },
    });
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.job.id).toBe(job.id);

    // get unknown → 404
    res = makeRes();
    body = call(getJobHandler, makeReq("GET", "/api/jobs/nope"), res, {
      url: new URL("http://gateway/api/jobs/nope"),
      params: { id: "nope" },
    });
    expect(res.statusCode).toBe(404);
    expect(body.ok).toBe(false);

    // cancel → aborts the run, status cancelled, audited via registry
    res = makeRes();
    body = call(cancelJobHandler, makeReq("POST", `/api/jobs/${job.id}/cancel`), res, {
      url: new URL(`http://gateway/api/jobs/${job.id}/cancel`),
      params: { id: job.id },
    });
    expect(res.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.job.status).toBe("cancelled");
    expect(abort).toHaveBeenCalledOnce();

    // second cancel → already_finished
    res = makeRes();
    body = call(cancelJobHandler, makeReq("POST", `/api/jobs/${job.id}/cancel`), res, {
      url: new URL(`http://gateway/api/jobs/${job.id}/cancel`),
      params: { id: job.id },
    });
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("already_finished");

    // cancel unknown → 404
    res = makeRes();
    body = call(cancelJobHandler, makeReq("POST", "/api/jobs/nope/cancel"), res, {
      url: new URL("http://gateway/api/jobs/nope/cancel"),
      params: { id: "nope" },
    });
    expect(res.statusCode).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe("jobs WS methods", () => {
  function invokeWs(method: keyof typeof jobsHandlers, params: Record<string, unknown>) {
    const respond = vi.fn();
    const handler = jobsHandlers[method] as (opts: {
      params: Record<string, unknown>;
      respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
      client: { connect: { role: "operator" } } | null;
    }) => void;
    handler({ params, respond, client: null });
    return respond.mock.calls[0] as [boolean, unknown, unknown];
  }

  it("jobs.list returns jobs", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    const [ok, payload] = invokeWs("jobs.list", {});
    expect(ok).toBe(true);
    expect((payload as { jobs: unknown[] }).jobs).toHaveLength(1);
    expect((payload as { jobs: Array<{ id: string }> }).jobs[0].id).toBe(job.id);
  });

  it("jobs.get rejects invalid params and unknown ids", () => {
    const [ok, , error] = invokeWs("jobs.get", {});
    expect(ok).toBe(false);
    expect((error as { code: string }).code).toBe("INVALID_REQUEST");

    const [ok2, , error2] = invokeWs("jobs.get", { id: "missing" });
    expect(ok2).toBe(false);
    expect((error2 as { message: string }).message).toContain("job not found");
  });

  it("jobs.cancel cancels a running job", () => {
    const job = startJob({ agent: "main", sessionKey: "s" });
    markJobRunning(job.id);
    const [ok, payload] = invokeWs("jobs.cancel", { id: job.id });
    expect(ok).toBe(true);
    expect((payload as { job: { status: string } }).job.status).toBe("cancelled");
  });
});
