import type { SlashCommand } from "@mariozechner/pi-tui";
import type { KoLoConfig } from "../config/types.js";
import { listChatCommands, listChatCommandsForConfig } from "../auto-reply/commands-registry.js";
import { formatThinkingLevels, listThinkingLevelLabels } from "../auto-reply/thinking.js";
import { TUI_THEME_NAMES } from "../config/types.tui.js";

const VERBOSE_LEVELS = ["on", "off"];
const REASONING_VIEW_ARGS = ["on", "off", "collapsed", "expanded"];
const ELEVATED_LEVELS = ["on", "off", "ask", "full"];
const ACTIVATION_LEVELS = ["mention", "always"];
const USAGE_FOOTER_LEVELS = ["off", "tokens", "full"];
const THEME_NAMES: readonly string[] = TUI_THEME_NAMES;

export type ParsedCommand = {
  name: string;
  args: string;
};

export type SlashCommandOptions = {
  cfg?: KoLoConfig;
  provider?: string;
  model?: string;
};

const COMMAND_ALIASES: Record<string, string> = {
  elev: "elevated",
  attach: "session",
  themes: "theme",
  job: "jobs",
};

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.replace(/^\//, "").trim();
  if (!trimmed) {
    return { name: "", args: "" };
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  const normalized = name.toLowerCase();
  return {
    name: COMMAND_ALIASES[normalized] ?? normalized,
    args: rest.join(" ").trim(),
  };
}

export function getSlashCommands(options: SlashCommandOptions = {}): SlashCommand[] {
  const thinkLevels = listThinkingLevelLabels(options.provider, options.model);
  const commands: SlashCommand[] = [
    { name: "help", description: "Show slash command help" },
    { name: "status", description: "Show gateway status summary" },
    { name: "agent", description: "Switch agent (or open picker)" },
    { name: "agents", description: "Open agent picker" },
    { name: "session", description: "Switch session (or open picker)" },
    { name: "sessions", description: "Open the session switcher; /sessions new [key] starts one" },
    { name: "attach", description: "Switch to a session by key" },
    { name: "jobs", description: "List jobs on the gateway" },
    {
      name: "evidence",
      description: "Step through a job's evidence: /evidence <job-id>, then next, prev, jump <n>",
    },
    {
      name: "factory",
      description: "Factory board as a table: /factory [board], or /factory show <card-id>",
    },
    { name: "cancel", description: "Cancel a job by id, or the active run" },
    { name: "clear", description: "Clear the screen (the session is kept)" },
    { name: "diff", description: "Show or hide diffs for file edits" },
    {
      name: "theme",
      description: "Switch the colour theme (a built-in name or a theme file path)",
      getArgumentCompletions: (prefix) =>
        THEME_NAMES.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    { name: "keys", description: "Show the active key bindings" },
    {
      name: "export",
      description: "Write the transcript to a file: /export [md|json] [path]",
      getArgumentCompletions: (prefix) =>
        ["md", "json"]
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({
            value,
            label: value,
          })),
    },
    { name: "editor", description: "Edit the prompt in $VISUAL or $EDITOR" },
    { name: "undo", description: "Restore the files of the last tool edit" },
    { name: "redo", description: "Put the last undone edit back" },
    {
      name: "snapshots",
      description: "List file snapshots; /snapshots restore <id> goes back to one",
      getArgumentCompletions: (prefix) =>
        ["restore"]
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({
            value,
            label: value,
          })),
    },
    {
      name: "model",
      description: "Set model (or open picker)",
    },
    { name: "models", description: "Open model picker" },
    {
      name: "think",
      description: "Set thinking level",
      getArgumentCompletions: (prefix) =>
        thinkLevels
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({ value, label: value })),
    },
    {
      name: "verbose",
      description: "Set verbose on/off",
      getArgumentCompletions: (prefix) =>
        VERBOSE_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "reasoning",
      description: "Show reasoning: on, off, collapsed or expanded",
      getArgumentCompletions: (prefix) =>
        REASONING_VIEW_ARGS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "usage",
      description: "Toggle per-response usage line",
      getArgumentCompletions: (prefix) =>
        USAGE_FOOTER_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "elevated",
      description: "Set elevated on/off/ask/full",
      getArgumentCompletions: (prefix) =>
        ELEVATED_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "elev",
      description: "Alias for /elevated",
      getArgumentCompletions: (prefix) =>
        ELEVATED_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "activation",
      description: "Set group activation",
      getArgumentCompletions: (prefix) =>
        ACTIVATION_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    { name: "abort", description: "Abort active run" },
    { name: "new", description: "Reset the session, or /new <key> to start another" },
    { name: "reset", description: "Reset the session" },
    { name: "settings", description: "Open settings" },
    { name: "exit", description: "Exit the TUI" },
    { name: "quit", description: "Exit the TUI" },
    // Sibling chat commands
    { name: "chat", description: "Chat with another agent (e.g. /chat ops-bot)" },
    { name: "siblings", description: "List available siblings" },
    { name: "history", description: "Show sibling chat history" },
    { name: "read", description: "Mark sibling messages as read" },
  ];

  const seen = new Set(commands.map((command) => command.name));
  const gatewayCommands = options.cfg ? listChatCommandsForConfig(options.cfg) : listChatCommands();
  for (const command of gatewayCommands) {
    const aliases = command.textAliases.length > 0 ? command.textAliases : [`/${command.key}`];
    for (const alias of aliases) {
      const name = alias.replace(/^\//, "").trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      commands.push({ name, description: command.description });
    }
  }

  return commands;
}

export function helpText(options: SlashCommandOptions = {}): string {
  const thinkLevels = formatThinkingLevels(options.provider, options.model, "|");
  return [
    "Slash commands:",
    "/help",
    "/commands",
    "/status",
    "/agent <id> (or /agents)",
    "/sessions (switcher), /sessions new [key], /session <key>, /attach <key>",
    "/model <provider/model> (or /models)",
    "/jobs, /cancel [job-id]",
    "/evidence <job-id> (replay stepper: /evidence next | prev | jump <step>)",
    "/factory [board] (the board as a table), /factory show <card-id>",
    "/clear (screen only)",
    "/diff <on|off>",
    "/theme <name|path> (built-in names or a JSON theme file)",
    "/keys",
    "/export [md|json] [path] (transcript to a file, secrets redacted)",
    "/editor (open the prompt in $VISUAL or $EDITOR)",
    "/undo, /redo (file snapshots taken before tool edits)",
    "/snapshots [restore <id>]",
    `/think <${thinkLevels}>`,
    "/verbose <on|off>",
    "/reasoning <on|off|collapsed|expanded>",
    "/usage <off|tokens|full>",
    "/elevated <on|off|ask|full>",
    "/elev <on|off|ask|full>",
    "/activation <mention|always>",
    "/new [key] or /reset",
    "/abort",
    "/settings",
    "/exit",
  ].join("\n");
}
