// src/consciousness/messaging/mailbox.ts
//
// MailboxManager — high-level messaging on top of the Transport abstraction.
// Handles serialization, event logging, broadcast, and message threading.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Transport } from "../transport/types.js";
import type { TeamMessage, SendMessageOptions } from "./types.js";
import { resolveSharedKoloHome } from "../../config/kolo-home.js";

function nowISO(): string {
  return new Date().toISOString();
}

export class MailboxManager {
  private readonly transport: Transport;
  private readonly teamName: string;
  private readonly eventsDir: string;

  constructor(teamName: string, transport: Transport) {
    this.teamName = teamName;
    this.transport = transport;
    this.eventsDir = join(resolveSharedKoloHome(), "consciousness", "events", teamName);
    mkdirSync(this.eventsDir, { recursive: true });
  }

  /** Send a message to a specific agent. */
  async send(opts: SendMessageOptions): Promise<TeamMessage> {
    const msg: TeamMessage = {
      type: opts.type ?? "message",
      from: opts.from,
      to: opts.to,
      content: opts.content ?? null,
      messageId: randomUUID().slice(0, 12),
      replyTo: opts.replyTo ?? null,
      timestamp: nowISO(),
      priority: opts.priority ?? "medium",
      taskId: opts.taskId ?? null,
      payload: opts.payload ?? null,
      tags: opts.tags ?? [],
    };

    if (msg.to) {
      const data = new TextEncoder().encode(JSON.stringify(msg, null, 2));
      await this.transport.deliver(msg.to, data);
    }

    // Log to event store (immutable audit trail)
    this.logEvent(msg);

    return msg;
  }

  /** Broadcast a message to all agents except sender (and optional excludes). */
  async broadcast(
    from: string,
    content: string,
    opts?: {
      type?: TeamMessage["type"];
      priority?: TeamMessage["priority"];
      exclude?: string[];
      tags?: string[];
    },
  ): Promise<TeamMessage[]> {
    const recipients = await this.transport.listRecipients();
    const excludeSet = new Set([from, ...(opts?.exclude ?? [])]);
    const messages: TeamMessage[] = [];

    for (const recipient of recipients) {
      if (excludeSet.has(recipient)) continue;

      const msg = await this.send({
        type: opts?.type ?? "broadcast",
        from,
        to: recipient,
        content,
        priority: opts?.priority ?? "medium",
        tags: opts?.tags ?? [],
      });
      messages.push(msg);
    }

    return messages;
  }

  /** Receive and consume messages from an agent's inbox. */
  async receive(agentName: string, limit = 10): Promise<TeamMessage[]> {
    const rawMessages = await this.transport.fetch(agentName, limit, true);
    return rawMessages.map((raw) => {
      const text = new TextDecoder().decode(raw);
      return JSON.parse(text) as TeamMessage;
    });
  }

  /** Peek at messages without consuming them. */
  async peek(agentName: string): Promise<TeamMessage[]> {
    const rawMessages = await this.transport.fetch(agentName, 50, false);
    return rawMessages.map((raw) => {
      const text = new TextDecoder().decode(raw);
      return JSON.parse(text) as TeamMessage;
    });
  }

  /** Count pending messages for an agent. */
  async pendingCount(agentName: string): Promise<number> {
    return this.transport.count(agentName);
  }

  /** Get event log (newest first). Non-destructive read. */
  getEventLog(limit = 100): TeamMessage[] {
    try {
      const files = readdirSync(this.eventsDir)
        .filter((f) => f.startsWith("evt-") && f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit);

      return files.map((f) => {
        const text = readFileSync(join(this.eventsDir, f), "utf-8");
        return JSON.parse(text) as TeamMessage;
      });
    } catch {
      return [];
    }
  }

  /** Close the underlying transport. */
  async close(): Promise<void> {
    await this.transport.close();
  }

  // ── Event Logging ─────────────────────────────────────────────────────

  private logEvent(msg: TeamMessage): void {
    const ts = Date.now();
    const uid = randomUUID().slice(0, 8);
    const path = join(this.eventsDir, `evt-${ts}-${uid}.json`);
    try {
      writeFileSync(path, JSON.stringify(msg, null, 2), "utf-8");
    } catch {
      // Event logging is best-effort — don't crash message delivery
    }
  }
}
