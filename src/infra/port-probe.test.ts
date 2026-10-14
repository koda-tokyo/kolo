import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pidListensOnPort,
  probePort,
  readGatewayLockOwners,
  resolveGatewayLockPaths,
} from "./port-probe.js";

function listen(host = "127.0.0.1"): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      resolve({ server, port: (server.address() as net.AddressInfo).port });
    });
  });
}

const close = (server: net.Server) => new Promise<void>((r) => server.close(() => r()));

describe("probePort", () => {
  const servers: net.Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
  });

  it("reports busy while a server listens on loopback", async () => {
    const { server, port } = await listen();
    servers.push(server);
    expect(await probePort(port)).toBe("busy");
  });

  it("reports busy for a wildcard listener", async () => {
    const { server, port } = await listen("0.0.0.0");
    servers.push(server);
    expect(await probePort(port)).toBe("busy");
  });

  it("reports free once the server is closed", async () => {
    const { server, port } = await listen();
    await close(server);
    expect(await probePort(port)).toBe("free");
  });

  it.runIf(process.platform === "linux")("verifies socket ownership through /proc", async () => {
    const { server, port } = await listen();
    servers.push(server);
    expect(pidListensOnPort(process.pid, port)).toBe(true);
    // pid 1 does not own our ephemeral port (or /proc denies access → null).
    expect(pidListensOnPort(1, port)).not.toBe(true);
  });
});

describe("gateway lock owners", () => {
  it("reads <KOLO_HOME>/run/gateway.lock with pid and port", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-lock-"));
    try {
      fs.mkdirSync(path.join(home, "run"));
      fs.writeFileSync(
        path.join(home, "run", "gateway.lock"),
        JSON.stringify({ pid: 4242, port: 18800, hostname: "h", startedAt: 1 }),
      );
      const env = { KOLO_HOME: home } as NodeJS.ProcessEnv;
      expect(resolveGatewayLockPaths(env)[0]).toBe(path.join(home, "run", "gateway.lock"));
      expect(readGatewayLockOwners(env)).toEqual([
        { pid: 4242, port: 18800, lockPath: path.join(home, "run", "gateway.lock") },
      ]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("ignores malformed lock files", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-lock-"));
    try {
      fs.mkdirSync(path.join(home, "run"));
      fs.writeFileSync(path.join(home, "run", "gateway.lock"), "{not json");
      expect(readGatewayLockOwners({ KOLO_HOME: home } as NodeJS.ProcessEnv)).toEqual([]);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
