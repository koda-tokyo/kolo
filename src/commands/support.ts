// `kurahi support`: everything a support ticket needs in one place. Prints version, OS, state
// directory, integrity and service state, and writes a redacted diagnostics bundle
// (<KOLO_HOME>/support/kolo-support-<timestamp>.tar.gz). Secrets never enter the bundle:
// config values whose keys look like credentials are replaced, log lines go through the
// log redactor, and environment values are reported as "set" / "unset" only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { create as createTar } from "tar";
import type { KoLoConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveAuditDir } from "../audit/audit-log.js";
import { verifyAuditChain } from "../audit/verify.js";
import { readConfigFileSnapshot } from "../config/io.js";
import { koloLogDir, readKoloHomeOverride, resolveKoloHome } from "../config/kolo-home.js";
import { resolveConfigPath } from "../config/paths.js";
import { DOCS_URL, SUPPORT_EMAIL, SUPPORT_URL } from "../config/product-urls.js";
import { resolveServiceBackend, resolveServiceIdentity } from "../daemon/supervisor/index.js";
import { t } from "../i18n/index.js";
import { getIntegrityStatus } from "../integrity/gate.js";
import { redactSensitiveText } from "../logging/redact.js";
import { defaultRuntime } from "../runtime.js";
import { VERSION } from "../version.js";
import { buildDoctorJsonReport } from "./doctor-json.js";

const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api_key|key|credential|cookie|auth)/i;
const LOG_TAIL_LINES = 400;

export type SupportOptions = {
  json?: boolean;
  out?: string;
  id?: string;
  /** Print the summary only; do not write the bundle. */
  noBundle?: boolean;
};

/** Replace every value under a credential-looking key; keep structure so shapes stay readable. */
export function redactConfigValue(value: unknown, keyName = ""): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactConfigValue(item, keyName));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SECRET_KEY_RE.test(k) && typeof v !== "object" ? "[redacted]" : redactConfigValue(v, k);
    }
    return out;
  }
  if (typeof value === "string") {
    return SECRET_KEY_RE.test(keyName) ? "[redacted]" : redactSensitiveText(value);
  }
  return value;
}

function newestLogFile(dir: string): string | null {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".log"))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .toSorted((a, b) => b.m - a.m);
    return files[0] ? path.join(dir, files[0].f) : null;
  } catch {
    return null;
  }
}

function tailLines(file: string, n: number): string {
  try {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - n)).join("\n");
  } catch {
    return "";
  }
}

function koloEnvReport(env: NodeJS.ProcessEnv): Record<string, "set" | "unset"> {
  const out: Record<string, "set" | "unset"> = {};
  for (const name of Object.keys(env)
    .filter((k) => k.startsWith("KOLO_"))
    .toSorted()) {
    out[name] = env[name]?.trim() ? "set" : "unset";
  }
  return out;
}

export type SupportServiceId = {
  id: string;
  source: "flag" | "env" | "service.json" | "config" | "default";
};

function readJsonSafe(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Which service identity `kurahi support` reports on: `--id`, else KOLO_SERVICE_ID (set by the
 * service environment), else the id `kurahi service install` recorded in
 * `<KOLO_HOME>/service/service.json`, else the default agent `kurahi init` wrote to the config,
 * else `default`.
 */
export function resolveSupportServiceId(params: {
  id?: string;
  home: string;
  cfg: KoLoConfig | null;
  env?: NodeJS.ProcessEnv;
}): SupportServiceId {
  const env = params.env ?? process.env;
  if (params.id?.trim()) {
    return { id: params.id.trim(), source: "flag" };
  }
  const fromEnv = env.KOLO_SERVICE_ID?.trim();
  if (fromEnv) {
    return { id: fromEnv, source: "env" };
  }
  const metadata = readJsonSafe(path.join(params.home, "service", "service.json"));
  if (typeof metadata?.id === "string" && metadata.id.trim()) {
    return { id: metadata.id.trim(), source: "service.json" };
  }
  const agents = params.cfg?.agents?.list ?? [];
  const agent = agents.find((entry) => entry?.default) ?? (agents.length === 1 ? agents[0] : null);
  const agentId = typeof agent?.id === "string" ? agent.id.trim().toLowerCase() : "";
  if (agentId) {
    return { id: agentId, source: "config" };
  }
  return { id: "default", source: "default" };
}

export async function buildSupportSummary(opts: SupportOptions = {}) {
  const home = resolveKoloHome();
  const doctor = await buildDoctorJsonReport();
  const integrity = getIntegrityStatus({ force: true });
  let service: unknown = null;
  try {
    let cfg: KoLoConfig | null = null;
    try {
      cfg = (await readConfigFileSnapshot()).config;
    } catch {
      cfg = null;
    }
    const serviceId = resolveSupportServiceId({ id: opts.id, home, cfg });
    // The identity's state root is this state root, except for the legacy layout where an
    // explicit --id without KOLO_HOME names a sibling root (~/.kolo-<id>).
    const useThisHome = serviceId.source !== "flag" || Boolean(readKoloHomeOverride());
    const identity = resolveServiceIdentity({
      id: serviceId.id,
      ...(useThisHome ? { home } : {}),
    });
    const backend = resolveServiceBackend();
    service = {
      id: identity.id,
      idSource: serviceId.source,
      home: identity.home,
      ...(await backend.status(identity)),
    };
  } catch (err) {
    service = { error: err instanceof Error ? err.message : String(err) };
  }
  let audit: unknown;
  try {
    const result = verifyAuditChain(resolveAuditDir());
    audit = { ok: result.ok, entries: result.entries, firstBreak: result.firstBreak ?? null };
  } catch (err) {
    audit = { error: err instanceof Error ? err.message : String(err) };
  }
  return {
    generatedAt: new Date().toISOString(),
    version: VERSION,
    os: `${process.platform} ${os.release()} ${os.arch()}`,
    node: process.versions.node,
    koloHome: home,
    configPath: resolveConfigPath(),
    integrity: { state: integrity.integrity, mode: integrity.mode },
    service,
    audit,
    doctor,
    env: koloEnvReport(process.env),
    support: SUPPORT_URL,
    supportEmail: SUPPORT_EMAIL,
    docs: `${DOCS_URL}/help/troubleshooting`,
  };
}

export async function writeSupportBundle(
  summary: Awaited<ReturnType<typeof buildSupportSummary>>,
  outPath?: string,
): Promise<string> {
  const home = resolveKoloHome();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = outPath ?? path.join(home, "support", `kolo-support-${stamp}.tar.gz`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-support-"));
  const dir = path.join(stage, "kolo-support");
  fs.mkdirSync(dir);
  try {
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
    try {
      const snapshot = await readConfigFileSnapshot();
      fs.writeFileSync(
        path.join(dir, "config.redacted.json"),
        JSON.stringify(redactConfigValue(snapshot.parsed ?? {}), null, 2),
      );
    } catch (err) {
      fs.writeFileSync(path.join(dir, "config.redacted.json"), `unreadable: ${String(err)}\n`);
    }
    const log = newestLogFile(koloLogDir(home));
    fs.writeFileSync(
      path.join(dir, "gateway-log.tail.txt"),
      log ? redactSensitiveText(tailLines(log, LOG_TAIL_LINES)) : "no log file\n",
    );
    fs.writeFileSync(
      path.join(dir, "README.txt"),
      [
        "Kurahi diagnostics bundle",
        `generated ${summary.generatedAt} by kolo ${summary.version}`,
        "summary.json          version, OS, state dir, integrity, service, audit, doctor report, KOLO_* names",
        "config.redacted.json  kolo.json with credential-looking values replaced",
        `gateway-log.tail.txt  last ${LOG_TAIL_LINES} gateway log lines, redacted`,
        "No secret values are included. Review before sending if your policy requires it.",
        "",
      ].join("\n"),
    );
    await createTar({ gzip: true, file: target, cwd: stage, portable: true }, ["kolo-support"]);
    fs.chmodSync(target, 0o600);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return target;
}

export async function supportCommand(
  opts: SupportOptions = {},
  runtime: RuntimeEnv = defaultRuntime,
) {
  const summary = await buildSupportSummary(opts);
  const bundle = opts.noBundle ? null : await writeSupportBundle(summary, opts.out);
  if (opts.json) {
    runtime.log(JSON.stringify({ ...summary, bundle }, null, 2));
    return;
  }
  const service = summary.service as {
    id?: string;
    state?: string;
    manager?: string;
    error?: string;
  } | null;
  const audit = summary.audit as { ok?: boolean; entries?: number; error?: string };
  const lines = [
    `version    ${summary.version}`,
    `os         ${summary.os} (node ${summary.node})`,
    `state      ${summary.koloHome}`,
    `config     ${summary.configPath}`,
    `integrity  ${summary.integrity.state} (${summary.integrity.mode})`,
    `service    ${service?.error ? `unknown (${service.error})` : `${service?.id ?? "?"}: ${service?.state ?? "?"} via ${service?.manager ?? "?"}`}`,
    `audit      ${audit.error ? `unknown (${audit.error})` : `${audit.ok ? "chain ok" : "chain broken"}, ${audit.entries ?? 0} entries`}`,
    `gateway    ${summary.doctor.gateway.reachable ? `reachable on ${summary.doctor.gateway.port}` : `not reachable on ${summary.doctor.gateway.port}`}`,
  ];
  if (bundle) {
    lines.push("", t("support.wrote", { path: bundle }), t("support.attach"));
  }
  lines.push("", `support: ${summary.supportEmail}`, `issues:  ${summary.support}`);
  for (const line of lines) {
    runtime.log(line);
  }
}
