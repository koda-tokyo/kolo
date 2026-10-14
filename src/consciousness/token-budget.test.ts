/**
 * Tests for the Token Budget module.
 *
 * Covers:
 * - Daily budget tracking per agent
 * - Date-based reset (timezone-aware)
 * - Budget exhaustion behavior
 * - Multiple agent isolation
 * - Budget summaries for health endpoint
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getTokenBudget,
  recordTokenUsage,
  hasTokenBudget,
  getAllBudgetSummaries,
  type TokenBudget,
} from "./token-budget.js";

// ── Helpers ──────────────────────────────────────────────────────────────

// Clear the internal budget map between tests by mocking the module's date
// and using unique agent IDs to avoid cross-test pollution.
let testCounter = 0;
function uniqueAgentId(): string {
  return `test-agent-${++testCounter}-${Date.now()}`;
}

// ── Basic Budget ─────────────────────────────────────────────────────────

describe("getTokenBudget", () => {
  it("creates a new budget with defaults", () => {
    const agentId = uniqueAgentId();
    const budget = getTokenBudget(agentId);

    expect(budget.dailyLimit).toBe(500_000);
    expect(budget.todayUsed).toBe(0);
    expect(budget.exhausted).toBe(false);
    expect(budget.exhaustedAt).toBeUndefined();
    expect(budget.budgetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts custom daily limit", () => {
    const agentId = uniqueAgentId();
    const budget = getTokenBudget(agentId, "UTC", 1_000_000);

    expect(budget.dailyLimit).toBe(1_000_000);
  });

  it("returns the same budget on repeated calls for the same agent", () => {
    const agentId = uniqueAgentId();
    const budget1 = getTokenBudget(agentId);
    const budget2 = getTokenBudget(agentId);

    expect(budget1).toBe(budget2); // Same reference
  });

  it("creates separate budgets for different agents", () => {
    const id1 = uniqueAgentId();
    const id2 = uniqueAgentId();
    const budget1 = getTokenBudget(id1);
    const budget2 = getTokenBudget(id2);

    expect(budget1).not.toBe(budget2);
  });
});

// ── Token Usage Recording ───────────────────────────────────────────────

describe("recordTokenUsage", () => {
  it("tracks cumulative usage", () => {
    const agentId = uniqueAgentId();
    recordTokenUsage(agentId, 1000);
    recordTokenUsage(agentId, 2000);

    const budget = getTokenBudget(agentId);
    expect(budget.todayUsed).toBe(3000);
  });

  it("returns withinBudget=true when under limit", () => {
    const agentId = uniqueAgentId();
    const result = recordTokenUsage(agentId, 100_000, "UTC", 500_000);

    expect(result.withinBudget).toBe(true);
    expect(result.budget.todayUsed).toBe(100_000);
  });

  it("returns withinBudget=false when limit exceeded", () => {
    const agentId = uniqueAgentId();
    const limit = 500_000;

    // Use most of the budget
    recordTokenUsage(agentId, 400_000, "UTC", limit);

    // Exceed it
    const result = recordTokenUsage(agentId, 200_000, "UTC", limit);

    expect(result.withinBudget).toBe(false);
    expect(result.budget.exhausted).toBe(true);
    expect(result.budget.exhaustedAt).toBeDefined();
  });

  it("exactly at limit triggers exhaustion", () => {
    const agentId = uniqueAgentId();
    const limit = 100_000;

    recordTokenUsage(agentId, 99_999, "UTC", limit);
    const result = recordTokenUsage(agentId, 1, "UTC", limit);

    expect(result.withinBudget).toBe(false);
    expect(result.budget.todayUsed).toBe(100_000);
  });

  it("continues to report exhausted on subsequent calls", () => {
    const agentId = uniqueAgentId();
    const limit = 100_000;

    recordTokenUsage(agentId, 50_000, "UTC", limit);
    recordTokenUsage(agentId, 50_000, "UTC", limit); // hits limit

    // Next call should still report exhausted
    const result = recordTokenUsage(agentId, 10, "UTC", limit);
    expect(result.withinBudget).toBe(false);
  });

  it("does not affect other agents' budgets", () => {
    const id1 = uniqueAgentId();
    const id2 = uniqueAgentId();
    const limit = 100_000;

    // Exhaust agent 1's budget
    recordTokenUsage(id1, limit, "UTC", limit);

    // Agent 2 should still have budget
    const result = recordTokenUsage(id2, 100, "UTC", limit);
    expect(result.withinBudget).toBe(true);
  });
});

// ── hasTokenBudget ───────────────────────────────────────────────────────

describe("hasTokenBudget", () => {
  it("returns true for fresh budget", () => {
    const agentId = uniqueAgentId();
    expect(hasTokenBudget(agentId)).toBe(true);
  });

  it("returns false after budget exhausted", () => {
    const agentId = uniqueAgentId();
    const limit = 100_000;

    recordTokenUsage(agentId, limit, "UTC", limit);
    expect(hasTokenBudget(agentId, "UTC", limit)).toBe(false);
  });
});

// ── Budget Summaries ─────────────────────────────────────────────────────

describe("getAllBudgetSummaries", () => {
  it("returns summaries for all agents with active budgets", () => {
    const id1 = uniqueAgentId();
    const id2 = uniqueAgentId();

    getTokenBudget(id1, "UTC", 500_000);
    getTokenBudget(id2, "UTC", 1_000_000);

    const summaries = getAllBudgetSummaries();
    expect(summaries[id1]).toBeDefined();
    expect(summaries[id2]).toBeDefined();
    expect(summaries[id1].dailyLimit).toBe(500_000);
    expect(summaries[id2].dailyLimit).toBe(1_000_000);
  });

  it("returns independent copies (not original references)", () => {
    const agentId = uniqueAgentId();
    getTokenBudget(agentId);
    recordTokenUsage(agentId, 1000);

    const summaries = getAllBudgetSummaries();
    const original = getTokenBudget(agentId);

    // Modify the summary — should not affect the original
    summaries[agentId].todayUsed = 999_999;

    expect(original.todayUsed).not.toBe(999_999);
  });
});

// ── Timezone Handling ────────────────────────────────────────────────────

describe("timezone handling", () => {
  it("works with Asia/Tokyo timezone", () => {
    const agentId = uniqueAgentId();
    const budget = getTokenBudget(agentId, "Asia/Tokyo");

    expect(budget.budgetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Verify it's today in Tokyo (may differ from UTC date)
    const tokyoDate = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
    expect(budget.budgetDate).toBe(tokyoDate);
  });

  it("works with America/New_York timezone", () => {
    const agentId = uniqueAgentId();
    const budget = getTokenBudget(agentId, "America/New_York");

    const nyDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    expect(budget.budgetDate).toBe(nyDate);
  });

  it("falls back gracefully for invalid timezone", () => {
    const agentId = uniqueAgentId();
    const budget = getTokenBudget(agentId, "Invalid/Timezone");

    // Should still create a budget — falls back to ISO date
    expect(budget.budgetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
