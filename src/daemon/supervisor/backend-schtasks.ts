import fs from "node:fs/promises";
import path from "node:path";
import type { ServiceIdentity } from "./identity.js";
import type { ServiceBackend, ServiceBackendDeps, ServiceStatus } from "./types.js";
import { readTailBytes } from "./log-tail.js";
import {
  buildSchtasksCreateArgs,
  renderWindowsTaskScript,
  windowsTaskScriptPath,
} from "./render.js";
import { assertOk } from "./types.js";

/** Parse `schtasks /Query /FO LIST /V` output (English locale keys; values kept raw). */
export function parseSchtasksList(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      if (key && !(key in out)) {
        out[key] = line.slice(idx + 1).trim();
      }
    }
  }
  return out;
}

type PidFile = { pid?: number; runnerPid?: number };

async function readPidFile(identity: ServiceIdentity): Promise<PidFile> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(identity.runDir, "gateway.pid"), "utf8"),
    ) as PidFile;
  } catch {
    return {};
  }
}

function alive(pid: number | undefined): pid is number {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function createSchtasksBackend(deps: ServiceBackendDeps): ServiceBackend {
  const schtasks = (args: string[]) => deps.exec("schtasks", args);
  const taskUser = () => {
    const user = deps.env.USERNAME?.trim();
    const domain = deps.env.USERDOMAIN?.trim();
    return user ? (domain ? `${domain}\\${user}` : user) : undefined;
  };

  const killRunner = async (identity: ServiceIdentity) => {
    // Kill the runner first so its restart loop cannot respawn, then the gateway itself.
    // Explicit pids from our own pid file: never match process names.
    const pids = await readPidFile(identity);
    for (const pid of [pids.runnerPid, pids.pid]) {
      if (alive(pid)) {
        try {
          process.kill(pid);
        } catch {
          // exited meanwhile
        }
      }
    }
    await fs.rm(path.join(identity.runDir, "gateway.pid"), { force: true });
  };

  const backend: ServiceBackend = {
    manager: "schtasks",
    definitionPath: windowsTaskScriptPath,

    async install(spec, opts) {
      const scriptPath = windowsTaskScriptPath(spec.identity);
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.mkdir(spec.identity.logDir, { recursive: true });
      await fs.writeFile(scriptPath, renderWindowsTaskScript(spec), "utf8");
      const user = taskUser();
      let res = await schtasks(
        buildSchtasksCreateArgs({ identity: spec.identity, scriptPath, user }),
      );
      if (res.code !== 0 && user) {
        res = await schtasks(buildSchtasksCreateArgs({ identity: spec.identity, scriptPath }));
      }
      if (res.code !== 0 && /access is denied/i.test(res.stderr + res.stdout)) {
        throw new Error(
          "schtasks /Create was denied. Run the install once from an elevated PowerShell, or ask an administrator to allow logon tasks.",
        );
      }
      assertOk(res, `schtasks /Create ${spec.identity.windowsTaskName}`);
      const lines = [`task: \\${spec.identity.windowsTaskName}`, `script: ${scriptPath}`];
      if (opts.start) {
        await backend.restart(spec.identity);
        lines.push(`started: ${spec.identity.windowsTaskName}`);
      }
      return lines;
    },

    async uninstall(identity) {
      await backend.stop(identity).catch(() => undefined);
      await schtasks(["/Delete", "/F", "/TN", identity.windowsTaskName]);
      const scriptPath = windowsTaskScriptPath(identity);
      await fs.rm(scriptPath, { force: true });
      return [`removed: \\${identity.windowsTaskName}`, `removed: ${scriptPath}`];
    },

    async start(identity) {
      assertOk(await schtasks(["/Run", "/TN", identity.windowsTaskName]), "schtasks /Run");
    },
    async stop(identity) {
      await killRunner(identity);
      const res = await schtasks(["/End", "/TN", identity.windowsTaskName]);
      if (res.code !== 0 && !/not running|no running instance/i.test(res.stderr + res.stdout)) {
        assertOk(res, "schtasks /End");
      }
    },
    async restart(identity) {
      await backend.stop(identity);
      await backend.start(identity);
    },

    async status(identity): Promise<ServiceStatus> {
      const res = await schtasks(["/Query", "/TN", identity.windowsTaskName, "/FO", "LIST", "/V"]);
      const base: ServiceStatus = {
        manager: "schtasks",
        name: `\\${identity.windowsTaskName}`,
        installed: false,
        state: "not-installed",
        definitionPath: windowsTaskScriptPath(identity),
      };
      if (res.code !== 0) {
        return base;
      }
      const info = parseSchtasksList(res.stdout);
      const taskStatus = info.Status ?? "";
      const pids = await readPidFile(identity);
      const gatewayAlive = alive(pids.pid);
      const exit = Number.parseInt(info["Last Result"] ?? "", 10);
      return {
        ...base,
        installed: true,
        enabled: !/disabled/i.test(info["Scheduled Task State"] ?? taskStatus),
        // Task Scheduler says whether the action (runner) runs; the pid confirms the gateway child.
        state: /running/i.test(taskStatus) ? (gatewayAlive ? "running" : "starting") : "stopped",
        pid: gatewayAlive ? pids.pid : undefined,
        lastExitCode: Number.isFinite(exit) ? exit : undefined,
        since: info["Last Run Time"],
        detail: taskStatus || undefined,
      };
    },

    async logs(identity, opts) {
      const file = path.join(identity.logDir, "gateway.log");
      const text = await readTailBytes(file, opts.maxBytes, opts.lines);
      return text || `(no log yet at ${file})`;
    },
  };
  return backend;
}
