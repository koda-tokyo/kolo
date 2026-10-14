import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TUI_THEME_NAMES as CONFIG_THEME_NAMES } from "../../config/types.tui.js";
import { TUI_PALETTE_KEYS, TUI_PALETTES, TUI_THEME_NAMES } from "./palettes.js";
import {
  exportThemeDocument,
  isThemePath,
  loadThemeFile,
  parseThemeDocument,
  resolveTheme,
} from "./theme-file.js";

const HEX = /^#[0-9A-F]{6}$/i;

describe("built-in palettes", () => {
  it("ships eight themes and the config enum matches", () => {
    expect(TUI_THEME_NAMES).toHaveLength(8);
    expect([...CONFIG_THEME_NAMES]).toEqual([...TUI_THEME_NAMES]);
  });

  it("defines every token with a six-digit hex colour", () => {
    for (const name of TUI_THEME_NAMES) {
      const palette = TUI_PALETTES[name];
      for (const key of TUI_PALETTE_KEYS) {
        expect(palette[key], `${name}.${key}`).toMatch(HEX);
      }
      expect(Object.keys(palette).toSorted()).toEqual([...TUI_PALETTE_KEYS].toSorted());
    }
  });
});

describe("parseThemeDocument", () => {
  it("merges a partial palette over the base", () => {
    const { document, warnings } = parseThemeDocument(
      JSON.stringify({ name: "mine", base: "light", palette: { accent: "#ff8800" } }),
    );
    expect(warnings).toEqual([]);
    expect(document.base).toBe("light");
    expect(document.palette.accent).toBe("#FF8800");
  });

  it("warns on unknown tokens and fields, rejects bad colours and bases", () => {
    const { warnings } = parseThemeDocument(
      JSON.stringify({ palette: { nope: "#000000" }, extra: 1 }),
      { fallbackName: "x" },
    );
    expect(warnings).toEqual([
      'unknown palette token "nope" ignored',
      'unknown theme field "extra" ignored',
    ]);
    expect(() => parseThemeDocument(JSON.stringify({ palette: { accent: "red" } }))).toThrow(
      /palette\.accent must be a hex colour/,
    );
    expect(() => parseThemeDocument(JSON.stringify({ base: "solarized" }))).toThrow(
      /theme base must be one of/,
    );
    expect(() => parseThemeDocument("{")).toThrow(/not valid JSON/);
    expect(() => parseThemeDocument("[]")).toThrow(/JSON object/);
    expect(() => parseThemeDocument(JSON.stringify({ name: "Bad Name" }))).toThrow(/theme name/);
  });
});

describe("theme files", () => {
  let dir = "";
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-theme-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("isThemePath recognises paths, not names", () => {
    expect(isThemePath("dark")).toBe(false);
    expect(isThemePath("mine.json")).toBe(true);
    expect(isThemePath("./themes/x")).toBe(true);
    expect(isThemePath("C:\\themes\\x")).toBe(true);
  });

  it("loads a file, names it after the file when unnamed, and round-trips an export", () => {
    const file = path.join(dir, "Sunset Glow.json");
    fs.writeFileSync(file, JSON.stringify({ base: "dusk", palette: { text: "#FFF" } }));
    const loaded = loadThemeFile(file);
    expect(loaded.name).toBe("sunset-glow");
    expect(loaded.palette.text).toBe("#FFF");
    expect(loaded.palette.accent).toBe(TUI_PALETTES.dusk.accent);
    expect(loaded.source).toBe(file);

    const exported = path.join(dir, "ocean.json");
    fs.writeFileSync(exported, exportThemeDocument("ocean"));
    const reloaded = loadThemeFile(exported);
    expect(reloaded.name).toBe("ocean");
    expect(reloaded.palette).toEqual(TUI_PALETTES.ocean);
  });

  it("resolveTheme never throws and falls back to dark with one error line", () => {
    expect(resolveTheme(undefined).name).toBe("dark");
    expect(resolveTheme("paper").palette).toEqual(TUI_PALETTES.paper);
    const unknown = resolveTheme("solarized");
    expect(unknown.name).toBe("dark");
    expect(unknown.error).toContain("unknown theme solarized");
    const missing = resolveTheme(path.join(dir, "missing.json"));
    expect(missing.name).toBe("dark");
    expect(missing.error).toContain("theme file not found");
    const relative = resolveTheme("rel.json", { cwd: dir });
    expect(relative.error).toContain(path.join(dir, "rel.json"));
  });
});
