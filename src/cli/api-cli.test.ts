import { KoloClient } from "@kodasoken/kurahi-client";
import { describe, expect, it } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import {
  API_EXIT,
  parseJsonArg,
  parseParams,
  resolveOperationId,
  runApiCall,
  runApiList,
  runApiWs,
} from "./api-cli.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const runtime: RuntimeEnv = {
    log: (...a: unknown[]) => void out.push(a.join(" ")),
    error: (...a: unknown[]) => void err.push(a.join(" ")),
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
  };
  return { out, err, runtime };
}

function clientWith(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new KoloClient({
    baseUrl: "http://127.0.0.1:18861",
    token: "tok",
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  });
  return { calls, createClient: async () => client };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("kurahi api", () => {
  it("resolves operation ids and shorthands", () => {
    expect(resolveOperationId("getHealth")).toBe("getHealth");
    expect(resolveOperationId("gethealth")).toBe("getHealth");
    expect(resolveOperationId("health")).toBe("getHealth");
    expect(resolveOperationId("metrics")).toBe("getMetrics");
    expect(resolveOperationId("/v1/responses")).toBe("createResponse");
    expect(resolveOperationId("nope")).toBeUndefined();
  });

  it("parses params and JSON arguments", () => {
    expect(parseParams(["a=1", "b=x=y", "a=2"])).toEqual({ a: ["1", "2"], b: "x=y" });
    expect(() => parseParams(["novalue"])).toThrow(/k=v/);
    expect(parseJsonArg('{"x":1}', {}, "--body")).toEqual({ x: 1 });
    expect(parseJsonArg("@f.json", { readFile: () => "[1]" }, "--body")).toEqual([1]);
    expect(parseJsonArg("@-", { readStdin: () => '"s"' }, "--body")).toBe("s");
    expect(() => parseJsonArg("{", {}, "--body")).toThrow(/not valid JSON/);
  });

  it("lists operations and WebSocket methods", () => {
    const c = capture();
    runApiList({}, c.runtime);
    expect(c.out.some((l) => /^getHealth\s+GET\s+\/health\s+none/.test(l))).toBe(true);
    const j = capture();
    runApiList({ json: true, raw: true }, j.runtime);
    const ops = JSON.parse(j.out[0]) as Array<{ operationId: string }>;
    expect(ops.map((o) => o.operationId)).toContain("getOpenApiDocument");
    const w = capture();
    runApiList({ ws: true, json: true }, w.runtime);
    expect((JSON.parse(w.out.join("\n")) as { methods: string[] }).methods).toContain("health");
  });

  it("prints the JSON body of a successful call", async () => {
    const c = capture();
    const m = clientWith(() => json(200, { status: "healthy" }));
    const code = await runApiCall(
      "health",
      {},
      { runtime: c.runtime, createClient: m.createClient },
    );
    expect(code).toBe(API_EXIT.ok);
    expect(JSON.parse(c.out.join("\n"))).toEqual({ status: "healthy" });
    expect(m.calls[0].url).toBe("http://127.0.0.1:18861/health");

    const raw = capture();
    await runApiCall(
      "listAuditEvents",
      { param: ["limit=3"], raw: true },
      { runtime: raw.runtime, createClient: m.createClient },
    );
    expect(raw.out).toEqual(['{"status":"healthy"}']);
    expect(m.calls[1].url).toBe("http://127.0.0.1:18861/api/admin/audit?limit=3");
    expect(new Headers(m.calls[1].init.headers).get("authorization")).toBe("Bearer tok");
  });

  it("exits non-zero with the error model on an HTTP error", async () => {
    const c = capture();
    const m = clientWith(() =>
      json(401, { error: { message: "Unauthorized", type: "unauthorized" } }),
    );
    const code = await runApiCall(
      "getOpenApiDocument",
      {},
      { runtime: c.runtime, createClient: m.createClient },
    );
    expect(code).toBe(API_EXIT.http);
    expect(JSON.parse(c.err.join("\n"))).toEqual({
      ok: false,
      operationId: "getOpenApiDocument",
      status: 401,
      error: { error: { message: "Unauthorized", type: "unauthorized" } },
    });
  });

  it("reports usage errors and unreachable gateways", async () => {
    const m = clientWith(() => json(200, {}));
    const u = capture();
    expect(await runApiCall("nope", {}, { runtime: u.runtime, createClient: m.createClient })).toBe(
      API_EXIT.usage,
    );
    expect(u.err[0]).toMatch(/unknown operationId "nope"/);
    const p = capture();
    expect(
      await runApiCall(
        "getHealth",
        { param: ["x=1"] },
        { runtime: p.runtime, createClient: m.createClient },
      ),
    ).toBe(API_EXIT.usage);
    expect(p.err[0]).toMatch(/unknown parameter "x"/);
    const down = capture();
    const dead = new KoloClient({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(
      await runApiCall("getHealth", {}, { runtime: down.runtime, createClient: async () => dead }),
    ).toBe(API_EXIT.unreachable);
    const ws = capture();
    expect(await runApiWs(undefined, undefined, {}, { runtime: ws.runtime })).toBe(API_EXIT.usage);
  });
});
