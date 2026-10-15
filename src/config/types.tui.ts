export const TUI_THEME_NAMES = [
  "dark",
  "light",
  "high-contrast",
  "dusk",
  "forest",
  "ocean",
  "paper",
  "mono",
] as const;
export type TuiThemeName = (typeof TUI_THEME_NAMES)[number];

/** Actions a key can be bound to in `kurahi tui` (`tui.keybinds`). Order decides conflict winners. */
export const TUI_KEYBIND_ACTIONS = [
  "sessions",
  "models",
  "agents",
  "toggleTools",
  "toggleThinking",
  "toggleReasoning",
  "toggleDiff",
  "abort",
  "exit",
  "clearInput",
  "help",
  "status",
  "jobs",
  "settings",
  "toggleUsage",
  "cycleTheme",
  "keys",
  "newSession",
  "clearScreen",
  "export",
  "editor",
  "undo",
  "redo",
  "snapshots",
] as const;
export type TuiKeybindAction = (typeof TUI_KEYBIND_ACTIONS)[number];

export const TUI_KEYBIND_DESCRIPTIONS: Readonly<Record<TuiKeybindAction, string>> = {
  sessions: "open the session switcher",
  models: "open the model picker",
  agents: "open the agent picker",
  toggleTools: "expand or collapse tool cards",
  toggleThinking: "show or hide reasoning blocks",
  toggleReasoning: "expand or collapse the latest reasoning block",
  toggleDiff: "show or hide diffs under file edits",
  abort: "abort the active run",
  exit: "exit when the input is empty",
  clearInput: "clear the input; twice on an empty input exits",
  help: "show the slash command help",
  status: "show the gateway status summary",
  jobs: "list jobs on the gateway",
  settings: "open the settings panel",
  toggleUsage: "cycle the usage footer (off, tokens, full)",
  cycleTheme: "switch to the next built-in theme",
  keys: "print this table",
  newSession: "reset the session",
  clearScreen: "clear the screen (the session is kept)",
  export: "write the transcript to a file",
  editor: "edit the prompt in an external editor",
  undo: "restore the files of the last tool edit",
  redo: "put the last undone edit back",
  snapshots: "list file snapshots",
};

/** `tui.keybinds`: `leader` plus one entry per action (a key id, `leader+<key>`, or a list). */
export type TuiKeybindsConfig = Partial<Record<TuiKeybindAction, string | string[]>> & {
  /** Leader key for chords (default `ctrl+x`); an empty string turns chords off. */
  leader?: string;
};

export type TuiConfig = {
  /** Built-in theme name (default `dark`) or the path to a JSON theme file. */
  theme?: TuiThemeName | (string & {});
  /** Action to key id (`ctrl+p`, `alt+enter`, `f2`), `leader+<key>` for a chord, or a list. */
  keybinds?: TuiKeybindsConfig;
  /** Show unified diffs for file edits produced by tools (default true). */
  diffs?: boolean;
  /** Reasoning blocks shown above answers. */
  reasoning?: TuiReasoningConfig;
};

export type TuiReasoningConfig = {
  /** Lines one reasoning block may take on screen, expanded (default 400). */
  maxLines?: number;
};
