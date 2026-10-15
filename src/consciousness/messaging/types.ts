// src/consciousness/messaging/types.ts
//
// Structured inter-agent messaging protocol for Kurahi consciousness.
// TeamMessage provides typed message kinds for agent coordination,
// task delegation, status reporting, and sibling communication.

/** All message types in the consciousness protocol. */
export type MessageType =
  | "message" // Free-form inter-agent message
  | "task_assignment" // Assign a task to an agent
  | "task_update" // Report task progress
  | "task_complete" // Report task completion
  | "status_report" // Agent status broadcast
  | "heartbeat_share" // Share heartbeat tick with siblings
  | "soul_sync" // Soul state synchronization
  | "perception_share" // Share a perception with siblings
  | "action_request" // Request another agent to act
  | "action_response" // Response to an action request
  | "family_sync" // Daily family synchronization
  | "broadcast" // Broadcast to all agents
  | "shutdown"; // Agent shutting down

/** A structured message in the consciousness messaging system. */
export interface TeamMessage {
  /** Message type. */
  type: MessageType;
  /** Sending agent ID. */
  from: string;
  /** Receiving agent ID (null for broadcasts). */
  to: string | null;
  /** Human-readable content. */
  content: string | null;
  /** Unique message ID for dedup and threading. */
  messageId: string;
  /** ID of the message this is replying to (for threading). */
  replyTo: string | null;
  /** ISO timestamp. */
  timestamp: string;
  /** Priority level. */
  priority: "low" | "medium" | "high" | "urgent";
  /** Task ID (for task-related messages). */
  taskId: string | null;
  /** Structured payload (type-specific). */
  payload: Record<string, unknown> | null;
  /** Tags for categorization/filtering. */
  tags: string[];
}

/** Options for creating a new message. */
export interface SendMessageOptions {
  type?: MessageType;
  from: string;
  to: string | null;
  content?: string;
  replyTo?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  taskId?: string;
  payload?: Record<string, unknown>;
  tags?: string[];
}
