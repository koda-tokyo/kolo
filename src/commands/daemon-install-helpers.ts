import type { KoLoConfig } from "../config/types.js";
import type { GatewayDaemonRuntime } from "./daemon-runtime.js";
import { formatCliCommand } from "../cli/command-format.js";
import { collectConfigEnvVars } from "../config/env-vars.js";
import { resolveGatewayLaunchAgentLabel } from "../daemon/constants.js";
import { resolveGatewayProgramArguments } from "../daemon/program-args.js";
import {
  renderSystemNodeWarning,
  resolvePreferredNodePath,
  resolveSystemNodeInfo,
} from "../daemon/runtime-paths.js";
import { buildServiceEnvironment } from "../daemon/service-env.js";
import { resolveGatewayTokenWithSource, writeGatewayTokenFile } from "../gateway/token-file.js";

type WarnFn = (message: string, title?: string) => void;

export type GatewayInstallPlan = {
  programArguments: string[];
  workingDirectory?: string;
  environment: Record<string, string | undefined>;
};

export function resolveGatewayDevMode(argv: string[] = process.argv): boolean {
  const entry = argv[1];
  const normalizedEntry = entry?.replaceAll("\\", "/");
  return Boolean(normalizedEntry?.includes("/src/") && normalizedEntry.endsWith(".ts"));
}

export async function buildGatewayInstallPlan(params: {
  env: Record<string, string | undefined>;
  port: number;
  runtime: GatewayDaemonRuntime;
  /**
   * Explicit token chosen by the caller (`--token`, onboarding). It is written to the
   * gateway token file (0600); the service only ever receives the file path.
   */
  token?: string;
  devMode?: boolean;
  nodePath?: string;
  warn?: WarnFn;
  /** Full config to extract env vars from (env vars + inline env keys). */
  config?: KoLoConfig;
}): Promise<GatewayInstallPlan> {
  const devMode = params.devMode ?? resolveGatewayDevMode();
  const nodePath =
    params.nodePath ??
    (await resolvePreferredNodePath({
      env: params.env,
      runtime: params.runtime,
    }));
  const { programArguments, workingDirectory } = await resolveGatewayProgramArguments({
    port: params.port,
    dev: devMode,
    runtime: params.runtime,
    nodePath,
  });
  if (params.runtime === "node") {
    const systemNode = await resolveSystemNodeInfo({ env: params.env });
    const warning = renderSystemNodeWarning(systemNode, programArguments[0]);
    if (warning) {
      params.warn?.(warning, "Gateway runtime");
    }
  }
  const resolved = resolveGatewayTokenWithSource({
    authConfig: params.config?.gateway?.auth,
    env: params.env as NodeJS.ProcessEnv,
  });
  const tokenFile = resolved.tokenFile;
  // An explicit token wins. Otherwise a token that currently lives only in the installer's env
  // or the legacy config key is moved into the file, so the service (which gets no token env)
  // keeps using the same secret instead of generating a new one.
  const explicitToken =
    params.token?.trim() || (resolved.source !== "file" ? resolved.token : undefined);
  if (explicitToken) {
    if (tokenFile) {
      writeGatewayTokenFile(tokenFile, explicitToken, params.env as NodeJS.ProcessEnv);
    } else {
      params.warn?.(
        "gateway.auth.tokenFile is false: the service will not receive the token. " +
          "Enable the token file or keep the token in your config.",
        "Gateway auth",
      );
    }
  }
  const serviceEnvironment = buildServiceEnvironment({
    env: params.env,
    port: params.port,
    tokenFile: tokenFile ?? undefined,
    launchdLabel:
      process.platform === "darwin"
        ? resolveGatewayLaunchAgentLabel(params.env.KOLO_PROFILE)
        : undefined,
  });

  // Merge config env vars into the service environment (vars + inline env keys).
  // Config env vars are added first so service-specific vars take precedence.
  const environment: Record<string, string | undefined> = {
    ...collectConfigEnvVars(params.config),
  };
  Object.assign(environment, serviceEnvironment);
  // Never persist a raw token into a unit/plist/task, even if config env vars carried one.
  delete environment.KOLO_GATEWAY_TOKEN;
  delete environment.CLAWDBOT_GATEWAY_TOKEN;

  return { programArguments, workingDirectory, environment };
}

export function gatewayInstallErrorHint(platform = process.platform): string {
  return platform === "win32"
    ? "Tip: rerun from an elevated PowerShell (Start → type PowerShell → right-click → Run as administrator) or skip service install."
    : `Tip: rerun \`${formatCliCommand("kolo gateway install")}\` after fixing the error.`;
}
