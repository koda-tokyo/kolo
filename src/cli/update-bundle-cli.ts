/**
 * `kolo update` on a prebuilt bundle install. Called from update-cli when the running CLI is a
 * bundle (KOLO_BUNDLE_ROOT / bundle-manifest.json); git and package installs keep their path.
 */
import { readConfigFileSnapshot } from "../config/config.js";
import { resolveBundleInfo, type BundleInfo } from "../infra/bundle.js";
import {
  ChecksumMismatchError,
  resolveBundleUpdateChannel,
  runBundleUpdate,
  type BundleUpdateOutcome,
} from "../infra/update-bundle.js";
import { readBundleManifest } from "../packaging/bundle-manifest.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";
import { VERSION } from "../version.js";
import { formatCliCommand } from "./command-format.js";

export type BundleUpdateCliOptions = {
  check?: boolean;
  json?: boolean;
  restart?: boolean;
  channel?: string;
  timeout?: string;
};

async function restartServiceIfPresent(): Promise<string | null> {
  try {
    const mod = await import("./daemon-cli.js");
    const ok = await mod.runDaemonRestart({ json: true });
    return ok ? "restarted" : "not restarted";
  } catch (err) {
    return `restart failed: ${String(err)}`;
  }
}

function renderOutcome(out: BundleUpdateOutcome, restart: string | null): string[] {
  const lines: string[] = [];
  lines.push(`${theme.muted("Channel:")} ${out.channel}  ${theme.muted("Repo:")} ${out.repo}`);
  lines.push(`${theme.muted("Current:")} ${out.currentVersion}`);
  if (!out.latestVersion) {
    lines.push(`${theme.muted("Latest:")} no release found for this channel`);
    return lines;
  }
  lines.push(`${theme.muted("Latest:")} ${out.latestVersion} (${out.tag})`);
  if (!out.available) {
    lines.push(theme.success("Already up to date."));
    return lines;
  }
  if (!out.performed) {
    lines.push(`Update available: ${out.asset}`);
    lines.push(theme.muted(`Run ${formatCliCommand("kolo update")} to install it.`));
    return lines;
  }
  if (out.apply?.mode === "applied") {
    lines.push(theme.success(`Updated to ${out.latestVersion}.`));
    lines.push(theme.muted(`Previous version kept in ${out.apply.previousDir}`));
    if (restart) {
      lines.push(`${theme.muted("Service:")} ${restart}`);
    }
  } else if (out.apply?.mode === "staged") {
    lines.push(theme.success(`Update ${out.latestVersion} downloaded and verified.`));
    lines.push(
      `It is applied the next time ${formatCliCommand("kolo")} starts. If the gateway service is running, stop it first: ${formatCliCommand("kolo service stop")}, run any ${formatCliCommand("kolo")} command, then ${formatCliCommand("kolo service start")}.`,
    );
  }
  return lines;
}

/** Returns true when this CLI runs from a bundle (and the update was handled here). */
export async function maybeRunBundleUpdate(
  opts: BundleUpdateCliOptions,
  bundle: BundleInfo | null = resolveBundleInfo(),
): Promise<boolean> {
  if (!bundle) {
    return false;
  }
  const manifest = readBundleManifest(bundle.root);
  if (!manifest) {
    defaultRuntime.error(`bundle manifest unreadable at ${bundle.root}`);
    defaultRuntime.exit(1);
    return true;
  }
  const timeoutMs = opts.timeout ? Number.parseInt(opts.timeout, 10) * 1000 : undefined;
  if (timeoutMs !== undefined && (Number.isNaN(timeoutMs) || timeoutMs <= 0)) {
    defaultRuntime.error("--timeout must be a positive integer (seconds)");
    defaultRuntime.exit(1);
    return true;
  }
  const snapshot = await readConfigFileSnapshot().catch(() => null);
  const configChannel = snapshot?.valid ? (snapshot.config.update?.channel ?? null) : null;
  const channel = resolveBundleUpdateChannel({ flag: opts.channel, configChannel });

  try {
    const out = await runBundleUpdate({
      bundle,
      manifest,
      currentVersion: manifest.version || VERSION,
      channel,
      checkOnly: Boolean(opts.check),
      timeoutMs,
      log: (message) => {
        if (!opts.json) {
          defaultRuntime.log(theme.muted(message));
        }
      },
    });
    let restart: string | null = null;
    if (out.performed && out.apply?.mode === "applied" && opts.restart !== false) {
      restart = await restartServiceIfPresent();
    }
    if (opts.json) {
      defaultRuntime.log(JSON.stringify({ installKind: "bundle", ...out, restart }, null, 2));
    } else {
      for (const line of renderOutcome(out, restart)) {
        defaultRuntime.log(line);
      }
    }
    return true;
  } catch (err) {
    if (opts.json) {
      defaultRuntime.log(
        JSON.stringify(
          {
            installKind: "bundle",
            ok: false,
            error: String(err),
            refused: err instanceof ChecksumMismatchError,
          },
          null,
          2,
        ),
      );
    } else {
      defaultRuntime.error(
        err instanceof ChecksumMismatchError
          ? `Update refused: ${err.message}. Nothing was changed.`
          : `Update failed: ${String(err)}`,
      );
    }
    defaultRuntime.exit(1);
    return true;
  }
}
