import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PairPrincipal } from "./pair-store.js";
import { __resetJobsForTest, getJob, markJobRunning, startJob } from "../agents/jobs.js";
import { PolicyEngine, setPolicyEngineForTest } from "../policy/engine.js";
import { resolvePolicyLocations } from "../policy/paths.js";
import { createHttpRouter, defineRoute } from "./http-registry.js";
import { GATEWAY_ROUTES } from "./http-routes.js";
import { setHttpPrincipal } from "./pair-auth.js";
import { createPolicyHttpHandlers, parseKillBody } from "./policy-http.js";
import { routeMinScope, wsMethodMinScope } from "./scopes.js";
import { policyHandlers } from "./server-methods/policy.js";

let home: string;
let engine: PolicyEngine;

function makeReq(method: string, url: string, body?: unknown): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  const req = {
    method,
    url,
    headers: { "content-type": "application/json" },
    socket: { remoteAddress: "127.0.0.1" },
    on(event: string, fn: (...args: unknown[]) => void) {
      (listeners[event] ??= []).push(fn);
      if (event === "end") {
        queueMicrotask(() => {
          for (const chunk of chunks) {
            for (const l of listeners.data ?? []) {
              l(chunk);
            }
          }
          for (const l of listeners.end ?? []) {
            l();
          }
        });
      }
      return req;
    },
    once(event: string, fn: (...args: unknown[]) => void) {
      return req.on(event, fn);
    },
    removeListener() {
      return req;
    },
    destroy() {},
  };
  return req as unknown as IncomingMessage;
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

function pairPrincipal(scope: PairPrincipal["scope"]): PairPrincipal {
  return {
    kind: "pair",
    scope,
    fingerprint: "abcdef0123456789abcdef",
    deviceName: "laptop",
    familyId: "fam",
    accessHash: "h",
    accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-policy-http-"));
  process.env.KOLO_HOME = home;
  __resetJobsForTest();
  engine = new PolicyEngine({
    loc: resolvePolicyLocations({ KOLO_HOME: home }),
    mode: "enforce",
    persist: false,
    audit: false,
  });
  engine.useDocument({ version: 1, kill: { mayFlip: ["owner", "admin"] } });
  setPolicyEngineForTest(engine);
});

afterEach(() => {
  setPolicyEngineForTest(null);
  delete process.env.KOLO_HOME;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("policy routes", () => {
  it("are declared with the right scopes", () => {
    const byId = new Map(GATEWAY_ROUTES.map((r) => [r.operationId, r]));
    expect(byId.get("getPolicyStatus")?.path).toBe("/api/policy/status");
    expect(routeMinScope(byId.get("getPolicyStatus")!)).toBe("observe");
    expect(routeMinScope(byId.get("killPolicy")!)).toBe("admin");
    expect(routeMinScope(byId.get("releasePolicy")!)).toBe("admin");
    expect(wsMethodMinScope("policy.status")).toBe("observe");
    expect(wsMethodMinScope("policy.kill")).toBe("admin");
    expect(wsMethodMinScope("policy.release")).toBe("admin");
  });

  it("parses the flip body", () => {
    expect(parseKillBody({ agent: "Alice" })).toEqual({ ok: true, body: { agent: "alice" } });
    expect(parseKillBody({ all: true, reason: "drill" })).toEqual({
      ok: true,
      body: { all: true, reason: "drill" },
    });
    expect(parseKillBody({}).ok).toBe(false);
    expect(parseKillBody({ agent: "../x" }).ok).toBe(false);
    expect(parseKillBody([]).ok).toBe(false);
  });

  it("status, kill and release through the HTTP handlers", async () => {
    const handlers = createPolicyHttpHandlers({ engine: () => engine });
    const job = startJob({ agent: "alice", sessionKey: "agent:alice:main" });
    markJobRunning(job.id);

    let res = makeRes();
    await handlers.getPolicyStatus(makeReq("GET", "/api/policy/status"), res, {
      url: new URL("http://x/api/policy/status"),
      params: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).status.kill.fleet).toBeNull();

    res = makeRes();
    await handlers.killPolicy(
      makeReq("POST", "/api/policy/kill", { agent: "alice", reason: "drill" }),
      res,
      { url: new URL("http://x/api/policy/kill"), params: {} },
    );
    expect(res.statusCode).toBe(200);
    const killed = JSON.parse(res.body);
    expect(killed.jobsAborted).toBe(1);
    expect(killed.status.kill.agents.alice.by).toBe("owner");
    expect(getJob(job.id)?.status).toBe("cancelled");

    res = makeRes();
    await handlers.releasePolicy(makeReq("POST", "/api/policy/release", { agent: "alice" }), res, {
      url: new URL("http://x/api/policy/release"),
      params: {},
    });
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, released: true });
    expect(engine.isKilled("alice")).toBe(false);
  });

  it("applies kill.mayFlip to the caller's scope", async () => {
    engine.useDocument({ version: 1, kill: { mayFlip: ["owner"] } });
    const handlers = createPolicyHttpHandlers({ engine: () => engine });
    const req = makeReq("POST", "/api/policy/kill", { all: true });
    setHttpPrincipal(req, pairPrincipal("admin"));
    const res = makeRes();
    await handlers.killPolicy(req, res, { url: new URL("http://x/api/policy/kill"), params: {} });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/kill\.mayFlip/);
    expect(engine.isKilled()).toBe(false);
  });

  it("the router's policy gate refuses agent-driving operations while the fleet is stopped", async () => {
    engine.kill({ by: "owner" });
    const router = createHttpRouter({
      authenticators: { "gateway-token": async () => true },
      policyGate: (_req, route) => {
        const d = engine.evaluate("request", { surface: "http", operation: route.operationId });
        return d.effect === "allow"
          ? { ok: true }
          : { ok: false, rule: d.ruleId, reason: d.reason };
      },
    });
    const handled: string[] = [];
    for (const operationId of ["createChatCompletion", "listSessions"]) {
      router.add({
        ...defineRoute({
          method: "GET",
          path: `/t/${operationId}`,
          operationId,
          summary: operationId,
          tags: ["t"],
          auth: "gateway-token",
          responses: { 200: { description: "ok" } },
        }),
        handler: (_req, res) => {
          handled.push(operationId);
          res.statusCode = 200;
          res.end("ok");
        },
      });
    }
    const denied = makeRes();
    await router.dispatch(makeReq("GET", "/t/createChatCompletion"), denied);
    expect(denied.statusCode).toBe(403);
    expect(JSON.parse(denied.body).error).toMatchObject({
      type: "policy_denied",
      rule: "kill.fleet",
    });
    const allowed = makeRes();
    await router.dispatch(makeReq("GET", "/t/listSessions"), allowed);
    expect(allowed.statusCode).toBe(200);
    expect(handled).toEqual(["listSessions"]);
  });
});

describe("policy WS methods", () => {
  function call(method: string, params: Record<string, unknown>, pairing?: PairPrincipal) {
    return new Promise<{ ok: boolean; payload?: unknown; error?: unknown }>((resolve) => {
      void policyHandlers[method]({
        req: { type: "req", id: "1", method, params },
        params,
        client: pairing
          ? ({ connect: {}, pairing } as never)
          : ({ connect: { device: { id: "dev-1" } } } as never),
        respond: (ok, payload, error) => resolve({ ok, payload, error }),
        context: {} as never,
      });
    });
  }

  it("kills and releases, naming the actor", async () => {
    const killed = await call("policy.kill", { all: true, reason: "drill" });
    expect(killed.ok).toBe(true);
    expect((killed.payload as { agent: null }).agent).toBeNull();
    expect(engine.status().kill.fleet?.by).toBe("dev-1");
    const status = await call("policy.status", {});
    expect(
      (status.payload as { status: { kill: { fleet: unknown } } }).status.kill.fleet,
    ).toBeTruthy();
    const released = await call("policy.release", { all: true }, pairPrincipal("admin"));
    expect(released.ok).toBe(true);
    expect(engine.isKilled()).toBe(false);
  });

  it("refuses bad params and scopes outside kill.mayFlip", async () => {
    const bad = await call("policy.kill", {});
    expect(bad.ok).toBe(false);
    expect(String((bad.error as { message: string }).message)).toMatch(/agent or all/);
    engine.useDocument({ version: 1, kill: { mayFlip: ["owner"] } });
    const forbidden = await call("policy.kill", { all: true }, pairPrincipal("admin"));
    expect(forbidden.ok).toBe(false);
    expect(String((forbidden.error as { message: string }).message)).toMatch(/mayFlip/);
  });
});
