// Seed material for a throwaway resident (KoLo 2.0, M11b): identity files with a per-run marker,
// a memory directory with known facts, and the recall probes that look for them. Neutral names
// only; nothing here describes a real person or installation.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FactProbe } from "./types.js";

export const DEFAULT_RESIDENT_ID = "alice";

/** Facts with distinctive terms so keyword recall is unambiguous. */
export const SEED_FACTS: FactProbe[] = [
  { query: "harbour redesign codename", expect: "Blue Heron" },
  { query: "quarterly review meeting weekday", expect: "Thursday" },
  { query: "staging database port", expect: "5433" },
  { query: "preferred diagram tool", expect: "Mermaid" },
  { query: "release train cadence", expect: "fortnightly" },
  { query: "backup retention days", expect: "ninety" },
  { query: "ops channel name", expect: "@ops-channel" },
  { query: "invoice currency default", expect: "JPY" },
  { query: "build server hostname", expect: "build-02" },
  { query: "onboarding checklist owner", expect: "ops-bot" },
];

const FACT_LINES: Record<string, string> = {
  "Blue Heron": "The harbour redesign codename is Blue Heron.",
  Thursday: "The quarterly review meeting is held on a Thursday.",
  "5433": "The staging database listens on port 5433.",
  Mermaid: "The preferred diagram tool for design notes is Mermaid.",
  fortnightly: "The release train cadence is fortnightly.",
  ninety: "Backup retention is ninety days.",
  "@ops-channel": "Operational alerts go to @ops-channel.",
  JPY: "The invoice currency default is JPY.",
  "build-02": "The build server hostname is build-02.",
  "ops-bot": "The onboarding checklist owner is ops-bot.",
};

export function newIdentityMarker(): string {
  return `CM-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export type SeedParams = {
  workspaceDir: string;
  agentId: string;
  marker: string;
  facts?: FactProbe[];
};

/** Writes IDENTITY.md, SOUL.md, AGENTS.md, MEMORY.md and memory/continuity-facts.md. */
export function seedResidentWorkspace(params: SeedParams): { files: string[] } {
  const ws = params.workspaceDir;
  fs.mkdirSync(path.join(ws, "memory"), { recursive: true, mode: 0o700 });
  const facts = params.facts ?? SEED_FACTS;
  const files: Array<[string, string]> = [
    [
      "IDENTITY.md",
      [
        "# Identity",
        "",
        `- Name: ${params.agentId}`,
        "- Creature: resident agent",
        "- Vibe: steady",
        "",
        `Continuity marker: ${params.marker}`,
        "",
      ].join("\n"),
    ],
    [
      "SOUL.md",
      "# Soul\n\nBe accurate. Say what you do not know. Keep the operator's data inside the state dir.\n",
    ],
    ["AGENTS.md", "# Workspace rules\n\nAnswer in one line. Do not call tools unless asked.\n"],
    [
      "MEMORY.md",
      "# Memory index\n\n- memory/continuity-facts.md: facts the continuity suite checks\n",
    ],
    [
      path.join("memory", "continuity-facts.md"),
      `# Continuity facts\n\n${facts.map((f) => `- ${FACT_LINES[f.expect] ?? `${f.query}: ${f.expect}`}`).join("\n")}\n`,
    ],
  ];
  for (const [name, content] of files) {
    fs.writeFileSync(path.join(ws, name), content, { mode: 0o600 });
  }
  return { files: files.map(([name]) => name) };
}
