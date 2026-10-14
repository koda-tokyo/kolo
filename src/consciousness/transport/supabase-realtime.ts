// src/consciousness/transport/supabase-realtime.ts
//
// Supabase Realtime Transport — push-based message delivery.
//
// Extends SupabaseTransport with Realtime subscriptions for instant
// message notification. Instead of polling on each consciousness tick,
// messages arrive via WebSocket push.
//
// Architecture:
//   - Deliver: POST to REST API (same as SupabaseTransport)
//   - Receive: Supabase Realtime subscription on INSERT to kolo_messages
//   - Fallback: REST polling if Realtime connection drops

import type { Transport } from "./types.js";
import { SupabaseTransport } from "./supabase-transport.js";

interface RealtimeOptions {
  teamName: string;
  supabaseUrl: string;
  supabaseKey: string;
  agentId: string;
  tableName?: string;
  onMessage?: (data: Uint8Array) => void;
}

/**
 * Supabase Realtime Transport — wraps SupabaseTransport with push notifications.
 *
 * On new message INSERT for our agent, the callback fires immediately
 * instead of waiting for the next tick's fetch().
 */
export class SupabaseRealtimeTransport implements Transport {
  readonly name = "supabase-realtime";
  private readonly restTransport: SupabaseTransport;
  private readonly agentId: string;
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;
  private readonly tableName: string;
  private readonly onMessage?: (data: Uint8Array) => void;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(opts: RealtimeOptions) {
    this.restTransport = new SupabaseTransport({
      teamName: opts.teamName,
      supabaseUrl: opts.supabaseUrl,
      supabaseKey: opts.supabaseKey,
      tableName: opts.tableName,
    });
    this.agentId = opts.agentId;
    this.supabaseUrl = opts.supabaseUrl;
    this.supabaseKey = opts.supabaseKey;
    this.tableName = opts.tableName ?? "kolo_messages";
    this.onMessage = opts.onMessage;

    this.connectRealtime();
  }

  // ── Transport Interface (delegates to REST transport) ──────────────────

  async deliver(recipient: string, data: Uint8Array): Promise<void> {
    return this.restTransport.deliver(recipient, data);
  }

  async fetch(agentName: string, limit?: number, consume?: boolean): Promise<Uint8Array[]> {
    return this.restTransport.fetch(agentName, limit, consume);
  }

  async count(agentName: string): Promise<number> {
    return this.restTransport.count(agentName);
  }

  async listRecipients(): Promise<string[]> {
    return this.restTransport.listRecipients();
  }

  async close(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    await this.restTransport.close();
  }

  /** Whether the realtime WebSocket is connected. */
  get isRealtimeConnected(): boolean {
    return this.connected;
  }

  // ── Realtime Connection ────────────────────────────────────────────────

  private connectRealtime(): void {
    // Supabase Realtime WebSocket URL
    const realtimeUrl =
      this.supabaseUrl.replace("https://", "wss://").replace("http://", "ws://") +
      "/realtime/v1/websocket?apikey=" +
      this.supabaseKey +
      "&vsn=1.0.0";

    try {
      this.ws = new WebSocket(realtimeUrl);

      this.ws.onopen = () => {
        this.connected = true;
        console.log(`[supabase-realtime] Connected for ${this.agentId}`);

        // Subscribe to INSERT events on our table for our agent
        const joinPayload = {
          topic: `realtime:public:${this.tableName}`,
          event: "phx_join",
          payload: {
            config: {
              postgres_changes: [
                {
                  event: "INSERT",
                  schema: "public",
                  table: this.tableName,
                  filter: `recipient=eq.${this.agentId}`,
                },
              ],
            },
          },
          ref: "1",
        };

        this.ws?.send(JSON.stringify(joinPayload));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));

          // Handle postgres_changes events
          if (data.event === "postgres_changes" && data.payload?.data?.record) {
            const record = data.payload.data.record;
            if (record.recipient === this.agentId && record.data_b64) {
              const decoded = new Uint8Array(Buffer.from(record.data_b64, "base64"));
              this.onMessage?.(decoded);
            }
          }

          // Respond to heartbeat to keep connection alive
          if (data.event === "phx_reply" || data.event === "heartbeat") {
            // Connection is healthy
          }
        } catch {
          // Ignore parse errors on realtime stream
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        console.log(`[supabase-realtime] Disconnected. Reconnecting in 10s...`);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.connected = false;
        this.scheduleReconnect();
      };
    } catch (err) {
      console.warn(`[supabase-realtime] Failed to connect: ${err}. Falling back to REST polling.`);
      this.connected = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectRealtime();
    }, 10_000);
  }

  // ── Heartbeat (keep WebSocket alive) ───────────────────────────────────

  /** Call this periodically (e.g., every 30s) to keep the connection alive. */
  sendHeartbeat(): void {
    if (!this.ws || !this.connected) return;
    try {
      this.ws.send(
        JSON.stringify({
          topic: "phoenix",
          event: "heartbeat",
          payload: {},
          ref: String(Date.now()),
        }),
      );
    } catch {
      // Connection may have dropped
    }
  }
}
