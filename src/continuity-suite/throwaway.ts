// Throwaway gateway for the continuity suite (KoLo 2.0, M11b): a fresh state dir, a config that
// points at the fake provider, a seeded resident, and a child `kolo gateway` process the runner
// can stop, restart and move. Only the state dir it created is ever written; the home must live
// under the OS temp dir or end in ".kolo-test" so a typo cannot wipe a real installation.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FactProbe } from "./types.js";
import { waitFor } from "./client.js";
import {
  FAKE_API_KEY_ENV,
  type FakeProfile,
  FAKE_PROVIDER_ID,
  fakeModelRef,
  fakeProviderConfig,
} from "./fake-provider.js";
import {
  DEFAULT_RESIDENT_ID,
  newIdentityMarker,
  SEED_FACTS,
  seedResidentWorkspace,
} from "./seed.js";

const READY_STATES = new Set(["gateway_ready", "consciousness_ready", "degraded"]);
const BOOT_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 10_000;

export function assertThrowawayHome(home: string): void {
  const resolved = path.resolve(home);
  const tmp = path.resolve(os.tmpdir());
  const underTmp = resolved === tmp ? false : resolved.startsWith(`${tmp}${path.sep}`);
  if (!underTmp && !path.basename(resolved).endsWith(".kolo-test")) {
    throw new Error(
      `refusing to use ${resolved} as a throwaway home: it must be under the OS temp dir or end in ".kolo-test"`,
    );
  }
}

/** `dist/entry.js` next to this module when built, or the repository build when run from src. */
export function resolveGatewayEntry(explicit?: string): string {
  if (explicit) {
    return path.resolve(explicit);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "..", "entry.js"),
    path.join(here, "..", "..", "dist", "entry.js"),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) {
    throw new Error("dist/entry.js not found; run `pnpm build` first or pass --entry");
  }
  return found;
}

export async function portFree(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

export async function pickFreePort(preferred?: number): Promise<number> {
  if (preferred && (await portFree(preferred))) {
    return preferred;
  }
  if (preferred) {
    throw new Error(`port ${preferred} is in use`);
  }
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export type ThrowawayOptions = {
  home: string;
  port?: number;
  entry?: string;
  providerBaseUrl: string;
  agentId?: string;
  profile?: FakeProfile;
  facts?: FactProbe[];
  marker?: string;
  logName?: string;
  /** Extra top-level config keys merged into the generated kolo.json (M14: channels). */
  extraConfig?: Record<string, unknown>;
};

export class ThrowawayGateway {
  home: string;
  readonly port: number;
  readonly token: string;
  readonly entry: string;
  readonly agentId: string;
  readonly marker: string;
  readonly facts: FactProbe[];
  readonly providerBaseUrl: string;
  private child: ChildProcess | null = null;
  private logFd: number | null = null;
  readonly logName: string;
  readonly extraConfig: Record<string, unknown>;

  private constructor(opts: ThrowawayOptions & { port: number; entry: string }) {
    this.home = path.resolve(opts.home);
    this.port = opts.port;
    this.entry = opts.entry;
    this.token = randomBytes(24).toString("hex");
    this.agentId = opts.agentId ?? DEFAULT_RESIDENT_ID;
    this.marker = opts.marker ?? newIdentityMarker();
    this.facts = opts.facts ?? SEED_FACTS;
    this.providerBaseUrl = opts.providerBaseUrl;
    this.logName = opts.logName ?? "continuity-gateway.log";
    this.extraConfig = opts.extraConfig ?? {};
  }

  /** Wipes and seeds the home; does not start the process. */
  static async create(opts: ThrowawayOptions): Promise<ThrowawayGateway> {
    assertThrowawayHome(opts.home);
    const gw = new ThrowawayGateway({
      ...opts,
      port: await pickFreePort(opts.port),
      entry: resolveGatewayEntry(opts.entry),
    });
    fs.rmSync(gw.home, { recursive: true, force: true });
    fs.mkdirSync(path.join(gw.home, "secrets"), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(gw.home, "secrets", "gateway.token"), `${gw.token}\n`, {
      mode: 0o600,
    });
    gw.writeConfig(opts.profile ?? "alpha");
    seedResidentWorkspace({
      workspaceDir: gw.workspaceDir,
      agentId: gw.agentId,
      marker: gw.marker,
      facts: gw.facts,
    });
    const sessionsDir = path.join(gw.home, "agents", gw.agentId, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(sessionsDir, "sessions.json"),
      `${JSON.stringify({ [`agent:${gw.agentId}:main`]: { sessionId: "main-session-1", updatedAt: Date.now(), label: "main" } }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return gw;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get workspaceDir(): string {
    return path.join(this.home, "workspace");
  }

  get configPath(): string {
    return path.join(this.home, "kolo.json");
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  writeConfig(profile: FakeProfile): void {
    const config = {
      gateway: {
        mode: "local",
        port: this.port,
        bind: "loopback",
        auth: { mode: "token" },
        http: { endpoints: { chatCompletions: { enabled: true } } },
      },
      agents: {
        list: [{ id: this.agentId, default: true }],
        defaults: { model: { primary: fakeModelRef(profile) } },
      },
      models: { providers: { [FAKE_PROVIDER_ID]: fakeProviderConfig(this.providerBaseUrl) } },
      ...this.extraConfig,
    };
    fs.writeFileSync(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  }

  /** The model profile swap: edit the config on disk; the gateway reads agent defaults per run. */
  setProfile(profile: FakeProfile): string {
    const raw = JSON.parse(fs.readFileSync(this.configPath, "utf8")) as {
      agents: { defaults: { model: { primary: string } } };
    };
    raw.agents.defaults.model.primary = fakeModelRef(profile);
    fs.writeFileSync(this.configPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    return fakeModelRef(profile);
  }

  env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^(KOLO|CLAWDBOT)_/.test(k) && v !== undefined) {
        env[k] = v;
      }
    }
    return {
      ...env,
      KOLO_HOME: this.home,
      KOLO_STATE_DIR: this.home,
      KOLO_SHARED_HOME: this.home,
      KOLO_CONFIG_PATH: this.configPath,
      KOLO_GATEWAY_PORT: String(this.port),
      KOLO_GATEWAY_TOKEN: this.token,
      KOLO_SKIP_CHANNELS: "1",
      CLAWDBOT_SKIP_CHANNELS: "1",
      KOLO_SERVICE_ID: "continuity",
      KOLO_CONFIG_CACHE_MS: "0",
      [FAKE_API_KEY_ENV]: "continuity-fake",
      NO_COLOR: "1",
    };
  }

  async start(): Promise<{ pid: number; bootMs: number }> {
    if (this.child) {
      throw new Error("gateway already running");
    }
    const logFile = path.join(this.home, this.logName);
    this.logFd = fs.openSync(logFile, "a", 0o600);
    const t0 = Date.now();
    const child = spawn(process.execPath, [this.entry, "gateway", "--port", String(this.port)], {
      cwd: this.home,
      env: this.env(),
      stdio: ["ignore", this.logFd, this.logFd],
      windowsHide: true,
    });
    this.child = child;
    await waitFor(
      async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `gateway exited early (code=${child.exitCode} signal=${child.signalCode})`,
          );
        }
        const res = await fetch(`${this.baseUrl}/health`, {
          headers: { authorization: `Bearer ${this.token}` },
          signal: AbortSignal.timeout(2000),
        });
        if (res.status !== 200) {
          return false;
        }
        const body = (await res.json()) as { readiness?: string };
        return READY_STATES.has(body.readiness ?? "") ? body : false;
      },
      { timeoutMs: BOOT_TIMEOUT_MS, intervalMs: 1500, what: "gateway /health" },
    ).catch((err) => {
      this.killNow();
      throw new Error(`${String(err)}\n--- log tail ---\n${this.logTail(1500)}`);
    });
    return { pid: child.pid ?? -1, bootMs: Date.now() - t0 };
  }

  private killNow(): void {
    try {
      this.child?.kill("SIGKILL");
    } catch {
      // already gone
    }
    this.child = null;
    if (this.logFd !== null) {
      fs.closeSync(this.logFd);
      this.logFd = null;
    }
  }

  async stop(): Promise<string> {
    const child = this.child;
    if (!child) {
      return "not running";
    }
    const exited = new Promise<string>((resolve) =>
      child.once("exit", (code, signal) =>
        resolve(`code=${code ?? "?"}${signal ? ` signal=${signal}` : ""}`),
      ),
    );
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
    let how = "SIGTERM";
    let result = await Promise.race([
      exited,
      new Promise<null>((r) => setTimeout(r, STOP_TIMEOUT_MS, null)),
    ]);
    if (result === null) {
      child.kill("SIGKILL");
      how = "SIGKILL";
      result = await Promise.race([exited, new Promise<null>((r) => setTimeout(r, 5000, null))]);
    }
    this.child = null;
    if (this.logFd !== null) {
      fs.closeSync(this.logFd);
      this.logFd = null;
    }
    await waitFor(() => portFree(this.port), {
      timeoutMs: 10_000,
      intervalMs: 250,
      what: `port ${this.port} release`,
    });
    return `${how}(${result ?? "no exit"})`;
  }

  /** Stop, rename the state dir, start again from the new path. */
  async move(newHome: string): Promise<void> {
    assertThrowawayHome(newHome);
    await this.stop();
    const target = path.resolve(newHome);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(this.home, target);
    this.home = target;
    // The config carries no absolute paths; only the token file and lock live under the home.
    await this.start();
  }

  logTail(bytes: number): string {
    try {
      const buf = fs.readFileSync(path.join(this.home, this.logName));
      return buf.subarray(Math.max(0, buf.length - bytes)).toString("utf8");
    } catch {
      return "";
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.stop();
    } catch {
      this.killNow();
    }
    fs.rmSync(this.home, { recursive: true, force: true });
  }
}
