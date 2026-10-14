import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearDeviceAuthToken,
  loadDeviceAuthToken,
  normalizeGatewayKey,
  storeDeviceAuthToken,
} from "./device-auth-store.js";

let dir: string;
let env: NodeJS.ProcessEnv;
const deviceId = "dev-1";
const IRIS = "ws://127.0.0.1:18791";
const ORION = "ws://[::1]:18889";

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-devauth-"));
  env = { KOLO_STATE_DIR: dir };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const storePath = () => path.join(dir, "identity", "device-auth.json");

describe("device-auth store keyed by gateway", () => {
  it("normalizes loopback spellings and default ports", () => {
    expect(normalizeGatewayKey("ws://localhost:18889/")).toBe("ws://loopback:18889");
    expect(normalizeGatewayKey("ws://[::1]:18889")).toBe("ws://loopback:18889");
    expect(normalizeGatewayKey("wss://gw.example.com")).toBe("wss://gw.example.com:443");
  });

  it("two gateways on one host never swap tokens", () => {
    storeDeviceAuthToken({ deviceId, role: "operator", token: "iris-tok", gatewayUrl: IRIS, env });
    storeDeviceAuthToken({
      deviceId,
      role: "operator",
      token: "orion-tok",
      gatewayUrl: ORION,
      env,
    });
    expect(loadDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: IRIS, env })?.token).toBe(
      "iris-tok",
    );
    expect(
      loadDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: "ws://localhost:18889", env })
        ?.token,
    ).toBe("orion-tok");
    clearDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: IRIS, env });
    expect(loadDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: IRIS, env })).toBeNull();
    expect(loadDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: ORION, env })?.token).toBe(
      "orion-tok",
    );
  });

  it("migrates v1 role-only entries on read and drops them once keyed", () => {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(
      storePath(),
      JSON.stringify({
        version: 1,
        deviceId,
        tokens: { operator: { token: "legacy", role: "operator", scopes: [], updatedAtMs: 1 } },
      }),
    );
    // Legacy entry is offered as a fallback for any gateway.
    expect(loadDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: IRIS, env })?.token).toBe(
      "legacy",
    );
    storeDeviceAuthToken({ deviceId, role: "operator", token: "iris-tok", gatewayUrl: IRIS, env });
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    expect(raw.version).toBe(2);
    expect(raw.tokens.operator).toBeUndefined();
    expect(raw.tokens["ws://loopback:18791|operator"].token).toBe("iris-tok");
    // The other gateway no longer sees Iris's token.
    expect(loadDeviceAuthToken({ deviceId, role: "operator", gatewayUrl: ORION, env })).toBeNull();
    if (process.platform !== "win32") {
      expect(fs.statSync(storePath()).mode & 0o777).toBe(0o600);
    }
  });
});
