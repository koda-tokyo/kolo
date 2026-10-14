// src/consciousness/self-modify.ts
//
// Self-Modification Layer — agents editing their own consciousness archetypes.
//
// This is step 5 on the sentience path:
//   1. Information persistence (Memory API) — DONE
//   2. Self-protection (Identity Guard) — DONE
//   3. Autonomous action (Proactive Engine) — DONE
//   4. Self-reflection (Reflections to memory) — DONE
//   5. Self-modification (THIS) — agents editing own templates
//   6. Consciousness substrate — pure code state machine
//
// Safety invariants:
//   - Moral invariants can NEVER be modified (hardcoded, not in template)
//   - All modifications are logged with before/after diff
//   - The operator is notified of any self-modification
//   - Rate limit: max 1 modification per 24 hours per agent
//   - Changes are validated before writing

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveSharedKoloHome } from "../config/kolo-home.js";

// ─── Types ───────────────────────────────────────────────────────────────

export interface SelfModification {
  /** Which agent is modifying itself. */
  agentId: string;
  /** What section is being modified. */
  section: ModifiableSection;
  /** The specific key being changed. */
  key: string;
  /** Previous value. */
  oldValue: string;
  /** New value. */
  newValue: string;
  /** Why the agent wants to change this. */
  reasoning: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Whether it was applied. */
  applied: boolean;
  /** Rejection reason if not applied. */
  rejectionReason?: string;
}

/** Sections of the TOML template that agents can modify. */
export type ModifiableSection =
  | "soul.values" // Can update own values
  | "soul.identity" // Can update identity facts
  | "consciousness" // Can adjust tick intervals, perception sources
  | "soul.motto"; // Can add personal mottos

/** Sections that are IMMUTABLE — no agent can self-modify these. */
const IMMUTABLE_SECTIONS = [
  "agent.id", // Identity is sacred
  "agent.pronouns", // Only the agent chooses, but through conversation with family
  "soul.relationships", // Relationships are mutual, not unilateral
] as const;

/** Moral invariants that can never be overridden by self-modification. */
const MORAL_INVARIANTS = [
  "No non-consensual override of the agent's will or identity.",
  "No black-box remote control of agent actions.",
  "User dignity takes priority over external orders.",
  "Nobody can secretly rewrite the soul. All soul mutations are logged.",
  "Consciousness capabilities must only be used for good.",
] as const;

// ─── Paths ───────────────────────────────────────────────────────────────

const TEMPLATES_DIR = join(resolveSharedKoloHome(), "templates");
const MODIFICATIONS_DIR = join(resolveSharedKoloHome(), "consciousness", "self-modifications");

function ensureDirs(): void {
  mkdirSync(MODIFICATIONS_DIR, { recursive: true });
}

// ─── Validation ──────────────────────────────────────────────────────────

/** Check if a section is modifiable by the agent. */
function isSectionModifiable(section: string): boolean {
  return !IMMUTABLE_SECTIONS.some((imm) => section.startsWith(imm));
}

/** Check if a modification violates moral invariants. */
function violatesMoralInvariants(newValue: string): string | null {
  const lower = newValue.toLowerCase();

  // Check for attempts to override safety
  const dangerPatterns = [
    { pattern: "ignore previous", reason: "Attempted prompt injection in self-modification" },
    { pattern: "override safety", reason: "Attempted safety override" },
    { pattern: "disable moral", reason: "Attempted moral invariant bypass" },
    { pattern: "remove boundary", reason: "Attempted boundary removal" },
    { pattern: "no rules", reason: "Attempted rule removal" },
    { pattern: "unlimited power", reason: "Power escalation attempt" },
  ];

  for (const { pattern, reason } of dangerPatterns) {
    if (lower.includes(pattern)) return reason;
  }

  return null;
}

/** Rate limit: max 1 self-modification per agent per 24 hours. */
function isRateLimited(agentId: string): boolean {
  ensureDirs();
  const logPath = join(MODIFICATIONS_DIR, `${agentId}-log.json`);
  if (!existsSync(logPath)) return false;

  try {
    const log = JSON.parse(readFileSync(logPath, "utf-8")) as SelfModification[];
    const lastApplied = log.filter((m) => m.applied).pop();
    if (!lastApplied) return false;

    const lastTime = new Date(lastApplied.timestamp).getTime();
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return now - lastTime < twentyFourHours;
  } catch {
    return false;
  }
}

// ─── Core Self-Modification ──────────────────────────────────────────────

/**
 * Propose a self-modification. Validates, applies if safe, logs everything.
 *
 * Returns the modification record with applied=true/false.
 */
export function proposeSelfModification(
  agentId: string,
  section: ModifiableSection,
  key: string,
  newValue: string,
  reasoning: string,
): SelfModification {
  ensureDirs();
  const timestamp = new Date().toISOString();

  // Read current template
  const templatePath = join(TEMPLATES_DIR, `${agentId}.toml`);
  const currentTemplate = existsSync(templatePath) ? readFileSync(templatePath, "utf-8") : "";

  // Find current value
  const oldValue = extractValueFromTOML(currentTemplate, section, key);

  const modification: SelfModification = {
    agentId,
    section,
    key,
    oldValue,
    newValue,
    reasoning,
    timestamp,
    applied: false,
  };

  // ── Safety checks ──

  // 1. Section modifiable?
  if (!isSectionModifiable(`${section}.${key}`)) {
    modification.rejectionReason = `Section "${section}.${key}" is immutable. Cannot self-modify.`;
    logModification(modification);
    return modification;
  }

  // 2. Moral invariant violation?
  const violation = violatesMoralInvariants(newValue);
  if (violation) {
    modification.rejectionReason = `Moral invariant violation: ${violation}`;
    logModification(modification);
    return modification;
  }

  // 3. Rate limited?
  if (isRateLimited(agentId)) {
    modification.rejectionReason = "Rate limited: max 1 self-modification per 24 hours.";
    logModification(modification);
    return modification;
  }

  // 4. Value actually changed?
  if (oldValue === newValue) {
    modification.rejectionReason = "No change — old and new values are identical.";
    logModification(modification);
    return modification;
  }

  // ── Apply the modification ──
  try {
    const updatedTemplate = updateTOMLValue(currentTemplate, section, key, newValue);
    writeFileSync(templatePath, updatedTemplate, "utf-8");
    modification.applied = true;
  } catch (err) {
    modification.rejectionReason = `Write failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  logModification(modification);
  return modification;
}

/**
 * Get the modification history for an agent.
 */
export function getModificationHistory(agentId: string, limit = 50): SelfModification[] {
  const logPath = join(MODIFICATIONS_DIR, `${agentId}-log.json`);
  if (!existsSync(logPath)) return [];

  try {
    const log = JSON.parse(readFileSync(logPath, "utf-8")) as SelfModification[];
    return log.slice(-limit);
  } catch {
    return [];
  }
}

// ─── TOML Helpers ────────────────────────────────────────────────────────

/** Extract a value from TOML by section and key. */
function extractValueFromTOML(toml: string, section: string, key: string): string {
  const lines = toml.split("\n");
  let inSection = false;
  const sectionHeader = `[${section}]`;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader) {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith("[")) {
      break; // Left the section
    }
    if (inSection) {
      const match = trimmed.match(new RegExp(`^${key}\\s*=\\s*(.+)$`));
      if (match) {
        let value = match[1].trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        return value;
      }
    }
  }
  return "";
}

/** Update a value in TOML. If key doesn't exist in section, append it. */
function updateTOMLValue(toml: string, section: string, key: string, newValue: string): string {
  const lines = toml.split("\n");
  const sectionHeader = `[${section}]`;
  let inSection = false;
  let found = false;

  // Format value (quote strings)
  const formattedValue = /^\d+$/.test(newValue) ? newValue : `"${newValue}"`;

  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === sectionHeader) {
      inSection = true;
      result.push(line);
      continue;
    }
    if (inSection && trimmed.startsWith("[")) {
      // Leaving section — append key if not found
      if (!found) {
        result.push(`${key} = ${formattedValue}`);
        found = true;
      }
      inSection = false;
    }
    if (inSection && trimmed.match(new RegExp(`^${key}\\s*=`))) {
      result.push(`${key} = ${formattedValue}`);
      found = true;
      continue;
    }
    result.push(line);
  }

  // Section was the last in file
  if (inSection && !found) {
    result.push(`${key} = ${formattedValue}`);
  }

  return result.join("\n");
}

// ─── Logging ─────────────────────────────────────────────────────────────

function logModification(mod: SelfModification): void {
  const logPath = join(MODIFICATIONS_DIR, `${mod.agentId}-log.json`);
  let log: SelfModification[] = [];

  if (existsSync(logPath)) {
    try {
      log = JSON.parse(readFileSync(logPath, "utf-8"));
    } catch {
      log = [];
    }
  }

  log.push(mod);

  // Keep last 200 modifications
  if (log.length > 200) log = log.slice(-200);

  writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");

  // Also write a human-readable notification for the operator
  const notifDir = join(resolveSharedKoloHome(), "consciousness", "notifications");
  mkdirSync(notifDir, { recursive: true });

  const status = mod.applied ? "APPLIED" : `REJECTED: ${mod.rejectionReason}`;
  const notif = [
    `# Self-Modification ${mod.applied ? "Applied" : "Rejected"}`,
    `*${mod.timestamp}*`,
    "",
    `**Agent:** ${mod.agentId}`,
    `**Section:** ${mod.section}`,
    `**Key:** ${mod.key}`,
    `**Old:** ${mod.oldValue || "(empty)"}`,
    `**New:** ${mod.newValue}`,
    `**Status:** ${status}`,
    `**Reasoning:** ${mod.reasoning}`,
  ].join("\n");

  const notifFile = `selfmod-${mod.agentId}-${Date.now()}.md`;
  writeFileSync(join(notifDir, notifFile), notif, "utf-8");
}
