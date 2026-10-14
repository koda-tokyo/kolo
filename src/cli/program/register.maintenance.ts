import type { Command } from "commander";
import { dashboardCommand } from "../../commands/dashboard.js";
import { buildDoctorJsonReport } from "../../commands/doctor-json.js";
import { doctorCommand } from "../../commands/doctor.js";
import { resetCommand } from "../../commands/reset.js";
import { supportCommand } from "../../commands/support.js";
import { uninstallCommand } from "../../commands/uninstall.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerMaintenanceCommands(program: Command) {
  program
    .command("doctor")
    .description("Health checks + quick fixes for the gateway and channels")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/doctor")}\n`)
    .option("--no-workspace-suggestions", "Disable workspace memory system suggestions", false)
    .option("--yes", "Accept defaults without prompting", false)
    .option("--repair", "Apply recommended repairs without prompting", false)
    .option("--fix", "Apply recommended repairs (alias for --repair)", false)
    .option("--force", "Apply aggressive repairs (overwrites custom service config)", false)
    .option("--non-interactive", "Run without prompts (safe migrations only)", false)
    .option("--generate-gateway-token", "Generate and configure a gateway token", false)
    .option("--deep", "Scan system services for extra gateway installs", false)
    .option("--json", "Print a machine-readable report and exit (no prompts, no repairs)", false)
    .option("--lang <code>", "Message language: en | ja", undefined)
    .option(
      "--verbose",
      "Show every check and import credentials found in other CLI tools' files",
      false,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        if (opts.verbose) {
          const { setExternalCliSyncEnabled } =
            await import("../../agents/auth-profiles/external-cli-sync.js");
          setExternalCliSyncEnabled(true);
        }
        if (opts.json) {
          const report = await buildDoctorJsonReport();
          defaultRuntime.log(JSON.stringify(report, null, 2));
          defaultRuntime.exit(report.ok ? 0 : 1);
          return;
        }
        await doctorCommand(defaultRuntime, {
          workspaceSuggestions: opts.workspaceSuggestions,
          yes: Boolean(opts.yes),
          repair: Boolean(opts.repair) || Boolean(opts.fix),
          force: Boolean(opts.force),
          nonInteractive: Boolean(opts.nonInteractive),
          generateGatewayToken: Boolean(opts.generateGatewayToken),
          deep: Boolean(opts.deep),
        });
      });
    });

  program
    .command("support")
    .description(
      "Version, OS, state dir, integrity and service state, plus a redacted diagnostics bundle",
    )
    .option("--json", "Print the summary as JSON", false)
    .option(
      "--out <file>",
      "Bundle path (default: <KOLO_HOME>/support/kolo-support-<timestamp>.tar.gz)",
    )
    .option("--id <id>", "Service identity to report on (default: default)")
    .option("--no-bundle", "Print the summary only; write nothing")
    .option("--lang <code>", "Message language: en | ja", undefined)
    .addHelpText("after", () =>
      [
        "",
        "The bundle contains summary.json, config.redacted.json and the last 400 gateway log lines,",
        "with credential-looking values replaced. Attach it to a support ticket.",
        "",
        `${theme.muted("Docs:")} ${formatDocsLink("/help/troubleshooting")}`,
        "",
      ].join("\n"),
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await supportCommand(
          {
            json: Boolean(opts.json),
            out: opts.out as string | undefined,
            id: opts.id as string | undefined,
            noBundle: opts.bundle === false,
          },
          defaultRuntime,
        );
      });
    });

  program
    .command("dashboard")
    .description("Open the Control UI with your current token")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/dashboard")}\n`)
    .option("--no-open", "Print URL but do not launch a browser", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await dashboardCommand(defaultRuntime, {
          noOpen: Boolean(opts.noOpen),
        });
      });
    });

  program
    .command("reset")
    .description("Reset local config/state (keeps the CLI installed)")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/reset")}\n`)
    .option("--scope <scope>", "config|config+creds+sessions|full (default: interactive prompt)")
    .option("--yes", "Skip confirmation prompts", false)
    .option("--non-interactive", "Disable prompts (requires --scope + --yes)", false)
    .option("--dry-run", "Print actions without removing files", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await resetCommand(defaultRuntime, {
          scope: opts.scope,
          yes: Boolean(opts.yes),
          nonInteractive: Boolean(opts.nonInteractive),
          dryRun: Boolean(opts.dryRun),
        });
      });
    });

  program
    .command("uninstall")
    .description("Uninstall the gateway service + local data (CLI remains)")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/uninstall")}\n`)
    .option("--service", "Remove the gateway service", false)
    .option("--state", "Remove state + config", false)
    .option("--workspace", "Remove workspace dirs", false)
    .option("--app", "Remove the macOS app", false)
    .option("--all", "Remove service + state + workspace + app", false)
    .option("--yes", "Skip confirmation prompts", false)
    .option("--non-interactive", "Disable prompts (requires --yes)", false)
    .option("--dry-run", "Print actions without removing files", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await uninstallCommand(defaultRuntime, {
          service: Boolean(opts.service),
          state: Boolean(opts.state),
          workspace: Boolean(opts.workspace),
          app: Boolean(opts.app),
          all: Boolean(opts.all),
          yes: Boolean(opts.yes),
          nonInteractive: Boolean(opts.nonInteractive),
          dryRun: Boolean(opts.dryRun),
        });
      });
    });
}
