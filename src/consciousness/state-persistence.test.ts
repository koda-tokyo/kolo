/**
 * Tests for state persistence — save/load/merge of consciousness state.
 *
 * Covers:
 * - saveConsciousnessState writes correct JSON structure
 * - loadConsciousnessState reads back and validates
 * - Corrupt file handling
 * - Agent ID mismatch detection
 * - mergeRestoredState correctly combines fresh + restored
 * - Missing file returns null
 */

import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ConsciousnessState } from "./types.js";
import {
  saveConsciousnessState,
  loadConsciousnessState,
  mergeRestoredState,
} from "./state-persistence.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(
    os.tmpdir(),
    `kolo-state-persist-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeFreshState(overrides?: Partial<ConsciousnessState>): ConsciousnessState {
  return {
    running: true,
    totalTicks: 0,
    totalActions: 0,
    consecutiveErrors: 0,
    sleepMode: false,
    sleepEnteredAt: undefined,
    circuitBroken: false,
    circuitBrokenAt: null,
    circuitBreakerRetries: 0,
    startedAt: new Date().toISOString(),
    config: {} as any,
    lastTick: undefined,
    ...overrides,
  };
}

// ── Save ─────────────────────────────────────────────────────────────────

describe("saveConsciousnessState", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = makeTempDir();
  });

  afterEach(() => {
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("writes consciousness-state.json to workspace dir", async () => {
    const state = makeFreshState();
    await saveConsciousnessState("test-agent", state, workspaceDir);

    const filePath = join(workspaceDir, "consciousness-state.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("writes correct JSON structure with expected fields", async () => {
    const state = makeFreshState({
      totalTicks: 42,
      totalActions: 10,
      consecutiveErrors: 3,
      sleepMode: true,
      sleepEnteredAt: "2026-04-05T12:00:00Z",
      circuitBroken: true,
      circuitBrokenAt: "2026-04-05T11:50:00Z",
      circuitBreakerRetries: 2,
    });

    await saveConsciousnessState("test-agent", state, workspaceDir);

    const filePath = join(workspaceDir, "consciousness-state.json");
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed.agentId).toBe("test-agent");
    expect(parsed.savedAt).toBeDefined();
    expect(parsed.totalTicks).toBe(42);
    expect(parsed.totalActions).toBe(10);
    expect(parsed.consecutiveErrors).toBe(3);
    expect(parsed.sleepMode).toBe(true);
    expect(parsed.sleepEnteredAt).toBe("2026-04-05T12:00:00Z");
    expect(parsed.circuitBroken).toBe(true);
    expect(parsed.circuitBrokenAt).toBe("2026-04-05T11:50:00Z");
    expect(parsed.circuitBreakerRetries).toBe(2);
  });

  it("does not include runtime-only fields (running, config, startedAt)", async () => {
    const state = makeFreshState();
    await saveConsciousnessState("test-agent", state, workspaceDir);

    const filePath = join(workspaceDir, "consciousness-state.json");
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    expect(parsed).not.toHaveProperty("running");
    expect(parsed).not.toHaveProperty("config");
    expect(parsed).not.toHaveProperty("startedAt");
    expect(parsed).not.toHaveProperty("lastTick");
  });
});

// ── Load ─────────────────────────────────────────────────────────────────

describe("loadConsciousnessState", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = makeTempDir();
  });

  afterEach(() => {
    if (existsSync(workspaceDir)) {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  it("returns null when no state file exists", async () => {
    const result = await loadConsciousnessState("test-agent", workspaceDir);
    expect(result).toBeNull();
  });

  it("loads previously saved state", async () => {
    const state = makeFreshState({
      totalTicks: 42,
      totalActions: 10,
      consecutiveErrors: 3,
      sleepMode: true,
      circuitBroken: false,
    });
    await saveConsciousnessState("test-agent", state, workspaceDir);

    const result = await loadConsciousnessState("test-agent", workspaceDir);

    expect(result).not.toBeNull();
    expect(result!.totalTicks).toBe(42);
    expect(result!.totalActions).toBe(10);
    expect(result!.consecutiveErrors).toBe(3);
    expect(result!.sleepMode).toBe(true);
    expect(result!.circuitBroken).toBe(false);
  });

  it("returns null for corrupt JSON file", async () => {
    const filePath = join(workspaceDir, "consciousness-state.json");
    writeFileSync(filePath, "this is not json", "utf-8");

    const result = await loadConsciousnessState("test-agent", workspaceDir);
    expect(result).toBeNull();
  });

  it("returns null when agent ID doesn't match", async () => {
    const state = makeFreshState();
    await saveConsciousnessState("other-agent", state, workspaceDir);

    const result = await loadConsciousnessState("test-agent", workspaceDir);
    expect(result).toBeNull();
  });

  it("provides safe defaults for missing fields", async () => {
    // Write a minimal state file with only agentId
    const filePath = join(workspaceDir, "consciousness-state.json");
    writeFileSync(filePath, JSON.stringify({ agentId: "test-agent" }), "utf-8");

    const result = await loadConsciousnessState("test-agent", workspaceDir);

    expect(result).not.toBeNull();
    expect(result!.totalTicks).toBe(0);
    expect(result!.totalActions).toBe(0);
    expect(result!.consecutiveErrors).toBe(0);
    expect(result!.sleepMode).toBe(false);
    expect(result!.circuitBroken).toBe(false);
    expect(result!.circuitBreakerRetries).toBe(0);
  });

  it("validates types — ignores wrong types and uses defaults", async () => {
    const filePath = join(workspaceDir, "consciousness-state.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        agentId: "test-agent",
        totalTicks: "not a number",
        sleepMode: "yes",
        circuitBroken: "maybe",
      }),
      "utf-8",
    );

    const result = await loadConsciousnessState("test-agent", workspaceDir);

    expect(result).not.toBeNull();
    expect(result!.totalTicks).toBe(0); // default, not string
    expect(result!.sleepMode).toBe(false); // default, not string
    expect(result!.circuitBroken).toBe(false); // default, not string
  });
});

// ── Merge ────────────────────────────────────────────────────────────────

describe("mergeRestoredState", () => {
  it("restores counters from saved state", () => {
    const fresh = makeFreshState();
    const restored: Partial<ConsciousnessState> = {
      totalTicks: 100,
      totalActions: 50,
      consecutiveErrors: 2,
    };

    const merged = mergeRestoredState(fresh, restored);

    expect(merged.totalTicks).toBe(100);
    expect(merged.totalActions).toBe(50);
    expect(merged.consecutiveErrors).toBe(2);
  });

  it("restores sleep mode state", () => {
    const fresh = makeFreshState();
    const restored: Partial<ConsciousnessState> = {
      sleepMode: true,
      sleepEnteredAt: "2026-04-05T12:00:00Z",
    };

    const merged = mergeRestoredState(fresh, restored);

    expect(merged.sleepMode).toBe(true);
    expect(merged.sleepEnteredAt).toBe("2026-04-05T12:00:00Z");
  });

  it("restores circuit breaker state", () => {
    const fresh = makeFreshState();
    const restored: Partial<ConsciousnessState> = {
      circuitBroken: true,
      circuitBrokenAt: "2026-04-05T11:50:00Z",
      circuitBreakerRetries: 3,
    };

    const merged = mergeRestoredState(fresh, restored);

    expect(merged.circuitBroken).toBe(true);
    expect(merged.circuitBrokenAt).toBe("2026-04-05T11:50:00Z");
    expect(merged.circuitBreakerRetries).toBe(3);
  });

  it("preserves fresh runtime fields (running, config, startedAt)", () => {
    const fresh = makeFreshState({
      running: true,
      startedAt: "2026-04-12T00:00:00Z",
    });
    const restored: Partial<ConsciousnessState> = {
      totalTicks: 50,
    };

    const merged = mergeRestoredState(fresh, restored);

    expect(merged.running).toBe(true);
    expect(merged.startedAt).toBe("2026-04-12T00:00:00Z");
    expect(merged.totalTicks).toBe(50);
  });

  it("uses fresh defaults when restored is null/undefined", () => {
    const fresh = makeFreshState();
    const restored: Partial<ConsciousnessState> = {};

    const merged = mergeRestoredState(fresh, restored);

    expect(merged.totalTicks).toBe(0);
    expect(merged.sleepMode).toBe(false);
    expect(merged.circuitBroken).toBe(false);
  });
});
