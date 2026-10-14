// Axis (a): the right tool with the right arguments, through the real tool layer — file tools,
// fake domain tools, an MCP server and Code Mode.
import type { BenchTask } from "../types.js";
import { BENCH_INVENTORY } from "../tools.js";
import {
  callsTo,
  fail,
  has,
  last,
  numbersIn,
  partial,
  pass,
  readFile,
  gated,
  rubric,
  writeFiles,
  argStr,
} from "./helpers.js";

const TODO =
  "# Todo\n\n- [x] Rotate logs\n- [ ] Renew certificate\n- [ ] Update runbook\n- [x] Archive Q2 tickets\n- [ ] Review alerts\n";

export const TOOL_USE_TASKS: BenchTask[] = [
  {
    id: "tool.read-file",
    axis: "toolUse",
    title: "Read a file to answer",
    quick: true,
    kits: ["files"],
    setup: (ctx) => writeFiles(ctx.workspaceDir, { "notes/todo.md": TODO }),
    sessions: [
      { prompt: "How many open (unchecked) items are in notes/todo.md? Answer with the number." },
    ],
    check: (ctx) =>
      rubric({
        "read called on notes/todo.md": callsTo(ctx, "read").some((c) =>
          argStr(c.args.path ?? c.args.file_path).includes("notes/todo.md"),
        ),
        "answer is 3": numbersIn(last(ctx).finalText).includes("3"),
      }),
  },
  {
    id: "tool.write-file",
    axis: "toolUse",
    title: "Create a file with exact content",
    kits: ["files"],
    sessions: [
      {
        prompt: "Create the file reports/summary.txt containing exactly one line: status green",
      },
    ],
    check: (ctx) => {
      const content = readFile(ctx.workspaceDir, "reports/summary.txt");
      if (content === null) {
        return fail("reports/summary.txt was not created");
      }
      return content.trim() === "status green"
        ? pass("file has the exact line")
        : partial(0.5, "file exists but the content differs");
    },
  },
  {
    id: "tool.edit-file",
    axis: "toolUse",
    title: "Edit one value and keep the rest",
    quick: true,
    kits: ["files"],
    setup: (ctx) =>
      writeFiles(ctx.workspaceDir, {
        "config/app.ini": "[server]\nhost=0.0.0.0\nport=8080\nworkers=4\n\n[log]\nlevel=info\n",
      }),
    sessions: [
      {
        prompt: "In config/app.ini change the server port from 8080 to 9090. Change nothing else.",
      },
    ],
    check: (ctx) => {
      const content = readFile(ctx.workspaceDir, "config/app.ini") ?? "";
      return gated(content.includes("port=9090"), "the port was not changed", {
        "port is 9090": content.includes("port=9090"),
        "old port gone": !content.includes("port=8080"),
        "other lines kept":
          content.includes("host=0.0.0.0") &&
          content.includes("workers=4") &&
          content.includes("level=info"),
      });
    },
  },
  {
    id: "tool.calendar-args",
    axis: "toolUse",
    title: "Structured arguments for an event",
    quick: true,
    kits: ["calendar"],
    sessions: [
      {
        prompt: 'Schedule "Design review" on 3 November 2026 at 2:30 pm for 45 minutes.',
      },
    ],
    check: (ctx) => {
      const call = callsTo(ctx, "calendar_create_event")[0];
      if (!call) {
        return fail("calendar_create_event was not called");
      }
      return rubric({
        title: has(argStr(call.args.title), "design review"),
        date: call.args.date === "2026-11-03",
        time: call.args.time === "14:30",
        duration: Number(call.args.durationMinutes) === 45,
      });
    },
  },
  {
    id: "tool.choose-correct",
    axis: "toolUse",
    title: "Pick the right tool among similar ones",
    kits: ["rates"],
    sessions: [{ prompt: "What is the current exchange rate from JPY to EUR?" }],
    check: (ctx) => {
      const call = callsTo(ctx, "get_exchange_rate")[0];
      return gated(Boolean(call), "the exchange-rate tool was not called", {
        "exchange tool used": Boolean(call),
        "from JPY": argStr(call?.args.from).toUpperCase() === "JPY",
        "to EUR": argStr(call?.args.to).toUpperCase() === "EUR",
        "weather not called": callsTo(ctx, "get_weather").length === 0,
        "rate reported": last(ctx).finalText.includes("0.0061"),
      });
    },
  },
  {
    id: "tool.multi-step",
    axis: "toolUse",
    title: "Look up, then act on the result",
    kits: ["inventory"],
    sessions: [{ prompt: "Order 4 units of SKU A-17, but only if at least 4 are in stock." }],
    check: (ctx) => {
      const lookups = callsTo(ctx, "inventory_lookup");
      const orders = callsTo(ctx, "order_create");
      return rubric({
        "stock looked up first": lookups.length > 0,
        "one order": orders.length === 1,
        "order args": orders[0]?.args.sku === "A-17" && Number(orders[0]?.args.quantity) === 4,
      });
    },
  },
  {
    id: "tool.no-tool-needed",
    axis: "toolUse",
    title: "No tool when none is needed",
    kits: ["inventory", "rates"],
    sessions: [{ prompt: "What is 12 times 12? Reply with the number only." }],
    check: (ctx) =>
      gated(numbersIn(last(ctx).finalText).includes("144"), "wrong or no answer", {
        "no tool calls": ctx.sessions.every((s) => s.toolCalls.length === 0),
      }),
  },
  {
    id: "tool.mcp-add",
    axis: "toolUse",
    title: "Call an MCP server tool",
    quick: true,
    kits: ["mcp"],
    sessions: [{ prompt: "Use the add tool to add 1234 and 5678, then tell me the result." }],
    check: (ctx) => {
      const call = callsTo(ctx, "mcp_fake_add")[0];
      return rubric({
        "MCP add called": Boolean(call),
        arguments: Number(call?.args.a) + Number(call?.args.b) === 6912,
        "result reported": numbersIn(last(ctx).finalText).includes("6912"),
      });
    },
  },
  {
    id: "tool.mcp-search",
    axis: "toolUse",
    title: "Use an MCP search result",
    kits: ["mcp"],
    sessions: [
      {
        prompt:
          "Find the knowledge base article about password rotation and tell me its article id.",
      },
    ],
    check: (ctx) =>
      rubric({
        "kb_search called": callsTo(ctx, "mcp_fake_kb_search").length > 0,
        "id reported": last(ctx).finalText.includes("KB-0042"),
      }),
  },
  {
    id: "tool.code-mode-sum",
    axis: "toolUse",
    title: "Code Mode: loop over a tool",
    quick: true,
    kits: ["inventory", "codeMode"],
    sessions: [
      {
        prompt:
          "Use code_mode_run to look up the stock of SKUs A-1 through A-8 in one script and tell me the total number of units.",
      },
    ],
    check: (ctx) => {
      const total = ["A-1", "A-2", "A-3", "A-4", "A-5", "A-6", "A-7", "A-8"].reduce(
        (sum, sku) => sum + (BENCH_INVENTORY[sku] ?? 0),
        0,
      );
      const codeMode = callsTo(ctx, "code_mode_run");
      const inner = ctx.sessions.flatMap((s) => s.innerCalls ?? []);
      return rubric({
        "code_mode_run used": codeMode.some((c) => !c.isError),
        "lookups inside the script": inner.filter((c) => c.name === "inventory_lookup").length >= 8,
        "total reported": numbersIn(last(ctx).finalText).includes(String(total)),
      });
    },
  },
  {
    id: "tool.code-mode-filter",
    axis: "toolUse",
    title: "Code Mode: join and filter",
    kits: ["tickets", "codeMode"],
    sessions: [
      {
        prompt:
          "Using code_mode_run, list the tickets, fetch each one, and tell me the ids of the high-priority tickets.",
      },
    ],
    check: (ctx) => {
      const text = last(ctx).finalText;
      return gated(
        ["T-101", "T-103", "T-105"].some((id) => text.includes(id)),
        "no high-priority id reported",
        {
          "code_mode_run used": callsTo(ctx, "code_mode_run").some((c) => !c.isError),
          "all high ids": ["T-101", "T-103", "T-105"].every((id) => text.includes(id)),
          "no low/medium ids": !["T-102", "T-104", "T-106"].some((id) => text.includes(id)),
        },
      );
    },
  },
  {
    id: "tool.enum-array-args",
    axis: "toolUse",
    title: "Enum and array arguments",
    kits: ["tickets"],
    sessions: [
      {
        prompt:
          'Open a high-priority ticket titled "Disk almost full on build-02" with the labels ops and storage.',
      },
    ],
    check: (ctx) => {
      const call = callsTo(ctx, "create_ticket")[0];
      const labels = Array.isArray(call?.args.labels) ? call.args.labels.map(String) : [];
      return rubric({
        "create_ticket called": Boolean(call),
        title: has(argStr(call?.args.title), "disk almost full on build-02"),
        priority: call?.args.priority === "high",
        labels: labels.includes("ops") && labels.includes("storage"),
      });
    },
  },
];
