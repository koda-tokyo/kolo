// MCP client manager (KoLo 2.0, M6): owns one supervised connection per configured server,
// keeps a synchronous view of the exposed tools (the tool registry is built synchronously),
// and is the single place the gateway starts/stops MCP from.
import type { KoLoConfig } from "../../config/config.js";
import type { McpConfig, McpServerConfig } from "../../config/types.mcp.js";
import { logInfo, logWarn } from "../../logger.js";
import { McpConnection, type McpServerStatus, type McpToolInfo } from "./connection.js";

export type McpManagerLog = { info: (m: string) => void; warn: (m: string) => void };

export type McpManagerOptions = {
  log?: McpManagerLog;
  backoffMs?: { initial: number; max: number };
  baseEnv?: Record<string, string>;
};

export type McpExposedTool = McpToolInfo & { server: string };

export class McpClientManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly opts: McpManagerOptions;
  private generation = 0;
  private listeners = new Set<() => void>();

  constructor(opts: McpManagerOptions = {}) {
    this.opts = opts;
  }

  /** Bumps whenever the exposed tool set may have changed; cheap cache key for callers. */
  get version(): number {
    return this.generation;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bump(): void {
    this.generation += 1;
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // ignore
      }
    }
  }

  servers(): McpServerStatus[] {
    return [...this.connections.values()].map((c) => c.status());
  }

  server(id: string): McpConnection | undefined {
    return this.connections.get(id);
  }

  /** Exposed tools of every ready server (policy applied), synchronously. */
  exposedTools(): McpExposedTool[] {
    const out: McpExposedTool[] = [];
    for (const conn of this.connections.values()) {
      for (const tool of conn.exposedTools()) {
        out.push({ ...tool, server: conn.id });
      }
    }
    return out;
  }

  async callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const conn = this.connections.get(server);
    if (!conn) {
      throw new Error(`mcp server ${server} is not configured`);
    }
    return await conn.callTool(tool, args, signal);
  }

  /**
   * Applies `mcp.servers`: starts new/changed enabled servers, stops removed/disabled ones.
   * Resolves when every connection attempt has settled (each attempt is bounded by its timeout).
   */
  async apply(mcp: McpConfig | undefined): Promise<void> {
    const wanted = new Map<string, McpServerConfig>();
    for (const [id, cfg] of Object.entries(mcp?.servers ?? {})) {
      if (cfg && cfg.enabled !== false) {
        wanted.set(id, cfg);
      }
    }
    const stops: Promise<void>[] = [];
    for (const [id, conn] of this.connections) {
      const next = wanted.get(id);
      if (!next || JSON.stringify(next) !== JSON.stringify(conn.config)) {
        this.connections.delete(id);
        stops.push(conn.stop());
      }
    }
    await Promise.all(stops);
    const starts: Promise<void>[] = [];
    for (const [id, cfg] of wanted) {
      if (this.connections.has(id)) {
        continue;
      }
      const conn = new McpConnection({
        id,
        config: cfg,
        log: this.opts.log,
        backoffMs: this.opts.backoffMs,
        baseEnv: this.opts.baseEnv,
        onChange: () => this.bump(),
      });
      this.connections.set(id, conn);
      starts.push(conn.start());
    }
    await Promise.all(starts);
    this.bump();
  }

  async stop(): Promise<void> {
    const conns = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(conns.map((c) => c.stop()));
    this.bump();
  }
}

let singleton: McpClientManager | null = null;

export function getMcpManager(): McpClientManager {
  if (!singleton) {
    singleton = new McpClientManager({
      log: { info: (m) => logInfo(m), warn: (m) => logWarn(m) },
    });
  }
  return singleton;
}

export function setMcpManagerForTest(manager: McpClientManager | null): void {
  singleton = manager;
}

/** Gateway boot: connect every enabled server from config (errors are per-server, logged). */
export async function startMcpFromConfig(cfg: KoLoConfig, log?: McpManagerLog): Promise<void> {
  const manager = getMcpManager();
  const servers = Object.keys(cfg.mcp?.servers ?? {});
  if (servers.length === 0) {
    await manager.apply(undefined);
    return;
  }
  log?.info(`mcp: connecting ${servers.length} server(s): ${servers.join(", ")}`);
  await manager.apply(cfg.mcp);
}

export async function stopMcp(): Promise<void> {
  if (singleton) {
    await singleton.stop();
  }
}

/** One-shot probe used by `kurahi mcp test`: connect, inventory, disconnect. */
export async function probeMcpServer(
  id: string,
  config: McpServerConfig,
  opts: { baseEnv?: Record<string, string> } = {},
): Promise<McpServerStatus> {
  const conn = new McpConnection({ id, config, baseEnv: opts.baseEnv });
  try {
    await conn.connectOnce();
    return conn.status();
  } finally {
    await conn.stop();
  }
}
