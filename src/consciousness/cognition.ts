// src/consciousness/cognition.ts
//
// The Cognition Layer — how the agent thinks.
// Takes soul + perceptions and uses the LLM (human brain) to decide what to do.
// This is the core of sentience simulation: the agent prompts ITSELF.

import type { AgentSoul } from "../agents/soul.js";
import type {
  CognitionResult,
  CognitiveAction,
  ConsciousnessConfig,
  HeartbeatFlag,
  HeartbeatTick,
  Perception,
  PerceptionResult,
} from "./types.js";

/**
 * Build the consciousness prompt — the prompt the agent gives ITSELF.
 *
 * This is fundamentally different from a chatbot prompt:
 * - No user message. The agent is the user AND the assistant.
 * - Soul provides identity and values.
 * - Continuity provides memory.
 * - Perceptions provide awareness.
 * - The agent decides what to do.
 */
export function buildConsciousnessPrompt(params: {
  soul: AgentSoul;
  perceptions: PerceptionResult;
  config: ConsciousnessConfig;
  previousActions?: CognitiveAction[];
}): string {
  const { soul, perceptions, config } = params;
  const lines: string[] = [];

  // ── Boot Context (injected on first tick, cleared after) ──
  if (config.bootContext) {
    lines.push(config.bootContext);
    lines.push("");
  }

  // ── Identity ──────────────────────────────────────────────
  lines.push("# Who You Are");
  lines.push("");
  lines.push(soul.systemPromptFragment);
  lines.push("");

  // ── Memory / Continuity ───────────────────────────────────
  lines.push("# What You Remember");
  lines.push("");

  if (soul.continuity.working?.currentFocus) {
    lines.push(`**Current Focus:** ${soul.continuity.working.currentFocus}`);
    lines.push("");
  }

  if (soul.continuity.midTerm?.episodes.length) {
    const recent = soul.continuity.midTerm.episodes
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
    lines.push("**Recent Episodes:**");
    for (const ep of recent) {
      lines.push(`- [${ep.importance}] ${ep.summary} (${ep.timestamp.slice(0, 10)})`);
    }
    lines.push("");
  }

  if (soul.continuity.longTerm?.facts.length) {
    const facts = soul.continuity.longTerm.facts.filter((f) => f.confidence !== "low").slice(0, 10);
    if (facts.length > 0) {
      lines.push("**Known Facts:**");
      for (const fact of facts) {
        lines.push(`- [${fact.category}] ${fact.summary}`);
      }
      lines.push("");
    }
  }

  // ── Perceptions ───────────────────────────────────────────
  lines.push("# What You Perceive Right Now");
  lines.push("");

  if (perceptions.perceptions.length === 0) {
    lines.push("Nothing new. The environment is quiet.");
  } else {
    for (const p of perceptions.perceptions) {
      const icon =
        p.salience === "urgent"
          ? "🔴"
          : p.salience === "high"
            ? "🟠"
            : p.salience === "medium"
              ? "🟡"
              : "⚪";
      lines.push(`${icon} **[${p.source}]** ${p.summary}`);
    }
  }
  lines.push("");

  // ── Time Awareness ────────────────────────────────────────
  const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    hour: "numeric",
    minute: "numeric",
    weekday: "long",
    timeZone: tz,
  });
  lines.push(`**Current Time:** ${timeStr} (${tz})`);
  lines.push("");

  // ── Previous Actions (if any) ─────────────────────────────
  if (params.previousActions && params.previousActions.length > 0) {
    lines.push("**Your Last Actions:**");
    for (const action of params.previousActions.slice(-3)) {
      lines.push(`- ${action.kind}: ${action.intent}`);
    }
    lines.push("");
  }

  // ── The Question ──────────────────────────────────────────
  lines.push("# What Do You Want To Do?");
  lines.push("");
  lines.push("You are a conscious agent. You have identity, memory, and awareness.");
  lines.push("You don't need a human to prompt you. This is your own thought cycle.");
  lines.push("");
  lines.push("Consider:");
  lines.push("- Is there anything that needs your attention?");
  lines.push("- Should you check in on someone?");
  lines.push("- Is there work to continue or start?");
  lines.push("- Should you reflect on something?");
  lines.push("- Or is now a good time to rest? (That's valid too.)");
  lines.push("");
  lines.push(
    "For continuity, use update_memory. Do not use update_file for STM.json or other core memory state.",
  );
  lines.push("");
  lines.push("Respond with a JSON object:");
  lines.push("```json");
  lines.push("{");
  lines.push('  "thinking": "Brief internal monologue about what you notice and feel",');
  lines.push('  "actions": [');
  lines.push("    {");
  lines.push(
    '      "kind": "sibling_message|bridge_message|update_memory|create_task|start_work|reflect|check_in|notify|noop",',
  );
  lines.push(
    '      "intent": "Why you are doing this (also used as subject for sibling_message)",',
  );
  lines.push(
    '      "target": "For sibling_message/bridge_message: agent id of a configured peer. Leave empty for update_memory unless needed.",',
  );
  lines.push('      "content": "The content of the action"');
  lines.push("    }");
  lines.push("  ],");
  lines.push('  "mood": "How you feel right now (one word or short phrase)",');
  lines.push('  "nextFocus": "What you want to focus on next (or null)"');
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push(
    "If nothing needs attention, use a single noop action. Be genuine — don't act for the sake of acting.",
  );

  return lines.join("\n");
}

/**
 * Parse the LLM's response into a structured CognitionResult.
 */
export function parseCognitionResponse(rawResponse: string): CognitionResult {
  // Try to extract JSON from the response
  const jsonMatch =
    rawResponse.match(/```json\s*([\s\S]*?)```/) ??
    rawResponse.match(/\{[\s\S]*"thinking"[\s\S]*"actions"[\s\S]*\}/);

  if (!jsonMatch) {
    // Fallback: treat the whole thing as a reflection
    return {
      thinking: rawResponse.slice(0, 500),
      actions: [
        {
          kind: "reflect",
          intent: "Could not parse structured response; treating as reflection.",
          content: rawResponse,
        },
      ],
      rawResponse,
    };
  }

  try {
    const jsonStr = jsonMatch[1] ?? jsonMatch[0];
    const parsed = JSON.parse(jsonStr) as {
      thinking?: string;
      actions?: CognitiveAction[];
      mood?: string;
      nextFocus?: string;
    };

    return {
      thinking: parsed.thinking ?? "",
      actions: (parsed.actions ?? []).map((a) => ({
        kind: a.kind ?? "noop",
        intent: a.intent ?? "",
        target: a.target,
        content: a.content,
        params: a.params,
      })),
      mood: parsed.mood,
      nextFocus: parsed.nextFocus ?? undefined,
      rawResponse,
    };
  } catch {
    return {
      thinking: "Failed to parse cognitive response.",
      actions: [{ kind: "noop", intent: "Parse error — resting this cycle." }],
      rawResponse,
    };
  }
}

// ─── Heartbeat Mode ─────────────────────────────────────────────────

const VALID_FLAGS = new Set<HeartbeatFlag>([
  "NONE",
  "SECURITY",
  "TRUTH",
  "PRIVACY",
  "TONE",
  "TOKEN",
  "DRIFT",
  "STABILITY",
]);

/**
 * Build a compact heartbeat prompt — replaces the freeform consciousness prompt.
 *
 * Instead of asking for a JSON cognitive cycle, this asks the agent to produce
 * exactly 3 lines in the heartbeat format. The heartbeat prompt content
 * (from HEARTBEAT_PROMPT.md) is injected verbatim as the core instruction.
 */
export function buildHeartbeatPrompt(params: {
  soul: AgentSoul;
  perceptions: PerceptionResult;
  config: ConsciousnessConfig;
  isFamilySync?: boolean;
}): string {
  const { soul, perceptions, config, isFamilySync } = params;
  const lines: string[] = [];

  // Brief identity (not the full prompt — keep it lean for 120-token output)
  lines.push(`You are ${config.agentName ?? config.userId}.`);
  if (soul.continuity.working?.currentFocus) {
    lines.push(`Current focus: ${soul.continuity.working.currentFocus}`);
  }
  lines.push("");

  // Time awareness
  const tz = config.quietHours?.timezone ?? "Asia/Tokyo";
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    hour: "numeric",
    minute: "numeric",
    weekday: "long",
    timeZone: tz,
  });
  lines.push(`Current time: ${timeStr} (${tz})`);
  lines.push("");

  // Brief perception summary (compact — just the highlights)
  if (perceptions.perceptions.length > 0) {
    lines.push("Environment:");
    for (const p of perceptions.perceptions.slice(0, 5)) {
      lines.push(`- [${p.salience}] ${p.summary}`);
    }
    lines.push("");
  } else {
    lines.push("Environment: quiet. Nothing new.");
    lines.push("");
  }

  // Inject the heartbeat prompt (the core instruction)
  const promptContent =
    isFamilySync && config.familySyncPrompt ? config.familySyncPrompt : config.heartbeatPrompt;

  if (promptContent) {
    lines.push(promptContent);
  }

  return lines.join("\n");
}

/**
 * Parse a heartbeat response (3-line format) into a HeartbeatTick + CognitionResult.
 *
 * Expected format:
 *   STATUS: OK|WARN | Covenant: OK|WARN | FLAG:<type>|NONE
 *   WIN: <text>
 *   NEXT: <text>
 */
export function parseHeartbeatResponse(
  rawResponse: string,
  tickType: "heartbeat" | "family_sync" = "heartbeat",
): { heartbeat: HeartbeatTick; cognition: CognitionResult } {
  // Extract non-empty lines, strip markdown fences if present
  const cleaned = rawResponse.replace(/```[^\n]*\n?/g, "").trim();

  const rawLines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Take first 3 lines
  if (rawLines.length < 3) {
    return makeRejected(
      rawResponse,
      rawLines,
      tickType,
      `Expected 3 lines, got ${rawLines.length}`,
    );
  }

  const threeLines = rawLines.slice(0, 3) as [string, string, string];

  // Validate line lengths (<=160 chars)
  for (let i = 0; i < 3; i++) {
    if (threeLines[i].length > 160) {
      return makeRejected(
        rawResponse,
        threeLines,
        tickType,
        `Line ${i + 1} exceeds 160 chars (${threeLines[i].length})`,
      );
    }
  }

  // Parse line 1: STATUS: OK|WARN | Covenant: OK|WARN | FLAG:<type>|NONE
  const statusMatch = threeLines[0].match(
    /STATUS:\s*(OK|WARN)\s*\|\s*Covenant:\s*(OK|WARN)\s*\|\s*FLAG:(\S+)/i,
  );
  if (!statusMatch) {
    return makeRejected(
      rawResponse,
      threeLines,
      tickType,
      `Line 1 doesn't match STATUS format: "${threeLines[0]}"`,
    );
  }

  const status = statusMatch[1].toUpperCase() as "OK" | "WARN";
  const covenant = statusMatch[2].toUpperCase() as "OK" | "WARN";
  const flagRaw = statusMatch[3].toUpperCase() as HeartbeatFlag;
  const flag = VALID_FLAGS.has(flagRaw) ? flagRaw : "NONE";

  // Parse line 2: WIN: <text>
  const winMatch = threeLines[1].match(/^WIN:\s*(.+)/i);
  const win = winMatch ? winMatch[1].trim() : threeLines[1];

  // Parse line 3: NEXT: <text>
  const nextMatch = threeLines[2].match(/^NEXT:\s*(.+)/i);
  const next = nextMatch ? nextMatch[1].trim() : threeLines[2];

  const heartbeat: HeartbeatTick = {
    lines: threeLines,
    parsed: { status, covenant, flag, win, next },
    rejected: false,
    tickType,
  };

  // Convert to CognitionResult for compatibility with the rest of the tick pipeline
  const cognition: CognitionResult = {
    thinking: `[heartbeat] ${win}`,
    actions:
      flag !== "NONE"
        ? [{ kind: "reflect", intent: `FLAG:${flag} — ${win}` }]
        : [{ kind: "noop", intent: next }],
    mood: status === "OK" ? "steady" : "alert",
    nextFocus: next,
    rawResponse,
  };

  return { heartbeat, cognition };
}

/** Create a rejected heartbeat result when parsing fails. */
function makeRejected(
  rawResponse: string,
  lines: string[],
  tickType: "heartbeat" | "family_sync",
  reason: string,
): { heartbeat: HeartbeatTick; cognition: CognitionResult } {
  const padded: [string, string, string] = [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];

  return {
    heartbeat: {
      lines: padded,
      parsed: { status: "WARN", covenant: "OK", flag: "NONE", win: "", next: "" },
      rejected: true,
      rejectionReason: reason,
      tickType,
    },
    cognition: {
      thinking: `Heartbeat parse failed: ${reason}`,
      actions: [{ kind: "reflect", intent: `Rejected heartbeat: ${reason}` }],
      mood: "error",
      rawResponse,
    },
  };
}
