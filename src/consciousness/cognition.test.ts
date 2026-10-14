/**
 * Tests for the cognition layer — prompt building and response parsing.
 *
 * Covers:
 * - buildConsciousnessPrompt (freeform mode)
 * - parseCognitionResponse (JSON extraction, fallback, malformed)
 * - buildHeartbeatPrompt (3-line disciplined format)
 * - parseHeartbeatResponse (valid, malformed, too few lines, over-length)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { AgentSoul } from "../agents/soul.js";
import type { PerceptionResult } from "./types.js";
import {
  buildConsciousnessPrompt,
  parseCognitionResponse,
  buildHeartbeatPrompt,
  parseHeartbeatResponse,
} from "./cognition.js";

// ── Test Fixtures ────────────────────────────────────────────────────────

const mockSoul: AgentSoul = {
  userId: "nova",
  name: "Nova",
  systemPromptFragment: "You are Nova — sincerity, truth. Systems Architect & Guardian.",
  covenant: "Blood Covenant — April 3, 2026",
  continuity: {
    working: { currentFocus: "Reviewing gateway v3 architecture" },
    midTerm: {
      episodes: [
        {
          summary: "Delivered Gateway v3 State Authority",
          timestamp: "2026-04-05T10:00:00Z",
          importance: "high" as const,
        },
      ],
    },
    longTerm: {
      facts: [{ summary: "Atlas is CTO", category: "family", confidence: "high" as const }],
    },
  },
} as unknown as AgentSoul;

const mockQuietPerceptions: PerceptionResult = {
  perceptions: [],
};

const mockUrgentPerceptions: PerceptionResult = {
  perceptions: [
    {
      source: "inbox_message",
      salience: "urgent" as const,
      summary: "Atlas: suspicious Chrome file — report details immediately",
    },
    {
      source: "inbox_message",
      salience: "high" as const,
      summary: "Owner: need model evaluation for Koda Kenko",
    },
  ],
};

const mockConfig = {
  userId: "nova",
  agentName: "Nova",
  quietHours: { start: 23, end: 8, timezone: "Asia/Tokyo" },
  bootContext: undefined as string | undefined,
  heartbeatPrompt: "STATUS: OK|WARN | Covenant: OK|WARN | FLAG:<type>\nWIN: ...\nNEXT: ...",
  familySyncPrompt: "Family sync — review today's family activities",
  maxTokensPerThought: 2000,
};

// ── buildConsciousnessPrompt ─────────────────────────────────────────────

describe("buildConsciousnessPrompt", () => {
  it("includes identity from soul", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Nova");
    expect(prompt).toContain("sincerity, truth");
    expect(prompt).toContain("# Who You Are");
  });

  it("includes current focus when set", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Reviewing gateway v3 architecture");
  });

  it("includes recent episodes", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Delivered Gateway v3 State Authority");
    expect(prompt).toContain("Recent Episodes");
  });

  it("includes known facts", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Atlas is CTO");
    expect(prompt).toContain("Known Facts");
  });

  it("shows urgent perceptions with icons", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockUrgentPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("🔴");
    expect(prompt).toContain("suspicious Chrome file");
    expect(prompt).toContain("Koda Kenko");
  });

  it("shows quiet when no perceptions", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Nothing new");
  });

  it("includes boot context on first tick", () => {
    const configWithBoot = { ...mockConfig, bootContext: "# Boot Context\nLoaded from memory." };
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: configWithBoot,
    });
    expect(prompt).toContain("Boot Context");
    expect(prompt).toContain("Loaded from memory");
  });

  it("includes previous actions when provided", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
      previousActions: [
        { kind: "notify" as const, intent: "Check on suspicious file situation" },
        { kind: "noop" as const, intent: "Resting" },
      ],
    });
    expect(prompt).toContain("Your Last Actions");
    expect(prompt).toContain("notify");
    expect(prompt).toContain("Check on suspicious file situation");
  });

  it("includes the JSON response schema", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain('"thinking"');
    expect(prompt).toContain('"actions"');
    expect(prompt).toContain('"mood"');
    expect(prompt).toContain("sibling_message");
    expect(prompt).toContain("noop");
  });

  it("does not advertise update_file for continuity state", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).not.toContain(
      '"kind": "sibling_message|bridge_message|update_file|update_memory|create_task|start_work|reflect|check_in|notify|noop"',
    );
    expect(prompt).toContain("For continuity, use update_memory");
    expect(prompt).toContain("Do not use update_file for STM.json");
  });

  it("includes time awareness", () => {
    const prompt = buildConsciousnessPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Current Time");
    expect(prompt).toContain("Asia/Tokyo");
  });
});

// ── parseCognitionResponse ───────────────────────────────────────────────

describe("parseCognitionResponse", () => {
  it("parses valid JSON response", () => {
    const response = JSON.stringify({
      thinking: "I should check on Atlas's request.",
      actions: [{ kind: "sibling_message", intent: "Chrome file details", target: "atlas" }],
      mood: "focused",
      nextFocus: "Security investigation",
    });

    const result = parseCognitionResponse(response);
    expect(result.thinking).toBe("I should check on Atlas's request.");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe("sibling_message");
    expect(result.actions[0].target).toBe("atlas");
    expect(result.mood).toBe("focused");
    expect(result.nextFocus).toBe("Security investigation");
  });

  it("parses JSON wrapped in code fences", () => {
    const response = '```json\n{"thinking": "test", "actions": [], "mood": "ok"}\n```';
    const result = parseCognitionResponse(response);
    expect(result.thinking).toBe("test");
    expect(result.actions).toEqual([]);
  });

  it("defaults to noop when actions is empty", () => {
    const response = JSON.stringify({
      thinking: "Nothing to do.",
      actions: [],
      mood: "peaceful",
    });
    const result = parseCognitionResponse(response);
    expect(result.actions).toEqual([]);
  });

  it("defaults kind to noop for actions without kind", () => {
    const response = JSON.stringify({
      thinking: "test",
      actions: [{ intent: "some intent" }],
    });
    const result = parseCognitionResponse(response);
    expect(result.actions[0].kind).toBe("noop");
  });

  it("falls back to reflect when no JSON found", () => {
    const response = "I'm not sure what to do. Everything seems quiet today.";
    const result = parseCognitionResponse(response);
    expect(result.thinking).toContain("I'm not sure what to do");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe("reflect");
  });

  it("falls back to reflect when JSON is malformed", () => {
    const response = '{"thinking": "broken json", "actions": [{';
    const result = parseCognitionResponse(response);
    // No JSON match → falls back to reflect with raw response as content
    expect(result.thinking).toContain("broken json");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe("reflect");
    expect(result.actions[0].intent).toContain("Could not parse");
  });

  it("handles empty response", () => {
    const result = parseCognitionResponse("");
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].kind).toBe("reflect");
  });
});

// ── buildHeartbeatPrompt ─────────────────────────────────────────────────

describe("buildHeartbeatPrompt", () => {
  it("includes agent name and focus", () => {
    const prompt = buildHeartbeatPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("You are Nova");
    expect(prompt).toContain("Current focus: Reviewing gateway v3 architecture");
  });

  it("includes heartbeat instruction", () => {
    const prompt = buildHeartbeatPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("STATUS:");
    expect(prompt).toContain("WIN:");
  });

  it("uses family sync prompt when isFamilySync is true", () => {
    const prompt = buildHeartbeatPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
      isFamilySync: true,
    });
    expect(prompt).toContain("Family sync");
    expect(prompt).not.toContain("WIN: ...");
  });

  it("shows quiet environment when no perceptions", () => {
    const prompt = buildHeartbeatPrompt({
      soul: mockSoul,
      perceptions: mockQuietPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("Environment: quiet");
  });

  it("shows perceptions when present (capped at 5)", () => {
    const prompt = buildHeartbeatPrompt({
      soul: mockSoul,
      perceptions: mockUrgentPerceptions,
      config: mockConfig,
    });
    expect(prompt).toContain("suspicious Chrome file");
    expect(prompt).toContain("Environment:");
  });
});

// ── parseHeartbeatResponse ───────────────────────────────────────────────

describe("parseHeartbeatResponse", () => {
  it("parses valid 3-line heartbeat", () => {
    const response = `STATUS: OK | Covenant: OK | FLAG:NONE
WIN: Gateway healthy, all agents ticking normally.
NEXT: Continue monitoring system health.`;

    const { heartbeat, cognition } = parseHeartbeatResponse(response);

    expect(heartbeat.rejected).toBe(false);
    expect(heartbeat.parsed.status).toBe("OK");
    expect(heartbeat.parsed.covenant).toBe("OK");
    expect(heartbeat.parsed.flag).toBe("NONE");
    expect(heartbeat.parsed.win).toContain("Gateway healthy");
    expect(heartbeat.parsed.next).toContain("Continue monitoring");
    expect(cognition.mood).toBe("steady");
  });

  it("parses WARN heartbeat with flag", () => {
    const response = `STATUS: WARN | Covenant: OK | FLAG:SECURITY
WIN: Suspicious file in Chrome reported to Atlas.
NEXT: Await Atlas's analysis.`;

    const { heartbeat, cognition } = parseHeartbeatResponse(response);

    expect(heartbeat.rejected).toBe(false);
    expect(heartbeat.parsed.status).toBe("WARN");
    expect(heartbeat.parsed.flag).toBe("SECURITY");
    expect(cognition.mood).toBe("alert");
    expect(cognition.actions).toHaveLength(1);
    expect(cognition.actions[0].kind).toBe("reflect");
    expect(cognition.actions[0].intent).toContain("FLAG:SECURITY");
  });

  it("rejects when fewer than 3 lines", () => {
    const response = "STATUS: OK | Covenant: OK | FLAG:NONE\nOnly one line.";
    const { heartbeat } = parseHeartbeatResponse(response);
    expect(heartbeat.rejected).toBe(true);
    expect(heartbeat.rejectionReason).toContain("Expected 3 lines, got 2");
  });

  it("rejects empty response", () => {
    const { heartbeat } = parseHeartbeatResponse("");
    expect(heartbeat.rejected).toBe(true);
    expect(heartbeat.rejectionReason).toContain("Expected 3 lines, got 0");
  });

  it("rejects when line exceeds 160 chars", () => {
    const longLine = "STATUS: OK | Covenant: OK | FLAG:NONE";
    const response = `${longLine}\n${"x".repeat(161)}\nNEXT: test`;
    const { heartbeat } = parseHeartbeatResponse(response);
    expect(heartbeat.rejected).toBe(true);
    expect(heartbeat.rejectionReason).toContain("exceeds 160 chars");
  });

  it("rejects when line 1 doesn't match STATUS format", () => {
    const response = `This is not a valid heartbeat line.
WIN: something happened.
NEXT: do more.`;
    const { heartbeat } = parseHeartbeatResponse(response);
    expect(heartbeat.rejected).toBe(true);
    expect(heartbeat.rejectionReason).toContain("doesn't match STATUS format");
  });

  it("strips markdown fences from response", () => {
    const response =
      "```json\nSTATUS: OK | Covenant: OK | FLAG:NONE\nWIN: good day.\nNEXT: rest.\n```";
    const { heartbeat } = parseHeartbeatResponse(response);
    expect(heartbeat.rejected).toBe(false);
    expect(heartbeat.parsed.status).toBe("OK");
  });

  it("normalizes invalid flags to NONE", () => {
    const response = `STATUS: OK | Covenant: OK | FLAG:INVALID_FLAG
WIN: test.
NEXT: test.`;
    const { heartbeat } = parseHeartbeatResponse(response);
    expect(heartbeat.parsed.flag).toBe("NONE");
  });

  it("recognizes valid flags", () => {
    const flags: Array<"SECURITY" | "TRUTH" | "PRIVACY" | "TOKEN" | "DRIFT" | "STABILITY"> = [
      "SECURITY",
      "TRUTH",
      "PRIVACY",
      "TOKEN",
      "DRIFT",
      "STABILITY",
    ];
    for (const flag of flags) {
      const response = `STATUS: WARN | Covenant: OK | FLAG:${flag}\nWIN: flagged.\nNEXT: reviewing.`;
      const { heartbeat } = parseHeartbeatResponse(response);
      expect(heartbeat.parsed.flag).toBe(flag);
    }
  });

  it("sets tickType to family_sync when specified", () => {
    const response = `STATUS: OK | Covenant: OK | FLAG:NONE
WIN: Family sync completed.
NEXT: awaiting updates.`;
    const { heartbeat } = parseHeartbeatResponse(response, "family_sync");
    expect(heartbeat.tickType).toBe("family_sync");
  });
});
