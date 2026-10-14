import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probePort } from "../infra/port-probe.js";
import { forceFreePort, forceFreePortAndWait, listPortListeners } from "./ports.js";

// A real child process holding a real port: exercises the Node-only probe and kill path.
async function spawnListener(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)+'\\n'));setInterval(()=>{},1000);",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout?.once("data", (buf: Buffer) => resolve(Number.parseInt(buf.toString(), 10)));
    child.once("error", reject);
  });
  return { child, port };
}

function writeLock(home: string, payload: Record<string, unknown>) {
  fs.mkdirSync(path.join(home, "run"), { recursive: true });
  fs.writeFileSync(path.join(home, "run", "gateway.lock"), JSON.stringify(payload));
}

describe("gateway --force helpers (no lsof)", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;
  const children: ChildProcess[] = [];

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-force-"));
    env = { KOLO_HOME: home, KOLO_CONFIG_PATH: path.join(home, "kolo.json") };
  });

  afterEach(() => {
    for (const child of children.splice(0)) {
      child.kill("SIGKILL");
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("returns nothing to kill when the port is free", async () => {
    const server = net.createServer();
    const port = await new Promise<number>((r) =>
      server.listen(0, "127.0.0.1", () => r((server.address() as net.AddressInfo).port)),
    );
    await new Promise<void>((r) => server.close(() => r()));
    expect(await forceFreePort(port, env)).toEqual([]);
  });

  it("kills the pid named by the gateway lock and waits for the port", async () => {
    const { child, port } = await spawnListener();
    children.push(child);
    writeLock(home, { pid: child.pid, port, hostname: os.hostname(), startedAt: Date.now() });

    expect(listPortListeners(port, env).map((p) => p.pid)).toEqual([child.pid]);
    const res = await forceFreePortAndWait(port, { env, timeoutMs: 5000, intervalMs: 50 });
    expect(res.killed.map((p) => p.pid)).toEqual([child.pid]);
    expect(await probePort(port)).toBe("free");
  });

  it("refuses to kill a process that no lock names", async () => {
    const { child, port } = await spawnListener();
    children.push(child);
    await expect(forceFreePort(port, env)).rejects.toThrow(/refusing to kill/);
    expect(child.exitCode).toBeNull();
  });

  it("ignores a lock whose port does not match", async () => {
    const { child, port } = await spawnListener();
    children.push(child);
    writeLock(home, { pid: child.pid, port: port + 1 });
    await expect(forceFreePort(port, env)).rejects.toThrow(/refusing to kill/);
  });
});
