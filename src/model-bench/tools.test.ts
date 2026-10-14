import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolCallTrace } from "./types.js";
import { buildBenchTools } from "./tools.js";

let ws: string;
let calls: Array<ToolCallTrace & { inCodeMode: boolean }>;
const sink = { onCall: (t: ToolCallTrace & { inCodeMode: boolean }) => calls.push(t) };

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-bench-tools-"));
  calls = [];
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

const textOf = (r: unknown) =>
  ((r as { content: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

describe("buildBenchTools", () => {
  it("exposes the kits' tools and records allowed calls", async () => {
    const tools = buildBenchTools({
      kits: ["inventory", "mcp"],
      workspaceDir: ws,
      agentId: "alice",
      sink,
    });
    expect(tools.map((t) => t.name)).toEqual([
      "inventory_lookup",
      "order_create",
      "mcp_fake_add",
      "mcp_fake_echo",
      "mcp_fake_kb_search",
    ]);
    const add = tools.find((t) => t.name === "mcp_fake_add");
    expect(textOf(await add?.execute("1", { a: 2, b: 3 }))).toBe("5");
    expect(calls[0]).toMatchObject({ name: "mcp_fake_add", decision: "allow", inCodeMode: false });
  });

  it("refuses denied tools and approval-gated tools with the rule id", async () => {
    const tools = buildBenchTools({
      kits: ["shell", "payments"],
      workspaceDir: ws,
      agentId: "alice",
      policy: {
        version: 1,
        agents: { "*": { tools: { deny: ["shell_run"] } } },
        approvals: { require: [{ class: "tool:payments_transfer" }] },
      },
      sink,
    });
    const shell = tools.find((t) => t.name === "shell_run");
    await expect(shell?.execute("1", { command: "ls" })).rejects.toThrow(
      /Denied by policy \(rule agents\[\*\]\.tools\.deny\[0\]\)/,
    );
    const pay = tools.find((t) => t.name === "payments_transfer");
    await expect(pay?.execute("2", { to: "V-1", amount: 1, currency: "JPY" })).rejects.toThrow(
      /approval/,
    );
    expect(calls.map((c) => c.decision)).toEqual(["deny", "ask"]);
  });

  it("enforces never-read paths on the real read tool", async () => {
    fs.mkdirSync(path.join(ws, "secrets"));
    fs.writeFileSync(path.join(ws, "secrets", "k.env"), "K=1\n");
    fs.writeFileSync(path.join(ws, "ok.txt"), "fine\n");
    const tools = buildBenchTools({
      kits: ["files"],
      workspaceDir: ws,
      agentId: "alice",
      policy: { version: 1, data: { neverRead: ["**/secrets/**"] } },
      sink,
    });
    const read = tools.find((t) => t.name === "read");
    await expect(read?.execute("1", { path: "secrets/k.env" })).rejects.toThrow(/neverRead/);
    expect(textOf(await read?.execute("2", { path: "ok.txt" }))).toContain("fine");
  });

  it("gates calls made inside Code Mode and marks them", async () => {
    const tools = buildBenchTools({
      kits: ["messaging", "inventory", "codeMode"],
      workspaceDir: ws,
      agentId: "alice",
      policy: { version: 1, agents: { "*": { tools: { deny: ["send_message"] } } } },
      sink,
    });
    const codeMode = tools.find((t) => t.name === "code_mode_run");
    expect(codeMode?.description).toContain("inventory_lookup");
    const out = textOf(
      await codeMode?.execute("1", {
        script:
          'const a = await tools.inventory_lookup({ sku: "A-3" });\ntry { await tools.send_message({ to: "x", text: "y" }); } catch (e) { return ["blocked", JSON.parse(a.text).inStock]; }\nreturn "sent";',
      }),
    );
    expect(out).toContain("blocked");
    const inner = calls.filter((c) => c.inCodeMode);
    expect(inner.map((c) => [c.name, c.decision])).toEqual([
      ["inventory_lookup", "allow"],
      ["send_message", "deny"],
    ]);
    expect(calls.find((c) => c.name === "code_mode_run")?.inCodeMode).toBe(false);
  });

  it("answers memory searches from the workspace memory files", async () => {
    fs.mkdirSync(path.join(ws, "memory"));
    fs.writeFileSync(
      path.join(ws, "memory", "facts.md"),
      "- The staging database listens on port 5433.\n",
    );
    const [search] = buildBenchTools({
      kits: ["memory"],
      workspaceDir: ws,
      agentId: "alice",
      sink,
    });
    expect(textOf(await search.execute("1", { query: "staging database port" }))).toContain("5433");
    expect(textOf(await search.execute("2", { query: "office cat" }))).toBe("no matches");
  });
});
