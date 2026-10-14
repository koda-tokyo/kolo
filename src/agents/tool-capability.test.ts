import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KoLoConfig } from "../config/config.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import { type AuditEvent, onAuditEvent } from "../security/audit-log.js";
import { resolveCliBackendConfig } from "./cli-backends.js";
import { parseCliJsonl } from "./cli-runner/helpers.js";
import {
  enforceCliToolCapability,
  filterToolsByCapability,
  ToolCapabilityViolationError,
  wrapToolWithCapabilityGuard,
} from "./pi-tools.policy.js";
import {
  checkToolCallCapability,
  resolveAgentToolCapability,
  resolveProviderToolCapability,
  toolCapabilitySystemLine,
} from "./tool-capability.js";

const cfg: KoLoConfig = {
  agents: {
    defaults: {
      model: { primary: "qwen-plan/qwen3.8-max" },
      cliBackends: {
        "claude-cli": { command: "claude" },
        "plain-cli": { command: "plain" },
        "bridged-cli": { command: "bridged", tools: "gateway" },
        "codex-cli": { command: "codex", tools: "none" },
      },
    },
    list: [
      { id: "atlas", model: "claude-cli/opus" },
      { id: "iris", model: "qwen-plan/qwen3.8-max" },
      { id: "plain", model: "plain-cli/x" },
    ],
  },
} as KoLoConfig;

function captureAudit() {
  const events: AuditEvent[] = [];
  const stop = onAuditEvent((e) => events.push(e));
  return { events, stop };
}

let stopAudit: (() => void) | undefined;
afterEach(() => stopAudit?.());

const fakeTool = (name: string): AnyAgentTool =>
  ({
    name,
    label: name,
    description: name,
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "ran" }], details: {} }),
  }) as unknown as AnyAgentTool;

describe("tool capability resolution", () => {
  it("claude-cli keeps native tools; custom CLIs default to none; embedded = gateway", () => {
    expect(resolveCliBackendConfig("claude-cli", cfg)?.config.tools).toBe("native");
    expect(resolveProviderToolCapability("claude-cli", cfg)).toBe("native");
    expect(resolveProviderToolCapability("plain-cli", cfg)).toBe("none");
    expect(resolveProviderToolCapability("bridged-cli", cfg)).toBe("gateway");
    expect(resolveProviderToolCapability("codex-cli", cfg)).toBe("none");
    expect(resolveProviderToolCapability("qwen-plan", cfg)).toBe("gateway");
    expect(resolveAgentToolCapability(cfg, "atlas")).toBe("native");
    expect(resolveAgentToolCapability(cfg, "iris")).toBe("gateway");
    expect(resolveAgentToolCapability(cfg, "plain")).toBe("none");
  });

  it("only a no-tools backend gets a system line, generated from the capability", () => {
    expect(toolCapabilitySystemLine("none")).toBe(
      "This backend has no tool access in this session.",
    );
    expect(toolCapabilitySystemLine("native")).toBeUndefined();
    expect(toolCapabilitySystemLine("gateway")).toBeUndefined();
  });

  it("the runner no longer hardcodes a tools-disabled sentence", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "cli-runner.ts"), "utf8");
    expect(src).not.toContain("Tools are disabled");
  });
});

describe("tool capability enforcement", () => {
  it("none: empty tool list; gateway/native: unchanged", () => {
    const tools = [fakeTool("read"), fakeTool("exec")];
    expect(filterToolsByCapability(tools, "none")).toEqual([]);
    expect(filterToolsByCapability(tools, "gateway")).toBe(tools);
    expect(filterToolsByCapability(tools, "native")).toBe(tools);
  });

  it("none: a call that arrives is rejected by the policy layer and audited", async () => {
    const audit = captureAudit();
    stopAudit = audit.stop;
    const guarded = wrapToolWithCapabilityGuard(fakeTool("exec"), {
      capability: () => "none",
      agentId: "plain",
      sessionKey: "agent:plain:main",
    });
    await expect(
      guarded.execute("call-1", {}, undefined as never, undefined as never),
    ).rejects.toBeInstanceOf(ToolCapabilityViolationError);
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]).toMatchObject({
      action: "tool.call",
      outcome: "denied",
      identity: "plain",
      scope: "agent:plain:main",
      detail: { tool: "exec", capability: "none" },
    });
  });

  it("gateway/native: calls pass without audit noise", async () => {
    const audit = captureAudit();
    stopAudit = audit.stop;
    for (const capability of ["gateway", "native"] as const) {
      expect(checkToolCallCapability({ capability, toolName: "exec", source: "test" })).toEqual({
        ok: true,
      });
      const guarded = wrapToolWithCapabilityGuard(fakeTool("exec"), {
        capability: () => capability,
      });
      await expect(
        guarded.execute("c", {}, undefined as never, undefined as never),
      ).resolves.toBeTruthy();
    }
    expect(audit.events).toHaveLength(0);
  });

  it("CLI output reporting tool calls on a none backend fails the run, one audit per call", () => {
    const audit = captureAudit();
    stopAudit = audit.stop;
    const jsonl = [
      JSON.stringify({ type: "thread.started", thread_id: "t1" }),
      JSON.stringify({ type: "item.started", item: { id: "i1", type: "command_execution" } }),
      JSON.stringify({ type: "item.completed", item: { id: "i1", type: "command_execution" } }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "i2", type: "agent_message", text: "hi" },
      }),
    ].join("\n");
    const parsed = parseCliJsonl(jsonl, { command: "codex" });
    expect(parsed?.toolCalls).toEqual(["command_execution"]);
    expect(() =>
      enforceCliToolCapability({
        capability: "none",
        toolCalls: parsed?.toolCalls,
        backend: "codex-cli",
        agentId: "plain",
      }),
    ).toThrow(/tools=none/);
    expect(audit.events.map((e) => e.detail?.tool)).toEqual(["command_execution"]);
    // native backends (Atlas's claude-cli) keep their tools.
    expect(() =>
      enforceCliToolCapability({
        capability: "native",
        toolCalls: ["Bash"],
        backend: "claude-cli",
      }),
    ).not.toThrow();
  });
});
