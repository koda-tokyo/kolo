// Sandbox contract (KoLo 2.0, M6): escapes fail, limits bite, calls are accounted and audited.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { onAuditEvent, type AuditEvent } from "../security/audit-log.js";
import { runCodeModeScript, toolResultForScript } from "./runner.js";

const tools: AnyAgentTool[] = [
  {
    name: "echo",
    label: "Echo",
    description: "echo text",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    } as AnyAgentTool["parameters"],
    execute: async (_id, args) => {
      const a = args as { text: string };
      return { content: [{ type: "text", text: String(a.text) }], details: { text: a.text } };
    },
  },
  {
    name: "add",
    label: "Add",
    description: "add numbers",
    parameters: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
    } as AnyAgentTool["parameters"],
    execute: async (_id, args) => {
      const a = args as { a: number; b: number };
      return { content: [{ type: "text", text: String(a.a + a.b) }], details: { sum: a.a + a.b } };
    },
  },
  {
    name: "boom",
    label: "Boom",
    description: "throws",
    parameters: { type: "object", properties: {} } as AnyAgentTool["parameters"],
    execute: async () => {
      throw new Error("tool exploded");
    },
  },
  {
    name: "slow",
    label: "Slow",
    description: "waits",
    parameters: { type: "object", properties: {} } as AnyAgentTool["parameters"],
    execute: async (_id, _args, signal) => {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 5000);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          resolve();
        });
      });
      return { content: [{ type: "text", text: "late" }], details: null };
    },
  },
];

const audit: AuditEvent[] = [];
let stopAudit = () => {};
beforeAll(() => {
  stopAudit = onAuditEvent((e) => audit.push(e));
});
afterAll(() => stopAudit());

const run = (script: string, extra: Partial<Parameters<typeof runCodeModeScript>[0]> = {}) =>
  runCodeModeScript({
    script,
    tools,
    audit: { source: "test", agentId: "tester", sessionKey: "agent:tester:main" },
    ...extra,
  });

describe("code mode runner: happy path", () => {
  it("runs a script that calls several tools and returns a value", async () => {
    const r = await run(
      "const s = await tools.add({ a: 2, b: 3 }); const e = await tools.echo({ text: 'hi' });" +
        " console.log('sum', s.details.sum); return { sum: s.details.sum, echo: e.text };",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ sum: 5, echo: "hi" });
    expect(r.toolCalls).toBe(2);
    expect(r.calls.map((c) => c.tool)).toEqual(["add", "echo"]);
    expect(r.logs).toEqual([{ level: "log", text: "sum 5" }]);
    expect(r.tools).toEqual(["echo", "add", "boom", "slow"]);
  });

  it("strips TypeScript types", async () => {
    const r = await run(
      "const x: number = 4; const r = await tools.add({ a: x, b: 1 }); return r.details.sum as number;",
      { language: "ts" },
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(5);
  });

  it("returns undefined for a script with no return", async () => {
    const r = await run("await tools.echo({ text: 'x' });");
    expect(r.ok).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it("surfaces a tool error as a catchable sandbox error", async () => {
    const r = await run(
      "try { await tools.boom({}); return 'no'; } catch (e) { return e.name + ':' + e.message; }",
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe("ToolError:tool exploded");
    expect(r.calls[0]).toMatchObject({ tool: "boom", ok: false, error: "tool exploded" });
  });
});

describe("code mode runner: escapes", () => {
  it.each([
    ["require", "return typeof require;", "undefined"],
    ["process", "return typeof process;", "undefined"],
    ["fetch", "return typeof fetch;", "undefined"],
    ["globalThis.process", "return typeof globalThis.process;", "undefined"],
    ["Atomics", "return typeof Atomics;", "undefined"],
    ["SharedArrayBuffer", "return typeof SharedArrayBuffer;", "undefined"],
    ["WebAssembly", "return typeof WebAssembly;", "undefined"],
  ])("%s is unreachable", async (_name, script, expected) => {
    const r = await run(script);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(expected);
  });

  it("dynamic import is refused", async () => {
    const r = await run("const m = await import('node:fs'); return typeof m;");
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("script_error");
    expect(r.error?.message).toMatch(/dynamic import/i);
  });

  it.each([
    ["eval", "return eval('1+1');"],
    ["Function", "return new Function('return typeof process')();"],
    ["tool function constructor", "return tools.add.constructor('return typeof process')();"],
    [
      "tool result constructor chain",
      "const r = await tools.add({a:1,b:1}); return r.constructor.constructor('return typeof process')();",
    ],
    [
      "tool promise constructor chain",
      "const p = tools.add({a:1,b:1}); const F = p.constructor.constructor; await p; return F('return typeof process')();",
    ],
    [
      "caught error constructor chain",
      "try { await tools.boom({}); } catch (e) { return e.constructor.constructor('return typeof process')(); }",
    ],
  ])("%s: code generation from strings is disallowed", async (_name, script) => {
    const r = await run(script);
    expect(r.ok).toBe(false);
    expect(r.error?.message).toMatch(/Code generation from strings disallowed/);
  });

  it("console output cannot reach the host stdout", async () => {
    const r = await run("console.error('captured'); return 1;");
    expect(r.logs).toEqual([{ level: "error", text: "captured" }]);
  });
});

describe("code mode runner: limits", () => {
  it("terminates a synchronous infinite loop at the wall clock", async () => {
    const t0 = Date.now();
    const r = await run("while (true) {}", { limits: { wallClockMs: 1000 } });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("terminates a loop after an await too", async () => {
    const r = await run("await tools.echo({ text: 'x' }); while (true) {}", {
      limits: { wallClockMs: 1000 },
    });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("timeout");
    expect(r.toolCalls).toBe(1);
  });

  it("kills a memory bomb", async () => {
    const r = await run(
      "const a = []; let i = 0; while (true) { a.push({ i: i++, s: String(i), o: { k: [i, i, i] } }); }",
      { limits: { wallClockMs: 20_000, maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 } },
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("memory");
    expect(r.durationMs).toBeLessThan(15_000);
  }, 30_000);

  it("stops at the tool call budget and audits the denied call", async () => {
    audit.length = 0;
    const r = await run(
      "for (let i = 0; i < 10; i++) await tools.echo({ text: 'x' }); return 'done';",
      {
        limits: { maxToolCalls: 3 },
      },
    );
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("tool_call_limit");
    expect(r.toolCalls).toBe(4);
    const denied = audit.find((e) => e.action === "code_mode.tool_call" && e.outcome === "denied");
    expect(denied?.detail).toMatchObject({ runId: r.runId, seq: 4, tool: "echo" });
  });

  it("refuses a script that returns too much", async () => {
    const r = await run("return 'x'.repeat(5000);", { limits: { maxResultBytes: 1000 } });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("result_too_large");
  });

  it("refuses an empty, oversized or unparsable script", async () => {
    expect((await run("   ")).error?.code).toBe("invalid_script");
    expect((await run("return 1;", { limits: { maxScriptChars: 3 } })).error?.code).toBe(
      "invalid_script",
    );
    const bad = await run("return (;");
    expect(bad.error?.code).toBe("invalid_script");
  });

  it("aborts a running tool call when the run is aborted", async () => {
    const ac = new AbortController();
    const p = run("await tools.slow({}); return 'late';", { signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("aborted");
  });
});

describe("code mode runner: allowlist, accounting, audit", () => {
  it("hides tools outside allowTools and denies a call by id", async () => {
    audit.length = 0;
    const r = await run("return [typeof tools.add, typeof tools.echo, Object.keys(tools)];", {
      allowTools: ["ech*"],
    });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual(["undefined", "function", ["echo"]]);
    expect(r.tools).toEqual(["echo"]);
  });

  it("writes start, per-call and run audit rows under the run id", async () => {
    audit.length = 0;
    const r = await run(
      "await tools.add({ a: 1, b: 1 }); await tools.echo({ text: 'y' }); return 1;",
      {
        runId: "cm_test_audit",
      },
    );
    expect(r.ok).toBe(true);
    const mine = audit.filter((e) => (e.detail as { runId?: string })?.runId === "cm_test_audit");
    expect(mine.map((e) => e.action)).toEqual([
      "code_mode.start",
      "code_mode.tool_call",
      "code_mode.tool_call",
      "code_mode.run",
    ]);
    expect(mine[1]).toMatchObject({
      outcome: "allowed",
      identity: "tester",
      scope: "agent:tester:main",
      source: "test",
      detail: { tool: "add", seq: 1 },
    });
    expect(mine[3].detail).toMatchObject({ ok: true, toolCalls: 2 });
  });

  it("runs beforeToolCall before every call and turns its throw into a tool error", async () => {
    const seen: string[] = [];
    const r = await run(
      "try { await tools.add({a:1,b:1}); } catch (e) { return e.message; } return 'allowed';",
      {
        beforeToolCall: (tool) => {
          seen.push(tool.name);
          throw new Error("capability none");
        },
      },
    );
    expect(seen).toEqual(["add"]);
    expect(r.value).toBe("capability none");
    expect(r.calls[0]).toMatchObject({ ok: false, error: "capability none" });
  });

  it("shapes tool results as {text, details, images?}", () => {
    expect(
      toolResultForScript(
        {
          content: [
            { type: "text", text: "a" },
            { type: "image", data: "", mimeType: "image/png" },
          ],
          details: 1,
        },
        1000,
      ),
    ).toEqual({ ok: true, value: { text: "a", details: 1, images: 1 } });
    const big = toolResultForScript({ content: [{ type: "text", text: "x".repeat(50) }] }, 20);
    expect(big.ok).toBe(false);
  });
});
