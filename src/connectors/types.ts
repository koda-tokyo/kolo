// src/connectors/types.ts
//
// Core type definitions for the connector runtime.
// Connectors bridge external services (GitHub, Linear, Slack, etc.) into KoLo's
// unified event model. Each connector runs in an isolated worker thread and
// communicates with the main gateway via a normalized event envelope.

// ─── Connector Lifecycle ────────────────────────────────────────────────

export type ConnectorId = string;
export type ConnectorStatus =
  | "initializing"
  | "connected"
  | "disconnected"
  | "error"
  | "reconnecting";

export interface ConnectorInfo {
  id: ConnectorId;
  name: string;
  version: string;
  status: ConnectorStatus;
  capabilities: ReadonlyArray<ConnectorCapability>;
  lastHealthCheck?: string; // ISO timestamp
  errorCount: number;
  lastError?: string;
}

export type ConnectorCapability =
  | "poll" // Can poll for new events
  | "subscribe" // Supports real-time subscriptions
  | "send_message" // Can send messages to the service
  | "read_message" // Can read messages from the service
  | "file_operations" // Can read/write files
  | "calendar_operations" // Can read/modify calendar events
  | "task_operations" // Can read/modify tasks/issues
  | "presence" // Can detect user presence/activity
  | "media" // Can handle media attachments
  | "reactions" // Can send/receive reactions
  | "threads" // Supports threaded conversations
  | "search"; // Can search the service's content;

// ─── Authentication ─────────────────────────────────────────────────────

export type AuthKind = "oauth" | "api_key" | "token" | "device_code" | "basic" | "custom";

export interface AuthCredential {
  /** The credential value (token, key, etc.) */
  value: string;
  /** When it expires (if applicable) */
  expiresAt?: string;
  /** Refresh token (for OAuth flows) */
  refreshToken?: string;
  /** Additional metadata (scopes, user info, etc.) */
  metadata?: Record<string, unknown>;
}

export interface AuthContext {
  connectorId: ConnectorId;
  config: Record<string, unknown>;
  credential?: AuthCredential;
  isRemote: boolean;
}

export interface AuthResult {
  success: boolean;
  credential?: AuthCredential;
  error?: string;
  retryable: boolean;
}

// ─── Normalized Event Envelope ──────────────────────────────────────────

export type EventKind =
  | "message" // New message received
  | "message_update" // Message edited
  | "message_delete" // Message deleted
  | "reaction" // Reaction added/removed
  | "presence" // User online/offline
  | "file_change" // File created/modified/deleted
  | "task_change" // Issue/PR/task state change
  | "calendar_event" // Calendar event created/updated
  | "system" // Service-level event (rate limit, disconnect, etc.)
  | "heartbeat" // Connector health ping
  | "custom"; // Connector-specific event (use eventType field)

export interface NormalizedEvent {
  /** Unique event ID (for deduplication) */
  id: string;
  /** Which connector produced this event */
  connectorId: ConnectorId;
  /** What kind of event this is */
  kind: EventKind;
  /** When the event occurred (ISO timestamp) */
  timestamp: string;
  /** Who triggered/caused the event (user ID, bot name, etc.) */
  actor?: string;
  /** Where the event happened (channel, repo, project, etc.) */
  target?: string;
  /** Human-readable summary for LLM consumption */
  summary: string;
  /** Raw event data from the source service */
  payload?: Record<string, unknown>;
  /** Thread/conversation ID if this event belongs to a thread */
  threadId?: string;
  /** Parent event ID (for replies, edits, etc.) */
  parentId?: string;
  /** How urgent this event is */
  salience: "low" | "medium" | "high" | "urgent";
  /** Attachments (files, images, etc.) */
  attachments?: EventAttachment[];
  /** Connector-specific event type (for custom events) */
  eventType?: string;
}

export interface EventAttachment {
  id: string;
  name: string;
  mimeType: string;
  size?: number; // bytes
  url?: string; // remote URL
  localPath?: string; // if downloaded
  thumbnailUrl?: string;
}

// ─── Connector Actions ──────────────────────────────────────────────────

export type ConnectorActionKind =
  | "send_message" // Send a message to a channel/user
  | "edit_message" // Edit an existing message
  | "delete_message" // Delete a message
  | "add_reaction" // Add a reaction to a message
  | "remove_reaction" // Remove a reaction
  | "create_task" // Create an issue/PR/task
  | "update_task" // Update task state/assignee/etc.
  | "create_file" // Create a new file
  | "update_file" // Update an existing file
  | "delete_file" // Delete a file
  | "create_calendar_event" // Create a calendar event
  | "update_calendar_event" // Update a calendar event
  | "delete_calendar_event" // Delete a calendar event
  | "search" // Search the service
  | "list_channels" // List available channels/projects/repos
  | "list_users" // List users in the service
  | "custom"; // Connector-specific action

export interface ConnectorAction {
  id: string;
  connectorId: ConnectorId;
  kind: ConnectorActionKind;
  target?: string; // channel ID, file path, task ID, etc.
  params: Record<string, unknown>;
  /** Whether this action requires human approval before execution */
  requiresApproval: boolean;
  /** Human-readable description of what this action will do */
  description: string;
  /** When this action was proposed */
  proposedAt: string;
}

export interface ActionResult {
  actionId: string;
  success: boolean;
  error?: string;
  result?: Record<string, unknown>;
  executedAt: string;
}

// ─── Health & Diagnostics ───────────────────────────────────────────────

export interface ConnectorHealth {
  connectorId: ConnectorId;
  status: ConnectorStatus;
  lastCheck: string; // ISO timestamp
  latencyMs?: number;
  error?: string;
  uptimeMs?: number;
  eventsProcessed: number;
  actionsExecuted: number;
  memoryUsageBytes?: number;
}

export interface ConnectorDiagnostic {
  connectorId: ConnectorId;
  timestamp: string;
  checks: DiagnosticCheck[];
  overall: "healthy" | "degraded" | "unhealthy";
}

export interface DiagnosticCheck {
  name: string;
  status: "pass" | "fail" | "warn";
  message?: string;
  latencyMs?: number;
}

// ─── Worker Thread Communication ────────────────────────────────────────

export type WorkerMessage =
  | { type: "start"; connectorId: ConnectorId; config: ConnectorConfig }
  | { type: "stop"; connectorId: ConnectorId }
  | { type: "health_check"; connectorId: ConnectorId }
  | { type: "event"; event: NormalizedEvent }
  | { type: "action_result"; result: ActionResult }
  | { type: "diagnostic"; diagnostic: ConnectorDiagnostic }
  | { type: "error"; connectorId: ConnectorId; error: string; stack?: string };

export interface ConnectorConfig {
  id: ConnectorId;
  name: string;
  auth: AuthContext;
  pollIntervalMs?: number;
  maxRetries?: number;
  retryBackoffMs?: number;
  capabilities: ConnectorCapability[];
  /** Whether to enable verbose logging for this connector */
  verbose?: boolean;
  /** Custom configuration for this connector type */
  custom?: Record<string, unknown>;
}

// ─── Connector Registry ─────────────────────────────────────────────────

export interface ConnectorRegistry {
  /** Register a new connector */
  register(connector: { id: ConnectorId }): Promise<void>;
  /** Get info about a registered connector */
  get(id: ConnectorId): ConnectorInfo | undefined;
  /** List all registered connectors */
  list(): ConnectorInfo[];
  /** Unregister a connector */
  unregister(id: ConnectorId): Promise<void>;
  /** Get all connectors with a specific capability */
  findByCapability(capability: ConnectorCapability): ConnectorInfo[];
}

// ─── Connector Interface ────────────────────────────────────────────────
// Every connector implementation must satisfy this interface.
// The runtime wraps this interface with lifecycle management, health probes,
// and worker-thread isolation.

export interface Connector {
  /** Unique identifier for this connector instance */
  readonly id: ConnectorId;
  /** Human-readable name */
  readonly name: string;
  /** Semantic version */
  readonly version: string;
  /** What this connector can do */
  readonly capabilities: ReadonlyArray<ConnectorCapability>;

  // ─── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Initialize the connector. Called once before any other method.
   * Should establish auth, validate config, and prepare internal state.
   */
  initialize(config: ConnectorConfig): Promise<void>;

  /**
   * Gracefully shut down the connector.
   * Should flush pending events, close connections, and release resources.
   */
  shutdown(): Promise<void>;

  // ─── Authentication ──────────────────────────────────────────────────

  /**
   * Authenticate with the external service.
   * Returns credential state and any errors.
   * Called during initialize() and periodically for token refresh.
   */
  auth(context: AuthContext): Promise<AuthResult>;

  // ─── Event Ingestion ─────────────────────────────────────────────────

  /**
   * Poll the external service for new events.
   * Returns an array of normalized events (may be empty).
   * Should respect rate limits and backoff strategies.
   */
  poll(): Promise<NormalizedEvent[]>;

  /**
   * Subscribe to real-time events from the external service.
   * Returns a cleanup function to unsubscribe.
   * Not all connectors support this — check capabilities first.
   */
  subscribe(
    handler: (event: NormalizedEvent) => void | Promise<void>,
  ): Promise<() => Promise<void>>;

  /**
   * Convert a raw event from the external service into a NormalizedEvent.
   * This is the adapter layer — maps service-specific fields to our schema.
   */
  normalizeEvent(raw: unknown): NormalizedEvent;

  // ─── Actions ─────────────────────────────────────────────────────────

  /**
   * Given the current state and pending events, propose actions to take.
   * Returns a list of ConnectorAction objects that the runtime can
   * approve, modify, or reject before execution.
   */
  proposeActions(context: {
    pendingEvents: NormalizedEvent[];
    state: Record<string, unknown>;
    constraints: ActionConstraints;
  }): Promise<ConnectorAction[]>;

  /**
   * Execute a previously proposed action.
   * Returns the result of the execution (success/failure + metadata).
   */
  execute(action: ConnectorAction): Promise<ActionResult>;

  // ─── Health & Diagnostics ────────────────────────────────────────────

  /**
   * Return current health status of this connector.
   * Called periodically by the daemon supervisor.
   */
  health(): Promise<ConnectorHealth>;

  /**
   * Run a full diagnostic suite and return results.
   * More expensive than health() — called on-demand or during startup.
   */
  diagnostic(): Promise<ConnectorDiagnostic>;
}

// ─── Action Constraints ─────────────────────────────────────────────────

export interface ActionConstraints {
  /** Maximum actions allowed per batch */
  maxActionsPerBatch: number;
  /** Which action kinds are allowed */
  allowedKinds: Set<ConnectorActionKind>;
  /** Whether human approval is required */
  requireHumanApproval: boolean;
  /** Rate limit (actions per minute) */
  rateLimitPerMinute: number;
}
