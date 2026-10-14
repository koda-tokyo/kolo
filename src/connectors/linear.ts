// src/connectors/linear.ts
//
// Linear connector — bridges Linear events (issues, projects, cycles, etc.)
// into KoLo's normalized event model.
//
// P1 connector: engineering legitimacy first.
// Status: SCAFFOLD — implementation pending API key configuration.

import { randomUUID } from "node:crypto";
import type {
  ConnectorAction,
  ConnectorConfig,
  NormalizedEvent,
  AuthContext,
  AuthResult,
  ConnectorHealth,
  ConnectorDiagnostic,
  ActionResult,
} from "./types.js";
import type { Connector } from "./types.js";

export class LinearConnector implements Connector {
  readonly id = "linear";
  readonly name = "Linear";
  readonly version = "0.1.0";
  readonly capabilities = [
    "poll",
    "subscribe",
    "send_message",
    "read_message",
    "task_operations",
    "search",
  ] as const;

  private initialized = false;
  private config: ConnectorConfig | null = null;

  async auth(context: AuthContext): Promise<AuthResult> {
    const token = context.credential?.value ?? process.env.LINEAR_API_KEY;
    if (!token) {
      return {
        success: false,
        error: "LINEAR_API_KEY not set",
        retryable: true,
      };
    }
    // TODO: validate token against Linear GraphQL API
    return {
      success: true,
      credential: { value: token },
      retryable: false,
    };
  }

  async initialize(config: ConnectorConfig): Promise<void> {
    this.config = config;
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.config = null;
  }

  async poll(): Promise<NormalizedEvent[]> {
    if (!this.initialized) {
      throw new Error("LinearConnector not initialized");
    }
    // TODO: poll Linear GraphQL API for new events
    return [];
  }

  async subscribe(
    handler: (event: NormalizedEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    // TODO: set up Linear webhook listener
    const cleanup = async () => {};
    return cleanup;
  }

  normalizeEvent(raw: unknown): NormalizedEvent {
    // TODO: map Linear webhook payload to NormalizedEvent
    return {
      id: randomUUID(),
      connectorId: this.id,
      kind: "task_change",
      timestamp: new Date().toISOString(),
      summary: "Linear event (not yet normalized)",
      salience: "low",
      payload: raw as Record<string, unknown>,
      eventType: "linear_raw",
    };
  }

  async proposeActions(): Promise<ConnectorAction[]> {
    // TODO: analyze pending events and propose actions
    return [];
  }

  async execute(action: ConnectorAction): Promise<ActionResult> {
    // TODO: execute proposed action against Linear GraphQL API
    return {
      actionId: action.id,
      success: false,
      error: "Not implemented",
      executedAt: new Date().toISOString(),
    };
  }

  async health(): Promise<ConnectorHealth> {
    return {
      connectorId: this.id,
      status: this.initialized ? "connected" : "disconnected",
      lastCheck: new Date().toISOString(),
      eventsProcessed: 0,
      actionsExecuted: 0,
    };
  }

  async diagnostic(): Promise<ConnectorDiagnostic> {
    return {
      connectorId: this.id,
      timestamp: new Date().toISOString(),
      checks: [
        { name: "auth", status: this.config ? "pass" : "warn", message: "API key configured" },
        { name: "graphql_connectivity", status: "warn", message: "Not yet tested" },
        { name: "webhook_setup", status: "warn", message: "Webhooks not configured" },
      ],
      overall: "degraded",
    };
  }
}
