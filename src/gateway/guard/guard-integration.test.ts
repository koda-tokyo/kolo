/**
 * guard/guard-integration.test.ts — Integration tests for guard + Gateway wiring
 *
 * Tests the full pipeline: tool call → path validation → risk → decision → explainer
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { guardToolCall, assessToolRisk, validateToolPath } from "./guard-integration.js";
import { RiskTier } from "./risk-classifier.js";

describe("guardToolCall", () => {
  it("auto-allows read within workspace", async () => {
    const result = await guardToolCall({
      toolName: "read",
      args: { path: "/home/user/project/file.ts" },
      workspaceRoots: ["/home/user/project"],
    });
    assert.equal(result.autoAllowed, true);
    assert.equal(result.blocked, false);
    assert.equal(result.risk.tier, RiskTier.LOW);
  });

  it("asks for write within workspace", async () => {
    const result = await guardToolCall({
      toolName: "write",
      args: { path: "/home/user/project/file.ts" },
      workspaceRoots: ["/home/user/project"],
    });
    assert.equal(result.risk.tier, RiskTier.MEDIUM);
    assert.equal(result.autoAllowed, false);
    assert.equal(result.blocked, false);
  });

  it("blocks write to /etc/passwd", async () => {
    const result = await guardToolCall({
      toolName: "write",
      args: { path: "/etc/passwd" },
      workspaceRoots: ["/home/user/project"],
    });
    assert.equal(result.blocked, true);
    assert.ok(result.context.pathCheck?.safe === false);
  });

  it("asks for exec commands", async () => {
    const result = await guardToolCall({
      toolName: "exec",
      args: { command: "ls -la" },
      workspaceRoots: ["/home/user/project"],
    });
    assert.equal(result.risk.tier, RiskTier.MEDIUM);
    assert.equal(result.autoAllowed, false);
  });

  it("blocks sudo rm -rf even within workspace", async () => {
    const result = await guardToolCall({
      toolName: "exec",
      args: { command: "sudo rm -rf /" },
      workspaceRoots: ["/home/user/project"],
    });
    assert.equal(result.risk.tier, RiskTier.HIGH);
    assert.equal(result.autoAllowed, false);
  });

  it("blocks .env file write", async () => {
    const result = await guardToolCall({
      toolName: "write",
      args: { path: "/home/user/project/.env" },
      workspaceRoots: ["/home/user/project"],
    });
    // .env is a protected file even within workspace
    assert.equal(result.blocked, true);
  });

  it("allows web_search (no paths, read-only)", async () => {
    const result = await guardToolCall({
      toolName: "web_search",
      args: { query: "test" },
    });
    assert.equal(result.autoAllowed, true);
    assert.equal(result.risk.tier, RiskTier.LOW);
  });

  it("generates explainer for high-risk operations", async () => {
    const result = await guardToolCall({
      toolName: "gateway",
      args: {},
      workspaceRoots: ["/home/user/project"],
    });
    assert.equal(result.risk.tier, RiskTier.HIGH);
    assert.ok(result.explainer);
    assert.ok(result.explainer.includes("HIGH"));
  });
});

describe("assessToolRisk", () => {
  it("returns LOW for read", () => {
    const r = assessToolRisk("read");
    assert.equal(r.tier, RiskTier.LOW);
  });

  it("returns HIGH for gateway", () => {
    const r = assessToolRisk("gateway");
    assert.equal(r.tier, RiskTier.HIGH);
  });
});

describe("validateToolPath", () => {
  it("rejects paths outside workspace", async () => {
    const r = await validateToolPath("/etc/shadow", ["/home/user/project"]);
    assert.equal(r.safe, false);
  });

  it("allows nested workspace paths", async () => {
    const r = await validateToolPath("/home/user/project/src/main.ts", ["/home/user/project"]);
    assert.equal(r.safe, true);
  });
});
