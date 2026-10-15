// `kurahi secrets …` — encrypted secrets store (KoLo 2.0, M2a). Never prints secret values.
import type { Command } from "commander";
import { isCancel, password } from "@clack/prompts";
import path from "node:path";
import { createConfigIO } from "../config/io.js";
import { defaultRuntime } from "../runtime.js";
import {
  assertValidSecretName,
  migrateConfigSecrets,
  resolveSecretStore,
  SECRET_BACKENDS,
  type SecretBackendId,
  type SecretStore,
} from "../secrets/index.js";

type CommonOpts = { home?: string; backend?: string; json?: boolean };

function openStore(opts: CommonOpts): SecretStore {
  let backend: SecretBackendId | undefined;
  if (opts.backend) {
    if (!SECRET_BACKENDS.includes(opts.backend as SecretBackendId)) {
      throw new Error(`--backend must be one of ${SECRET_BACKENDS.join(", ")}`);
    }
    backend = opts.backend as SecretBackendId;
  }
  return resolveSecretStore({ home: opts.home ? path.resolve(opts.home) : undefined, backend });
}

function emit(opts: CommonOpts, payload: Record<string, unknown>, lines: string[]) {
  if (opts.json) {
    defaultRuntime.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (const line of lines) {
    defaultRuntime.log(line);
  }
}

async function guard(opts: CommonOpts, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ ok: false, error: message }));
    } else {
      defaultRuntime.error(`kurahi secrets: ${message}`);
    }
    defaultRuntime.exit(1);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  // Strip one trailing newline (echo/printf pipelines), keep everything else verbatim.
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

export async function runSecretsSet(name: string, opts: CommonOpts & { stdin?: boolean }) {
  const valid = assertValidSecretName(name);
  let value: string;
  if (opts.stdin) {
    value = await readStdin();
  } else {
    if (!process.stdin.isTTY) {
      throw new Error("no TTY for a hidden prompt; pipe the value with --stdin");
    }
    const answer = await password({ message: `Value for ${valid}` });
    if (isCancel(answer)) {
      throw new Error("cancelled");
    }
    value = String(answer);
  }
  if (!value) {
    throw new Error("empty value; nothing stored");
  }
  const store = openStore(opts);
  store.set(valid, value);
  emit(opts, { ok: true, action: "set", name: valid, backend: store.backend }, [
    `Stored ${valid} (${store.backend})`,
    `  reference it in kolo.json as {"$secret": "${valid}"}`,
  ]);
}

export async function runSecretsList(opts: CommonOpts) {
  const store = openStore(opts);
  const names = store.list();
  emit(opts, { ok: true, backend: store.backend, location: store.location, names }, [
    `backend: ${store.backend} (${store.location})`,
    ...(names.length ? names.map((n) => `  ${n}`) : ["  (no secrets)"]),
  ]);
}

export async function runSecretsDelete(name: string, opts: CommonOpts) {
  const store = openStore(opts);
  const removed = store.delete(name.trim());
  emit(opts, { ok: true, action: "delete", name, removed, backend: store.backend }, [
    removed ? `Deleted ${name} (${store.backend})` : `${name} not found (${store.backend})`,
  ]);
}

export async function runSecretsMigrate(opts: CommonOpts & { config?: string; dryRun?: boolean }) {
  const configPath = opts.config
    ? path.resolve(opts.config)
    : opts.home
      ? path.join(path.resolve(opts.home), "kolo.json")
      : createConfigIO().configPath;
  const store = openStore(opts);
  const result = migrateConfigSecrets({ configPath, store, dryRun: opts.dryRun });
  const verb = result.dryRun ? "would move" : "moved";
  emit(opts, { ok: true, action: "migrate", backend: store.backend, ...result }, [
    `${configPath}: ${verb} ${result.moved.length} secret(s) to ${store.backend}`,
    ...result.moved.map((m) => `  ${m.configPath} -> {"$secret": "${m.name}"}`),
    ...(result.backupPath
      ? [`  backup: ${result.backupPath} (mode 0600; delete once verified)`]
      : []),
  ]);
}

export function registerSecretsCli(program: Command) {
  const secrets = program
    .command("secrets")
    .description(
      "Encrypted secrets store (OS keyring or encrypted file); values are never printed",
    );
  const common = (cmd: Command) =>
    cmd
      .option("--home <dir>", "State root (KOLO_HOME) whose store to use")
      .option("--backend <id>", `Force a backend (${SECRET_BACKENDS.join(", ")})`)
      .option("--json", "JSON output", false);

  common(
    secrets
      .command("set <name>")
      .description("Store a secret (hidden prompt, or --stdin)")
      .option("--stdin", "Read the value from stdin", false),
  ).action(async (name: string, opts) => guard(opts, () => runSecretsSet(name, opts)));

  common(secrets.command("list").description("List secret names and the backend")).action(
    async (opts) => guard(opts, () => runSecretsList(opts)),
  );

  common(secrets.command("delete <name>").description("Delete a secret")).action(
    async (name: string, opts) => guard(opts, () => runSecretsDelete(name, opts)),
  );

  common(
    secrets
      .command("migrate")
      .description("Move plaintext credentials out of kolo.json into the store ($secret refs)")
      .option("--config <path>", "Config file (default: the active kolo.json)")
      .option("--dry-run", "Show what would move without changing anything", false),
  ).action(async (opts) => guard(opts, () => runSecretsMigrate(opts)));
}
