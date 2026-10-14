import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecApprovalsResolved } from "../infra/exec-approvals.js";
import { sanitizeBinaryOutput } from "./shell-utils.js";

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return {
    ...mod,
    getShellPathFromLoginShell: vi.fn(() => "/custom/bin:/opt/bin"),
    resolveShellEnvFallbackTimeoutMs: vi.fn(() => 1234),
  };
});

vi.mock("../infra/exec-approvals.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/exec-approvals.js")>();
  const approvals: ExecApprovalsResolved = {
    path: "/tmp/exec-approvals.json",
    socketPath: "/tmp/exec-approvals.sock",
    token: "token",
    defaults: {
      security: "full",
      ask: "off",
      askFallback: "full",
      autoAllowSkills: false,
    },
    agent: {
      security: "full",
      ask: "off",
      askFallback: "full",
      autoAllowSkills: false,
    },
    allowlist: [],
    file: {
      version: 1,
      socket: { path: "/tmp/exec-approvals.sock", token: "token" },
      defaults: {
        security: "full",
        ask: "off",
        askFallback: "full",
        autoAllowSkills: false,
      },
      agents: {},
    },
  };
  return { ...mod, resolveExecApprovals: () => approvals };
});

const normalizeText = (value?: string) =>
  sanitizeBinaryOutput(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

const normalizePathEntries = (value?: string) =>
  normalizeText(value)
    .split(/[:\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const isWin = process.platform === "win32";

describe("exec tool: session identity in the child environment", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("exports KOLO_SESSION_KEY and KOLO_AGENT_ID for the session the tool serves", async () => {
    if (isWin) {
      return;
    }
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({
      host: "gateway",
      security: "full",
      ask: "off",
      sessionKey: "agent:iris:owner",
    });
    const result = await tool.execute("call1", {
      command: 'echo "$KOLO_SESSION_KEY|$KOLO_AGENT_ID"',
    });
    const text = sanitizeBinaryOutput(result.content.find((c) => c.type === "text")?.text ?? "");
    expect(text.trim()).toBe("agent:iris:owner|iris");
  });

  it("leaves the variables unset when the tool has no session", async () => {
    if (isWin) {
      return;
    }
    const { createExecTool } = await import("./bash-tools.exec.js");
    const tool = createExecTool({ host: "gateway", security: "full", ask: "off" });
    const result = await tool.execute("call1", {
      command: 'echo "[${KOLO_SESSION_KEY:-none}|${KOLO_AGENT_ID:-none}]"',
    });
    const text = sanitizeBinaryOutput(result.content.find((c) => c.type === "text")?.text ?? "");
    expect(text.trim()).toBe("[none|none]");
  });
});
