import { type KeyId, matchesKey } from "@mariozechner/pi-tui";
import {
  TUI_KEYBIND_ACTIONS,
  TUI_KEYBIND_DESCRIPTIONS,
  type TuiKeybindAction,
  type TuiKeybindsConfig,
} from "../config/types.tui.js";

export type { TuiKeybindAction };

/**
 * Key bindings for `kurahi tui` (KoLo 2.0, M9a; leader chords in M10). Every action has a direct
 * key and a leader chord: press the leader (`tui.keybinds.leader`, default `ctrl+x`) and then one
 * key. Configuration values are a key id, a chord (`leader+<key>`), or an array of both.
 */

export const DEFAULT_TUI_LEADER = "ctrl+x";

/** Direct key per action; `null` when the action is reachable only through its chord. */
export const DEFAULT_TUI_KEYBINDS: Readonly<Record<TuiKeybindAction, string | null>> = {
  sessions: "ctrl+p",
  models: "ctrl+l",
  agents: "ctrl+g",
  // ctrl+o follows the common terminal-agent convention: expand the detail you just saw.
  toggleTools: "alt+o",
  toggleThinking: "ctrl+t",
  toggleReasoning: "ctrl+o",
  toggleDiff: "ctrl+y",
  abort: "escape",
  exit: "ctrl+d",
  clearInput: "ctrl+c",
  help: "f1",
  status: "f2",
  jobs: "f3",
  settings: "f4",
  toggleUsage: "f5",
  cycleTheme: "f6",
  keys: "f7",
  newSession: "ctrl+n",
  clearScreen: "ctrl+r",
  export: "f8",
  editor: "alt+e",
  undo: "alt+z",
  redo: "alt+r",
  snapshots: "f9",
};

/** Chord key (after the leader) per action. */
export const DEFAULT_TUI_CHORDS: Readonly<Record<TuiKeybindAction, string>> = {
  sessions: "s",
  models: "m",
  agents: "a",
  toggleTools: "o",
  toggleThinking: "t",
  toggleReasoning: "f",
  toggleDiff: "d",
  abort: ".",
  exit: "q",
  clearInput: "u",
  help: "h",
  status: "i",
  jobs: "j",
  settings: ",",
  toggleUsage: "g",
  cycleTheme: "c",
  keys: "k",
  newSession: "n",
  clearScreen: "l",
  export: "e",
  editor: "v",
  undo: "z",
  redo: "r",
  snapshots: "p",
};

const SPECIAL_KEYS = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);
const SPECIAL_CANONICAL: Record<string, string> = { pageup: "pageUp", pagedown: "pageDown" };
const MODIFIERS = new Set(["ctrl", "alt", "shift"]);

/**
 * Normalise a key id such as `Ctrl+Shift+P` or `alt+enter` into the form pi-tui matches.
 * Returns null for anything that is not a single key with optional modifiers.
 */
export function parseKeyId(raw: string): KeyId | null {
  const parts = raw
    .trim()
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const base = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (mods.some((m) => !MODIFIERS.has(m)) || new Set(mods).size !== mods.length) {
    return null;
  }
  const isLetter = /^[a-z]$/.test(base);
  const isSymbol = base.length === 1 && !isLetter && base !== " ";
  const isSpecial = SPECIAL_KEYS.has(base);
  if (!isLetter && !isSymbol && !isSpecial) {
    return null;
  }
  const canonicalBase = SPECIAL_CANONICAL[base] ?? base;
  const order = ["ctrl", "shift", "alt"].filter((m) => mods.includes(m));
  return [...order, canonicalBase].join("+") as KeyId;
}

export type KeyBinding = { key: KeyId; chord: boolean };

/**
 * Parse one configured binding: a key id, or `leader+<key>` for a chord. Null when invalid.
 * The chord key is itself a key id, so `leader+ctrl+s` is allowed.
 */
export function parseBinding(raw: string): KeyBinding | null {
  const trimmed = raw.trim();
  const match = /^leader\s*\+\s*(.+)$/i.exec(trimmed);
  if (match) {
    const key = parseKeyId(match[1]);
    return key ? { key, chord: true } : null;
  }
  const key = parseKeyId(trimmed);
  return key ? { key, chord: false } : null;
}

export function formatBinding(binding: KeyBinding, leader: KeyId | null): string {
  if (!binding.chord) {
    return binding.key;
  }
  return `${leader ?? "leader"} ${binding.key}`;
}

export type ResolvedKeybinds = {
  /** Action to its bindings (direct keys and chords), defaults merged with configuration. */
  bindings: Record<TuiKeybindAction, KeyBinding[]>;
  /** The leader key; null when chords are disabled (`"leader": ""`). */
  leader: KeyId | null;
  /** One line per problem found in the configuration (unknown action, bad key, conflict). */
  warnings: string[];
};

function defaultsFor(action: TuiKeybindAction): KeyBinding[] {
  const list: KeyBinding[] = [];
  const direct = DEFAULT_TUI_KEYBINDS[action];
  if (direct) {
    list.push({ key: parseKeyId(direct) as KeyId, chord: false });
  }
  list.push({ key: parseKeyId(DEFAULT_TUI_CHORDS[action]) as KeyId, chord: true });
  return list;
}

export function resolveKeybinds(configured?: TuiKeybindsConfig | null): ResolvedKeybinds {
  const warnings: string[] = [];
  const bindings = {} as Record<TuiKeybindAction, KeyBinding[]>;
  for (const action of TUI_KEYBIND_ACTIONS) {
    bindings[action] = defaultsFor(action);
  }
  let leader: KeyId | null = parseKeyId(DEFAULT_TUI_LEADER);
  for (const [action, value] of Object.entries(configured ?? {})) {
    if (action === "leader") {
      if (typeof value !== "string") {
        warnings.push("tui.keybinds.leader must be a key id; keeping the default");
        continue;
      }
      if (value.trim() === "") {
        leader = null;
        continue;
      }
      const key = parseKeyId(value);
      if (!key) {
        warnings.push(`tui.keybinds.leader: "${value}" is not a key id; keeping the default`);
        continue;
      }
      leader = key;
      continue;
    }
    if (!(TUI_KEYBIND_ACTIONS as readonly string[]).includes(action)) {
      warnings.push(`tui.keybinds: unknown action "${action}" ignored`);
      continue;
    }
    const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    if (values.length === 0) {
      continue;
    }
    const parsed: KeyBinding[] = [];
    for (const raw of values) {
      if (typeof raw !== "string") {
        continue;
      }
      const binding = parseBinding(raw);
      if (!binding) {
        warnings.push(`tui.keybinds.${action}: "${raw}" is not a key id; keeping the default`);
        continue;
      }
      parsed.push(binding);
    }
    if (parsed.length > 0) {
      // A configured direct key replaces the default direct key and a configured chord replaces
      // the default chord; the other kind keeps its default.
      const hasDirect = parsed.some((b) => !b.chord);
      const hasChord = parsed.some((b) => b.chord);
      const kept = bindings[action as TuiKeybindAction].filter(
        (b) => (b.chord && !hasChord) || (!b.chord && !hasDirect),
      );
      bindings[action as TuiKeybindAction] = [...kept, ...parsed];
    }
  }
  if (leader === null) {
    for (const action of TUI_KEYBIND_ACTIONS) {
      bindings[action] = bindings[action].filter((binding) => !binding.chord);
    }
  }
  // Conflicts: the last action in declaration order keeps the key; the earlier one loses that
  // binding. Direct keys and chord keys are separate namespaces. The leader itself and escape
  // (which cancels a pending chord) are reserved.
  const seen = new Map<string, TuiKeybindAction>();
  for (const action of TUI_KEYBIND_ACTIONS) {
    bindings[action] = bindings[action].filter((binding) => {
      if (binding.chord && binding.key === "escape") {
        warnings.push(
          `tui.keybinds.${action}: escape cannot be a chord key (it cancels the chord)`,
        );
        return false;
      }
      if (!binding.chord && leader && binding.key === leader) {
        warnings.push(`tui.keybinds.${action}: ${leader} is the leader key; binding dropped`);
        return false;
      }
      return true;
    });
  }
  for (const action of TUI_KEYBIND_ACTIONS) {
    for (const binding of bindings[action]) {
      const slot = `${binding.chord ? "chord" : "key"}:${binding.key}`;
      const previous = seen.get(slot);
      if (previous && previous !== action) {
        const label = formatBinding(binding, leader);
        warnings.push(
          `tui.keybinds: ${label} is bound to both ${previous} and ${action}; ${action} wins`,
        );
        bindings[previous] = bindings[previous].filter(
          (other) => !(other.chord === binding.chord && other.key === binding.key),
        );
      }
      seen.set(slot, action);
    }
  }
  return { bindings, leader, warnings };
}

/** Return the action bound directly to this raw terminal input, if any. */
export function matchAction(
  data: string,
  bindings: Partial<Record<TuiKeybindAction, KeyBinding[]>>,
): TuiKeybindAction | null {
  for (const action of TUI_KEYBIND_ACTIONS) {
    for (const binding of bindings[action] ?? []) {
      if (!binding.chord && matchesKey(data, binding.key)) {
        return action;
      }
    }
  }
  return null;
}

/** Return the action whose chord key matches this input (the leader was already pressed). */
export function matchChord(
  data: string,
  bindings: Partial<Record<TuiKeybindAction, KeyBinding[]>>,
): TuiKeybindAction | null {
  for (const action of TUI_KEYBIND_ACTIONS) {
    for (const binding of bindings[action] ?? []) {
      if (binding.chord && matchesKey(data, binding.key)) {
        return action;
      }
    }
  }
  return null;
}

/** The `/keys` table: action, direct key, chord, description. */
export function formatKeybinds(
  bindings: Partial<Record<TuiKeybindAction, KeyBinding[]>>,
  leader: KeyId | null = parseKeyId(DEFAULT_TUI_LEADER),
): string[] {
  const rows = TUI_KEYBIND_ACTIONS.map((action) => {
    const list = bindings[action] ?? [];
    const direct = list.filter((b) => !b.chord).map((b) => b.key);
    const chords = list.filter((b) => b.chord).map((b) => formatBinding(b, leader));
    return `${action.padEnd(15)} ${(direct.join(", ") || "unbound").padEnd(14)} ${(
      chords.join(", ") || "-"
    ).padEnd(14)} ${TUI_KEYBIND_DESCRIPTIONS[action]}`;
  });
  const header = `${"action".padEnd(15)} ${"key".padEnd(14)} ${"chord".padEnd(14)} what it does`;
  const leaderLine = leader ? `leader: ${leader} (then one key; escape cancels)` : "leader: off";
  return [header, ...rows, leaderLine];
}
