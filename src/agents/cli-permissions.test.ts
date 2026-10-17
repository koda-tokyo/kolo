import { afterEach, describe, expect, it } from "vitest";
import type { CliBackendConfig } from "../config/types.js";
import { onAuditEvent, type AuditEvent } from "../security/audit-log.js";
import { resolveCliBackendConfig } from "./cli-backends.js";
import { auditCliPermissionPlan, planCliPermissions } from "./cli-permissions.js";

const claude = () => resolveCliBackendConfig("claude-cli")!.config;
const codex = () => resolveCliBackendConfig("codex-cli")!.config;

let off: (() => void) | undefined;
afterEach(() => off?.());

describe("default CLI backends", () => {
  it("contain no permission bypass", () => {
    const all = [
      ...(claude().args ?? []),
      ...(claude().resumeArgs ?? []),
      ...(codex().args ?? []),
      ...(codex().resumeArgs ?? []),
    ];
    expect(all).not.toContain("--dangerously-skip-permissions");
    expect(all).not.toContain("danger-full-access");
    expect(all).not.toContain("--sandbox");
  });
});

describe("planCliPermissions: claude-cli", () => {
  it("tools=none disables every built-in tool before execution", () => {
    const plan = planCliPermissions({
      backendId: "claude-cli",
      backend: claude(),
      capability: "none",
      baseArgs: claude().args!,
    });
    expect(plan.extraArgs).toEqual([
      "--restricted",
      "--strict-mcp-config",
      "--tools",
      "",
      "--permission-mode",
      "dontAsk",
    ]);
    expect(plan.unsafe).toBe(false);
  });

  it("native denies anything not pre-approved, and passes allowed and disallowed lists", () => {
    const backend: CliBackendConfig = {
      ...claude(),
      allowedTools: ["Read", " Edit "],
      disallowedTools: ["Bash"],
    };
    const plan = planCliPermissions({
      backendId: "claude-cli",
      backend,
      capability: "native",
      baseArgs: backend.args!,
    });
    expect(plan.extraArgs).toEqual([
      "--restricted",
      "--tools",
      "Read,Edit",
      "--allowedTools",
      "Read,Edit",
      "--disallowedTools",
      "Bash",
      "--permission-mode",
      "dontAsk",
    ]);
  });

  it("strips bypass flags from configured args without the opt-in and audits it", () => {
    const events: AuditEvent[] = [];
    off = onAuditEvent((e) => events.push(e));
    const baseArgs = [
      "-p",
      "--dangerously-skip-permissions",
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "json",
    ];
    const plan = planCliPermissions({
      backendId: "claude-cli",
      backend: claude(),
      capability: "native",
      baseArgs,
    });
    expect(plan.baseArgs).toEqual(["-p", "--output-format", "json"]);
    expect(plan.stripped).toEqual([
      "--dangerously-skip-permissions",
      "--permission-mode bypassPermissions",
    ]);
    auditCliPermissionPlan(plan, { backendId: "claude-cli", agentId: "a1" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "cli.permissions",
      outcome: "denied",
      identity: "a1",
    });
  });

  it("bypasses only with unsafeSkipPermissions, and audits every such run", () => {
    const events: AuditEvent[] = [];
    off = onAuditEvent((e) => events.push(e));
    const backend: CliBackendConfig = { ...claude(), unsafeSkipPermissions: true };
    const plan = planCliPermissions({
      backendId: "claude-cli",
      backend,
      capability: "native",
      baseArgs: backend.args!,
    });
    expect(plan.extraArgs).toContain("--dangerously-skip-permissions");
    auditCliPermissionPlan(plan, { backendId: "claude-cli" });
    expect(events[0]).toMatchObject({ action: "cli.permissions", outcome: "allowed" });
    expect(events[0]?.detail).toMatchObject({ mode: "unsafeSkipPermissions" });
  });
});

describe("planCliPermissions: claude-cli ordering and defaults", () => {
  it("native without allowedTools exposes only read-only built-in tools", () => {
    const plan = planCliPermissions({
      backendId: "claude-cli",
      backend: claude(),
      capability: "native",
      baseArgs: claude().args!,
    });
    expect(plan.extraArgs).toEqual([
      "--restricted",
      "--tools",
      "Read,Grep,Glob",
      "--permission-mode",
      "dontAsk",
    ]);
  });

  it("always ends with a single-value option, so a variadic list cannot swallow the prompt", () => {
    for (const capability of ["none", "native"] as const) {
      const backend: CliBackendConfig = {
        ...claude(),
        allowedTools: ["Read"],
        disallowedTools: ["Bash"],
      };
      const plan = planCliPermissions({
        backendId: "claude-cli",
        backend,
        capability,
        baseArgs: backend.args!,
      });
      expect(plan.extraArgs.slice(-2)).toEqual(["--permission-mode", "dontAsk"]);
    }
  });

  it("drops configured --restricted / --strict-mcp-config copies without eating the next arg", () => {
    const baseArgs = ["-p", "--restricted", "--output-format", "json", "--strict-mcp-config"];
    const plan = planCliPermissions({
      backendId: "claude-cli",
      backend: claude(),
      capability: "none",
      baseArgs,
    });
    expect(plan.baseArgs).toEqual(["-p", "--output-format", "json"]);
  });
});

describe("planCliPermissions: codex-cli", () => {
  it("is read-only for tools=none and workspace-write for native", () => {
    expect(
      planCliPermissions({
        backendId: "codex-cli",
        backend: codex(),
        capability: "none",
        baseArgs: codex().args!,
      }).extraArgs,
    ).toEqual(["--sandbox", "read-only"]);
    expect(
      planCliPermissions({
        backendId: "codex-cli",
        backend: codex(),
        capability: "native",
        baseArgs: codex().args!,
      }).extraArgs,
    ).toEqual(["--sandbox", "workspace-write"]);
  });

  it("drops a configured sandbox (the capability decides) and strips full access without the opt-in", () => {
    const baseArgs = [
      "exec",
      "--sandbox",
      "danger-full-access",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
    ];
    const plan = planCliPermissions({
      backendId: "codex-cli",
      backend: codex(),
      capability: "none",
      baseArgs,
    });
    expect(plan.baseArgs).toEqual(["exec", "--json"]);
    expect(plan.extraArgs).toEqual(["--sandbox", "read-only"]);
    expect(plan.stripped).toContain("--sandbox danger-full-access");
  });

  it("uses full access only with the opt-in", () => {
    const backend: CliBackendConfig = { ...codex(), unsafeSkipPermissions: true };
    expect(
      planCliPermissions({
        backendId: "codex-cli",
        backend,
        capability: "native",
        baseArgs: backend.args!,
      }).extraArgs,
    ).toEqual(["--sandbox", "danger-full-access"]);
  });
});

describe("planCliPermissions: custom backends", () => {
  it("adds nothing but still strips known bypass flags", () => {
    const backend: CliBackendConfig = {
      command: "my-cli",
      args: ["run", "--dangerously-skip-permissions"],
    };
    const plan = planCliPermissions({
      backendId: "my-cli",
      backend,
      capability: "none",
      baseArgs: backend.args!,
    });
    expect(plan.baseArgs).toEqual(["run"]);
    expect(plan.extraArgs).toEqual([]);
  });
});
