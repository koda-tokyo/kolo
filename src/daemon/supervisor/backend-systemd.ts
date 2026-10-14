import fs from "node:fs/promises";
import path from "node:path";
import type { ServiceIdentity } from "./identity.js";
import type { ServiceBackend, ServiceBackendDeps, ServiceState, ServiceStatus } from "./types.js";
import { tailBytes } from "./exec.js";
import { renderSystemdUnit } from "./render.js";
import { assertOk } from "./types.js";

export function systemdUserUnitDir(deps: Pick<ServiceBackendDeps, "env" | "homedir">): string {
  const xdg = deps.env.XDG_CONFIG_HOME?.trim();
  return path.join(xdg || path.join(deps.homedir, ".config"), "systemd", "user");
}

export function parseSystemctlShow(output: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      out[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return out;
}

export function systemdStateFromShow(props: Record<string, string>): ServiceState {
  if (props.LoadState === "not-found") {
    return "not-installed";
  }
  switch (props.ActiveState) {
    case "active":
    case "reloading":
      return "running";
    case "activating":
      return "starting";
    case "deactivating":
      return "stopping";
    case "failed":
      return "failed";
    case "inactive":
      return "stopped";
    default:
      return "unknown";
  }
}

export function createSystemdBackend(deps: ServiceBackendDeps): ServiceBackend {
  const systemctl = (args: string[]) => deps.exec("systemctl", ["--user", ...args]);
  const unitPath = (identity: ServiceIdentity) =>
    path.join(systemdUserUnitDir(deps), identity.systemdUnit);

  const backend: ServiceBackend = {
    manager: "systemd",
    definitionPath: unitPath,

    async install(spec, opts) {
      const probe = await systemctl(["show-environment"]);
      if (probe.code !== 0) {
        throw new Error(
          "systemd --user is not available in this session. On WSL enable systemd in /etc/wsl.conf ([boot] systemd=true); on servers run `loginctl enable-linger $USER` and log in again.",
        );
      }
      const file = unitPath(spec.identity);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, renderSystemdUnit(spec), { mode: 0o644 });
      assertOk(await systemctl(["daemon-reload"]), "systemctl --user daemon-reload");
      assertOk(
        await systemctl(["enable", spec.identity.systemdUnit]),
        `systemctl --user enable ${spec.identity.systemdUnit}`,
      );
      const lines = [`unit: ${file}`];
      if (opts.start) {
        assertOk(
          await systemctl(["restart", spec.identity.systemdUnit]),
          `systemctl --user restart ${spec.identity.systemdUnit}`,
        );
        lines.push(`started: ${spec.identity.systemdUnit}`);
      }
      const linger = await deps.exec("loginctl", [
        "show-user",
        deps.user ?? deps.env.USER ?? "",
        "-p",
        "Linger",
      ]);
      if (linger.code === 0 && /Linger=no/.test(linger.stdout)) {
        lines.push(
          "note: user lingering is off, so the gateway stops when you log out. Enable with: loginctl enable-linger",
        );
      }
      return lines;
    },

    async uninstall(identity) {
      await systemctl(["disable", "--now", identity.systemdUnit]);
      const file = unitPath(identity);
      await fs.rm(file, { force: true });
      await systemctl(["daemon-reload"]);
      await systemctl(["reset-failed", identity.systemdUnit]);
      return [`removed: ${file}`];
    },

    async start(identity) {
      assertOk(await systemctl(["start", identity.systemdUnit]), `start ${identity.systemdUnit}`);
    },
    async stop(identity) {
      assertOk(await systemctl(["stop", identity.systemdUnit]), `stop ${identity.systemdUnit}`);
    },
    async restart(identity) {
      assertOk(
        await systemctl(["restart", identity.systemdUnit]),
        `restart ${identity.systemdUnit}`,
      );
    },

    async status(identity): Promise<ServiceStatus> {
      const res = await systemctl([
        "show",
        identity.systemdUnit,
        "--no-pager",
        "-p",
        "LoadState,ActiveState,SubState,MainPID,NRestarts,ExecMainStatus,ActiveEnterTimestamp,UnitFileState,FragmentPath",
      ]);
      const base: ServiceStatus = {
        manager: "systemd",
        name: identity.systemdUnit,
        installed: false,
        state: "unknown",
        definitionPath: unitPath(identity),
      };
      if (res.code !== 0) {
        return { ...base, detail: (res.stderr || res.stdout).trim().slice(0, 300) };
      }
      const props = parseSystemctlShow(res.stdout);
      const state = systemdStateFromShow(props);
      const pid = Number.parseInt(props.MainPID ?? "", 10);
      const restarts = Number.parseInt(props.NRestarts ?? "", 10);
      const exit = Number.parseInt(props.ExecMainStatus ?? "", 10);
      return {
        ...base,
        installed: state !== "not-installed",
        enabled: props.UnitFileState === "enabled",
        state,
        pid: pid > 0 ? pid : undefined,
        restarts: Number.isFinite(restarts) ? restarts : undefined,
        lastExitCode: Number.isFinite(exit) ? exit : undefined,
        since: props.ActiveEnterTimestamp || undefined,
        detail: `${props.ActiveState ?? "?"} (${props.SubState ?? "?"})`,
        definitionPath: props.FragmentPath || base.definitionPath,
      };
    },

    async logs(identity, opts) {
      const res = await deps.exec("journalctl", [
        "--user",
        "-u",
        identity.systemdUnit,
        "-n",
        String(opts.lines),
        "--no-pager",
        "-o",
        "short-iso",
      ]);
      const text = res.code === 0 ? res.stdout : `journalctl failed: ${res.stderr || res.stdout}`;
      return tailBytes(text, opts.maxBytes);
    },
  };
  return backend;
}
