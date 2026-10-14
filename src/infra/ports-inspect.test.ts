import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectPortUsage } from "./ports-inspect.js";

async function listenLoopback(): Promise<{ server: net.Server; port: number }> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: (server.address() as net.AddressInfo).port };
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kolo-ports-inspect-"));
}

describe("inspectPortUsage (Node only, no lsof)", () => {
  it("reports free for an unused port", async () => {
    const { server, port } = await listenLoopback();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const result = await inspectPortUsage(port, { env: { KOLO_HOME: tempHome() } });
    expect(result.status).toBe("free");
    expect(result.listeners).toEqual([]);
  });

  it("reports an unknown holder when the port is busy but no gateway lock names it", async () => {
    const { server, port } = await listenLoopback();
    try {
      const result = await inspectPortUsage(port, { env: { KOLO_HOME: tempHome() } });
      expect(result.status).toBe("busy");
      expect(result.listeners).toEqual([]);
      expect(result.hints.join("\n")).toContain("unknown holder");
    } finally {
      server.close();
    }
  });

  it("names the gateway from this state root's lease lock", async () => {
    const { server, port } = await listenLoopback();
    const home = tempHome();
    fs.mkdirSync(path.join(home, "run"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "run", "gateway.lock"),
      JSON.stringify({ pid: process.pid, port }),
    );
    try {
      const result = await inspectPortUsage(port, { env: { KOLO_HOME: home } });
      expect(result.status).toBe("busy");
      expect(result.listeners.map((l) => l.pid)).toEqual([process.pid]);
      expect(result.hints.join("\n")).toContain("Gateway already running");
    } finally {
      server.close();
    }
  });
});
