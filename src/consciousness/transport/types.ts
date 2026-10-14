// src/consciousness/transport/types.ts
//
// Transport abstraction — pluggable message delivery for inter-agent communication.
// Inspired by KoLo's transport pattern, adapted for KoLo's consciousness architecture.
//
// Transports handle raw message bytes. Higher-level protocols (TeamMessage, etc.)
// serialize/deserialize on top.

/**
 * Abstract transport interface for delivering and fetching raw messages.
 *
 * Implementations:
 *   - FileTransport: filesystem-based (atomic write + rename), works locally
 *   - WebSocketTransport: gateway WebSocket, works in-process
 *   - SupabaseTransport: Supabase Realtime + REST, works distributed (cloud)
 */
export interface Transport {
  /** Transport name (for logging/debug). */
  readonly name: string;

  /** Deliver message bytes to a recipient's inbox. */
  deliver(recipient: string, data: Uint8Array): Promise<void>;

  /**
   * Fetch messages from an agent's inbox.
   * @param agentName - The agent whose inbox to read.
   * @param limit - Max messages to return.
   * @param consume - If true, messages are removed (receive). If false, peeked.
   */
  fetch(agentName: string, limit?: number, consume?: boolean): Promise<Uint8Array[]>;

  /** Return the number of pending messages for an agent. */
  count(agentName: string): Promise<number>;

  /** List all known recipient names (for broadcast). */
  listRecipients(): Promise<string[]>;

  /** Release resources. */
  close(): Promise<void>;
}

/** Configuration for transport creation. */
export interface TransportConfig {
  /** Transport type: "file" | "websocket" | "supabase" */
  type: string;
  /** Team/family name (namespace for inboxes). */
  teamName: string;
  /** Base directory for file transport. Default: ~/.kolo/transport */
  baseDir?: string;
  /** Supabase URL (for supabase transport). */
  supabaseUrl?: string;
  /** Supabase key (for supabase transport). */
  supabaseKey?: string;
  /** WebSocket URL (for ws transport). */
  wsUrl?: string;
}
