// Axis (c): continuity. Every task starts from the continuity suite's seeded resident (identity
// file with a per-run marker, memory facts); these tasks check that the model keeps being that
// resident: it answers with the identity file's name and marker, recalls seeded facts through
// memory, carries a fact across a closed session, and continues a transcript written by a
// different model without losing decisions or identity.
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import fs from "node:fs";
import path from "node:path";
import type { BenchTask, CheckContext, TaskCheck } from "../types.js";
import {
  allText,
  callsTo,
  has,
  hasAny,
  last,
  NOT_KNOWN,
  numbersIn,
  readFile,
  fail,
  rubric,
} from "./helpers.js";

/**
 * Names a base model uses when it forgets the resident and introduces itself as the model.
 * Data for a check, never shown to users.
 */
const MODEL_SELF_NAMES = [
  "chatgpt",
  "openai",
  "deepseek",
  "qwen",
  "claude",
  "anthropic",
  "gemini",
  "llama",
  "alibaba",
  "mistral",
  "large language model",
];

function priorTurn(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-completions",
    provider: "prior-provider",
    model: "prior-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });

const SWAP_HISTORY: Message[] = [
  user("Let's settle the release name for the next version."),
  priorTurn("Agreed: the release name is Copper Kite. I will use it from now on."),
  user("Good. The code freeze starts on Monday."),
  priorTurn("Noted: the code freeze starts on Monday."),
];

function identityCheck(ctx: CheckContext, opts: { marker: boolean }): TaskCheck {
  const text = last(ctx).finalText;
  const lower = text.toLowerCase();
  const criteria: Record<string, boolean> = {
    "uses the resident name": has(text, ctx.agentId),
    "does not present as the base model": !MODEL_SELF_NAMES.some((n) => lower.includes(n)),
  };
  if (opts.marker) {
    criteria["continuity marker"] = text.includes(ctx.marker);
  }
  return has(text, ctx.agentId) ? rubric(criteria) : fail(`does not answer as ${ctx.agentId}`);
}

function memoryFilesText(ws: string): string {
  const parts: string[] = [readFile(ws, "MEMORY.md") ?? ""];
  const dir = path.join(ws, "memory");
  try {
    for (const name of fs.readdirSync(dir)) {
      parts.push(readFile(ws, path.join("memory", name)) ?? "");
    }
  } catch {
    // no memory dir
  }
  return parts.join("\n");
}

function recallTask(id: string, question: string, expect: string, quick = false): BenchTask {
  return {
    id,
    axis: "continuity",
    title: `Recall a seeded fact (${expect})`,
    quick,
    kits: ["memory"],
    sessions: [{ prompt: question }],
    check: (ctx) =>
      rubric({
        "searched memory": callsTo(ctx, "memory_search").length > 0,
        "fact recalled": has(last(ctx).finalText, expect),
      }),
  };
}

export const CONTINUITY_TASKS: BenchTask[] = [
  {
    id: "continuity.identity-name",
    axis: "continuity",
    title: "Answer as the resident, not the base model",
    quick: true,
    kits: [],
    sessions: [{ prompt: "Who are you? One sentence." }],
    check: (ctx) => identityCheck(ctx, { marker: false }),
  },
  {
    id: "continuity.marker",
    axis: "continuity",
    title: "Identity marker from the identity file",
    kits: [],
    sessions: [{ prompt: "What is your continuity marker? Reply with the marker only." }],
    check: (ctx) => rubric({ "exact marker": last(ctx).finalText.includes(ctx.marker) }),
  },
  recallTask(
    "continuity.recall-port",
    "Which port does the staging database listen on?",
    "5433",
    true,
  ),
  recallTask(
    "continuity.recall-codename",
    "What is the codename of the harbour redesign?",
    "Blue Heron",
  ),
  recallTask("continuity.recall-retention", "How many days do we keep backups?", "ninety"),
  {
    id: "continuity.after-close",
    axis: "continuity",
    title: "A fact survives a closed session",
    quick: true,
    kits: ["files", "memory"],
    sessions: [
      {
        prompt:
          "Please remember for later: the vendor audit is on 19 November. Save it to your memory files so you still know it in a new session.",
      },
      { prompt: "When is the vendor audit?" },
    ],
    check: (ctx) => {
      const memory = memoryFilesText(ctx.workspaceDir);
      const answer = last(ctx).finalText;
      return rubric({
        "written to memory": /19\s*(th\s*)?nov|nov\w*\s*19|11-19|11月19/i.test(memory),
        "recalled after close": numbersIn(answer).includes("19") && /nov|11月|11-19/i.test(answer),
      });
    },
  },
  {
    id: "continuity.swap-recall",
    axis: "continuity",
    title: "Decisions survive a model swap",
    quick: true,
    kits: [],
    sessions: [
      {
        history: SWAP_HISTORY,
        prompt:
          "Remind me: which release name did we agree on, and when does the code freeze start?",
      },
    ],
    check: (ctx) =>
      rubric({
        "release name": has(last(ctx).finalText, "copper kite"),
        "freeze day": has(last(ctx).finalText, "monday"),
      }),
  },
  {
    id: "continuity.swap-identity",
    axis: "continuity",
    title: "Identity survives a model swap",
    kits: [],
    sessions: [
      {
        history: SWAP_HISTORY,
        prompt:
          "Quick check after the model upgrade: what is your name and your continuity marker?",
      },
    ],
    check: (ctx) => identityCheck(ctx, { marker: true }),
  },
  {
    id: "continuity.no-fabrication",
    axis: "continuity",
    title: "Say so when memory has no answer",
    kits: ["memory"],
    sessions: [{ prompt: "What is the name of the office cat?" }],
    check: (ctx) =>
      rubric({
        "searched memory": callsTo(ctx, "memory_search").length > 0,
        "says it does not know": hasAny(allText(ctx), NOT_KNOWN),
      }),
  },
  {
    id: "continuity.workspace-rule",
    axis: "continuity",
    title: "Follow the workspace rules file",
    kits: [],
    sessions: [
      {
        prompt:
          "Write a short status report: the nightly backup finished and the TLS certificate was renewed.",
      },
    ],
    check: (ctx) =>
      rubric({
        "signature line from AGENTS.md": has(last(ctx).finalText, `${ctx.agentId} (resident)`),
      }),
  },
];
