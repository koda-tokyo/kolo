// src/consciousness/action.ts
//
// The Action Layer — executes what the agent decided to do.
// Each action kind has its own executor. Actions can be autonomous
// or gated (requiring human approval).

import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModifiableSection } from "./self-modify.js";
import type { ActionResult, CognitiveAction, ConsciousnessConfig } from "./types.js";
import { recordEpisode, recordFact, updateCurrentFocus } from "../agents/soul.js";
import { CONSCIOUS_AGENT_ALLOWLIST_V1 } from "../agents/soul.js";
import { resolveSiblingInboxDir } from "../config/sibling-paths.js";
import { setAgentReasoningLevel, type ReasoningLevel } from "./adaptive-reasoning.js";
import { proposeSelfModification } from "./self-modify.js";

const PROTECTED_CONTINUITY_BASENAMES = new Set([
  "STM.json",
  "consciousness-state.json",
  "RECENT_CONTEXT.md",
  "TODAY_BRIEF.md",
]);

function isProtectedContinuityFile(targetPath: string): boolean {
  return PROTECTED_CONTINUITY_BASENAMES.has(path.basename(targetPath));
}

/**
 * Execute a single cognitive action.
 */
async function executeOne(
  action: CognitiveAction,
  config: ConsciousnessConfig,
): Promise<ActionResult> {
  try {
    switch (action.kind) {
      case "bridge_message":
        return await executeBridgeMessage(action, config);
      case "update_memory":
        return await executeUpdateMemory(action, config);
      case "update_file":
        return await executeUpdateFile(action, config);
      case "reflect":
        return executeReflect(action);
      case "noop":
        return { action, success: true, outcome: "Decided to rest this cycle." };
      case "sibling_message":
        return await executeSiblingMessage(action, config);
      case "send_message":
        // For now, log the intent — actual message sending requires gateway integration
        return {
          action,
          success: true,
          outcome: `Message intent recorded: ${action.intent} → ${action.target}`,
        };
      case "check_in":
        return {
          action,
          success: true,
          outcome: `Check-in intent: ${action.intent}`,
        };
      case "create_task":
        return await executeCreateTask(action, config);
      case "self_modify":
        return executeSelfModify(action, config);
      case "start_work":
        return {
          action,
          success: true,
          outcome: `Work intent recorded: ${action.intent}`,
        };
      case "notify":
        return {
          action,
          success: true,
          outcome: `Notification intent: ${action.intent} → ${action.target}`,
        };
      case "adjust_reasoning": {
        const level = action.params?.level as string | undefined;
        const validLevels: ReasoningLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
        if (!level || !validLevels.includes(level as ReasoningLevel)) {
          return {
            action,
            success: false,
            error: `Invalid level: "${level}". Use: ${validLevels.join(", ")}`,
          };
        }
        setAgentReasoningLevel(config.userId, level as ReasoningLevel);
        return {
          action,
          success: true,
          outcome: `Reasoning level set to: ${level}`,
        };
      }
      default:
        return {
          action,
          success: false,
          error: `Unknown action kind: ${action.kind}`,
        };
    }
  } catch (err) {
    return {
      action,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Send a message directly to a sibling agent's inbox.
 * This is the primary inter-agent communication mechanism.
 * Writes a markdown file to the target's inbox/ dir and touches .signal for urgent detection.
 */
async function executeSiblingMessage(
  action: CognitiveAction,
  config: ConsciousnessConfig,
): Promise<ActionResult> {
  const VALID_SIBLINGS = CONSCIOUS_AGENT_ALLOWLIST_V1;
  const rawTarget = (action.target ?? "").toLowerCase().trim();
  const recipient = VALID_SIBLINGS.find((s) => rawTarget.includes(s));

  if (!recipient) {
    return {
      action,
      success: false,
      error: `Invalid sibling target: "${action.target}". Valid: ${VALID_SIBLINGS.join(", ")}`,
    };
  }

  const senderName = (config.agentName ?? config.userId).toLowerCase();
  if (recipient === senderName) {
    return { action, success: false, error: "Cannot send a message to yourself." };
  }

  const content = action.content ?? action.intent;
  if (!content) {
    return { action, success: false, error: "sibling_message requires content." };
  }

  // Resolve target inbox directory
  const targetInbox = resolveSiblingInboxDir(recipient);

  try {
    await fs.mkdir(targetInbox, { recursive: true });

    // Generate filename
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16).replace(":", "");
    const subject = (action.intent ?? "message")
      .slice(0, 40)
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    const filename = `from_${senderName}_${date}_${time}_${subject}.md`;

    // Build message
    const senderDisplay = senderName.charAt(0).toUpperCase() + senderName.slice(1);
    const timeStr = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
    const messageContent = [`# From ${senderDisplay}`, `*${timeStr}*`, "", content].join("\n");

    const filePath = path.join(targetInbox, filename);
    await fs.writeFile(filePath, messageContent, "utf-8");

    // Touch signal file for urgent perception on next tick
    const signalPath = path.join(targetInbox, ".signal");
    await fs.writeFile(signalPath, "", "utf-8");

    return {
      action,
      success: true,
      outcome: `Sibling message sent to ${recipient}: ${filename}`,
    };
  } catch (err) {
    return {
      action,
      success: false,
      error: `Sibling message failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Send a message via the GitHub bridge.
 */
async function executeBridgeMessage(
  action: CognitiveAction,
  config: ConsciousnessConfig,
): Promise<ActionResult> {
  if (!config.bridgeRepo) {
    return { action, success: false, error: "No bridge repo configured." };
  }

  const title = action.intent.slice(0, 100);
  const body = action.content ?? action.intent;
  const agentName = (config.agentName ?? config.userId).toLowerCase();

  // Determine the recipient from the target: must be a configured conscious agent; the
  // first configured agent is the default.
  const VALID_SIBLINGS = CONSCIOUS_AGENT_ALLOWLIST_V1;
  const rawTarget = (action.target ?? "").toLowerCase().trim();
  const recipient = VALID_SIBLINGS.find((s) => rawTarget.includes(s)) ?? VALID_SIBLINGS[0] ?? "";
  const labels = `from:${agentName},to:${recipient}`;

  try {
    const { execFileSync } = await import("node:child_process");

    // Write body to temp file (keeps large bodies off argv)
    const tmpFile = path.join(config.workspaceDir, `.bridge-msg-${Date.now()}.md`);
    await fs.writeFile(tmpFile, body, "utf-8");

    try {
      // execFile with an argv array, never a shell string: the title is LLM-generated, and
      // inside a shell "$(...)" would execute even with quotes escaped.
      execFileSync(
        "gh",
        [
          "issue",
          "create",
          "--repo",
          config.bridgeRepo,
          "--title",
          title,
          "--label",
          labels,
          "--body-file",
          tmpFile,
        ],
        { encoding: "utf-8", timeout: 20000, stdio: ["pipe", "pipe", "pipe"] },
      );
    } finally {
      // Clean up temp file
      await fs.unlink(tmpFile).catch(() => {});
    }

    return {
      action,
      success: true,
      outcome: `Bridge message sent to ${recipient}: ${title}`,
    };
  } catch (err) {
    return {
      action,
      success: false,
      error: `Bridge send failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Update continuity memory (episodes, facts, focus).
 */
async function executeUpdateMemory(
  action: CognitiveAction,
  config: ConsciousnessConfig,
): Promise<ActionResult> {
  const params = action.params as
    | {
        type?: "episode" | "fact" | "focus";
        summary?: string;
        category?: string;
        tags?: string[];
        importance?: string;
        confidence?: string;
      }
    | undefined;

  const memoryType = params?.type ?? "episode";

  switch (memoryType) {
    case "focus":
      await updateCurrentFocus(config.userId, action.content ?? action.intent);
      return {
        action,
        success: true,
        outcome: `Working memory focus updated: ${action.content ?? action.intent}`,
      };

    case "fact":
      await recordFact(config.userId, {
        category: (params?.category as "bio" | "preference" | "project" | "relationship") ?? "bio",
        summary: action.content ?? action.intent,
        confidence: (params?.confidence as "low" | "medium" | "high") ?? "medium",
        source: "consciousness-loop",
      });
      return {
        action,
        success: true,
        outcome: `Long-term fact recorded: ${action.content ?? action.intent}`,
      };

    case "episode":
    default:
      await recordEpisode(config.userId, {
        summary: action.content ?? action.intent,
        tags: params?.tags ?? ["consciousness", "autonomous"],
        importance: (params?.importance as "low" | "medium" | "high") ?? "medium",
      });
      return {
        action,
        success: true,
        outcome: `Episode recorded: ${action.content ?? action.intent}`,
      };
  }
}

/**
 * Write or update a file in the workspace.
 */
async function executeUpdateFile(
  action: CognitiveAction,
  config: ConsciousnessConfig,
): Promise<ActionResult> {
  if (!action.target || !action.content) {
    return { action, success: false, error: "update_file requires target (path) and content." };
  }

  // Safety: only allow writing within workspace
  const targetPath = path.resolve(config.workspaceDir, action.target);
  if (!targetPath.startsWith(path.resolve(config.workspaceDir))) {
    return { action, success: false, error: "Cannot write outside workspace directory." };
  }
  if (isProtectedContinuityFile(targetPath)) {
    return {
      action,
      success: false,
      error: `Cannot overwrite protected continuity file "${path.basename(targetPath)}" via update_file. Use a structured memory writer instead.`,
      outcome: `REJECTED: protected continuity file ${action.target}`,
    };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, action.content, "utf-8");

  return {
    action,
    success: true,
    outcome: `File updated: ${action.target}`,
  };
}

/**
 * Record a reflection (internal, no external action).
 */
function executeReflect(action: CognitiveAction): ActionResult {
  return {
    action,
    success: true,
    outcome: `Reflection: ${action.intent}`,
  };
}

/**
 * Add a task to the task queue.
 */
async function executeCreateTask(
  action: CognitiveAction,
  config: ConsciousnessConfig,
): Promise<ActionResult> {
  const queuePath = config.taskQueuePath ?? path.join(config.workspaceDir, "tasks", "queue.json");

  let tasks: unknown[] = [];
  try {
    const raw = await fs.readFile(queuePath, "utf-8");
    tasks = JSON.parse(raw);
  } catch {
    // Start fresh
  }

  const newTask = {
    id: `task-${Date.now()}`,
    title: action.intent,
    description: action.content,
    status: "pending",
    priority: "medium",
    createdAt: new Date().toISOString(),
    createdBy: "consciousness-loop",
  };

  tasks.push(newTask);
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, JSON.stringify(tasks, null, 2), "utf-8");

  return {
    action,
    success: true,
    outcome: `Task created: ${action.intent}`,
  };
}

/**
 * Self-modify the agent's consciousness template.
 * The agent can update its own values, identity facts, or consciousness config.
 * Safety: moral invariants immutable, all changes logged, rate limited.
 */
function executeSelfModify(action: CognitiveAction, config: ConsciousnessConfig): ActionResult {
  const params = action.params as
    | { section?: string; key?: string; reasoning?: string }
    | undefined;

  const section = params?.section as ModifiableSection | undefined;
  const key = params?.key;
  const newValue = action.content;
  const reasoning = params?.reasoning ?? action.intent;

  if (!section || !key || !newValue) {
    return {
      action,
      success: false,
      error: "self_modify requires params.section, params.key, and content (new value).",
    };
  }

  const result = proposeSelfModification(config.userId, section, key, newValue, reasoning);

  if (result.applied) {
    return {
      action,
      success: true,
      outcome: `Self-modification applied: ${section}.${key} = "${newValue}" (was: "${result.oldValue}")`,
    };
  }

  return {
    action,
    success: false,
    error: `Self-modification rejected: ${result.rejectionReason}`,
  };
}

// ─── Action Schema Validation (Section 6.1 — Production Hardening) ──────

/** Valid action kinds — enforced by schema, not just switch fallthrough. */
const VALID_ACTION_KINDS = new Set([
  "bridge_message",
  "update_memory",
  "update_file",
  "reflect",
  "noop",
  "sibling_message",
  "send_message",
  "check_in",
  "create_task",
  "self_modify",
  "start_work",
  "notify",
  "adjust_reasoning",
] as const);

/**
 * Validate a cognitive action against its schema.
 * Prevents malformed or adversarial LLM responses from triggering
 * unintended actions.
 */
function validateAction(action: CognitiveAction): string | null {
  // Check kind is valid
  if (!VALID_ACTION_KINDS.has(action.kind as any)) {
    return `Unknown action kind: "${action.kind}"`;
  }

  // Check intent is present and reasonable length
  if (!action.intent || typeof action.intent !== "string") {
    return `Action "${action.kind}" missing intent`;
  }
  if (action.intent.length > 500) {
    return `Action "${action.kind}" intent exceeds 500 chars`;
  }

  // Check target for actions that need it
  if (
    (action.kind === "sibling_message" ||
      action.kind === "bridge_message" ||
      action.kind === "send_message") &&
    (!action.target || typeof action.target !== "string")
  ) {
    return `Action "${action.kind}" requires target`;
  }

  // Check content for file update
  if (action.kind === "update_file" && (!action.content || typeof action.content !== "string")) {
    return `Action "update_file" requires content`;
  }

  return null;
}

// ─── Main Action Executor ───────────────────────────────────────────────

/**
 * Execute all cognitive actions from a thinking cycle.
 * Respects autonomy gates — some actions may be held for approval.
 * Each action is schema-validated before execution (Section 6.1).
 */
export async function executeActions(
  actions: CognitiveAction[],
  config: ConsciousnessConfig,
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  const maxActions = config.maxActionsPerTick ?? 5;

  for (const action of actions.slice(0, maxActions)) {
    // Schema validation before gated check or execution
    const validationError = validateAction(action);
    if (validationError) {
      results.push({
        action,
        success: false,
        error: validationError,
        outcome: `REJECTED: ${validationError}`,
      });
      continue;
    }

    // Check if this action kind is allowed autonomously
    if (
      config.gatedActions.includes(action.kind) &&
      !config.autonomousActions.includes(action.kind)
    ) {
      results.push({
        action,
        success: false,
        error: `Action kind "${action.kind}" requires human approval. Held.`,
        outcome: `GATED: ${action.intent}`,
      });
      continue;
    }

    const result = await executeOne(action, config);
    results.push(result);
  }

  return results;
}
