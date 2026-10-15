import fs from "node:fs";
import path from "node:path";
import {
  isTuiThemeName,
  TUI_PALETTE_KEYS,
  TUI_PALETTES,
  TUI_THEME_NAMES,
  type TuiPalette,
  type TuiThemeName,
} from "./palettes.js";

/**
 * Theme files (KoLo 2.0, M10). A theme is a JSON document:
 *
 *   { "name": "mine", "base": "dark", "palette": { "accent": "#FF8800", ... } }
 *
 * `base` is a built-in theme the palette is merged over (default `dark`), so a file needs only
 * the tokens it changes. Colours are `#RGB` or `#RRGGBB`. `tui.theme` and `/theme` accept either
 * a built-in name or a path to such a file; `kurahi tui themes export <name>` writes one.
 */

export type ThemeDocument = {
  name: string;
  base: TuiThemeName;
  palette: Partial<TuiPalette>;
};

export type ResolvedTheme = {
  /** Display name: the built-in name, or the file's `name`, or the file's base name. */
  name: string;
  palette: TuiPalette;
  /** Source: `built-in` or the absolute file path. */
  source: string;
  /** Problems that did not prevent loading (unknown tokens). */
  warnings: string[];
};

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const THEME_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_THEME_FILE_BYTES = 64 * 1024;

/** True when `tui.theme` looks like a file path rather than a built-in name. */
export function isThemePath(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.toLowerCase().endsWith(".json") || trimmed.includes("/") || trimmed.includes("\\");
}

/** Parse a theme document. Throws an Error with a one-line message on invalid input. */
export function parseThemeDocument(
  text: string,
  options: { fallbackName?: string } = {},
): { document: ThemeDocument; warnings: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("theme file is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("theme file must be a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const base = record.base ?? "dark";
  if (!isTuiThemeName(base)) {
    throw new Error(`theme base must be one of ${TUI_THEME_NAMES.join(", ")}`);
  }
  const nameRaw = record.name ?? options.fallbackName ?? "custom";
  if (typeof nameRaw !== "string" || !THEME_NAME.test(nameRaw)) {
    throw new Error("theme name must be lowercase letters, digits and dashes (max 40)");
  }
  const paletteRaw = record.palette ?? {};
  if (!paletteRaw || typeof paletteRaw !== "object" || Array.isArray(paletteRaw)) {
    throw new Error("theme palette must be an object of token to colour");
  }
  const palette: Partial<TuiPalette> = {};
  for (const [key, value] of Object.entries(paletteRaw as Record<string, unknown>)) {
    if (!(TUI_PALETTE_KEYS as string[]).includes(key)) {
      warnings.push(`unknown palette token "${key}" ignored`);
      continue;
    }
    if (typeof value !== "string" || !HEX_COLOUR.test(value.trim())) {
      throw new Error(`palette.${key} must be a hex colour such as #RRGGBB`);
    }
    palette[key as keyof TuiPalette] = value.trim().toUpperCase();
  }
  for (const key of Object.keys(record)) {
    if (!["name", "base", "palette", "$comment"].includes(key)) {
      warnings.push(`unknown theme field "${key}" ignored`);
    }
  }
  return { document: { name: nameRaw, base, palette }, warnings };
}

export function paletteFromDocument(document: ThemeDocument): TuiPalette {
  return { ...TUI_PALETTES[document.base], ...document.palette };
}

/** Load and validate a theme file. Throws on a missing or invalid file. */
export function loadThemeFile(filePath: string, options: { cwd?: string } = {}): ResolvedTheme {
  const absolute = path.resolve(options.cwd ?? process.cwd(), filePath.trim());
  let text: string;
  try {
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_THEME_FILE_BYTES) {
      throw new Error(`theme file is larger than ${MAX_THEME_FILE_BYTES} bytes`);
    }
    text = fs.readFileSync(absolute, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(`theme file not found: ${absolute}`, { cause: err });
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
  const fallbackName = path
    .basename(absolute)
    .replace(/\.json$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const { document, warnings } = parseThemeDocument(text, {
    fallbackName: fallbackName || "custom",
  });
  return {
    name: document.name,
    palette: paletteFromDocument(document),
    source: absolute,
    warnings,
  };
}

/**
 * Resolve a `tui.theme` value (built-in name or file path). Never throws: a bad value yields the
 * `dark` theme and one error line the caller shows as a system message.
 */
export function resolveTheme(
  value: unknown,
  options: { cwd?: string } = {},
): ResolvedTheme & { error?: string } {
  const builtIn = (name: TuiThemeName): ResolvedTheme => ({
    name,
    palette: TUI_PALETTES[name],
    source: "built-in",
    warnings: [],
  });
  if (value === undefined || value === null || value === "") {
    return builtIn("dark");
  }
  if (typeof value !== "string") {
    return { ...builtIn("dark"), error: "tui.theme must be a theme name or a file path" };
  }
  const trimmed = value.trim();
  if (isTuiThemeName(trimmed)) {
    return builtIn(trimmed);
  }
  if (!isThemePath(trimmed)) {
    return {
      ...builtIn("dark"),
      error: `unknown theme ${trimmed}. Available: ${TUI_THEME_NAMES.join(", ")}, or a path to a theme file`,
    };
  }
  try {
    return loadThemeFile(trimmed, options);
  } catch (err) {
    return { ...builtIn("dark"), error: `tui.theme: ${(err as Error).message}` };
  }
}

/** The JSON text `kurahi tui themes export` writes for a built-in theme. */
export function exportThemeDocument(name: TuiThemeName): string {
  const palette = TUI_PALETTES[name];
  const ordered: Record<string, string> = {};
  for (const key of TUI_PALETTE_KEYS) {
    ordered[key] = palette[key];
  }
  return `${JSON.stringify({ name, base: name, palette: ordered }, null, 2)}\n`;
}
