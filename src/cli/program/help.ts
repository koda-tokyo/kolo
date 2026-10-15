import type { Command } from "commander";
import type { ProgramContext } from "./context.js";
import { t } from "../../i18n/index.js";
import { formatDocsLink } from "../../terminal/links.js";
import { isRich, theme } from "../../terminal/theme.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import { replaceCliName, resolveCliName } from "../cli-name.js";

const CLI_NAME = resolveCliName();

const EXAMPLES = [
  ["kurahi init", "help.ex.init"],
  ["kurahi service install", "help.ex.service"],
  ["kurahi health", "help.ex.health"],
  ["kurahi pair invite --scope attach", "help.ex.pair"],
  ["kurahi attach --list", "help.ex.attach"],
  ["kurahi tui", "help.ex.tui"],
  [
    'kurahi message send --channel telegram --target @ops-channel --message "Deploy done"',
    "help.ex.message",
  ],
  ["kurahi api health --raw", "help.ex.api"],
] as const;

export function configureProgramHelp(program: Command, ctx: ProgramContext) {
  program
    .name(CLI_NAME)
    .description("")
    .version(ctx.programVersion)
    .option(
      "--dev",
      "Dev profile: isolate state under ~/.kolo-dev, default gateway port 19001, and shift derived ports (browser/canvas)",
    )
    .option(
      "--profile <name>",
      "Use a named profile (isolates KOLO_STATE_DIR/KOLO_CONFIG_PATH under ~/.kolo-<name>)",
    );

  program.option("--no-color", "Disable ANSI colors", false);
  program.option(
    "--lang <code>",
    "Message language: en | ja (default: KOLO_LANG or the OS locale)",
  );

  program.configureHelp({
    optionTerm: (option) => theme.option(option.flags),
    subcommandTerm: (cmd) => theme.command(cmd.name()),
  });

  program.configureOutput({
    writeOut: (str) => {
      const colored = str
        .replace(/^Usage:/gm, theme.heading("Usage:"))
        .replace(/^Options:/gm, theme.heading("Options:"))
        .replace(/^Commands:/gm, theme.heading("Commands:"));
      process.stdout.write(colored);
    },
    writeErr: (str) => process.stderr.write(str),
    outputError: (str, write) => write(theme.error(str)),
  });

  if (
    process.argv.includes("-V") ||
    process.argv.includes("--version") ||
    process.argv.includes("-v")
  ) {
    console.log(ctx.programVersion);
    process.exit(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner()) {
      return "";
    }
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, { richTty: rich });
    return `\n${line}\n`;
  });

  const fmtExamples = EXAMPLES.map(
    ([cmd, key]) => `  ${theme.command(replaceCliName(cmd, CLI_NAME))}\n    ${theme.muted(t(key))}`,
  ).join("\n");

  program.addHelpText("afterAll", ({ command }) => {
    if (command !== program) {
      return "";
    }
    const docs = formatDocsLink("/cli");
    return `\n${theme.heading(t("help.examples"))}\n${fmtExamples}\n\n${theme.muted(t("help.docs"))} ${docs}\n`;
  });
}
