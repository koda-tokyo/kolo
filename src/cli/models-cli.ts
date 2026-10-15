import type { Command } from "commander";
import {
  BENCH_EXIT,
  modelsBenchCommand,
  modelsBenchMergeCommand,
  modelsTestedCommand,
} from "../commands/models-bench.js";
import {
  githubCopilotLoginCommand,
  modelsAliasesAddCommand,
  modelsAliasesListCommand,
  modelsAliasesRemoveCommand,
  modelsAuthAddCommand,
  modelsAuthLoginCommand,
  modelsAuthOrderClearCommand,
  modelsAuthOrderGetCommand,
  modelsAuthOrderSetCommand,
  modelsAuthPasteTokenCommand,
  modelsAuthSetupTokenCommand,
  modelsFallbacksAddCommand,
  modelsFallbacksClearCommand,
  modelsFallbacksListCommand,
  modelsFallbacksRemoveCommand,
  modelsImageFallbacksAddCommand,
  modelsImageFallbacksClearCommand,
  modelsImageFallbacksListCommand,
  modelsImageFallbacksRemoveCommand,
  modelsListCommand,
  modelsScanCommand,
  modelsSetCommand,
  modelsSetImageCommand,
  modelsStatusCommand,
} from "../commands/models.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { resolveOptionFromCommand, runCommandWithRuntime } from "./cli-utils.js";

function runModelsCommand(action: () => Promise<void>) {
  return runCommandWithRuntime(defaultRuntime, action);
}

export function registerModelsCli(program: Command) {
  const models = program
    .command("models")
    .description("Model discovery, scanning, and configuration")
    .option("--status-json", "Output JSON (alias for `models status --json`)", false)
    .option("--status-plain", "Plain output (alias for `models status --plain`)", false)
    .option("--agent <id>", "Agent id to inspect (overrides KOLO_AGENT_DIR/PI_CODING_AGENT_DIR)")
    .addHelpText("after", () => `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/models")}\n`);

  models
    .command("list")
    .description("List models (configured by default)")
    .option("--all", "Show full model catalog", false)
    .option("--local", "Filter to local models", false)
    .option("--provider <name>", "Filter by provider")
    .option("--live", "Also fetch the current model list from configured providers", false)
    .option("--json", "Output JSON", false)
    .option("--plain", "Plain line output", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsListCommand(opts, defaultRuntime);
      });
    });

  models
    .command("status")
    .description("Show configured model state")
    .option("--json", "Output JSON", false)
    .option("--plain", "Plain output", false)
    .option(
      "--check",
      "Exit non-zero if auth is expiring/expired (1=expired/missing, 2=expiring)",
      false,
    )
    .option("--probe", "Probe configured provider auth (live)", false)
    .option("--probe-provider <name>", "Only probe a single provider")
    .option(
      "--probe-profile <id>",
      "Only probe specific auth profile ids (repeat or comma-separated)",
      (value, previous) => {
        const next = Array.isArray(previous) ? previous : previous ? [previous] : [];
        next.push(value);
        return next;
      },
    )
    .option("--probe-timeout <ms>", "Per-probe timeout in ms")
    .option("--probe-concurrency <n>", "Concurrent probes")
    .option("--probe-max-tokens <n>", "Probe max tokens (best-effort)")
    .option("--agent <id>", "Agent id to inspect (overrides KOLO_AGENT_DIR/PI_CODING_AGENT_DIR)")
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsStatusCommand(
          {
            json: Boolean(opts.json),
            plain: Boolean(opts.plain),
            check: Boolean(opts.check),
            probe: Boolean(opts.probe),
            probeProvider: opts.probeProvider as string | undefined,
            probeProfile: opts.probeProfile as string | string[] | undefined,
            probeTimeout: opts.probeTimeout as string | undefined,
            probeConcurrency: opts.probeConcurrency as string | undefined,
            probeMaxTokens: opts.probeMaxTokens as string | undefined,
            agent,
          },
          defaultRuntime,
        );
      });
    });

  models
    .command("set")
    .description("Set the default model")
    .argument("<model>", "Model id or alias")
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsSetCommand(model, defaultRuntime);
      });
    });

  models
    .command("set-image")
    .description("Set the image model")
    .argument("<model>", "Model id or alias")
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsSetImageCommand(model, defaultRuntime);
      });
    });

  const aliases = models.command("aliases").description("Manage model aliases");

  aliases
    .command("list")
    .description("List model aliases")
    .option("--json", "Output JSON", false)
    .option("--plain", "Plain output", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAliasesListCommand(opts, defaultRuntime);
      });
    });

  aliases
    .command("add")
    .description("Add or update a model alias")
    .argument("<alias>", "Alias name")
    .argument("<model>", "Model id or alias")
    .action(async (alias: string, model: string) => {
      await runModelsCommand(async () => {
        await modelsAliasesAddCommand(alias, model, defaultRuntime);
      });
    });

  aliases
    .command("remove")
    .description("Remove a model alias")
    .argument("<alias>", "Alias name")
    .action(async (alias: string) => {
      await runModelsCommand(async () => {
        await modelsAliasesRemoveCommand(alias, defaultRuntime);
      });
    });

  const fallbacks = models.command("fallbacks").description("Manage model fallback list");

  fallbacks
    .command("list")
    .description("List fallback models")
    .option("--json", "Output JSON", false)
    .option("--plain", "Plain output", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsFallbacksListCommand(opts, defaultRuntime);
      });
    });

  fallbacks
    .command("add")
    .description("Add a fallback model")
    .argument("<model>", "Model id or alias")
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsFallbacksAddCommand(model, defaultRuntime);
      });
    });

  fallbacks
    .command("remove")
    .description("Remove a fallback model")
    .argument("<model>", "Model id or alias")
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsFallbacksRemoveCommand(model, defaultRuntime);
      });
    });

  fallbacks
    .command("clear")
    .description("Clear all fallback models")
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsFallbacksClearCommand(defaultRuntime);
      });
    });

  const imageFallbacks = models
    .command("image-fallbacks")
    .description("Manage image model fallback list");

  imageFallbacks
    .command("list")
    .description("List image fallback models")
    .option("--json", "Output JSON", false)
    .option("--plain", "Plain output", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksListCommand(opts, defaultRuntime);
      });
    });

  imageFallbacks
    .command("add")
    .description("Add an image fallback model")
    .argument("<model>", "Model id or alias")
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksAddCommand(model, defaultRuntime);
      });
    });

  imageFallbacks
    .command("remove")
    .description("Remove an image fallback model")
    .argument("<model>", "Model id or alias")
    .action(async (model: string) => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksRemoveCommand(model, defaultRuntime);
      });
    });

  imageFallbacks
    .command("clear")
    .description("Clear all image fallback models")
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsImageFallbacksClearCommand(defaultRuntime);
      });
    });

  models
    .command("scan")
    .description("Scan OpenRouter free models for tools + images")
    .option("--min-params <b>", "Minimum parameter size (billions)")
    .option("--max-age-days <days>", "Skip models older than N days")
    .option("--provider <name>", "Filter by provider prefix")
    .option("--max-candidates <n>", "Max fallback candidates", "6")
    .option("--timeout <ms>", "Per-probe timeout in ms")
    .option("--concurrency <n>", "Probe concurrency")
    .option("--no-probe", "Skip live probes; list free candidates only")
    .option("--yes", "Accept defaults without prompting", false)
    .option("--no-input", "Disable prompts (use defaults)")
    .option("--set-default", "Set agents.defaults.model to the first selection", false)
    .option("--set-image", "Set agents.defaults.imageModel to the first image selection", false)
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsScanCommand(opts, defaultRuntime);
      });
    });

  const collect = (value: string, previous: string[] = []) => [...previous, value];

  models
    .command("bench")
    .description("Benchmark models as residents and write a signed report")
    .option(
      "--model <provider/model>",
      "Model to benchmark on the full suite (repeatable)",
      collect,
    )
    .option(
      "--quick-model <provider/model>",
      "Model to benchmark on the quick subset, for slow local models (repeatable)",
      collect,
    )
    .option("--only <ids>", "Comma-separated task ids or id prefixes (policy., coding.sort)")
    .option("--max-tokens <n>", "Token cap per model (default 300000)")
    .option(
      "--global-max-tokens <n>",
      "Token cap for the whole run (default: per-model cap x models)",
    )
    .option("--timeout <ms>", "Per model turn (default 120000; local servers 600000)")
    .option("--base-url <url>", "Base URL for providers that need one")
    .option("--out <dir>", "Report directory (default <KOLO_HOME>/bench/<timestamp>)")
    .option("--update-catalogue <file>", "Merge the results into a catalogue file")
    .option("--json", "Output JSON", false)
    .addHelpText("after", () =>
      [
        "",
        "Examples:",
        "  kurahi models bench --model sakura/gpt-oss-120b",
        "  kurahi models bench --quick-model ollama/qwen2.5:7b --max-tokens 100000",
        "  kurahi models bench --model sakura/gpt-oss-120b --only policy.,continuity.",
        "",
        `${theme.muted("Docs:")} ${formatDocsLink("/providers/koda-tested")}`,
        "",
      ].join("\n"),
    )
    .action(async (opts) => {
      await runModelsCommand(async () => {
        try {
          await modelsBenchCommand(opts, defaultRuntime);
        } catch (err) {
          const code = (err as { exitCode?: unknown } | null)?.exitCode;
          defaultRuntime.error(
            `kurahi models bench: ${err instanceof Error ? err.message : String(err)}`,
          );
          defaultRuntime.exit(typeof code === "number" ? code : BENCH_EXIT.error);
        }
      });
    });

  models
    .command("bench-merge")
    .description("Merge signed reports of chunked bench runs into one signed report")
    .argument("<reports...>", "bench-report.json files")
    .requiredOption("--out <dir>", "Directory for the merged report")
    .option("--update-catalogue <file>", "Merge the results into a catalogue file")
    .option("--json", "Output JSON", false)
    .action(async (files: string[], opts) => {
      await runModelsCommand(async () => {
        try {
          modelsBenchMergeCommand(files, opts, defaultRuntime);
        } catch (err) {
          const code = (err as { exitCode?: unknown } | null)?.exitCode;
          defaultRuntime.error(
            `kurahi models bench-merge: ${err instanceof Error ? err.message : String(err)}`,
          );
          defaultRuntime.exit(typeof code === "number" ? code : BENCH_EXIT.error);
        }
      });
    });

  models
    .command("tested")
    .description("Models scored by the KODA tested suite, with residency and cost")
    .option("--residency <region>", "jp | eu | us | cn | sg | local | unknown")
    .option("--min-score <n>", "Only models with an overall score of at least n (0-100)")
    .option("--tested-only", "Hide models that are pending a benchmark", false)
    .option("--json", "Output JSON", false)
    .addHelpText(
      "after",
      () => `\n${theme.muted("Docs:")} ${formatDocsLink("/providers/koda-tested")}\n`,
    )
    .action(async (opts) => {
      await runModelsCommand(async () => {
        try {
          modelsTestedCommand(opts, defaultRuntime);
        } catch (err) {
          const code = (err as { exitCode?: unknown } | null)?.exitCode;
          defaultRuntime.error(
            `kurahi models tested: ${err instanceof Error ? err.message : String(err)}`,
          );
          defaultRuntime.exit(typeof code === "number" ? code : BENCH_EXIT.error);
        }
      });
    });

  models.action(async (opts) => {
    await runModelsCommand(async () => {
      await modelsStatusCommand(
        {
          json: Boolean(opts?.statusJson),
          plain: Boolean(opts?.statusPlain),
          agent: opts?.agent as string | undefined,
        },
        defaultRuntime,
      );
    });
  });

  const auth = models.command("auth").description("Manage model auth profiles");
  auth.option("--agent <id>", "Agent id for auth order get/set/clear");
  auth.action(() => {
    auth.help();
  });

  auth
    .command("add")
    .description("Interactive auth helper (setup-token or paste token)")
    .action(async () => {
      await runModelsCommand(async () => {
        await modelsAuthAddCommand({}, defaultRuntime);
      });
    });

  auth
    .command("login")
    .description("Run a provider plugin auth flow (OAuth/API key)")
    .option("--provider <id>", "Provider id registered by a plugin")
    .option("--method <id>", "Provider auth method id")
    .option("--set-default", "Apply the provider's default model recommendation", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthLoginCommand(
          {
            provider: opts.provider as string | undefined,
            method: opts.method as string | undefined,
            setDefault: Boolean(opts.setDefault),
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("setup-token")
    .description("Run a provider CLI to create/sync a token (TTY required)")
    .option("--provider <name>", "Provider id (default: anthropic)")
    .option("--yes", "Skip confirmation", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthSetupTokenCommand(
          {
            provider: opts.provider as string | undefined,
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("paste-token")
    .description("Paste a token into auth-profiles.json and update config")
    .requiredOption("--provider <name>", "Provider id (e.g. anthropic)")
    .option("--profile-id <id>", "Auth profile id (default: <provider>:manual)")
    .option(
      "--expires-in <duration>",
      "Optional expiry duration (e.g. 365d, 12h). Stored as absolute expiresAt.",
    )
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await modelsAuthPasteTokenCommand(
          {
            provider: opts.provider as string | undefined,
            profileId: opts.profileId as string | undefined,
            expiresIn: opts.expiresIn as string | undefined,
          },
          defaultRuntime,
        );
      });
    });

  auth
    .command("login-github-copilot")
    .description("Login to GitHub Copilot via GitHub device flow (TTY required)")
    .option("--profile-id <id>", "Auth profile id (default: github-copilot:github)")
    .option("--yes", "Overwrite existing profile without prompting", false)
    .action(async (opts) => {
      await runModelsCommand(async () => {
        await githubCopilotLoginCommand(
          {
            profileId: opts.profileId as string | undefined,
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
      });
    });

  const order = auth.command("order").description("Manage per-agent auth profile order overrides");

  order
    .command("get")
    .description("Show per-agent auth order override (from auth-profiles.json)")
    .requiredOption("--provider <name>", "Provider id (e.g. anthropic)")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .option("--json", "Output JSON", false)
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderGetCommand(
          {
            provider: opts.provider as string,
            agent,
            json: Boolean(opts.json),
          },
          defaultRuntime,
        );
      });
    });

  order
    .command("set")
    .description("Set per-agent auth order override (locks rotation to this list)")
    .requiredOption("--provider <name>", "Provider id (e.g. anthropic)")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .argument("<profileIds...>", "Auth profile ids (e.g. anthropic:default)")
    .action(async (profileIds: string[], opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderSetCommand(
          {
            provider: opts.provider as string,
            agent,
            order: profileIds,
          },
          defaultRuntime,
        );
      });
    });

  order
    .command("clear")
    .description("Clear per-agent auth order override (fall back to config/round-robin)")
    .requiredOption("--provider <name>", "Provider id (e.g. anthropic)")
    .option("--agent <id>", "Agent id (default: configured default agent)")
    .action(async (opts, command) => {
      const agent =
        resolveOptionFromCommand<string>(command, "agent") ?? (opts.agent as string | undefined);
      await runModelsCommand(async () => {
        await modelsAuthOrderClearCommand(
          {
            provider: opts.provider as string,
            agent,
          },
          defaultRuntime,
        );
      });
    });
}
