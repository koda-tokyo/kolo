import type {
  EditorTheme,
  MarkdownTheme,
  SelectListTheme,
  SettingsListTheme,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import { highlight, supportsLanguage } from "cli-highlight";
import type { SearchableSelectListTheme } from "../components/searchable-select-list.js";
import {
  isTuiThemeName,
  TUI_PALETTES,
  TUI_THEME_NAMES,
  type TuiPalette,
  type TuiThemeName,
} from "./palettes.js";
import { createSyntaxTheme } from "./syntax-theme.js";

export { TUI_THEME_NAMES, isTuiThemeName };
export type { TuiThemeName };

// The palette is mutable so `/theme` and `tui.theme` can switch it at runtime without every
// component re-importing. Every exported style function reads `palette` at call time.
let currentThemeName: string = "dark";
let palette: TuiPalette = TUI_PALETTES.dark;

export function setTheme(name: TuiThemeName): void {
  currentThemeName = name;
  palette = TUI_PALETTES[name];
}

/** Apply a palette from a theme file (M10); `name` is what `/theme` and the status line show. */
export function setThemePalette(name: string, next: TuiPalette): void {
  currentThemeName = name;
  palette = { ...next };
}

export function getThemeName(): string {
  return currentThemeName;
}

export function getPalette(): TuiPalette {
  return { ...palette };
}

/** Resolve a configured theme name; unknown values fall back to `dark`. */
export function resolveThemeName(value: unknown): TuiThemeName {
  return isTuiThemeName(value) ? value : "dark";
}

type Color = keyof TuiPalette;
const fg = (key: Color) => (text: string) => chalk.hex(palette[key])(text);
const bg = (key: Color) => (text: string) => chalk.bgHex(palette[key])(text);

const syntaxTheme = createSyntaxTheme((text) => fg("code")(text));

/**
 * Highlight code with syntax coloring.
 * Returns an array of lines with ANSI escape codes.
 */
function highlightCode(code: string, lang?: string): string[] {
  try {
    // Auto-detect can be slow for very large blocks; prefer explicit language when available.
    const language = lang && supportsLanguage(lang) ? lang : undefined;
    const highlighted = highlight(code, {
      language,
      theme: syntaxTheme,
      ignoreIllegals: true,
    });
    return highlighted.split("\n");
  } catch {
    // If highlighting fails, return plain code
    return code.split("\n").map((line) => fg("code")(line));
  }
}

export const theme = {
  fg: fg("text"),
  dim: fg("dim"),
  accent: fg("accent"),
  accentSoft: fg("accentSoft"),
  success: fg("success"),
  error: fg("error"),
  header: (text: string) => chalk.bold(fg("accent")(text)),
  system: fg("systemText"),
  userBg: bg("userBg"),
  userText: fg("userText"),
  toolTitle: fg("toolTitle"),
  toolOutput: fg("toolOutput"),
  toolPendingBg: bg("toolPendingBg"),
  toolSuccessBg: bg("toolSuccessBg"),
  toolErrorBg: bg("toolErrorBg"),
  border: fg("border"),
  diffAdded: fg("diffAdded"),
  diffRemoved: fg("diffRemoved"),
  diffHunk: fg("diffHunk"),
  diffContext: fg("diffContext"),
  reasoning: fg("reasoning"),
  banner: (text: string) => chalk.bold(bg("bannerBg")(fg("banner")(text))),
  bold: (text: string) => chalk.bold(text),
  italic: (text: string) => chalk.italic(text),
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold(fg("accent")(text)),
  link: (text) => fg("link")(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => fg("code")(text),
  codeBlock: (text) => fg("code")(text),
  codeBlockBorder: (text) => fg("codeBorder")(text),
  quote: (text) => fg("quote")(text),
  quoteBorder: (text) => fg("quoteBorder")(text),
  hr: (text) => fg("border")(text),
  listBullet: (text) => fg("accentSoft")(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
  highlightCode,
};

export const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => fg("accent")(text),
  selectedText: (text) => chalk.bold(fg("accent")(text)),
  description: (text) => fg("dim")(text),
  scrollInfo: (text) => fg("dim")(text),
  noMatch: (text) => fg("dim")(text),
};

export const filterableSelectListTheme = {
  ...selectListTheme,
  filterLabel: (text: string) => fg("dim")(text),
};

export const settingsListTheme: SettingsListTheme = {
  label: (text, selected) => (selected ? chalk.bold(fg("accent")(text)) : fg("text")(text)),
  value: (text, selected) => (selected ? fg("accentSoft")(text) : fg("dim")(text)),
  description: (text) => fg("systemText")(text),
  cursor: fg("accent")("> "),
  hint: (text) => fg("dim")(text),
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => fg("border")(text),
  selectList: selectListTheme,
};

export const searchableSelectListTheme: SearchableSelectListTheme = {
  selectedPrefix: (text) => fg("accent")(text),
  selectedText: (text) => chalk.bold(fg("accent")(text)),
  description: (text) => fg("dim")(text),
  scrollInfo: (text) => fg("dim")(text),
  noMatch: (text) => fg("dim")(text),
  searchPrompt: (text) => fg("accentSoft")(text),
  searchInput: (text) => fg("text")(text),
  matchHighlight: (text) => chalk.bold(fg("accent")(text)),
};
