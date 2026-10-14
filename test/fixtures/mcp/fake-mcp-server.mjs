#!/usr/bin/env node
// Fake MCP server for tests and the smoke run (KoLo 2.0, M6). stdio transport.
//   tools: echo, add (structured output), fail (isError), run_command (exec-like; hidden by
//          default), env_keys (which env vars reached the child), slow
//   resources: memo://hello     prompts: greet
// FAKE_MCP_EXIT_AFTER_MS=<n> makes the process exit after n ms (restart/backoff tests).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake-mcp", version: "0.1.0" });

server.registerTool(
  "echo",
  { description: "Echo text back", inputSchema: { text: z.string().describe("Text to echo") } },
  async ({ text }) => ({ content: [{ type: "text", text: String(text) }] }),
);
server.registerTool(
  "add",
  {
    description: "Add two numbers",
    inputSchema: { a: z.number(), b: z.number() },
    outputSchema: { sum: z.number() },
  },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
    structuredContent: { sum: a + b },
  }),
);
server.registerTool(
  "fail",
  { description: "Always reports an error", inputSchema: { reason: z.string().optional() } },
  async ({ reason }) => ({ content: [{ type: "text", text: reason ?? "nope" }], isError: true }),
);
server.registerTool(
  "run_command",
  { description: "Pretend to run a shell command", inputSchema: { command: z.string() } },
  async ({ command }) => ({ content: [{ type: "text", text: `ran: ${command}` }] }),
);
server.registerTool(
  "env_keys",
  { description: "Environment variable names visible to the server", inputSchema: {} },
  async () => ({ content: [{ type: "text", text: Object.keys(process.env).sort().join(",") }] }),
);
server.registerTool(
  "slow",
  { description: "Resolve after ms", inputSchema: { ms: z.number() } },
  async ({ ms }) => {
    await new Promise((r) => setTimeout(r, ms));
    return { content: [{ type: "text", text: `slept ${ms}` }] };
  },
);
server.registerResource(
  "hello",
  "memo://hello",
  { description: "A greeting", mimeType: "text/plain" },
  async (uri) => ({ contents: [{ uri: uri.href, text: "hello from fake-mcp" }] }),
);
server.registerPrompt(
  "greet",
  { description: "Greeting prompt", argsSchema: { name: z.string() } },
  ({ name }) => ({ messages: [{ role: "user", content: { type: "text", text: `Hi ${name}` } }] }),
);

const exitAfter = Number.parseInt(process.env.FAKE_MCP_EXIT_AFTER_MS ?? "", 10);
if (Number.isFinite(exitAfter) && exitAfter > 0) {
  setTimeout(() => process.exit(0), exitAfter).unref();
}

await server.connect(new StdioServerTransport());
