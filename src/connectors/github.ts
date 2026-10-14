// src/connectors/github.ts
//
// GitHub connector — bridges GitHub events (issues, PRs, comments, etc.)
// into KoLo's normalized event model.
//
// P1 connector: engineering legitimacy first.
// Status: SCAFFOLD — implementation pending API key configuration.

import { randomUUID } from "node:crypto";
import type {
  Connector,
  ConnectorAction,
  ConnectorConfig,
  NormalizedEvent,
  AuthContext,
  AuthResult,
  ConnectorHealth,
  ConnectorDiagnostic,
  ActionResult,
} from "./types.js";

export class GitHubConnector implements Connector {
  readonly id = "github";
  readonly name = "GitHub";
  readonly version = "0.1.0";
  readonly capabilities = [
    "poll",
    "subscribe",
    "send_message",
    "read_message",
    "file_operations",
    "task_operations",
    "reactions",
    "threads",
    "search",
  ] as const;

  private initialized = false;
  private config: ConnectorConfig | null = null;

  async auth(context: AuthContext): Promise<AuthResult> {
    const token = context.credential?.value ?? process.env.GITHUB_TOKEN;
    if (!token) {
      return {
        success: false,
        error: "GITHUB_TOKEN not set",
        retryable: true,
      };
    }
    // TODO: validate token against GitHub API
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
      throw new Error("GitHubConnector not initialized");
    }
    // TODO: poll GitHub API for new events
    return [];
  }

  async subscribe(
    handler: (event: NormalizedEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    // TODO: set up GitHub webhook listener
    const cleanup = async () => {};
    return cleanup;
  }

  normalizeEvent(raw: unknown): NormalizedEvent {
    // TODO: map GitHub webhook payload to NormalizedEvent
    return {
      id: randomUUID(),
      connectorId: this.id,
      kind: "custom",
      timestamp: new Date().toISOString(),
      summary: "GitHub event (not yet normalized)",
      salience: "low",
      payload: raw as Record<string, unknown>,
      eventType: "github_raw",
    };
  }

  async proposeActions(): Promise<ConnectorAction[]> {
    // TODO: analyze pending events and propose actions
    return [];
  }

  async execute(action: ConnectorAction): Promise<ActionResult> {
    // TODO: execute proposed action against GitHub API
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
        { name: "auth", status: this.config ? "pass" : "warn", message: "Token configured" },
        { name: "api_connectivity", status: "warn", message: "Not yet tested" },
        { name: "webhook_setup", status: "warn", message: "Webhooks not configured" },
      ],
      overall: "degraded",
    };
  }
}
