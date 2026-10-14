// src/connectors/daemon.ts
//
// Connector daemonization architecture — separate process management for
// connector workers. Not an Electron background mode. Uses worker_threads
// as the substrate with a supervisor process.
//
// Design:
//   - Supervisor process spawns connector workers in isolated threads
//   - Each worker runs one connector with its own lifecycle
//   - Health probes run on a configurable interval
//   - Restart matrix handles failures with exponential backoff
//   - Supervisor itself runs as a system service (launchd/systemd/schtasks)

import { randomUUID } from "node:crypto";
import { Worker, isMainThread, parentPort, threadId } from "worker_threads";
import type {
  ConnectorHealth,
  ConnectorInfo,
  ConnectorStatus,
  NormalizedEvent,
  WorkerMessage,
  ConnectorConfig,
  ConnectorId,
} from "./types.js";

// ─── Daemon Configuration ───────────────────────────────────────────────

export interface ConnectorDaemonConfig {
  /** How often to run health probes (ms). Default: 30_000 */
  healthProbeIntervalMs: number;
  /** Max consecutive failures before marking connector as error. Default: 3 */
  maxConsecutiveFailures: number;
  /** Base backoff for restart retries (ms). Default: 1_000 */
  restartBackoffBaseMs: number;
  /** Max backoff cap (ms). Default: 300_000 (5 min) */
  restartBackoffMaxMs: number;
  /** Whether to auto-restart failed connectors. Default: true */
  autoRestart: boolean;
  /** Worker thread pool size. Default: number of connectors */
  maxWorkers: number;
  /** Grace period before force-killing a stuck worker (ms). Default: 10_000 */
  shutdownGracePeriodMs: number;
  /** Path to connector entry script (for worker isolation) */
  workerScriptPath?: string;
}

export const DEFAULT_DAEMON_CONFIG: ConnectorDaemonConfig = {
  healthProbeIntervalMs: 30_000,
  maxConsecutiveFailures: 3,
  restartBackoffBaseMs: 1_000,
  restartBackoffMaxMs: 300_000,
  autoRestart: true,
  maxWorkers: 8,
  shutdownGracePeriodMs: 10_000,
};

// ─── Worker State ───────────────────────────────────────────────────────

interface WorkerState {
  worker: Worker | null;
  connectorId: ConnectorId;
  config: ConnectorConfig;
  status: ConnectorStatus;
  consecutiveFailures: number;
  lastHealthCheck: string | null;
  lastError: string | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  eventsProcessed: number;
  startedAt: string | null;
}

// ─── Connector Daemon Supervisor ────────────────────────────────────────

export class ConnectorDaemonSupervisor {
  private workers = new Map<ConnectorId, WorkerState>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private eventListeners: Array<(event: NormalizedEvent) => void> = [];

  constructor(private config: ConnectorDaemonConfig = DEFAULT_DAEMON_CONFIG) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Start the daemon supervisor. Begins health probe loop and
   * spawns workers for all registered connectors.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    // Start health probe loop
    this.healthTimer = setInterval(() => this.runHealthProbes(), this.config.healthProbeIntervalMs);

    // Spawn workers for registered connectors
    for (const state of this.workers.values()) {
      await this.spawnWorker(state);
    }
  }

  /**
   * Gracefully shut down all workers and stop the health probe loop.
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.running = false;

    // Stop health probe loop
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    // Stop all workers
    const shutdownPromises: Promise<void>[] = [];
    for (const [id] of this.workers) {
      shutdownPromises.push(this.terminateWorker(id));
    }
    await Promise.all(shutdownPromises);
  }

  // ─── Worker Management ─────────────────────────────────────────────

  /**
   * Register a connector config with the supervisor.
   * Does not start the worker — call start() or spawnWorker() for that.
   */
  register(config: ConnectorConfig): void {
    const state: WorkerState = {
      worker: null,
      connectorId: config.id,
      config,
      status: "initializing",
      consecutiveFailures: 0,
      lastHealthCheck: null,
      lastError: null,
      restartTimer: null,
      eventsProcessed: 0,
      startedAt: null,
    };
    this.workers.set(config.id, state);
  }

  /**
   * Unregister a connector and terminate its worker if running.
   */
  async unregister(connectorId: ConnectorId): Promise<void> {
    await this.terminateWorker(connectorId);
    this.workers.delete(connectorId);
  }

  /**
   * Get info about a registered connector.
   */
  getConnectorInfo(connectorId: ConnectorId): ConnectorInfo | undefined {
    const state = this.workers.get(connectorId);
    if (!state) return undefined;

    return {
      id: state.connectorId,
      name: state.config.name,
      version: "unknown", // populated by connector itself
      status: state.status,
      capabilities: state.config.capabilities,
      lastHealthCheck: state.lastHealthCheck ?? undefined,
      errorCount: state.consecutiveFailures,
      lastError: state.lastError ?? undefined,
    };
  }

  /**
   * List all registered connectors.
   */
  listConnectors(): ConnectorInfo[] {
    return Array.from(this.workers.values()).map((s) => ({
      id: s.connectorId,
      name: s.config.name,
      version: "unknown",
      status: s.status,
      capabilities: s.config.capabilities,
      lastHealthCheck: s.lastHealthCheck ?? undefined,
      errorCount: s.consecutiveFailures,
      lastError: s.lastError ?? undefined,
    }));
  }

  // ─── Event Subscription ────────────────────────────────────────────

  /**
   * Subscribe to events emitted by any connector worker.
   */
  onEvent(listener: (event: NormalizedEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  // ─── Internal: Worker Spawning ─────────────────────────────────────

  private async spawnWorker(state: WorkerState): Promise<void> {
    if (state.worker) {
      return; // already running
    }

    state.status = "initializing";

    try {
      const worker = new Worker(
        this.config.workerScriptPath ?? new URL("./worker-entry.mjs", import.meta.url),
        {
          workerData: {
            connectorId: state.connectorId,
            config: state.config,
          },
        },
      );

      worker.on("message", (msg: WorkerMessage) => this.handleWorkerMessage(state, msg));
      worker.on("error", (err) => this.handleWorkerError(state, err));
      worker.on("exit", (code) => this.handleWorkerExit(state, code));

      state.worker = worker;
      state.startedAt = new Date().toISOString();
      state.status = "connected";
    } catch (err) {
      state.status = "error";
      state.lastError = String(err);
      state.consecutiveFailures += 1;
      this.maybeScheduleRestart(state);
    }
  }

  private async terminateWorker(connectorId: ConnectorId): Promise<void> {
    const state = this.workers.get(connectorId);
    if (!state) return;

    // Clear any pending restart timer
    if (state.restartTimer) {
      clearTimeout(state.restartTimer);
      state.restartTimer = null;
    }

    // Graceful shutdown
    if (state.worker) {
      state.worker.postMessage({ type: "stop", connectorId } satisfies WorkerMessage);

      // Wait for graceful shutdown or force-kill after grace period
      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, this.config.shutdownGracePeriodMs),
      );
      const exited = new Promise<void>((resolve) => {
        state.worker!.once("exit", () => resolve());
      });
      await Promise.race([exited, timeout]);
      await state.worker.terminate();
      state.worker = null;
    }

    state.status = "disconnected";
  }

  // ─── Internal: Message Handling ────────────────────────────────────

  private handleWorkerMessage(state: WorkerState, message: WorkerMessage): void {
    switch (message.type) {
      case "event": {
        state.eventsProcessed += 1;
        state.consecutiveFailures = 0; // reset on successful event
        for (const listener of this.eventListeners) {
          listener(message.event);
        }
        break;
      }
      case "action_result": {
        // Forward action results to gateway
        break;
      }
      case "diagnostic": {
        state.lastHealthCheck = message.diagnostic.timestamp;
        state.consecutiveFailures = 0;
        break;
      }
      case "error": {
        state.consecutiveFailures += 1;
        state.lastError = message.error;
        if (state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
          state.status = "error";
          this.maybeScheduleRestart(state);
        }
        break;
      }
    }
  }

  private handleWorkerError(state: WorkerState, error: unknown): void {
    state.consecutiveFailures += 1;
    state.lastError = String(error);
    state.status = "error";
    this.maybeScheduleRestart(state);
  }

  private handleWorkerExit(state: WorkerState, exitCode: number): void {
    state.worker = null;
    if (exitCode !== 0) {
      state.consecutiveFailures += 1;
      state.lastError = `Worker exited with code ${exitCode}`;
      state.status = "error";
    } else {
      state.status = "disconnected";
    }
    this.maybeScheduleRestart(state);
  }

  // ─── Internal: Health Probes ───────────────────────────────────────

  private async runHealthProbes(): Promise<void> {
    for (const state of this.workers.values()) {
      if (!state.worker || state.status === "error") continue;

      try {
        state.worker.postMessage({
          type: "health_check",
          connectorId: state.connectorId,
        } satisfies WorkerMessage);
      } catch {
        state.consecutiveFailures += 1;
        state.lastError = "Health probe failed";
        if (state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
          state.status = "error";
          this.maybeScheduleRestart(state);
        }
      }
    }
  }

  // ─── Internal: Restart Logic ───────────────────────────────────────

  private maybeScheduleRestart(state: WorkerState): void {
    if (!this.config.autoRestart) return;
    if (state.restartTimer) return; // already scheduled

    const backoffMs = Math.min(
      this.config.restartBackoffBaseMs * Math.pow(2, state.consecutiveFailures - 1),
      this.config.restartBackoffMaxMs,
    );

    state.restartTimer = setTimeout(async () => {
      state.restartTimer = null;
      if (this.running) {
        await this.spawnWorker(state);
      }
    }, backoffMs);
  }
}
