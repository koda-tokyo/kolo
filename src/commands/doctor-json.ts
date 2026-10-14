// `kolo doctor --json`: a machine-readable, non-interactive report of the local installation.
// Used by the packaging check (`pnpm pack:check`) and by operators who script health probes.
// It never prompts, never repairs, and never opens a gateway socket beyond one HTTP probe.

import fs from "node:fs";
import os from "node:os";
import process from "node:process";
import { readConfigFileSnapshot } from "../config/io.js";
import { resolveKoloHome } from "../config/kolo-home.js";
import { resolveConfigPath, resolveGatewayPort } from "../config/paths.js";
import { probeGatewayHealth } from "../daemon/supervisor/index.js";
import { defaultGatewayTokenFilePath } from "../gateway/token-file.js";
import { currentLang } from "../i18n/index.js";
import { VERSION } from "../version.js";

export type DoctorCheckLevel = "ok" | "warn" | "error";

export type DoctorCheck = {
  id: string;
  level: DoctorCheckLevel;
  detail: string;
};

export type DoctorJsonReport = {
  ok: boolean;
  version: string;
  lang: string;
  node: string;
  platform: string;
  arch: string;
  koloHome: string;
  config: { path: string; exists: boolean; valid: boolean; gatewayMode: string | null };
  gateway: {
    port: number;
    tokenFile: { path: string; exists: boolean };
    reachable: boolean;
    status: number | null;
    readiness: string | null;
  };
  checks: DoctorCheck[];
  next: string[];
};

export async function buildDoctorJsonReport(
  env: NodeJS.ProcessEnv = process.env,
): Promise<DoctorJsonReport> {
  const checks: DoctorCheck[] = [];
  const next: string[] = [];
  const koloHome = resolveKoloHome({ env });
  const configPath = resolveConfigPath(env);

  let configExists = false;
  let configValid = false;
  let gatewayMode: string | null = null;
  let port = resolveGatewayPort(undefined, env);
  try {
    const snapshot = await readConfigFileSnapshot();
    configExists = snapshot.exists;
    configValid = snapshot.exists && snapshot.valid;
    if (snapshot.exists && snapshot.valid) {
      gatewayMode = snapshot.config.gateway?.mode ?? null;
      port = resolveGatewayPort(snapshot.config, env);
    }
  } catch (err) {
    checks.push({ id: "config.read", level: "error", detail: String(err) });
  }

  if (!configExists) {
    checks.push({
      id: "config.exists",
      level: "warn",
      detail: `no config at ${configPath}; run \`kolo init\``,
    });
    next.push("kolo init");
  } else if (!configValid) {
    checks.push({ id: "config.valid", level: "error", detail: `${configPath} does not parse` });
  } else {
    checks.push({ id: "config.valid", level: "ok", detail: configPath });
    if (gatewayMode !== "local" && gatewayMode !== "remote") {
      checks.push({
        id: "gateway.mode",
        level: "warn",
        detail: "gateway.mode is not set; `kolo gateway` will refuse to start",
      });
    }
  }

  const tokenPath = defaultGatewayTokenFilePath(env);
  const tokenExists = fs.existsSync(tokenPath);
  checks.push({
    id: "gateway.token",
    level: tokenExists ? "ok" : "warn",
    detail: tokenExists ? tokenPath : `no token file at ${tokenPath} (created on first start)`,
  });

  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    id: "node.version",
    level: major >= 22 ? "ok" : "error",
    detail: `node ${process.versions.node} (requires >= 22.12)`,
  });

  const probe = await probeGatewayHealth(port, 1500);
  checks.push({
    id: "gateway.reachable",
    level: probe.ok ? "ok" : "warn",
    detail: probe.ok
      ? `http://127.0.0.1:${port}/health -> ${probe.status}`
      : `no gateway on port ${port} (${probe.error ?? probe.status ?? "unknown"})`,
  });
  if (!probe.ok && configExists) {
    next.push("kolo service install");
  }

  const ok = !checks.some((check) => check.level === "error");
  return {
    ok,
    version: VERSION,
    lang: currentLang(),
    node: process.versions.node,
    platform: process.platform,
    arch: os.arch(),
    koloHome,
    config: { path: configPath, exists: configExists, valid: configValid, gatewayMode },
    gateway: {
      port,
      tokenFile: { path: tokenPath, exists: tokenExists },
      reachable: probe.ok,
      status: probe.status ?? null,
      readiness: probe.readiness ?? null,
    },
    checks,
    next,
  };
}
