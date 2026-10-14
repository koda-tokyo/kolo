import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createHttpRouter, defineMount, defineRoute, type BoundRoute } from "./http-registry.js";

function makeReq(method: string, url: string, headers: Record<string, string> = {}) {
  return {
    method,
    url,
    headers,
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
  return res;
}

const ok =
  (id: string): BoundRoute["handler"] =>
  (_req, res, ctx) => {
    res.statusCode = 200;
    res.end(JSON.stringify({ id, params: ctx.params }));
  };

function route(partial: Partial<BoundRoute> & Pick<BoundRoute, "method" | "path" | "operationId">) {
  return defineRoute({
    summary: partial.operationId,
    tags: ["t"],
    auth: "none",
    responses: { 200: { description: "ok" } },
    ...partial,
  } as BoundRoute);
}

describe("http route registry", () => {
  it("matches literal paths and path parameters, most specific first", () => {
    const router = createHttpRouter()
      .add(route({ method: "GET", path: "/a/{id}", operationId: "byId" }))
      .add(route({ method: "GET", path: "/a/new", operationId: "fresh" }))
      .add(route({ method: "GET", path: "/a/{id}/b/{sub}", operationId: "nested" }));

    const one = router.match("GET", "/a/new");
    expect(one.kind === "match" && one.route.operationId).toBe("fresh");

    const two = router.match("get", "/a/u%201");
    expect(two.kind).toBe("match");
    expect(two.kind === "match" && two.params).toEqual({ id: "u 1" });

    const three = router.match("GET", "/a/x/b/y");
    expect(three.kind === "match" && three.params).toEqual({ id: "x", sub: "y" });

    expect(router.match("GET", "/a").kind).toBe("none");
    expect(router.match("GET", "/a/").kind).toBe("none"); // empty segment never binds a param
    expect(router.match("GET", "/a/%E0%A4%A").kind).toBe("none"); // malformed escape
    expect(router.match("GET", "/a/x/b").kind).toBe("none");
  });

  it("answers 405 with Allow when the path exists for other methods", async () => {
    const router = createHttpRouter()
      .add(route({ method: "GET", path: "/x", operationId: "getX", handler: ok("g") }))
      .add(route({ method: "POST", path: "/x", operationId: "postX", handler: ok("p") }));
    expect(router.match("DELETE", "/x")).toEqual({
      kind: "method-not-allowed",
      allow: ["GET", "POST"],
    });

    const res = makeRes();
    expect(await router.dispatch(makeReq("PUT", "/x"), res as unknown as ServerResponse)).toBe(
      true,
    );
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("GET, POST");

    const res2 = makeRes();
    await router.dispatch(makeReq("POST", "/x?q=1"), res2 as unknown as ServerResponse);
    expect(JSON.parse(res2.body).id).toBe("p");
  });

  it("enforces the auth kind before the handler and fails closed without an authenticator", async () => {
    const handler = vi.fn(ok("admin"));
    const router = createHttpRouter({
      authenticators: {
        "gateway-token": (req) => req.headers.authorization === "Bearer good",
      },
    })
      .add(route({ method: "GET", path: "/gw", operationId: "gw", auth: "gateway-token", handler }))
      .add(
        route({
          method: "GET",
          path: "/either",
          operationId: "either",
          auth: ["session-admin", "gateway-token"],
          handler,
        }),
      )
      .add(route({ method: "GET", path: "/mk", operationId: "mk", auth: "migrate-key", handler }))
      .add(
        route({
          method: "GET",
          path: "/own",
          operationId: "own",
          auth: "migrate-key",
          authEnforcedBy: "handler",
          handler,
        }),
      );

    const call = async (path: string, headers?: Record<string, string>) => {
      const res = makeRes();
      await router.dispatch(makeReq("GET", path, headers), res as unknown as ServerResponse);
      return res.statusCode;
    };
    expect(await call("/gw")).toBe(401);
    expect(await call("/gw", { authorization: "Bearer bad" })).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(await call("/gw", { authorization: "Bearer good" })).toBe(200);
    // Alternatives: no session-admin authenticator registered, gateway token still accepted.
    expect(await call("/either", { authorization: "Bearer good" })).toBe(200);
    expect(await call("/either")).toBe(401);
    // No migrate-key authenticator: fail closed.
    expect(await call("/mk", { "x-migrate-key": "anything" })).toBe(401);
    // Handler-enforced auth is left to the handler.
    expect(await call("/own")).toBe(200);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it("dispatches by stage, skips disabled and declared-only routes, honours declines", async () => {
    let enabled = false;
    const router = createHttpRouter()
      .add(
        route({
          method: "GET",
          path: "/live",
          operationId: "live",
          stage: "pre-auth",
          handler: ok("l"),
        }),
      )
      .add(
        route({
          method: "GET",
          path: "/opt",
          operationId: "opt",
          handler: ok("o"),
          enabled: () => enabled,
        }),
      )
      .add(route({ method: "POST", path: "/declared", operationId: "declared", servedBy: "m" }))
      .add(
        route({ method: "GET", path: "/decline", operationId: "decline", handler: () => false }),
      );

    const run = async (method: string, path: string, stage?: "pre-auth" | "main") => {
      const res = makeRes();
      const handled = await router.dispatch(
        makeReq(method, path),
        res as unknown as ServerResponse,
        {
          stage,
        },
      );
      return { handled, status: res.statusCode };
    };
    expect((await run("GET", "/live")).handled).toBe(false);
    expect(await run("GET", "/live", "pre-auth")).toEqual({ handled: true, status: 200 });
    expect((await run("GET", "/opt")).handled).toBe(false);
    enabled = true;
    expect((await run("GET", "/opt")).handled).toBe(true);
    expect((await run("POST", "/declared")).handled).toBe(false);
    expect((await run("GET", "/declared")).handled).toBe(false); // no 405 from declared-only
    expect((await run("GET", "/decline")).handled).toBe(false);
  });

  it("runs mounts per phase in order", async () => {
    const seen: string[] = [];
    const router = createHttpRouter()
      .mount(
        defineMount({
          id: "a",
          summary: "a",
          paths: ["/a/*"],
          methods: "*",
          auth: "none",
          reason: "static",
          handler: () => {
            seen.push("a");
            return false;
          },
        }),
      )
      .mount(
        defineMount({
          id: "b",
          summary: "b",
          paths: ["/b/*"],
          methods: "*",
          auth: "none",
          phase: "before-routes",
          reason: "prefix",
          handler: () => {
            seen.push("b");
            return true;
          },
        }),
      );
    const res = makeRes() as unknown as ServerResponse;
    expect(await router.dispatchMounts(makeReq("GET", "/"), res, "after-routes")).toBe(false);
    expect(await router.dispatchMounts(makeReq("GET", "/"), res, "before-routes")).toBe(true);
    expect(seen).toEqual(["a", "b"]);
  });

  it("rejects malformed declarations", () => {
    expect(() => route({ method: "GET", path: "nope", operationId: "x" })).toThrow(/must start/);
    expect(() => route({ method: "GET", path: "/a/{bad", operationId: "x" })).toThrow(/malformed/);
    expect(() => route({ method: "GET", path: "/a", operationId: "Bad-Id" })).toThrow(/camel/i);
    expect(() =>
      route({ method: "GET", path: "/a", operationId: "x", auth: ["none", "gateway-token"] }),
    ).toThrow(/none/);
    expect(() =>
      route({ method: "GET", path: "/a", operationId: "x", responses: { 404: "NotFound" } }),
    ).toThrow(/2xx/);
    const router = createHttpRouter().add(route({ method: "GET", path: "/a", operationId: "x" }));
    expect(() => router.add(route({ method: "GET", path: "/a", operationId: "y" }))).toThrow(
      /duplicate/,
    );
    expect(() => router.add(route({ method: "POST", path: "/b", operationId: "x" }))).toThrow(
      /duplicate/,
    );
    expect(() =>
      defineMount({ id: "m", summary: "m", paths: [], methods: "*", auth: "none", reason: " " }),
    ).toThrow(/reason/);
  });
});
