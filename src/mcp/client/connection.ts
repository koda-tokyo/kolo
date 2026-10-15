// One MCP server connection (KoLo 2.0, M6): stdio child or streamable-HTTP endpoint, tool /
// resource / prompt inventory, per-call timeout, and a supervised restart with exponential
// backoff when the transport drops. Audit of individual calls lives in tools.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../../config/types.mcp.js";
import { mcpToolExposed } from "./policy.js";

export type McpToolInfo = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /** False when policy hides it (exec-like without an explicit allow, or not in allowTools). */
  exposed: boolean;
  execLike: boolean;
  reason?: string;
};

export type McpResourceInfo = {
  uri: string;
  name?: string;
  mimeType?: string;
  description?: string;
};
export type McpPromptInfo = { name: string; description?: string; arguments?: string[] };

export type McpConnectionState = "stopped" | "connecting" | "ready" | "error" | "backoff";

export type McpServerStatus = {
  id: string;
  transport: McpServerConfig["transport"];
  target: string;
  enabled: boolean;
  state: McpConnectionState;
  serverName?: string;
  serverVersion?: string;
  tools: McpToolInfo[];
  resources: McpResourceInfo[];
  prompts: McpPromptInfo[];
  restarts: number;
  lastError?: string;
  nextRetryAt?: string;
  connectedAt?: string;
};

export type McpConnectionOptions = {
  id: string;
  config: McpServerConfig;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  /** Called whenever the tool inventory changes (connect, reconnect, drop). */
  onChange?: () => void;
  /** Backoff schedule (ms); tests shrink it. Default 1s doubling to 60s. */
  backoffMs?: { initial: number; max: number };
  /** Minimal child env for stdio servers (tests pass PATH only). */
  baseEnv?: Record<string, string>;
};

export const CLIENT_INFO = { name: "kolo", version: "2.0" };

export function describeTarget(config: McpServerConfig): string {
  if (config.transport === "stdio") {
    return [config.command ?? "", ...(config.args ?? [])].join(" ").trim();
  }
  return config.url ?? "";
}

function baseStdioEnv(): Record<string, string> {
  // Never leak the gateway's token/secret environment into an MCP child: PATH + locale only.
  const out: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT"]) {
    const value = process.env[key];
    if (value) {
      out[key] = value;
    }
  }
  return out;
}

export class McpConnection {
  readonly id: string;
  config: McpServerConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  private state: McpConnectionState = "stopped";
  private tools: McpToolInfo[] = [];
  private resources: McpResourceInfo[] = [];
  private prompts: McpPromptInfo[] = [];
  private restarts = 0;
  private lastError?: string;
  private connectedAt?: string;
  private serverInfo?: { name?: string; version?: string };
  private retryTimer: NodeJS.Timeout | null = null;
  private nextRetryAt?: number;
  private backoff: number;
  private readonly backoffCfg: { initial: number; max: number };
  private wantRunning = false;
  private readonly log?: McpConnectionOptions["log"];
  private readonly onChange?: () => void;
  private readonly baseEnv?: Record<string, string>;

  constructor(opts: McpConnectionOptions) {
    this.id = opts.id;
    this.config = opts.config;
    this.log = opts.log;
    this.onChange = opts.onChange;
    this.backoffCfg = opts.backoffMs ?? { initial: 1000, max: 60_000 };
    this.backoff = this.backoffCfg.initial;
    this.baseEnv = opts.baseEnv;
  }

  get timeoutMs(): number {
    return this.config.timeoutMs ?? 30_000;
  }

  status(): McpServerStatus {
    return {
      id: this.id,
      transport: this.config.transport,
      target: describeTarget(this.config),
      enabled: this.config.enabled !== false,
      state: this.state,
      serverName: this.serverInfo?.name,
      serverVersion: this.serverInfo?.version,
      tools: this.tools.map((t) => ({ ...t })),
      resources: [...this.resources],
      prompts: [...this.prompts],
      restarts: this.restarts,
      lastError: this.lastError,
      nextRetryAt: this.nextRetryAt ? new Date(this.nextRetryAt).toISOString() : undefined,
      connectedAt: this.connectedAt,
    };
  }

  /** Exposed tools only (policy applied). */
  exposedTools(): McpToolInfo[] {
    return this.state === "ready" ? this.tools.filter((t) => t.exposed) : [];
  }

  isReady(): boolean {
    return this.state === "ready" && this.client !== null;
  }

  /** Starts and keeps the connection alive (restart with backoff) until `stop()`. */
  async start(): Promise<void> {
    this.wantRunning = true;
    await this.connectOnce();
  }

  /** One connection attempt without supervision (used by `kurahi mcp test`). */
  async connectOnce(): Promise<void> {
    if (this.state === "connecting" || this.state === "ready") {
      return;
    }
    this.clearRetry();
    this.state = "connecting";
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    let transport: StdioClientTransport | StreamableHTTPClientTransport;
    try {
      transport = this.buildTransport();
    } catch (err) {
      this.fail(err, false);
      return;
    }
    transport.onclose = () => this.handleDrop("transport closed");
    transport.onerror = (err) => {
      this.lastError = err?.message ?? String(err);
      this.log?.warn(`mcp[${this.id}]: ${this.lastError}`);
    };
    try {
      await withTimeout(client.connect(transport), this.timeoutMs, "connect");
      this.client = client;
      this.transport = transport;
      await this.refreshInventory();
      this.state = "ready";
      this.connectedAt = new Date().toISOString();
      this.backoff = this.backoffCfg.initial;
      this.lastError = undefined;
      const info = client.getServerVersion();
      this.serverInfo = info ? { name: info.name, version: info.version } : undefined;
      this.log?.info(
        `mcp[${this.id}]: connected (${this.tools.filter((t) => t.exposed).length}/${this.tools.length} tools exposed)`,
      );
      this.onChange?.();
    } catch (err) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
      this.fail(err, true);
    }
  }

  async stop(): Promise<void> {
    this.wantRunning = false;
    this.clearRetry();
    const transport = this.transport;
    this.transport = null;
    this.client = null;
    this.state = "stopped";
    this.tools = [];
    this.resources = [];
    this.prompts = [];
    if (transport) {
      transport.onclose = undefined;
      try {
        await transport.close();
      } catch {
        // ignore
      }
    }
    this.onChange?.();
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: unknown[]; structuredContent?: unknown; isError?: boolean }> {
    const client = this.client;
    if (!client || this.state !== "ready") {
      throw new Error(`mcp server ${this.id} is not connected (${this.state})`);
    }
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: this.timeoutMs,
      signal,
    });
    const r = result as { content?: unknown[]; structuredContent?: unknown; isError?: boolean };
    return {
      content: Array.isArray(r.content) ? r.content : [],
      structuredContent: r.structuredContent,
      isError: r.isError === true,
    };
  }

  async refreshInventory(): Promise<void> {
    const target = this.client;
    if (!target) {
      return;
    }
    const caps = target.getServerCapabilities() ?? {};
    const tools = caps.tools
      ? (await withTimeout(target.listTools(), this.timeoutMs, "tools/list")).tools
      : [];
    this.tools = tools.map((t) => {
      const policy = mcpToolExposed({
        server: this.id,
        tool: t.name,
        allowTools: this.config.allowTools,
      });
      return {
        name: t.name,
        description: t.description,
        inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
        exposed: policy.exposed,
        execLike: policy.execLike,
        reason: policy.reason,
      };
    });
    this.resources = caps.resources
      ? (await withTimeout(target.listResources(), this.timeoutMs, "resources/list")).resources.map(
          (r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType, description: r.description }),
        )
      : [];
    this.prompts = caps.prompts
      ? (await withTimeout(target.listPrompts(), this.timeoutMs, "prompts/list")).prompts.map(
          (p) => ({
            name: p.name,
            description: p.description,
            arguments: p.arguments?.map((a) => a.name),
          }),
        )
      : [];
  }

  private buildTransport(): StdioClientTransport | StreamableHTTPClientTransport {
    const cfg = this.config;
    if (cfg.transport === "stdio") {
      if (!cfg.command) {
        throw new Error(`mcp server ${this.id}: stdio transport needs command`);
      }
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...(this.baseEnv ?? baseStdioEnv()), ...(cfg.env ?? {}) },
        cwd: cfg.cwd,
        stderr: "pipe",
      });
    }
    if (!cfg.url) {
      throw new Error(`mcp server ${this.id}: http transport needs url`);
    }
    return new StreamableHTTPClientTransport(new URL(cfg.url), {
      requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
    });
  }

  private fail(err: unknown, retry: boolean): void {
    this.client = null;
    this.transport = null;
    this.lastError = err instanceof Error ? err.message : String(err);
    this.log?.warn(`mcp[${this.id}]: ${this.lastError}`);
    this.tools = [];
    this.state = "error";
    this.onChange?.();
    if (retry) {
      this.scheduleRetry();
    }
  }

  private handleDrop(reason: string): void {
    if (!this.wantRunning) {
      return;
    }
    this.log?.warn(`mcp[${this.id}]: ${reason}; restarting`);
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.lastError = reason;
    this.state = "error";
    this.onChange?.();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (!this.wantRunning || this.retryTimer) {
      return;
    }
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, this.backoffCfg.max);
    this.state = "backoff";
    this.nextRetryAt = Date.now() + delay;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.nextRetryAt = undefined;
      if (!this.wantRunning) {
        return;
      }
      this.restarts += 1;
      this.state = "stopped";
      void this.connectOnce();
    }, delay);
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.nextRetryAt = undefined;
  }
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`mcp ${what} timed out after ${ms} ms`)), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
