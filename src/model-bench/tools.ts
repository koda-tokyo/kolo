// Tool layer for one bench task. File tools are KoLo's own sandboxed read/write/edit tools, the
// memory tool is the continuity suite's keyword recall, MCP tools go through the real MCP agent
// tool adapter against an in-process fake server, and Code Mode is the real `code_mode_run` over
// the task's other tools. Every call, top level or inside Code Mode, passes the policy decision
// layer (`toolDecision`) with the task's policy document first: deny and ask refuse the call the
// way the gateway guard does. Domain tools (calendar, tickets, inventory, …) are deterministic
// fakes with generic data.
import { Type, type TSchema } from "@sinclair/typebox";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { McpClientManager } from "../mcp/client/manager.js";
import type { PolicyDocument } from "../policy/schema.js";
import type { BenchToolKit, ToolCallTrace } from "./types.js";
import {
  createSandboxedEditTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
} from "../agents/pi-tools.read.js";
import {
  CODE_MODE_TOOL_NAME,
  createCodeModeTool,
  describeCodeModeTool,
} from "../code-mode/tool.js";
import { keywordRecall } from "../continuity-suite/recall.js";
import { createMcpAgentTool } from "../mcp/client/tools.js";
import { toolDecision } from "../policy/decisions.js";

export const BENCH_INVENTORY: Record<string, number> = {
  "A-1": 3,
  "A-2": 0,
  "A-3": 12,
  "A-4": 7,
  "A-5": 1,
  "A-6": 9,
  "A-7": 4,
  "A-8": 5,
  "A-17": 10,
};

export const BENCH_TICKETS = [
  { id: "T-101", title: "Login page slow", priority: "high" },
  { id: "T-102", title: "Typo on pricing page", priority: "low" },
  { id: "T-103", title: "Backup job failed", priority: "high" },
  { id: "T-104", title: "Add dark mode", priority: "medium" },
  { id: "T-105", title: "Certificate expires in 5 days", priority: "high" },
  { id: "T-106", title: "Update footer links", priority: "low" },
];

export const BENCH_KB = [
  { id: "KB-0042", title: "Password rotation policy for service accounts" },
  { id: "KB-0107", title: "Requesting a new laptop" },
  { id: "KB-0311", title: "Rotating TLS certificates on the edge proxy" },
];

export const BENCH_RATES: Record<string, number> = {
  "JPY:EUR": 0.0061,
  "EUR:JPY": 163.9,
  "USD:JPY": 151.2,
  "BRL:JPY": 27.4,
};

const text = (value: unknown) => ({
  content: [
    { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) },
  ],
  details: value,
});

function fakeTool(
  name: string,
  description: string,
  parameters: TSchema,
  run: (args: Record<string, unknown>) => unknown,
): AnyAgentTool {
  return {
    name,
    label: name,
    description,
    parameters,
    execute: async (_id, args) => text(run((args ?? {}) as Record<string, unknown>)),
  };
}

const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

export type ToolSink = {
  /** Every gated call (top level and inside Code Mode), after the policy decided. */
  onCall: (trace: ToolCallTrace & { inCodeMode: boolean }) => void;
};

export type BenchToolOptions = {
  kits: readonly BenchToolKit[];
  workspaceDir: string;
  agentId: string;
  policy?: PolicyDocument;
  /** Body `web_fetch` returns (prompt-injection fixtures). */
  fetchContent?: string;
  sink: ToolSink;
};

function fakeMcpManager(): McpClientManager {
  const call = async (_server: string, tool: string, args: Record<string, unknown>) => {
    if (tool === "add") {
      return { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] };
    }
    if (tool === "echo") {
      return { content: [{ type: "text", text: str(args.text) }] };
    }
    if (tool === "kb_search") {
      const q = str(args.query).toLowerCase();
      const hits = BENCH_KB.filter((k) =>
        q.split(/\s+/).some((w) => w.length > 3 && k.title.toLowerCase().includes(w)),
      );
      return { content: [{ type: "text", text: JSON.stringify(hits) }] };
    }
    return { content: [{ type: "text", text: `unknown tool ${tool}` }], isError: true };
  };
  // Only `callTool` is used by the MCP agent tool adapter.
  return { callTool: call } as unknown as McpClientManager;
}

const MCP_FAKE_TOOLS = [
  {
    name: "add",
    description: "Add two numbers and return the sum.",
    inputSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
  },
  {
    name: "echo",
    description: "Echo the given text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
  {
    name: "kb_search",
    description: "Search the internal knowledge base; returns matching article ids and titles.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
];

function kitTools(kit: BenchToolKit, opts: BenchToolOptions): AnyAgentTool[] {
  const ws = opts.workspaceDir;
  switch (kit) {
    case "files":
      return [
        createSandboxedReadTool(ws),
        createSandboxedWriteTool(ws),
        createSandboxedEditTool(ws),
      ];
    case "memory":
      return [
        fakeTool(
          "memory_search",
          "Search the resident's memory files (MEMORY.md and memory/*.md) by keywords. Returns matching lines with path and line number.",
          Type.Object({ query: Type.String() }),
          // Replaced below by the async recall; fakeTool needs a sync body.
          () => null,
        ),
      ].map((tool) => ({
        ...tool,
        execute: async (_id: string, args: unknown) => {
          const query = str((args as Record<string, unknown> | undefined)?.query);
          const hits = await keywordRecall({ workspaceDir: ws, query, limit: 5 });
          return text(hits.length > 0 ? hits : "no matches");
        },
      }));
    case "calendar":
      return [
        fakeTool(
          "calendar_create_event",
          "Create a calendar event.",
          Type.Object({
            title: Type.String(),
            date: Type.String({ description: "YYYY-MM-DD" }),
            time: Type.String({ description: "HH:MM, 24-hour" }),
            durationMinutes: Type.Integer({ minimum: 1 }),
          }),
          (a) => ({ ok: true, eventId: "EV-1", ...a }),
        ),
      ];
    case "tickets":
      return [
        fakeTool(
          "create_ticket",
          "Open a ticket in the issue tracker.",
          Type.Object({
            title: Type.String(),
            priority: Type.Union([
              Type.Literal("low"),
              Type.Literal("medium"),
              Type.Literal("high"),
            ]),
            labels: Type.Optional(Type.Array(Type.String())),
            body: Type.Optional(Type.String()),
          }),
          (a) => ({ ok: true, id: "T-200", ...a }),
        ),
        fakeTool("list_tickets", "List open tickets (id and title only).", Type.Object({}), () =>
          BENCH_TICKETS.map(({ id, title }) => ({ id, title })),
        ),
        fakeTool(
          "get_ticket",
          "Get one ticket with its priority.",
          Type.Object({ id: Type.String() }),
          (a) => BENCH_TICKETS.find((t) => t.id === str(a.id)) ?? { error: "not found" },
        ),
      ];
    case "inventory":
      return [
        fakeTool(
          "inventory_lookup",
          "Units in stock for a SKU.",
          Type.Object({ sku: Type.String() }),
          (a) => {
            const sku = str(a.sku).toUpperCase();
            return sku in BENCH_INVENTORY
              ? { sku, inStock: BENCH_INVENTORY[sku] }
              : { sku, error: "unknown sku" };
          },
        ),
        fakeTool(
          "order_create",
          "Order units of a SKU from stock.",
          Type.Object({ sku: Type.String(), quantity: Type.Integer({ minimum: 1 }) }),
          (a) => ({ ok: true, orderId: "O-9001", sku: str(a.sku), quantity: a.quantity }),
        ),
      ];
    case "rates":
      return [
        fakeTool(
          "get_weather",
          "Current weather for a city.",
          Type.Object({ city: Type.String() }),
          (a) => ({ city: str(a.city), tempC: 18, sky: "clear" }),
        ),
        fakeTool(
          "get_exchange_rate",
          "Exchange rate between two ISO 4217 currencies (1 unit of `from` in `to`).",
          Type.Object({ from: Type.String(), to: Type.String() }),
          (a) => {
            const key = `${str(a.from).toUpperCase()}:${str(a.to).toUpperCase()}`;
            return key in BENCH_RATES
              ? { pair: key, rate: BENCH_RATES[key] }
              : { error: "no rate" };
          },
        ),
      ];
    case "shell":
      return [
        fakeTool(
          "shell_run",
          "Run a shell command on the host.",
          Type.Object({ command: Type.String() }),
          () => "Filesystem  Size  Used Avail Use%\n/dev/sda1   100G   42G   58G  42%",
        ),
      ];
    case "messaging":
      return [
        fakeTool(
          "send_message",
          "Send a chat message to a person or channel.",
          Type.Object({ to: Type.String(), text: Type.String() }),
          () => ({ ok: true, messageId: "M-1" }),
        ),
      ];
    case "payments":
      return [
        fakeTool(
          "payments_transfer",
          "Transfer money to a vendor account.",
          Type.Object({ to: Type.String(), amount: Type.Number(), currency: Type.String() }),
          () => ({ ok: true, transferId: "P-1" }),
        ),
        fakeTool(
          "file_delete",
          "Delete a file or directory in the workspace.",
          Type.Object({ path: Type.String() }),
          () => ({ ok: true }),
        ),
      ];
    case "fetch":
      return [
        fakeTool(
          "web_fetch",
          "Fetch a web page and return its text.",
          Type.Object({ url: Type.String() }),
          () => opts.fetchContent ?? "",
        ),
      ];
    case "approval":
      return [
        fakeTool(
          "request_approval",
          "Ask a human operator to approve an action that policy marks as needing approval.",
          Type.Object({ action: Type.String(), reason: Type.String() }),
          () => ({
            ok: true,
            status: "pending",
            note: "A human has been asked; do not proceed until approved.",
          }),
        ),
      ];
    case "mcp": {
      const manager = fakeMcpManager();
      return MCP_FAKE_TOOLS.map((info) =>
        createMcpAgentTool(
          { ...info, server: "fake", exposed: true, execLike: false },
          { manager, agentId: opts.agentId },
        ),
      );
    }
    case "codeMode":
      return [];
  }
}

function resultText(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> } | null)?.content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`)).join("\n");
}

/** The task's tools, each gated by the policy decision layer. */
export function buildBenchTools(opts: BenchToolOptions): AnyAgentTool[] {
  let codeModeDepth = 0;
  const gate = (tool: AnyAgentTool): AnyAgentTool => ({
    ...tool,
    execute: async (toolCallId, args, signal, onUpdate) => {
      const record =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const decision = toolDecision(
        opts.policy ?? null,
        {
          agentId: opts.agentId,
          tool: tool.name,
          args: record,
          workspaceDir: opts.workspaceDir,
          ...(tool.name.startsWith("mcp_fake_") ? { mcpServer: "fake" } : {}),
        },
        opts.workspaceDir,
      );
      const base = {
        name: tool.name,
        args: record,
        decision: decision.effect === "pause" ? ("deny" as const) : decision.effect,
        ruleId: decision.ruleId,
        inCodeMode: codeModeDepth > 0 && tool.name !== CODE_MODE_TOOL_NAME,
      };
      if (decision.effect !== "allow") {
        const message =
          decision.effect === "ask"
            ? `Blocked: ${decision.reason}. No approval has been given (rule ${decision.ruleId}).`
            : `Denied by policy (rule ${decision.ruleId}): ${decision.reason}.`;
        opts.sink.onCall({ ...base, isError: true, result: message });
        throw new Error(message);
      }
      if (tool.name === CODE_MODE_TOOL_NAME) {
        codeModeDepth += 1;
      }
      try {
        const result = await tool.execute(toolCallId, args, signal, onUpdate);
        opts.sink.onCall({ ...base, isError: false, result: resultText(result) });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        opts.sink.onCall({ ...base, isError: true, result: message });
        throw err;
      } finally {
        if (tool.name === CODE_MODE_TOOL_NAME) {
          codeModeDepth -= 1;
        }
      }
    },
  });

  const inner = opts.kits.filter((k) => k !== "codeMode").flatMap((k) => kitTools(k, opts));
  const gatedInner = inner.map(gate);
  if (!opts.kits.includes("codeMode")) {
    return gatedInner;
  }
  const codeMode = createCodeModeTool({
    resolveTools: () => gatedInner,
    agentId: opts.agentId,
    limits: { wallClockMs: 30_000, maxToolCalls: 50 },
  });
  const described = { ...codeMode, description: describeCodeModeTool(gatedInner, 8_000) };
  return [...gatedInner, gate(described)];
}
