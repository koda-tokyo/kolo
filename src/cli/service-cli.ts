// `kurahi service …` — the one supervisor command (KoLo 2.0, M1c).
// systemd --user on Linux, launchd on macOS, Task Scheduler + Node runner on Windows.
import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { ensureEnvFile } from "../daemon/supervisor/env-file.js";
import {
  assertDistBuilt,
  detectPm2Gateways,
  formatPm2Notice,
  parsePortFlag,
  probeGatewayHealth,
  resolveLaunchSpec,
  resolveServiceBackend,
  resolveServiceIdentity,
  writeServiceMetadata,
  type ServiceIdentity,
} from "../daemon/supervisor/index.js";
import { defaultRuntime } from "../runtime.js";
import { VERSION } from "../version.js";

type CommonOpts = { id?: string; port?: string; home?: string; json?: boolean };

const DEFAULT_LOG_LINES = 200;
const DEFAULT_LOG_BYTES = 64 * 1024;

function identityFrom(opts: CommonOpts): ServiceIdentity {
  return resolveServiceIdentity({
    id: opts.id,
    port: parsePortFlag(opts.port),
    home: opts.home,
  });
}

function out(opts: CommonOpts, payload: Record<string, unknown>, lines: string[]) {
  if (opts.json) {
    defaultRuntime.log(JSON.stringify(payload, null, 2));
    return;
  }
  for (const line of lines) {
    defaultRuntime.log(line);
  }
}

function pm2Notice(opts: CommonOpts) {
  const notice = formatPm2Notice(detectPm2Gateways());
  if (notice && !opts.json) {
    defaultRuntime.error(notice);
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
      defaultRuntime.error(`kurahi service: ${message}`);
    }
    defaultRuntime.exit(1);
  }
}

export async function runServiceInstall(opts: CommonOpts & { start?: boolean }) {
  const identity = identityFrom(opts);
  const spec = resolveLaunchSpec({ identity, version: VERSION });
  assertDistBuilt(spec);
  for (const dir of [identity.home, identity.logDir, identity.runDir]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const createdEnv = ensureEnvFile(identity.envFile);
  writeServiceMetadata(spec, process.platform);
  const backend = resolveServiceBackend();
  const lines = await backend.install(spec, { start: opts.start !== false });
  const warnings: string[] = [];
  if (!fs.existsSync(path.join(identity.home, "kolo.json"))) {
    warnings.push(
      `no kolo.json in ${identity.home}; the gateway will not start until it is configured (KOLO_HOME=${identity.home} kurahi setup).`,
    );
  }
  out(opts, { ok: true, action: "install", identity, manager: backend.manager, lines, warnings }, [
    `Installed ${identity.id} (${backend.manager}) on port ${identity.port}`,
    `  home: ${identity.home}`,
    `  env:  ${identity.envFile}${createdEnv ? " (created, mode 0600)" : ""}`,
    ...lines.map((l) => `  ${l}`),
    ...warnings.map((w) => `warning: ${w}`),
  ]);
  pm2Notice(opts);
}

export async function runServiceUninstall(opts: CommonOpts) {
  const identity = identityFrom(opts);
  const backend = resolveServiceBackend();
  const lines = await backend.uninstall(identity);
  fs.rmSync(identity.metadataFile, { force: true });
  out(opts, { ok: true, action: "uninstall", id: identity.id, lines }, [
    `Uninstalled ${identity.id} (${backend.manager}); state in ${identity.home} kept`,
    ...lines.map((l) => `  ${l}`),
  ]);
}

async function runSimple(action: "start" | "stop" | "restart", opts: CommonOpts) {
  const identity = identityFrom(opts);
  const backend = resolveServiceBackend();
  await backend[action](identity);
  const status = await backend.status(identity);
  out(opts, { ok: true, action, id: identity.id, status }, [
    `${action}: ${status.name} -> ${status.state}${status.pid ? ` (pid ${status.pid})` : ""}`,
  ]);
  if (action !== "stop") {
    pm2Notice(opts);
  }
}

export async function runServiceStatus(opts: CommonOpts & { probe?: boolean }) {
  const identity = identityFrom(opts);
  const backend = resolveServiceBackend();
  const status = await backend.status(identity);
  const health =
    opts.probe !== false && status.state === "running"
      ? await probeGatewayHealth(identity.port)
      : undefined;
  // Only this identity is reported in detail; processes under another supervisor are a count.
  const otherPm2Gateways = detectPm2Gateways().length;
  out(opts, { ok: true, identity, status, health, otherPm2Gateways }, [
    `${identity.id}: ${status.state}${status.pid ? ` (pid ${status.pid})` : ""}`,
    `  manager:  ${backend.manager} ${status.name}${status.detail ? ` [${status.detail}]` : ""}`,
    `  enabled:  ${status.enabled === undefined ? "?" : status.enabled ? "yes" : "no"}`,
    ...(status.restarts !== undefined ? [`  restarts: ${status.restarts}`] : []),
    ...(status.lastExitCode !== undefined ? [`  last exit: ${status.lastExitCode}`] : []),
    ...(status.since ? [`  since:    ${status.since}`] : []),
    `  port:     ${identity.port} (${identity.portSource})`,
    `  home:     ${identity.home}`,
    `  unit:     ${status.definitionPath}`,
    ...(health
      ? [
          `  health:   ${health.ok ? "ok" : "FAIL"} ${health.status ?? health.error ?? ""}${health.readiness ? ` readiness=${health.readiness}` : ""}`,
        ]
      : []),
  ]);
  pm2Notice(opts);
  if (!status.installed) {
    defaultRuntime.exit(3);
  }
}

export async function runServiceLogs(opts: CommonOpts & { lines?: string; maxBytes?: string }) {
  const identity = identityFrom(opts);
  const backend = resolveServiceBackend();
  const lines = Math.max(1, Number.parseInt(opts.lines ?? "", 10) || DEFAULT_LOG_LINES);
  const maxBytes = Math.max(256, Number.parseInt(opts.maxBytes ?? "", 10) || DEFAULT_LOG_BYTES);
  const text = await backend.logs(identity, { lines, maxBytes });
  if (opts.json) {
    defaultRuntime.log(JSON.stringify({ ok: true, id: identity.id, logs: text }));
    return;
  }
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function common(cmd: Command): Command {
  return cmd
    .option("--id <identity>", "Service identity (one unit, state root and port each)", "default")
    .option("--port <port>", "Gateway port (default: service.json, kolo.json, then 18789)")
    .option("--home <dir>", "State root override (default: ~/.kolo for default, ~/.kolo-<id>)")
    .option("--json", "Output JSON", false);
}

export function registerServiceCli(program: Command) {
  const service = program
    .command("service")
    .description(
      "Run the Gateway under the OS service manager (systemd / launchd / Task Scheduler)",
    );

  common(service.command("install").description("Install and start the service for an identity"))
    .option("--no-start", "Install and enable without starting")
    .action(async (opts) => guard(opts, () => runServiceInstall(opts)));

  common(
    service.command("uninstall").description("Stop and remove the service (keeps state)"),
  ).action(async (opts) => guard(opts, () => runServiceUninstall(opts)));

  for (const action of ["start", "stop", "restart"] as const) {
    common(
      service
        .command(action)
        .description(`${action[0]?.toUpperCase()}${action.slice(1)} the service`),
    ).action(async (opts) => guard(opts, () => runSimple(action, opts)));
  }

  common(service.command("status").description("Process state from the OS service manager"))
    .option("--no-probe", "Skip the /health probe")
    .action(async (opts) => guard(opts, () => runServiceStatus(opts)));

  common(service.command("logs").description("Tail the service log from the OS (byte-capped)"))
    .option("-n, --lines <n>", "Lines to show", String(DEFAULT_LOG_LINES))
    .option("--max-bytes <n>", "Byte cap for the output", String(DEFAULT_LOG_BYTES))
    .action(async (opts) => guard(opts, () => runServiceLogs(opts)));
}
