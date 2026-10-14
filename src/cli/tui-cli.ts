import type { Command } from "commander";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runTui } from "../tui/tui.js";
import { parseTimeoutMs } from "./parse-timeout.js";
import { registerTuiThemesCli } from "./tui-themes-cli.js";

export function registerTuiCli(program: Command) {
  const tui = program
    .command("tui")
    .description("Open a terminal UI connected to the Gateway")
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option(
      "--token <token>",
      "Deprecated: leaks via ps. The TUI reads <KOLO_HOME>/secrets/gateway.token (or KOLO_GATEWAY_TOKEN_FILE / KOLO_GATEWAY_TOKEN)",
    )
    .option("--password <password>", "Gateway password (if required)")
    .option("--session <key>", 'Session key (default: "main", or "global" when scope is global)')
    .option("--deliver", "Deliver assistant replies", false)
    .option("--thinking <level>", "Thinking level override")
    .option("--message <text>", "Send an initial message after connecting")
    .option("--timeout-ms <ms>", "Agent timeout in ms (defaults to agents.defaults.timeoutSeconds)")
    .option("--history-limit <n>", "History entries to load", "200")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/tui")}\n`)
    .action(async (opts) => {
      try {
        const timeoutMs = parseTimeoutMs(opts.timeoutMs);
        if (opts.timeoutMs !== undefined && timeoutMs === undefined) {
          defaultRuntime.error(
            `warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`,
          );
        }
        if (typeof opts.token === "string" && opts.token.trim()) {
          defaultRuntime.error(
            "warning: --token is deprecated: the token is visible to every user via ps. " +
              "Use the gateway token file (<KOLO_HOME>/secrets/gateway.token, or KOLO_GATEWAY_TOKEN_FILE) or KOLO_GATEWAY_TOKEN.",
          );
        }
        const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
        await runTui({
          url: opts.url as string | undefined,
          token: opts.token as string | undefined,
          password: opts.password as string | undefined,
          session: opts.session as string | undefined,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking as string | undefined,
          message: opts.message as string | undefined,
          timeoutMs,
          historyLimit: Number.isNaN(historyLimit) ? undefined : historyLimit,
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
  registerTuiThemesCli(tui);
}
