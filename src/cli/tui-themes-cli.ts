import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { TUI_THEME_NAMES } from "../config/types.tui.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { isTuiThemeName } from "../tui/theme/palettes.js";
import { exportThemeDocument, loadThemeFile } from "../tui/theme/theme-file.js";

/**
 * `kurahi tui themes list|export|check` (KoLo 2.0, M10). `export` writes a built-in theme as a JSON
 * theme file so it can be copied and edited; `check` validates a theme file without starting the
 * terminal UI.
 */
export function registerTuiThemesCli(tui: Command) {
  const themes = tui
    .command("themes")
    .description("Built-in terminal themes and theme files")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/tui")}\n`);

  themes
    .command("list")
    .alias("ls")
    .description("List the built-in themes")
    .option("--json", "Print as JSON", false)
    .action((opts: { json?: boolean }) => {
      if (opts.json) {
        defaultRuntime.log(JSON.stringify({ themes: [...TUI_THEME_NAMES] }));
        return;
      }
      for (const name of TUI_THEME_NAMES) {
        defaultRuntime.log(name);
      }
    });

  themes
    .command("export <name>")
    .description("Write a built-in theme as a JSON theme file (stdout by default)")
    .option("--out <path>", "Write to this file instead of stdout")
    .action((name: string, opts: { out?: string }) => {
      const key = name.trim().toLowerCase();
      if (!isTuiThemeName(key)) {
        defaultRuntime.error(
          `kurahi tui themes export: unknown theme ${name}. Available: ${TUI_THEME_NAMES.join(", ")}`,
        );
        defaultRuntime.exit(2);
        return;
      }
      const text = exportThemeDocument(key);
      if (!opts.out) {
        defaultRuntime.log(text.trimEnd());
        return;
      }
      const target = path.resolve(opts.out);
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, text, "utf8");
      } catch (err) {
        defaultRuntime.error(`kurahi tui themes export: cannot write ${target} (${String(err)})`);
        defaultRuntime.exit(1);
        return;
      }
      defaultRuntime.log(`wrote ${target}`);
    });

  themes
    .command("check <path>")
    .alias("test")
    .description("Validate a theme file and report the tokens it sets")
    .option("--json", "Print as JSON", false)
    .action((file: string, opts: { json?: boolean }) => {
      try {
        const resolved = loadThemeFile(file);
        if (opts.json) {
          defaultRuntime.log(
            JSON.stringify({
              ok: true,
              name: resolved.name,
              source: resolved.source,
              warnings: resolved.warnings,
            }),
          );
          return;
        }
        defaultRuntime.log(`name     ${resolved.name}`);
        defaultRuntime.log(`source   ${resolved.source}`);
        for (const warning of resolved.warnings) {
          defaultRuntime.log(`warning  ${warning}`);
        }
      } catch (err) {
        if (opts.json) {
          defaultRuntime.log(JSON.stringify({ ok: false, error: (err as Error).message }));
        } else {
          defaultRuntime.error(`kurahi tui themes check: ${(err as Error).message}`);
        }
        defaultRuntime.exit(1);
      }
    });
}
