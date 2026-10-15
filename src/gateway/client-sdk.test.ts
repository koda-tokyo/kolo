// @kodasoken/kurahi-client against a real gateway (M4b): /health and /doc through the generated client,
// plus one WebSocket call through the ws() helper.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KoloApiError, KoloClient } from "../../packages/client/src/index.js";
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

describe("@kodasoken/kurahi-client against the gateway", () => {
  it("getHealth() returns the deep health document", async () => {
    const client = new KoloClient({ baseUrl: `http://127.0.0.1:${port}` });
    // The test gateway has no auth profiles, so it may report unhealthy (503 with the same body).
    const res = await client.send<{ status: string; version: string }>("getHealth");
    expect([200, 503]).toContain(res.status);
    expect(["healthy", "degraded", "unhealthy"]).toContain(res.data.status);
    expect(typeof res.data.version).toBe("string");
    if (res.ok) {
      expect((await client.getHealth()).status).toBe(res.data.status);
    } else {
      const err = await client.getHealth().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(KoloApiError);
      expect((err as KoloApiError).status).toBe(503);
    }
  });

  it("getOpenApiDocument() needs the token and returns the spec the client was generated from", async () => {
    const anon = new KoloClient({ baseUrl: `http://127.0.0.1:${port}` });
    const err = await anon.getOpenApiDocument().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KoloApiError);
    expect((err as KoloApiError).status).toBe(401);

    expect(token).not.toBe("");
    const client = new KoloClient({ baseUrl: `http://127.0.0.1:${port}`, token });
    const doc = (await client.getOpenApiDocument()) as {
      openapi: string;
      paths: Record<string, Record<string, { operationId?: string }>>;
    };
    expect(doc.openapi).toMatch(/^3\.1\./);
    const ids = Object.values(doc.paths).flatMap((item) =>
      Object.values(item).map((op) => op.operationId),
    );
    for (const id of ["getHealth", "getOpenApiDocument", "getMetrics"]) {
      expect(ids).toContain(id);
    }
  });

  it("ws() completes the handshake and calls a method", async () => {
    const client = new KoloClient({ baseUrl: `http://127.0.0.1:${port}`, token });
    const sock = await client.ws({ client: { id: "test", mode: "test", version: "test" } });
    try {
      expect(sock.hello.type).toBe("hello-ok");
      const health = await sock.call("health");
      expect(health).toBeTruthy();
    } finally {
      sock.close();
    }
  });
});
