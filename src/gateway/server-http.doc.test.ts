import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testState } from "./test-helpers.mocks.js";
import { getFreePort, installGatewayTestHooks, startGatewayServer } from "./test-helpers.server.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let token = "";

beforeAll(async () => {
  delete process.env.KOLO_GATEWAY_TOKEN;
  delete process.env.KOLO_GATEWAY_PASSWORD;
  port = await getFreePort();
  server = await startGatewayServer(port, { bind: "loopback" });
  token = (testState.gatewayAuth as { token?: string } | undefined)?.token ?? "";
});

afterAll(async () => {
  await server?.close();
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;

describe("GET /doc (M4a)", () => {
  it("requires the gateway token", async () => {
    expect(token).not.toBe("");
    expect((await fetch(url("/doc"))).status).toBe(401);
    const wrong = await fetch(url("/doc"), { headers: { authorization: "Bearer nope" } });
    expect(wrong.status).toBe(401);
  });

  it("serves the OpenAPI 3.1 document generated from the registry", async () => {
    const res = await fetch(url("/doc"), { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      "x-kolo-websocket": { methods: Array<{ name: string }> };
    };
    expect(doc.openapi).toMatch(/^3\.1\./);
    const ops = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
    expect(ops).toBeGreaterThanOrEqual(20);
    expect(doc.paths["/health"].get).toBeTruthy();
    expect(
      doc["x-kolo-websocket"].methods.some((m) => m.name === "connect" || m.name === "health"),
    ).toBe(true);
  });

  it("serves the self-contained viewer at /doc/", async () => {
    const res = await fetch(url("/doc/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("KoLo Gateway API");
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("keeps /health open and answers 405 for a wrong method", async () => {
    const health = await fetch(url("/health"));
    expect([200, 503]).toContain(health.status);
    const post = await fetch(url("/health"), { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET");
    const doc = await fetch(url("/doc"), { method: "POST" });
    expect(doc.status).toBe(405);
  });

  it("still gates /metrics and admin routes", async () => {
    expect((await fetch(url("/metrics"))).status).toBe(401);
    expect((await fetch(url("/api/admin/status"))).status).toBe(401);
    expect((await fetch(url("/api/admin/nope"))).status).toBe(401);
    const metrics = await fetch(url("/metrics"), { headers: { authorization: `Bearer ${token}` } });
    expect(metrics.status).toBe(200);
  });
});
