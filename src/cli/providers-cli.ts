// `kurahi providers …` — provider wiring driven by the built-in registry (KoLo 2.0, M9c).
//
//   kurahi providers list [--json] [--all] [--search <text>]
//   kurahi providers add <id> [--base-url <url>] [--api-key-stdin | --api-key-file <path>] [--model <id>]
//   kurahi providers test <id> [--model <id>] [--timeout <ms>] [--json]
//   kurahi providers remove <id> [--yes]
//   kurahi providers default <id> [--model <id>]
//
// Keys are never read from argv: they come from stdin, a file, a prompt, or the environment
// variable the registry names. They are stored in the auth profile store (never in kolo.json).
import type { Command } from "commander";
import { confirm, isCancel, password } from "@clack/prompts";
import {
  PROVIDERS_EXIT,
  type ProvidersDeps,
  providersAddCommand,
  providersDefaultCommand,
  providersListCommand,
  providersRemoveCommand,
  providersTestCommand,
} from "../commands/providers/index.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { formatCliCommand } from "./command-format.js";

type ProvidersCliDeps = ProvidersDeps & { runtime?: RuntimeEnv };

async function promptKey(message: string): Promise<string> {
  const value = await password({ message, mask: "*" });
  if (isCancel(value)) {
    throw Object.assign(new Error("cancelled"), { exitCode: PROVIDERS_EXIT.error });
  }
  return String(value);
}

async function promptConfirm(message: string): Promise<boolean> {
  const value = await confirm({ message, initialValue: false });
  return value === true;
}

function run(runtime: RuntimeEnv, json: boolean | undefined, action: () => Promise<void>) {
  return action().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { exitCode?: unknown } | null)?.exitCode;
    const exitCode =
      typeof code === "number" && code > 0 && code < 256 ? code : PROVIDERS_EXIT.error;
    if (json) {
      runtime.log(JSON.stringify({ ok: false, error: message, exitCode }, null, 2));
    } else {
      runtime.error(theme.error(`kurahi providers: ${message}`));
    }
    runtime.exit(exitCode);
  });
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("--timeout expects milliseconds"), {
      exitCode: PROVIDERS_EXIT.usage,
    });
  }
  return n;
}

export function registerProvidersCli(program: Command, deps: ProvidersCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  const cmdDeps: ProvidersDeps = {
    promptKey: deps.promptKey ?? promptKey,
    confirm: deps.confirm ?? promptConfirm,
    ...deps,
  };

  const cmd = program
    .command("providers")
    .description("Model providers from the built-in registry (list, add, test, remove, default)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Examples:")}\n  ${formatCliCommand("kurahi providers list")}\n  ${formatCliCommand(
          "kurahi providers add sakura --api-key-stdin < key.txt",
        )}\n  ${formatCliCommand("kurahi providers test sakura")}\n  ${formatCliCommand(
          "kurahi providers default sakura",
        )}\n${theme.muted("Exit codes:")} 0 ok, 1 failed, 2 usage, 3 provider unreachable, 4 key rejected\n${theme.muted("Docs:")} ${formatDocsLink("/providers")}\n`,
    );

  cmd
    .command("list")
    .alias("ls")
    .description("Registry entries with their configured state")
    .option("--json", "Print JSON", false)
    .option("--all", "Include every entry from the public catalogue", false)
    .option("--search <text>", "Only entries whose id, name or region contains this text")
    .action(async (opts: { json?: boolean; all?: boolean; search?: string }) => {
      await run(runtime, opts.json, () => providersListCommand(opts, runtime, cmdDeps));
    });

  cmd
    .command("add <id>")
    .description("Configure a provider and store its key")
    .option("--base-url <url>", "Endpoint base URL (required for generic and per-resource entries)")
    .option("--api-key-stdin", "Read the key from stdin", false)
    .option("--api-key-file <path>", "Read the key from a file")
    .option("--model <id>", "Model to register (default: the registry default)")
    .option("--json", "Print JSON", false)
    .action(
      async (
        id: string,
        opts: {
          baseUrl?: string;
          apiKeyStdin?: boolean;
          apiKeyFile?: string;
          model?: string;
          json?: boolean;
        },
      ) => {
        await run(runtime, opts.json, () => providersAddCommand(id, opts, runtime, cmdDeps));
      },
    );

  cmd
    .command("test <id>")
    .description("Send one tiny request and report latency")
    .option("--model <id>", "Model for providers without a models endpoint")
    .option("--base-url <url>", "Override the configured base URL for this probe")
    .option("--timeout <ms>", "Request timeout (10000)")
    .option("--json", "Print JSON", false)
    .action(
      async (
        id: string,
        opts: { model?: string; baseUrl?: string; timeout?: string; json?: boolean },
      ) => {
        await run(runtime, opts.json, async () => {
          const timeout = parseTimeout(opts.timeout);
          await providersTestCommand(
            id,
            { model: opts.model, baseUrl: opts.baseUrl, timeout, json: opts.json },
            runtime,
            cmdDeps,
          );
        });
      },
    );

  cmd
    .command("remove <id>")
    .alias("rm")
    .description("Remove a provider's config entry and stored key")
    .option("--yes", "Do not ask for confirmation", false)
    .option("--json", "Print JSON", false)
    .action(async (id: string, opts: { yes?: boolean; json?: boolean }) => {
      await run(runtime, opts.json, () => providersRemoveCommand(id, opts, runtime, cmdDeps));
    });

  cmd
    .command("default <id>")
    .description("Make a provider's model the primary model")
    .option("--model <id>", "Model id (default: the configured or registry default)")
    .option("--json", "Print JSON", false)
    .action(async (id: string, opts: { model?: string; json?: boolean }) => {
      await run(runtime, opts.json, () => providersDefaultCommand(id, opts, runtime, cmdDeps));
    });
}
