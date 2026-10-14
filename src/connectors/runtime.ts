// src/connectors/runtime.ts
//
// Connector runtime interface — process-isolated execution environment for
// external service connectors (GitHub, Linear, Slack, etc.).
//
// Architecture:
//   - Each connector runs in its own worker thread
//   - Communication via WorkerMessage protocol
//   - Events normalized to NormalizedEvent envelope
//   - Actions proposed and executed through the runtime
//   - Health monitoring and automatic restart via daemon supervisor
//
// Design principles:
//   - No `any` types — strict typing throughout
//   - Fail fast, fail loud — errors propagate to supervisor
//   - Idempotent operations — safe to retry
//   - Resource bounded — memory/CPU limits enforced by worker isolation

import { workerData, parentPort, isMainThread, threadId } from "worker_threads";
import type {
  Connector,
  ConnectorHealth,
  ConnectorDiagnostic,
  NormalizedEvent,
  WorkerMessage,
  ConnectorConfig,
  ConnectorId,
  ConnectorAction,
  ActionResult,
  ActionConstraints,
  ConnectorRegistry,
  ConnectorInfo,
  ConnectorStatus,
  AuthContext,
  AuthResult,
} from "./types.js";

export type { Connector, ActionConstraints } from "./types.js";

// ─── Connector Runtime Environment ──────────────────────────────────────

/**
 * The runtime environment provided to each connector.
 * Wraps the connector with lifecycle management, health monitoring,
 * and worker-thread communication.
 */
export interface ConnectorRuntimeEnv {
  /** Logger bound to this connector's ID */
  log: ConnectorLogger;

  /** Access to the connector registry */
  registry: ConnectorRegistry;

  /** Configuration for this connector */
  config: ConnectorConfig;

  /** Worker thread ID (0 if main thread) */
  threadId: number;

  /** Whether this is running in the main thread */
  isMainThread: boolean;

  /** Signal the supervisor to restart this connector */
  requestRestart(reason: string): void;

  /** Report a health check result */
  reportHealth(health: ConnectorHealth): void;

  /** Emit an event to the gateway */
  emitEvent(event: NormalizedEvent): void;

  /** Report an action result */
  reportActionResult(result: ActionResult): void;
}

export interface ConnectorLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ─── Worker Thread Runner ───────────────────────────────────────────────

/**
 * Runs a connector inside a worker thread.
 * Handles message passing to/from the main thread, health reporting,
 * and graceful shutdown.
 */
export class ConnectorWorkerRunner {
  private connector: Connector | null = null;
  private unsubscribe: (() => Promise<void>) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly env: ConnectorRuntimeEnv) {}

  /**
   * Start the worker runner. Initializes the connector and begins polling
   * or subscribing based on capabilities.
   */
  async start(): Promise<void> {
    if (this.running) {
      this.env.log.warn("ConnectorWorkerRunner.start() called while already running");
      return;
    }

    this.running = true;
    this.env.log.info("Starting connector worker", {
      connectorId: this.env.config.id,
      threadId: this.env.threadId,
    });

    try {
      // Auth first — fail fast if credentials are invalid
      const authResult = await this.connector!.auth(this.env.config.auth);
      if (!authResult.success) {
        this.env.log.error("Authentication failed", {
          error: authResult.error,
          retryable: authResult.retryable,
        });
        if (!authResult.retryable) {
          this.env.requestRestart(`Auth failed: ${authResult.error}`);
          return;
        }
      }

      // Initialize the connector
      await this.connector!.initialize(this.env.config);

      // Subscribe if supported, otherwise poll
      const canSubscribe = this.connector!.capabilities.includes("subscribe");
      if (canSubscribe) {
        this.unsubscribe = await this.connector!.subscribe((event) => {
          this.env.emitEvent(event);
        });
      } else {
        this.startPolling();
      }

      // Report initial health
      const health = await this.connector!.health();
      this.env.reportHealth(health);
    } catch (err) {
      this.env.log.error("Failed to start connector", { error: String(err) });
      this.env.requestRestart(`Start failed: ${String(err)}`);
    }
  }

  /**
   * Stop the worker runner gracefully.
   * Cleans up subscriptions, stops polling, and shuts down the connector.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;

    // Stop polling
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Unsubscribe from real-time events
    if (this.unsubscribe) {
      await this.unsubscribe();
      this.unsubscribe = null;
    }

    // Shutdown the connector
    if (this.connector) {
      await this.connector.shutdown();
    }

    this.env.log.info("Connector worker stopped", {
      connectorId: this.env.config.id,
    });
  }

  /**
   * Handle a message from the main thread.
   */
  async handleMessage(message: WorkerMessage): Promise<void> {
    switch (message.type) {
      case "health_check": {
        if (this.connector) {
          const health = await this.connector.health();
          this.env.reportHealth(health);
        }
        break;
      }
      case "stop": {
        await this.stop();
        break;
      }
      default:
        this.env.log.warn("Unhandled worker message", { type: (message as WorkerMessage).type });
    }
  }

  private startPolling(): void {
    const intervalMs = this.env.config.pollIntervalMs ?? 30_000;

    this.pollTimer = setInterval(async () => {
      if (!this.running || !this.connector) {
        return;
      }

      try {
        const events = await this.connector.poll();
        for (const event of events) {
          this.env.emitEvent(event);
        }

        // Update health after each poll
        const health = await this.connector.health();
        this.env.reportHealth(health);
      } catch (err) {
        this.env.log.error("Poll failed", { error: String(err) });
      }
    }, intervalMs);
  }
}

// ─── Factory ────────────────────────────────────────────────────────────

/**
 * Creates a ConnectorWorkerRunner for the given connector.
 * Used by the daemon supervisor to spawn new worker threads.
 */
export function createConnectorRunner(
  connector: Connector,
  config: ConnectorConfig,
): ConnectorWorkerRunner {
  const env: ConnectorRuntimeEnv = {
    log: createConnectorLogger(config.id),
    registry: createConnectorRegistry(),
    config,
    threadId: isMainThread ? 0 : threadId,
    isMainThread,
    requestRestart: (reason: string) => {
      parentPort?.postMessage({
        type: "error",
        connectorId: config.id,
        error: reason,
      } satisfies WorkerMessage);
    },
    reportHealth: (health: ConnectorHealth) => {
      parentPort?.postMessage({
        type: "event",
        event: {
          id: `health:${config.id}:${Date.now()}`,
          connectorId: config.id,
          kind: "heartbeat",
          timestamp: new Date().toISOString(),
          summary: `Health check: ${health.status}`,
          salience: "low" as const,
          payload: health as unknown as Record<string, unknown>,
        } satisfies NormalizedEvent,
      } satisfies WorkerMessage);
    },
    emitEvent: (event: NormalizedEvent) => {
      parentPort?.postMessage({
        type: "event",
        event,
      } satisfies WorkerMessage);
    },
    reportActionResult: (result: ActionResult) => {
      parentPort?.postMessage({
        type: "action_result",
        result,
      } satisfies WorkerMessage);
    },
  };

  const runner = new ConnectorWorkerRunner(env);
  // Inject the connector into the runner (runtime.ts internal access)
  (runner as unknown as { connector: Connector }).connector = connector;
  return runner;
}

// ─── Logger Implementation ──────────────────────────────────────────────

function createConnectorLogger(connectorId: ConnectorId): ConnectorLogger {
  const prefix = `[connector:${connectorId}]`;
  return {
    debug: (msg, meta) => console.debug(prefix, msg, meta ?? ""),
    info: (msg, meta) => console.info(prefix, msg, meta ?? ""),
    warn: (msg, meta) => console.warn(prefix, msg, meta ?? ""),
    error: (msg, meta) => console.error(prefix, msg, meta ?? ""),
  };
}

// ─── Registry Implementation ────────────────────────────────────────────

function createConnectorRegistry(): ConnectorRegistry {
  const connectors = new Map<ConnectorId, Connector>();

  return {
    async register(connector: Connector): Promise<void> {
      connectors.set(connector.id, connector);
    },
    get(id: ConnectorId): ConnectorInfo | undefined {
      const c = connectors.get(id);
      if (!c) return undefined;
      return {
        id: c.id,
        name: c.name,
        version: c.version,
        status: "initializing" as ConnectorStatus,
        capabilities: c.capabilities,
        errorCount: 0,
      };
    },
    list(): ConnectorInfo[] {
      return Array.from(connectors.values()).map((c) => ({
        id: c.id,
        name: c.name,
        version: c.version,
        status: "initializing" as ConnectorStatus,
        capabilities: c.capabilities,
        errorCount: 0,
      }));
    },
    async unregister(id: ConnectorId): Promise<void> {
      connectors.delete(id);
    },
    findByCapability(capability: import("./types.js").ConnectorCapability): ConnectorInfo[] {
      return Array.from(connectors.values())
        .filter((c) => c.capabilities.includes(capability))
        .map((c) => ({
          id: c.id,
          name: c.name,
          version: c.version,
          status: "initializing" as ConnectorStatus,
          capabilities: c.capabilities,
          errorCount: 0,
        }));
    },
  };
}
