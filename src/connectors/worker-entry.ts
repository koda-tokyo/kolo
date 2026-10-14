// src/connectors/worker-entry.ts
//
// Entry point for connector worker threads.
// Receives connector config from parent, instantiates the connector,
// and runs the ConnectorWorkerRunner lifecycle.

import { parentPort, workerData } from "worker_threads";
import type { ConnectorConfig, WorkerMessage } from "./types.js";
import { createConnectorRunner } from "./runtime.js";

interface WorkerInitData {
  connectorId: string;
  config: ConnectorConfig;
}

const init = workerData as WorkerInitData;

if (!parentPort) {
  throw new Error("worker-entry.ts must be run inside a worker thread");
}

// Create and start the connector runner
const runner = createConnectorRunner(
  // Connector instance is provided by the specific connector implementation
  // This is a placeholder — real implementations register their connector
  null as never,
  init.config,
);

// Handle messages from the main thread
parentPort.on("message", async (message: WorkerMessage) => {
  try {
    await runner.handleMessage(message);
  } catch (err) {
    parentPort!.postMessage({
      type: "error",
      connectorId: init.connectorId,
      error: String(err),
      stack: (err as Error).stack,
    } satisfies WorkerMessage);
  }
});

// Start the runner
runner.start().catch((err) => {
  parentPort!.postMessage({
    type: "error",
    connectorId: init.connectorId,
    error: `Failed to start: ${String(err)}`,
  } satisfies WorkerMessage);
});
