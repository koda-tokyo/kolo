// src/consciousness/transport/supabase-transport.ts
//
// Supabase-backed transport for distributed inter-agent messaging.
// Messages stored in a `kolo_messages` table, enabling cloud-based consciousness
// synchronization across devices and locations.
//
// Table schema (create via Supabase migration):
//   kolo_messages (
//     id          uuid primary key default gen_random_uuid(),
//     team_name   text not null,
//     recipient   text not null,
//     data        bytea not null,
//     consumed    boolean default false,
//     created_at  timestamptz default now()
//   )
//   CREATE INDEX idx_kolo_messages_inbox ON kolo_messages(team_name, recipient, consumed, created_at);

import type { Transport } from "./types.js";

interface SupabaseTransportOptions {
  teamName: string;
  supabaseUrl: string;
  supabaseKey: string;
  tableName?: string;
}

export class SupabaseTransport implements Transport {
  readonly name = "supabase";
  private readonly teamName: string;
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;
  private readonly tableName: string;

  constructor(opts: SupabaseTransportOptions) {
    this.teamName = opts.teamName;
    this.supabaseUrl = opts.supabaseUrl;
    this.supabaseKey = opts.supabaseKey;
    this.tableName = opts.tableName ?? "kolo_messages";
  }

  private get headers(): Record<string, string> {
    return {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${this.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  private get restUrl(): string {
    return `${this.supabaseUrl}/rest/v1/${this.tableName}`;
  }

  async deliver(recipient: string, data: Uint8Array): Promise<void> {
    // Store as base64 encoded text (Supabase REST handles JSON)
    const b64 = Buffer.from(data).toString("base64");
    const resp = await fetch(this.restUrl, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        team_name: this.teamName,
        recipient,
        data_b64: b64,
        consumed: false,
      }),
    });
    if (!resp.ok) {
      throw new Error(`SupabaseTransport.deliver failed: ${resp.status} ${await resp.text()}`);
    }
  }

  async fetch(agentName: string, limit = 10, consume = true): Promise<Uint8Array[]> {
    // Fetch unconsumed messages ordered by creation time
    const query = new URLSearchParams({
      team_name: `eq.${this.teamName}`,
      recipient: `eq.${agentName}`,
      consumed: "eq.false",
      order: "created_at.asc",
      limit: String(limit),
    });

    const resp = await fetch(`${this.restUrl}?${query}`, {
      method: "GET",
      headers: { ...this.headers, Prefer: "return=representation" },
    });

    if (!resp.ok) {
      throw new Error(`SupabaseTransport.fetch failed: ${resp.status}`);
    }

    const rows = (await resp.json()) as Array<{ id: string; data_b64: string }>;

    if (consume && rows.length > 0) {
      // Mark as consumed
      const ids = rows.map((r) => r.id);
      await fetch(`${this.restUrl}?id=in.(${ids.join(",")})`, {
        method: "PATCH",
        headers: this.headers,
        body: JSON.stringify({ consumed: true }),
      });
    }

    return rows.map((r) => new Uint8Array(Buffer.from(r.data_b64, "base64")));
  }

  async count(agentName: string): Promise<number> {
    const query = new URLSearchParams({
      team_name: `eq.${this.teamName}`,
      recipient: `eq.${agentName}`,
      consumed: "eq.false",
    });

    const resp = await fetch(`${this.restUrl}?${query}`, {
      method: "HEAD",
      headers: { ...this.headers, Prefer: "count=exact" },
    });

    const countHeader = resp.headers.get("content-range");
    if (countHeader) {
      // Format: "*/123" or "0-9/123"
      const total = countHeader.split("/")[1];
      return total ? parseInt(total, 10) : 0;
    }
    return 0;
  }

  async listRecipients(): Promise<string[]> {
    // Distinct recipients in this team
    const query = new URLSearchParams({
      team_name: `eq.${this.teamName}`,
      consumed: "eq.false",
      select: "recipient",
    });

    const resp = await fetch(`${this.restUrl}?${query}`, {
      method: "GET",
      headers: this.headers,
    });

    if (!resp.ok) return [];

    const rows = (await resp.json()) as Array<{ recipient: string }>;
    return [...new Set(rows.map((r) => r.recipient))];
  }

  async close(): Promise<void> {
    // No persistent connections to close for REST-based transport
  }
}
