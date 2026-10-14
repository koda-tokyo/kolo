import fs from "node:fs/promises";
import path from "node:path";
import type { ServiceIdentity } from "./identity.js";
import type { ServiceBackend, ServiceBackendDeps, ServiceStatus } from "./types.js";
import { readTailBytes } from "./log-tail.js";
import { renderLaunchdPlist } from "./render.js";
import { assertOk } from "./types.js";

/** Parse the bits of `launchctl print gui/<uid>/<label>` we report. */
export function parseLaunchctlPrint(output: string): {
  state?: string;
  pid?: number;
  lastExitCode?: number;
  runs?: number;
} {
  const pick = (re: RegExp) => output.match(re)?.[1]?.trim();
  const pid = Number.parseInt(pick(/^\s*pid = (\d+)/m) ?? "", 10);
  const exit = Number.parseInt(pick(/^\s*last exit code = (-?\d+)/m) ?? "", 10);
  const runs = Number.parseInt(pick(/^\s*runs = (\d+)/m) ?? "", 10);
  return {
    state: pick(/^\s*state = (.+)$/m),
    pid: pid > 0 ? pid : undefined,
    lastExitCode: Number.isFinite(exit) ? exit : undefined,
    runs: Number.isFinite(runs) ? runs : undefined,
  };
}

export function createLaunchdBackend(deps: ServiceBackendDeps): ServiceBackend {
  const uid = deps.uid ?? 501;
  const domain = `gui/${uid}`;
  const target = (identity: ServiceIdentity) => `${domain}/${identity.launchdLabel}`;
  const plistPath = (identity: ServiceIdentity) =>
    path.join(deps.homedir, "Library", "LaunchAgents", `${identity.launchdLabel}.plist`);
  const launchctl = (args: string[]) => deps.exec("launchctl", args);
  const isLoaded = async (identity: ServiceIdentity) =>
    (await launchctl(["print", target(identity)])).code === 0;
  const bootstrap = async (identity: ServiceIdentity) => {
    if (!(await isLoaded(identity))) {
      assertOk(
        await launchctl(["bootstrap", domain, plistPath(identity)]),
        `launchctl bootstrap ${identity.launchdLabel}`,
      );
    }
  };

  return {
    manager: "launchd",
    definitionPath: plistPath,

    async install(spec, opts) {
      const file = plistPath(spec.identity);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.mkdir(spec.identity.logDir, { recursive: true });
      await fs.writeFile(file, renderLaunchdPlist(spec), { mode: 0o644 });
      // Reload so launchd picks up the new definition.
      await launchctl(["bootout", target(spec.identity)]);
      await launchctl(["enable", target(spec.identity)]);
      const lines = [`plist: ${file}`];
      if (opts.start) {
        await bootstrap(spec.identity);
        lines.push(`started: ${spec.identity.launchdLabel}`);
      }
      return lines;
    },

    async uninstall(identity) {
      await launchctl(["bootout", target(identity)]);
      const file = plistPath(identity);
      await fs.rm(file, { force: true });
      return [`removed: ${file}`];
    },

    async start(identity) {
      await launchctl(["enable", target(identity)]);
      await bootstrap(identity);
      assertOk(await launchctl(["kickstart", target(identity)]), "launchctl kickstart");
    },
    async stop(identity) {
      // bootout, not kill: KeepAlive would restart a killed job immediately.
      const res = await launchctl(["bootout", target(identity)]);
      if (res.code !== 0 && (await isLoaded(identity))) {
        assertOk(res, `launchctl bootout ${identity.launchdLabel}`);
      }
    },
    async restart(identity) {
      await bootstrap(identity);
      assertOk(await launchctl(["kickstart", "-k", target(identity)]), "launchctl kickstart -k");
    },

    async status(identity): Promise<ServiceStatus> {
      const file = plistPath(identity);
      const installed = await fs
        .access(file)
        .then(() => true)
        .catch(() => false);
      const base: ServiceStatus = {
        manager: "launchd",
        name: identity.launchdLabel,
        installed,
        state: installed ? "stopped" : "not-installed",
        definitionPath: file,
      };
      const res = await launchctl(["print", target(identity)]);
      if (res.code !== 0) {
        return { ...base, detail: installed ? "not loaded" : undefined };
      }
      const info = parseLaunchctlPrint(res.stdout);
      const state =
        info.state === "running"
          ? "running"
          : info.state?.includes("spawn")
            ? "starting"
            : info.lastExitCode && info.lastExitCode !== 0
              ? "failed"
              : "stopped";
      return {
        ...base,
        installed: true,
        enabled: true,
        state,
        pid: info.pid,
        restarts: info.runs !== undefined ? Math.max(info.runs - 1, 0) : undefined,
        lastExitCode: info.lastExitCode,
        detail: info.state,
      };
    },

    async logs(identity, opts) {
      // launchd sends the job's stdout/stderr to the files named in the plist.
      const half = Math.floor(opts.maxBytes / 2);
      const out = await readTailBytes(
        path.join(identity.logDir, "gateway.out.log"),
        half,
        opts.lines,
      );
      const err = await readTailBytes(
        path.join(identity.logDir, "gateway.err.log"),
        half,
        opts.lines,
      );
      return [`== stdout ==`, out || "(empty)", `== stderr ==`, err || "(empty)"].join("\n");
    },
  };
}
