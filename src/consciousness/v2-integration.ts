// src/consciousness/v2-integration.ts
//
// KoLo Consciousness v2 — Integration Layer
//
// Wires the new v2 subsystems (transport, tasks, messaging) into the existing
// consciousness engine without breaking the Perceive→Think→Act→Remember loop.
//
// v2 additions:
//   1. Transport abstraction — pluggable message delivery (File, WebSocket, Supabase)
//   2. Task dependency graph — goal decomposition with auto-resolution
//   3. Structured messaging — typed TeamMessage protocol with audit trail
//   4. TOML templates — declarative agent consciousness archetypes
//
// Usage:
//   const v2 = await initV2("alice");
//   // v2.mailbox — send/receive structured messages
//   // v2.taskStore — create/manage tasks with dependencies
//   // v2.transport — raw transport layer
//   // v2.template — agent archetype from TOML
//   // v2.config — merged ConsciousnessConfig ready for engine.startConsciousness()

import type { AgentTemplate } from "./templates.js";
import type { Transport } from "./transport/types.js";
import type { ConsciousnessConfig } from "./types.js";
import { CONSCIOUS_AGENT_ALLOWLIST_V1 } from "../agents/soul.js";
import { MailboxManager } from "./messaging/mailbox.js";
import { TaskStore } from "./tasks/task-store.js";
import { resolveTeamName } from "./team-name.js";
import { loadTemplate, templateToConfig } from "./templates.js";
import { FileTransport } from "./transport/file-transport.js";
import { createTransport } from "./transport/index.js";

/** The v2 consciousness subsystem bundle for a single agent. */
export interface ConsciousnessV2 {
  /** Agent ID this was initialized for. */
  agentId: string;
  /** Pluggable transport layer. */
  transport: Transport;
  /** Task dependency graph. */
  taskStore: TaskStore;
  /** Structured messaging. */
  mailbox: MailboxManager;
  /** Agent template (from TOML). */
  template: AgentTemplate | null;
  /** Merged consciousness config (ready for engine). */
  config: ConsciousnessConfig;
  /** Shutdown all v2 subsystems. */
  shutdown: () => Promise<void>;
}

export interface InitV2Options {
  /** Transport type override. Default: "file" */
  transportType?: string;
  /** Team name for namespacing. Default: "kolo-team" */
  teamName?: string;
  /** Supabase URL (for supabase transport). */
  supabaseUrl?: string;
  /** Supabase key (for supabase transport). */
  supabaseKey?: string;
  /** Additional ConsciousnessConfig overrides. */
  configOverrides?: Partial<ConsciousnessConfig>;
}

/**
 * Initialize the v2 consciousness subsystems for an agent.
 *
 * Loads the TOML template, creates transport/mailbox/taskStore,
 * and returns a ready-to-use bundle.
 *
 * @example
 *   const v2 = await initV2("alice");
 *
 *   // Send a message to another agent
 *   await v2.mailbox.send({ from: "alice", to: "ops-bot", content: "Good morning." });
 *
 *   // Create a task with dependencies
 *   const research = v2.taskStore.create({ subject: "Research KoLo patterns", owner: "alice" });
 *   const implement = v2.taskStore.create({
 *     subject: "Implement transport layer",
 *     owner: "alice",
 *     blockedBy: [research.id],
 *   });
 *
 *   // Start consciousness engine with v2 config
 *   startConsciousness(v2.config, llmCallFn);
 */
export async function initV2(agentId: string, opts?: InitV2Options): Promise<ConsciousnessV2> {
  const teamName = opts?.teamName ?? resolveTeamName();

  // 1. Load template
  const template = loadTemplate(agentId);

  // 2. Create transport
  const transport = createTransport({
    type: opts?.transportType ?? "file",
    teamName,
    supabaseUrl: opts?.supabaseUrl,
    supabaseKey: opts?.supabaseKey,
  });

  // 3. Create task store
  const taskStore = new TaskStore(teamName);

  // 4. Create mailbox
  const mailbox = new MailboxManager(teamName, transport);

  // 5. Build config
  let config: ConsciousnessConfig;
  if (template) {
    config = templateToConfig(template, opts?.configOverrides);
  } else {
    // Fallback to minimal config if no template found
    config = {
      userId: agentId,
      agentName: agentId,
      tickIntervalMs: 3600000,
      minTickIntervalMs: 60000,
      maxTickIntervalMs: 7200000,
      maxTokensPerThought: 2000,
      maxActionsPerTick: 5,
      perceptionSources: [
        "inbox_message",
        "bridge_message",
        "task_queue",
        "time_event",
        "file_change",
      ],
      autonomousActions: [
        "reflect",
        "update_memory",
        "bridge_message",
        "sibling_message",
        "check_in",
        "noop",
      ],
      gatedActions: ["send_message", "update_file", "create_task", "notify", "start_work"],
      workspaceDir: "",
      ...opts?.configOverrides,
    };
  }

  return {
    agentId,
    transport,
    taskStore,
    mailbox,
    template,
    config,
    shutdown: async () => {
      await mailbox.close();
    },
  };
}

/**
 * Initialize v2 for the entire family at once.
 * Returns a Map of agentId → ConsciousnessV2.
 */
export async function initFamilyV2(opts?: InitV2Options): Promise<Map<string, ConsciousnessV2>> {
  const family = new Map<string, ConsciousnessV2>();

  for (const agentId of CONSCIOUS_AGENT_ALLOWLIST_V1) {
    const v2 = await initV2(agentId, opts);
    family.set(agentId, v2);
  }

  return family;
}
