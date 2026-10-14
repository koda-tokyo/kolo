// src/connectors/index.ts
//
// Public API for the connector runtime.
// Re-exports types, runtime, and daemon supervisor.

export type {
  Connector,
  ConnectorRuntimeEnv,
  ConnectorLogger,
  ActionConstraints,
} from "./runtime.js";
export { createConnectorRunner, ConnectorWorkerRunner } from "./runtime.js";

export type {
  ConnectorId,
  ConnectorStatus,
  ConnectorInfo,
  ConnectorCapability,
  AuthKind,
  AuthCredential,
  AuthContext,
  AuthResult,
  EventKind,
  NormalizedEvent,
  EventAttachment,
  ConnectorAction,
  ConnectorActionKind,
  ActionResult,
  ConnectorHealth,
  ConnectorDiagnostic,
  DiagnosticCheck,
  WorkerMessage,
  ConnectorConfig,
  ConnectorRegistry,
} from "./types.js";

export type { ConnectorDaemonConfig, ConnectorDaemonSupervisor } from "./daemon.js";
export { DEFAULT_DAEMON_CONFIG } from "./daemon.js";
