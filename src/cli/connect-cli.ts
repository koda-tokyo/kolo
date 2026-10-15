// `kurahi connect <channel>` — connect a phone to the resident (KoLo 2.0, M16).
//
//   kurahi connect whatsapp|telegram|line|web [--account <id>] [--stdin] [--wait|--no-wait] [--json]
//   kurahi connect --unbind <channel> [--account <id>]
//   kurahi connect --list [--json]
import type { Command } from "commander";
import type { ConnectDeps } from "../commands/connect/types.js";
import {
  createDefaultConnectDeps,
  isPhoneChannel,
  listConnections,
  PHONE_CHANNELS,
  runConnect,
  runUnbind,
} from "../commands/connect/index.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";

type ConnectCliDeps = {
  runtime?: RuntimeEnv;
  createDeps?: (input: { runtime: RuntimeEnv; interactive: boolean }) => Promise<ConnectDeps>;
};

type ConnectCliOpts = {
  account?: string;
  stdin?: boolean;
  wait?: boolean;
  force?: boolean;
  json?: boolean;
  nonInteractive?: boolean;
  unbind?: string | boolean;
  list?: boolean;
};

export function registerConnectCli(program: Command, cliDeps: ConnectCliDeps = {}) {
  const runtime = cliDeps.runtime ?? defaultRuntime;
  const createDeps = cliDeps.createDeps ?? createDefaultConnectDeps;
  program
    .command("connect")
    .description("Connect your phone: WhatsApp, Telegram, LINE or the dashboard in a phone browser")
    .argument("[channel]", PHONE_CHANNELS.join(" | "))
    .option("--account <id>", "Channel account (default: the default account)")
    .option("--stdin", "Read the channel secrets from stdin, one per line (no prompts)", false)
    .option(
      "--wait",
      "Wait for the first message that binds the owner (default: when interactive and the gateway runs)",
    )
    .option("--no-wait", "Print the code and return")
    .option("--force", "WhatsApp: link again even when a session exists", false)
    .option("--unbind <channel>", "Remove the owner bound on a channel and withdraw pending codes")
    .option("--list", "List owner bindings", false)
    .option("--non-interactive", "No prompts", false)
    .option("--json", "Print the result as JSON (QR and guidance go to stderr)", false)
    .addHelpText("after", () =>
      [
        "",
        "Examples:",
        "  kurahi connect telegram",
        "  kurahi connect whatsapp",
        '  printf \'%s\\n%s\\n\' "$SECRET" "$TOKEN" | kurahi connect line --stdin --no-wait',
        "  kurahi connect web",
        "  kurahi connect --unbind telegram",
        "",
        "Exit codes: 0 ok, 1 failed, 2 usage, 3 gateway unreachable (web invitation).",
        `${theme.muted("Docs:")} ${formatDocsLink("/start/phone")}`,
        "",
      ].join("\n"),
    )
    .action(async (channelArg: string | undefined, opts: ConnectCliOpts) => {
      const interactive =
        !opts.nonInteractive &&
        !opts.stdin &&
        !opts.json &&
        Boolean(process.stdin.isTTY && process.stdout.isTTY);
      const deps = await createDeps({ runtime, interactive });
      if (opts.list) {
        const rows = listConnections(deps.env);
        if (opts.json) {
          runtime.log(JSON.stringify({ ok: true, owners: rows }, null, 2));
          return;
        }
        if (rows.length === 0) {
          runtime.log("No owner bindings. Connect a phone with: kurahi connect telegram");
          return;
        }
        runtime.log(
          renderTable({
            columns: [
              { key: "channel", header: "Channel" },
              { key: "account", header: "Account" },
              { key: "owner", header: "Owner" },
              { key: "via", header: "Via" },
              { key: "boundAt", header: "Bound" },
            ],
            rows,
          }),
        );
        return;
      }
      if (typeof opts.unbind === "string") {
        if (!isPhoneChannel(opts.unbind)) {
          runtime.error(
            `kurahi connect: --unbind ${opts.unbind}: expected ${PHONE_CHANNELS.join(", ")}`,
          );
          runtime.exit(2);
          return;
        }
        const res = await runUnbind(deps, { channel: opts.unbind, accountId: opts.account });
        if (opts.json) {
          runtime.log(JSON.stringify(res, null, 2));
        } else if (res.ok) {
          runtime.log(res.message);
        } else {
          runtime.error(`kurahi connect: ${res.message}`);
        }
        if (!res.ok) {
          runtime.exit(res.exitCode);
        }
        return;
      }
      if (!isPhoneChannel(channelArg)) {
        runtime.error(
          `kurahi connect: ${channelArg ? `unknown channel '${channelArg}'` : "channel required"} (expected ${PHONE_CHANNELS.join(", ")})`,
        );
        runtime.exit(2);
        return;
      }
      const result = await runConnect(deps, {
        channel: channelArg,
        accountId: opts.account,
        stdin: opts.stdin,
        wait: opts.wait,
        force: opts.force,
        json: opts.json,
      });
      if (opts.json) {
        runtime.log(JSON.stringify(result, null, 2));
      } else if (!result.ok) {
        runtime.error(`kurahi connect ${channelArg}: ${result.message}`);
      }
      if (!result.ok) {
        runtime.exit(result.exitCode);
      }
    });
}
