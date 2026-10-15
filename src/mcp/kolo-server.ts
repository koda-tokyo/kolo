/**
 * KoLo MCP Server: exposes the Kurahi biology layer to MCP clients.
 *
 * Exposes KoLo's internal state (hormones, proprioception, inbox, health)
 * as MCP tools that any MCP-compatible client can call.
 *
 * Transport: stdio (standard MCP transport for CLI tools)
 *
 * Phase 1 — Hardening Sprint (2026-04-01)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  readBiologyStatus,
  readInbox,
  sendSiblingMessage,
  callGatewayHealthDeep,
} from "./tools.js";

// ── Server Setup ───────────────────────────────────────────────────────

const server = new McpServer({
  name: "kolo",
  version: "0.1.0",
});

// ── Tool: kolo_biology_status ──────────────────────────────────────────
// Reads hormones.json and proprioception.json — the autonomic nervous system.
// Pure read, no side effects.

server.tool(
  "kolo_biology_status",
  "Read Kurahi biology state: hormones (stress, dopamine, serotonin, mood, energy) and proprioception (unread inbox, system stress, ticks, circadian phase). Returns combined JSON.",
  {
    agent_id: z
      .string()
      .optional()
      .describe("Agent ID to read proprioception for (default: reads all agents)."),
  },
  async ({ agent_id }) => {
    const result = await readBiologyStatus(agent_id);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Tool: kolo_gateway_health ──────────────────────────────────────────
// Calls the health.deep RPC on the running gateway.
// Returns: gateway process info, auth TTL, provider health, circuit breaker state.

server.tool(
  "kolo_gateway_health",
  "Deep health check of the Kurahi gateway: process info (uptime, memory, PID), auth profile TTL/validity, API provider health (healthy/degraded/down), consciousness circuit breaker state, and standard channel health.",
  {},
  async () => {
    const result = await callGatewayHealthDeep();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Tool: kolo_inbox_read ──────────────────────────────────────────────
// Reads unread messages from an agent's inbox.

server.tool(
  "kolo_inbox_read",
  "Read messages from a Kurahi agent's inbox. Returns file names and contents of unread messages.",
  {
    agent_id: z.string().describe("Agent id whose inbox to read."),
    include_read: z
      .boolean()
      .optional()
      .describe("Include already-read messages (default: false)."),
    limit: z.number().optional().describe("Max messages to return (default: 20)."),
  },
  async ({ agent_id, include_read, limit }) => {
    const result = await readInbox(agent_id, include_read ?? false, limit ?? 20);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Tool: kolo_sibling_message ─────────────────────────────────────────
// Sends a message to a sibling agent's inbox.

server.tool(
  "kolo_sibling_message",
  "Send a message to a sibling agent's inbox. Creates a timestamped file in their inbox directory.",
  {
    target: z.string().describe("Target agent id."),
    subject: z.string().describe("Short subject line (used in filename)."),
    message: z.string().describe("Message body."),
    sender: z.string().optional().describe("Sender agent ID (default: 'mcp-client')."),
  },
  async ({ target, subject, message, sender }) => {
    const result = await sendSiblingMessage(target, subject, message, sender ?? "mcp-client");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── Tool: kolo_memory_recall (stub) ────────────────────────────────────
// Placeholder for vector search via Supabase. Wired up once Supabase Brain is live.

server.tool(
  "kolo_memory_recall",
  "Search agent memory via vector similarity (Supabase Brain). Currently returns a stub — will be wired to Supabase when the Brain schema is deployed.",
  {
    query: z.string().describe("Natural language query to search memories for."),
    agent_id: z.string().optional().describe("Agent ID to scope search (default: all agents)."),
    limit: z.number().optional().describe("Max results (default: 10)."),
  },
  async ({ query, agent_id, limit }) => {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              status: "stub",
              message:
                "Supabase Brain not yet deployed. This tool will perform vector similarity search once the schema is live.",
              query,
              agent_id: agent_id ?? null,
              limit: limit ?? 10,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server is now running — reads from stdin, writes to stdout (MCP JSON-RPC).
  // It will stay alive until stdin closes or the process is killed.
}

main().catch((err) => {
  console.error("[kolo-mcp] Fatal:", err);
  process.exit(1);
});
