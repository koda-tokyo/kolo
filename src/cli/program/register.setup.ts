import type { Command } from "commander";
import type { Residency } from "../../model-bench/catalogue.js";
import {
  initCommand,
  type InitBindPolicy,
  type InitOptions,
  type InitProviderProfile,
} from "../../commands/init.js";
import { onboardCommand } from "../../commands/onboard.js";
import { setupCommand } from "../../commands/setup.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { hasExplicitOptions } from "../command-options.js";

export function registerSetupCommand(program: Command) {
  program
    .command("init")
    .description("First run: create the state directory, config and gateway token")
    .option("--non-interactive", "No prompts; take values from flags and defaults", false)
    .option("--name <id>", "Identity name, also the service id (default: default)")
    .option("--state-dir <dir>", "State directory for this run (default: KOLO_HOME)")
    .option(
      "--bind <policy>",
      "Who may reach the gateway: loopback | lan | tailnet | custom | remote (alias of lan; default: loopback)",
    )
    .option(
      "--provider <profile>",
      "Model provider profile: sakura | openai-compatible | local | koda-tested (key from SAKURA_API_KEY / KOLO_PROVIDER_API_KEY; koda-tested uses the keys already set)",
    )
    .option(
      "--residency <region>",
      "koda-tested: only models processed in jp | eu | us | cn | sg | local",
    )
    .option("--provider-base-url <url>", "openai-compatible: base URL ending in /v1")
    .option("--provider-model <id>", "openai-compatible or local: model id")
    .option(
      "--phone <channel>",
      "Last step, connect your phone: whatsapp | telegram | line | web | skip (default: ask when interactive)",
    )
    .option("--force", "Rewrite an existing config instead of merging into it", false)
    .option("--json", "Print the result as JSON", false)
    .option("--lang <code>", "Message language: en | ja", undefined)
    .addHelpText("after", () =>
      [
        "",
        "Examples:",
        "  kurahi init",
        "  kurahi init --non-interactive --name alice --bind loopback",
        "  kurahi init --non-interactive --state-dir /srv/kolo/ops-bot --name ops-bot",
        "  TELEGRAM_BOT_TOKEN=<token> kurahi init --non-interactive --phone telegram",
        "",
        `${theme.muted("Docs:")} ${formatDocsLink("/start/getting-started")}`,
        "",
      ].join("\n"),
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await initCommand(
          {
            nonInteractive: Boolean(opts.nonInteractive),
            name: opts.name as string | undefined,
            stateDir: opts.stateDir as string | undefined,
            bind: opts.bind as InitBindPolicy | undefined,
            provider: opts.provider as InitProviderProfile | undefined,
            residency: opts.residency as Residency | undefined,
            providerBaseUrl: opts.providerBaseUrl as string | undefined,
            providerModel: opts.providerModel as string | undefined,
            force: Boolean(opts.force),
            json: Boolean(opts.json),
            phone: opts.phone as InitOptions["phone"],
          },
          defaultRuntime,
        );
      });
    });

  program
    .command("setup")
    .description("Initialize ~/.kolo/kolo.json and the agent workspace")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/setup")}\n`)
    .option(
      "--workspace <dir>",
      "Agent workspace directory (default: ~/.kolo/workspace; stored as agents.defaults.workspace)",
    )
    .option("--wizard", "Run the interactive onboarding wizard", false)
    .option("--non-interactive", "Run the wizard without prompts", false)
    .option("--mode <mode>", "Wizard mode: local|remote")
    .option("--remote-url <url>", "Remote Gateway WebSocket URL")
    .option("--remote-token <token>", "Remote Gateway token (optional)")
    .action(async (opts, command) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        const hasWizardFlags = hasExplicitOptions(command, [
          "wizard",
          "nonInteractive",
          "mode",
          "remoteUrl",
          "remoteToken",
        ]);
        if (opts.wizard || hasWizardFlags) {
          await onboardCommand(
            {
              workspace: opts.workspace as string | undefined,
              nonInteractive: Boolean(opts.nonInteractive),
              mode: opts.mode as "local" | "remote" | undefined,
              remoteUrl: opts.remoteUrl as string | undefined,
              remoteToken: opts.remoteToken as string | undefined,
            },
            defaultRuntime,
          );
          return;
        }
        await setupCommand({ workspace: opts.workspace as string | undefined }, defaultRuntime);
      });
    });
}
