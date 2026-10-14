import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import type { DeepHealthSummary } from "./server-methods/health.js";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  onceMessage,
  startGatewayServer,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let previousToken: string | undefined;

beforeAll(async () => {
  previousToken = process.env.KOLO_GATEWAY_TOKEN;
  delete process.env.KOLO_GATEWAY_TOKEN;
  port = await getFreePort();
  server = await startGatewayServer(port);
});

afterAll(async () => {
  await server.close();
  if (previousToken === undefined) {
    delete process.env.KOLO_GATEWAY_TOKEN;
  } else {
    process.env.KOLO_GATEWAY_TOKEN = previousToken;
  }
});

const openClient = async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => ws.once("open", resolve));
  await connectOk(ws);
  return ws;
};

describe("health.deep endpoint", () => {
  test("returns deep health summary with all sections", { timeout: 30_000 }, async () => {
    const ws = await openClient();

    ws.send(
      JSON.stringify({
        type: "req",
        id: "deep1",
        method: "health.deep",
      }),
    );

    const res = await onceMessage(ws, (o) => o.type === "res" && o.id === "deep1");
    expect(res.ok).toBe(true);

    const payload = res.payload as DeepHealthSummary;

    // Top-level shape
    expect(payload.ok).toBe(true);
    expect(typeof payload.ts).toBe("number");
    expect(typeof payload.durationMs).toBe("number");

    // Gateway section
    expect(typeof payload.gateway.uptimeMs).toBe("number");
    expect(payload.gateway.uptimeMs).toBeGreaterThan(0);
    expect(typeof payload.gateway.pid).toBe("number");
    expect(typeof payload.gateway.memoryMb).toBe("number");
    expect(typeof payload.gateway.nodeVersion).toBe("string");
    expect(payload.gateway.nodeVersion).toMatch(/^v\d+/);
    expect(typeof payload.gateway.platform).toBe("string");

    // Auth section
    expect(typeof payload.auth.totalProfiles).toBe("number");
    expect(typeof payload.auth.validProfiles).toBe("number");
    expect(typeof payload.auth.expiringWithinHour).toBe("number");
    expect(Array.isArray(payload.auth.profiles)).toBe(true);

    // Each auth profile has the right shape
    for (const profile of payload.auth.profiles) {
      expect(typeof profile.profileId).toBe("string");
      expect(typeof profile.provider).toBe("string");
      expect(["api_key", "oauth", "token"]).toContain(profile.type);
      expect(typeof profile.valid).toBe("boolean");
      expect(typeof profile.inCooldown).toBe("boolean");
      // ttlMs and expiresAt can be null
      if (profile.ttlMs !== null) {
        expect(typeof profile.ttlMs).toBe("number");
      }
      if (profile.expiresAt !== null) {
        expect(typeof profile.expiresAt).toBe("string");
      }
    }

    // Providers section (may be empty if no consciousness engine is running)
    expect(typeof payload.providers).toBe("object");

    // Consciousness section (may be empty array in test)
    expect(Array.isArray(payload.consciousness)).toBe(true);
    for (const entry of payload.consciousness) {
      expect(typeof entry.agentId).toBe("string");
      expect(typeof entry.running).toBe("boolean");
      expect(typeof entry.circuitBroken).toBe("boolean");
      expect(typeof entry.totalTicks).toBe("number");
      expect(typeof entry.consecutiveErrors).toBe("number");
    }

    ws.close();
  });

  test("health.deep is accessible with read scope", { timeout: 15_000 }, async () => {
    const ws = await openClient();

    ws.send(
      JSON.stringify({
        type: "req",
        id: "deep-read",
        method: "health.deep",
      }),
    );

    const res = await onceMessage(ws, (o) => o.type === "res" && o.id === "deep-read");
    expect(res.ok).toBe(true);
    expect(res.payload?.ok).toBe(true);

    ws.close();
  });
});
