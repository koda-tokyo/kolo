import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecResult, ServiceExec } from "./exec.js";
import { defaultKoloHome } from "../../config/kolo-home.js";
import { parseLaunchctlPrint } from "./backend-launchd.js";
import { parseSchtasksList } from "./backend-schtasks.js";
import {
  createSystemdBackend,
  parseSystemctlShow,
  systemdStateFromShow,
} from "./backend-systemd.js";
import { parseEnvFile } from "./env-file.js";
import { normalizeServiceId, resolveServiceIdentity } from "./identity.js";
import { resolveLaunchSpec } from "./index.js";
import {
  buildSchtasksCreateArgs,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsTaskScript,
  systemdQuote,
  windowsTaskScriptPath,
} from "./render.js";
import { parseRunnerArgs } from "./runner.js";

const realPlatform = process.platform;
function mockPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}
afterEach(() => mockPlatform(realPlatform));

// Host-independent fixtures; snapshots use POSIX paths, so skip them on a Windows host.
const posixHost = realPlatform !== "win32";
const HOMEDIR = "/home/tester";
const env = { HOME: HOMEDIR, PATH: "/usr/bin:/bin" };
// Per-OS default state root for the fixture home (~/.kolo, or <home>\AppData\Local\KoLo on Windows).
const DEFAULT_HOME = defaultKoloHome({ env, homedir: () => HOMEDIR });

function specFor(platform: NodeJS.Platform) {
  mockPlatform(platform);
  const identity = resolveServiceIdentity({ id: "smoke", port: 18800, env, homedir: HOMEDIR });
  return resolveLaunchSpec({
    identity,
    env,
    platform: process.platform,
    nodePath: "/opt/node/bin/node",
    distRoot: "/opt/kolo/dist",
    version: "2.0.0-test",
  });
}

describe("service identity", () => {
  it("gives every identity its own names, state root and port", () => {
    const id = resolveServiceIdentity({ id: "Iris", port: 18791, env, homedir: HOMEDIR });
    expect(id).toMatchObject({
      id: "iris",
      home: `${DEFAULT_HOME}-iris`,
      port: 18791,
      systemdUnit: "kolo-gateway@iris.service",
      launchdLabel: "com.kodasoken.kolo.iris",
      windowsTaskName: "KoLo\\gateway-iris",
      envFile: path.join(`${DEFAULT_HOME}-iris`, "env"),
    });
  });

  it("maps the default identity to KOLO_HOME or ~/.kolo", () => {
    expect(resolveServiceIdentity({ env, homedir: HOMEDIR }).home).toBe(DEFAULT_HOME);
    expect(
      resolveServiceIdentity({ env: { ...env, KOLO_HOME: "/srv/kolo" }, homedir: HOMEDIR }).home,
    ).toBe(path.resolve("/srv/kolo"));
  });

  it("reads the port from kolo.json when no flag is given", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-svc-"));
    try {
      fs.writeFileSync(path.join(home, "kolo.json"), JSON.stringify({ gateway: { port: 19001 } }));
      const id = resolveServiceIdentity({ id: "x", home });
      expect(id.port).toBe(19001);
      expect(id.portSource).toBe("config");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("rejects ids that are unsafe as unit names", () => {
    expect(() => normalizeServiceId("../etc")).toThrow(/invalid service id/);
    expect(() => normalizeServiceId("a b")).toThrow(/invalid service id/);
    expect(normalizeServiceId("lobi_2")).toBe("lobi_2");
  });
});

describe.runIf(posixHost)("service definitions (snapshot per platform)", () => {
  it("linux: systemd --user instance unit", () => {
    const unit = renderSystemdUnit(specFor("linux"));
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("RestartSec=3");
    expect(unit).toContain("KillMode=mixed");
    expect(unit).toContain(`EnvironmentFile=-${HOMEDIR}/.kolo-smoke/env`);
    expect(unit).not.toMatch(/TOKEN=/);
    expect(unit).toMatchSnapshot();
  });

  it("darwin: launchd plist with KeepAlive and the env-file runner", () => {
    const plist = renderLaunchdPlist(specFor("darwin"));
    expect(plist).toContain("<key>KeepAlive</key>\n    <true/>");
    expect(plist).toContain("<string>com.kodasoken.kolo.smoke</string>");
    expect(plist).toMatchSnapshot();
  });

  it("win32: task script and schtasks argv", () => {
    const spec = specFor("win32");
    const script = renderWindowsTaskScript(spec);
    expect(script).toContain("--restart-loop");
    expect(script.split("\r\n")[0]).toBe("@echo off");
    expect(script).toMatchSnapshot();
    const args = buildSchtasksCreateArgs({
      identity: spec.identity,
      scriptPath: windowsTaskScriptPath(spec.identity),
      user: "HOST\\tester",
    });
    expect(args).toMatchSnapshot();
    expect(args).toContain("ONLOGON");
  });
});

describe("escaping", () => {
  it("quotes systemd args with spaces and escapes specifiers", () => {
    expect(systemdQuote("/opt/node/bin/node")).toBe("/opt/node/bin/node");
    expect(systemdQuote("/Users/a b/x")).toBe('"/Users/a b/x"');
    expect(systemdQuote("50%$HOME")).toBe("50%%$$HOME");
  });
});

describe("OS output parsers", () => {
  it("systemctl show", () => {
    const props = parseSystemctlShow(
      "LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=4321\nNRestarts=2\n",
    );
    expect(props.MainPID).toBe("4321");
    expect(systemdStateFromShow(props)).toBe("running");
    expect(systemdStateFromShow({ LoadState: "not-found", ActiveState: "inactive" })).toBe(
      "not-installed",
    );
    expect(systemdStateFromShow({ LoadState: "loaded", ActiveState: "failed" })).toBe("failed");
  });

  it("launchctl print", () => {
    const info = parseLaunchctlPrint(
      "gui/501/com.kodasoken.kolo.smoke = {\n\tstate = running\n\tpid = 777\n\truns = 3\n\tlast exit code = 0\n}",
    );
    expect(info).toEqual({ state: "running", pid: 777, runs: 3, lastExitCode: 0 });
  });

  it("schtasks /Query /V list", () => {
    const info = parseSchtasksList(
      "TaskName:      \\KoLo\\gateway-smoke\r\nStatus:        Running\r\nLast Result:   267009\r\n",
    );
    expect(info.Status).toBe("Running");
    expect(info["Last Result"]).toBe("267009");
  });

  it("env file", () => {
    expect(
      parseEnvFile("# c\nexport A=1\nB=\"two words\"\nC='x'\n bad line\nKOLO_GATEWAY_TOKEN=abc\n"),
    ).toEqual({ A: "1", B: "two words", C: "x", KOLO_GATEWAY_TOKEN: "abc" });
  });

  it("runner argv", () => {
    expect(
      parseRunnerArgs([
        "--env-file",
        "/e",
        "--restart-loop",
        "--restart-sec",
        "3",
        "--",
        "node",
        "x",
      ]),
    ).toEqual({ envFile: "/e", restartLoop: true, restartSec: 3, command: ["node", "x"] });
    expect(() => parseRunnerArgs(["--env-file", "/e"])).toThrow(/missing command/);
  });
});

describe("systemd backend (fake exec)", () => {
  it("install writes the unit, reloads, enables and restarts", async () => {
    const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-xdg-"));
    const calls: string[] = [];
    const exec: ServiceExec = async (cmd, args): Promise<ExecResult> => {
      calls.push([cmd, ...args].join(" "));
      return { code: 0, stdout: cmd === "loginctl" ? "Linger=yes\n" : "", stderr: "" };
    };
    try {
      const backend = createSystemdBackend({
        exec,
        env: { XDG_CONFIG_HOME: xdg, USER: "tester" },
        homedir: HOMEDIR,
      });
      const spec = specFor("linux");
      const lines = await backend.install(spec, { start: true });
      const unitFile = path.join(xdg, "systemd", "user", "kolo-gateway@smoke.service");
      expect(fs.readFileSync(unitFile, "utf8")).toBe(renderSystemdUnit(spec));
      expect(calls).toEqual([
        "systemctl --user show-environment",
        "systemctl --user daemon-reload",
        "systemctl --user enable kolo-gateway@smoke.service",
        "systemctl --user restart kolo-gateway@smoke.service",
        "loginctl show-user tester -p Linger",
      ]);
      expect(lines[0]).toBe(`unit: ${unitFile}`);
    } finally {
      fs.rmSync(xdg, { recursive: true, force: true });
    }
  });

  it("status maps systemctl show to OS process state", async () => {
    const exec: ServiceExec = async () => ({
      code: 0,
      stdout:
        "LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=99\nNRestarts=4\nExecMainStatus=0\nUnitFileState=enabled\nFragmentPath=/u\n",
      stderr: "",
    });
    const backend = createSystemdBackend({ exec, env: {}, homedir: HOMEDIR });
    const status = await backend.status(specFor("linux").identity);
    expect(status).toMatchObject({
      state: "running",
      pid: 99,
      restarts: 4,
      enabled: true,
      installed: true,
      definitionPath: "/u",
    });
  });
});
