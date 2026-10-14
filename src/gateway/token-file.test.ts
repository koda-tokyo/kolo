import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveGatewayAuth } from "./auth.js";
import {
  ensureGatewayTokenFile,
  resolveGatewayTokenFilePath,
  resolveGatewayTokenWithSource,
  resetGatewayTokenWarningsForTest,
} from "./token-file.js";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-token-"));
  env = { KOLO_HOME: home };
  resetGatewayTokenWarningsForTest();
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

function writeTokenFile(token: string): string {
  const dir = path.join(home, "secrets");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "gateway.token");
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return file;
}

describe("gateway token precedence", () => {
  it("file > env > legacy config", () => {
    const authConfig = { token: "legacy-token" };
    expect(resolveGatewayTokenWithSource({ authConfig, env })).toMatchObject({
      token: "legacy-token",
      source: "config",
    });
    const withEnv = { ...env, KOLO_GATEWAY_TOKEN: "env-token" };
    expect(resolveGatewayTokenWithSource({ authConfig, env: withEnv })).toMatchObject({
      token: "env-token",
      source: "env",
    });
    writeTokenFile("file-token");
    expect(resolveGatewayTokenWithSource({ authConfig, env: withEnv })).toMatchObject({
      token: "file-token",
      source: "file",
    });
    const auth = resolveGatewayAuth({ authConfig, env: withEnv });
    expect(auth.token).toBe("file-token");
    expect(auth.tokenSource).toBe("file");
  });

  it("defaults the file to <KOLO_HOME>/secrets/gateway.token", () => {
    expect(resolveGatewayTokenFilePath({ env })).toBe(path.join(home, "secrets", "gateway.token"));
  });

  it("honors gateway.auth.tokenFile and KOLO_GATEWAY_TOKEN_FILE", () => {
    const custom = path.join(home, "custom.token");
    fs.writeFileSync(custom, "custom-token\n", { mode: 0o600 });
    expect(resolveGatewayTokenWithSource({ authConfig: { tokenFile: custom }, env }).token).toBe(
      "custom-token",
    );
    const other = path.join(home, "other.token");
    fs.writeFileSync(other, "other-token\n", { mode: 0o600 });
    expect(
      resolveGatewayTokenWithSource({
        authConfig: { tokenFile: custom },
        env: { ...env, KOLO_GATEWAY_TOKEN_FILE: other },
      }).token,
    ).toBe("other-token");
  });

  it("tokenFile:false disables the file source", () => {
    writeTokenFile("file-token");
    const res = resolveGatewayTokenWithSource({
      authConfig: { tokenFile: false, token: "legacy-token" },
      env,
    });
    expect(res).toMatchObject({ token: "legacy-token", source: "config", tokenFile: null });
  });

  it("does not create the file unless asked (clients, doctor)", () => {
    const auth = resolveGatewayAuth({ authConfig: {}, env });
    expect(auth.token).toBeUndefined();
    expect(fs.existsSync(path.join(home, "secrets", "gateway.token"))).toBe(false);
  });
});

describe("gateway token file creation", () => {
  it("generates a 32-byte hex token with mode 0600 on first start", () => {
    const auth = resolveGatewayAuth({ authConfig: {}, env, ensureTokenFile: true });
    const file = path.join(home, "secrets", "gateway.token");
    expect(auth.tokenSource).toBe("file");
    expect(auth.token).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readFileSync(file, "utf8").trim()).toBe(auth.token);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    }
    // Second start reuses the same token.
    const again = resolveGatewayAuth({ authConfig: {}, env, ensureTokenFile: true });
    expect(again.token).toBe(auth.token);
  });

  it("does not generate when a legacy or env token is present", () => {
    const auth = resolveGatewayAuth({
      authConfig: { token: "legacy-token" },
      env,
      ensureTokenFile: true,
    });
    expect(auth.token).toBe("legacy-token");
    expect(fs.existsSync(path.join(home, "secrets", "gateway.token"))).toBe(false);
  });

  it("does not generate in password mode", () => {
    resolveGatewayAuth({ authConfig: { password: "pw" }, env, ensureTokenFile: true });
    expect(fs.existsSync(path.join(home, "secrets", "gateway.token"))).toBe(false);
  });

  it("returns the existing token instead of overwriting", () => {
    const file = writeTokenFile("existing-token");
    expect(ensureGatewayTokenFile(file, env)).toEqual({ token: "existing-token", created: false });
  });
});
