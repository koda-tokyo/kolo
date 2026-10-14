import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseSchtasksQuery, readScheduledTaskCommand, resolveTaskScriptPath } from "./schtasks.js";

describe("schtasks runtime parsing", () => {
  it("parses status and last run info", () => {
    const output = [
      "TaskName: \\KoLo Gateway",
      "Status: Ready",
      "Last Run Time: 1/8/2026 1:23:45 AM",
      "Last Run Result: 0x0",
    ].join("\r\n");
    expect(parseSchtasksQuery(output)).toEqual({
      status: "Ready",
      lastRunTime: "1/8/2026 1:23:45 AM",
      lastRunResult: "0x0",
    });
  });

  it("parses running status", () => {
    const output = [
      "TaskName: \\KoLo Gateway",
      "Status: Running",
      "Last Run Time: 1/8/2026 1:23:45 AM",
      "Last Run Result: 0x0",
    ].join("\r\n");
    expect(parseSchtasksQuery(output)).toEqual({
      status: "Running",
      lastRunTime: "1/8/2026 1:23:45 AM",
      lastRunResult: "0x0",
    });
  });
});

describe("resolveTaskScriptPath", () => {
  it("uses default path when KOLO_PROFILE is default", () => {
    const env = { USERPROFILE: "C:\\Users\\test", KOLO_PROFILE: "default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".kolo", "gateway.cmd"));
  });

  it("uses default path when KOLO_PROFILE is unset", () => {
    const env = { USERPROFILE: "C:\\Users\\test" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".kolo", "gateway.cmd"));
  });

  it("uses profile-specific path when KOLO_PROFILE is set to a custom value", () => {
    const env = { USERPROFILE: "C:\\Users\\test", KOLO_PROFILE: "jbphoenix" };
    expect(resolveTaskScriptPath(env)).toBe(
      path.join("C:\\Users\\test", ".kolo-jbphoenix", "gateway.cmd"),
    );
  });

  it("prefers KOLO_STATE_DIR over profile-derived defaults", () => {
    const env = {
      USERPROFILE: "C:\\Users\\test",
      KOLO_PROFILE: "rescue",
      KOLO_STATE_DIR: "C:\\State\\KoLo",
    };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\State\\KoLo", "gateway.cmd"));
  });

  it("handles case-insensitive 'Default' profile", () => {
    const env = { USERPROFILE: "C:\\Users\\test", KOLO_PROFILE: "Default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".kolo", "gateway.cmd"));
  });

  it("handles case-insensitive 'DEFAULT' profile", () => {
    const env = { USERPROFILE: "C:\\Users\\test", KOLO_PROFILE: "DEFAULT" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("C:\\Users\\test", ".kolo", "gateway.cmd"));
  });

  it("trims whitespace from KOLO_PROFILE", () => {
    const env = { USERPROFILE: "C:\\Users\\test", KOLO_PROFILE: "  myprofile  " };
    expect(resolveTaskScriptPath(env)).toBe(
      path.join("C:\\Users\\test", ".kolo-myprofile", "gateway.cmd"),
    );
  });

  it("falls back to HOME when USERPROFILE is not set", () => {
    const env = { HOME: "/home/test", KOLO_PROFILE: "default" };
    expect(resolveTaskScriptPath(env)).toBe(path.join("/home/test", ".kolo", "gateway.cmd"));
  });
});

describe("readScheduledTaskCommand", () => {
  it("parses basic command script", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".kolo", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "node gateway.js --port 18789"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js", "--port", "18789"],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses script with working directory", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".kolo", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "cd /d C:\\Projects\\KoLo", "node gateway.js"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js"],
        workingDirectory: "C:\\Projects\\KoLo",
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses script with environment variables", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".kolo", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "set NODE_ENV=production", "set PORT=18789", "node gateway.js"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js"],
        environment: {
          NODE_ENV: "production",
          PORT: "18789",
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses script with quoted arguments containing spaces", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".kolo", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      // Use forward slashes which work in Windows cmd and avoid escape parsing issues
      await fs.writeFile(
        scriptPath,
        ["@echo off", '"C:/Program Files/Node/node.exe" gateway.js'].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["C:/Program Files/Node/node.exe", "gateway.js"],
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when script does not exist", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns null when script has no command", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".kolo", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        ["@echo off", "rem This is just a comment"].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("parses full script with all components", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
    try {
      const scriptPath = path.join(tmpDir, ".kolo", "gateway.cmd");
      await fs.mkdir(path.dirname(scriptPath), { recursive: true });
      await fs.writeFile(
        scriptPath,
        [
          "@echo off",
          "rem KoLo Gateway",
          "cd /d C:\\Projects\\KoLo",
          "set NODE_ENV=production",
          "set KOLO_PORT=18789",
          "node gateway.js --verbose",
        ].join("\r\n"),
        "utf8",
      );

      const env = { USERPROFILE: tmpDir, KOLO_PROFILE: "default" };
      const result = await readScheduledTaskCommand(env);
      expect(result).toEqual({
        programArguments: ["node", "gateway.js", "--verbose"],
        workingDirectory: "C:\\Projects\\KoLo",
        environment: {
          NODE_ENV: "production",
          KOLO_PORT: "18789",
        },
      });
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

import { PassThrough } from "node:stream";
// --- install / uninstall against a fake `schtasks` on PATH (M8) ---------------------------------
// The real binary only exists on Windows; the stub logs its argv as JSON lines and can be told to
// reject the /XML form so the argument fallback is covered too.
import {
  buildTaskLauncherVbs,
  buildTaskXml,
  encodeTaskXml,
  installScheduledTask,
  resolveTaskLauncherPath,
  resolveTaskXmlPath,
  uninstallScheduledTask,
} from "./schtasks.js";

async function withSchtasksStub(
  options: { rejectXml?: boolean },
  run: (context: {
    env: Record<string, string | undefined>;
    logPath: string;
    home: string;
  }) => Promise<void>,
) {
  const originalPath = process.env.PATH;
  const originalLog = process.env.KOLO_TEST_SCHTASKS_LOG;
  const originalReject = process.env.KOLO_TEST_SCHTASKS_REJECT_XML;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-schtasks-test-"));
  try {
    const binDir = path.join(tmpDir, "bin");
    const homeDir = path.join(tmpDir, "home");
    const logPath = path.join(tmpDir, "schtasks.log");
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });
    const stubJsPath = path.join(binDir, "schtasks.js");
    await fs.writeFile(
      stubJsPath,
      [
        'import fs from "node:fs";',
        "const args = process.argv.slice(2);",
        "const logPath = process.env.KOLO_TEST_SCHTASKS_LOG;",
        'if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + "\\n", "utf8");',
        'if (args.includes("/XML") && process.env.KOLO_TEST_SCHTASKS_REJECT_XML === "1") {',
        '  process.stderr.write("ERROR: The task XML is malformed.");',
        "  process.exit(1);",
        "}",
        "process.exit(0);",
        "",
      ].join("\n"),
      "utf8",
    );
    if (process.platform === "win32") {
      await fs.writeFile(
        path.join(binDir, "schtasks.cmd"),
        `@echo off\r\nnode "%~dp0\\schtasks.js" %*\r\n`,
        "utf8",
      );
    } else {
      const shPath = path.join(binDir, "schtasks");
      await fs.writeFile(
        shPath,
        `#!/bin/sh\nexec node "$(dirname "$0")/schtasks.js" "$@"\n`,
        "utf8",
      );
      await fs.chmod(shPath, 0o755);
    }
    process.env.KOLO_TEST_SCHTASKS_LOG = logPath;
    process.env.KOLO_TEST_SCHTASKS_REJECT_XML = options.rejectXml ? "1" : "0";
    process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ""}`;
    await run({
      env: {
        USERPROFILE: homeDir,
        HOME: homeDir,
        KOLO_PROFILE: "default",
        USERNAME: "eval",
        USERDOMAIN: "PC",
      },
      logPath,
      home: homeDir,
    });
  } finally {
    process.env.PATH = originalPath;
    if (originalLog === undefined) {
      delete process.env.KOLO_TEST_SCHTASKS_LOG;
    } else {
      process.env.KOLO_TEST_SCHTASKS_LOG = originalLog;
    }
    if (originalReject === undefined) {
      delete process.env.KOLO_TEST_SCHTASKS_REJECT_XML;
    } else {
      process.env.KOLO_TEST_SCHTASKS_REJECT_XML = originalReject;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function readCalls(logPath: string): Promise<string[][]> {
  return (await fs.readFile(logPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

describe("task definition", () => {
  it("has no execution time limit, restarts on failure and runs hidden through wscript", () => {
    const xml = buildTaskXml({
      description: "KoLo Gateway",
      launcherPath: "C:\\Users\\eval\\.kolo\\gateway.vbs",
      userId: "PC\\eval",
    });
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<RestartOnFailure>");
    expect(xml).toContain("<Hidden>true</Hidden>");
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<UserId>PC\\eval</UserId>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toContain("<Command>wscript.exe</Command>");
    expect(xml).toContain(
      '<Arguments>//B //Nologo "C:\\Users\\eval\\.kolo\\gateway.vbs"</Arguments>',
    );
    expect(xml).toContain("<LogonType>InteractiveToken</LogonType>");
    const encoded = encodeTaskXml(xml);
    expect(encoded[0]).toBe(0xff);
    expect(encoded[1]).toBe(0xfe);
    expect(encoded.subarray(2).toString("utf16le")).toBe(xml);
  });

  it("omits UserId when the user is unknown and escapes XML", () => {
    const xml = buildTaskXml({
      description: "a & b <c>",
      launcherPath: "C:\\x\\g.vbs",
      userId: null,
    });
    expect(xml).not.toContain("<UserId>");
    expect(xml).toContain("<Description>a &amp; b &lt;c&gt;</Description>");
  });

  it("builds a hidden launcher that runs the task script", () => {
    const vbs = buildTaskLauncherVbs("C:\\Users\\eval\\.kolo\\gateway.cmd");
    expect(vbs).toContain('shell.Run """C:\\Users\\eval\\.kolo\\gateway.cmd""", 0, False');
  });

  it("derives launcher and xml paths from the task script path", () => {
    const env = { USERPROFILE: "C:\\Users\\test" };
    expect(resolveTaskLauncherPath(env)).toBe(path.join("C:\\Users\\test", ".kolo", "gateway.vbs"));
    expect(resolveTaskXmlPath(env)).toBe(path.join("C:\\Users\\test", ".kolo", "gateway.task.xml"));
  });
});

// On Windows, execFile("schtasks") cannot be intercepted by a .cmd shim on PATH (a .cmd is not
// executable without a shell), so the fake never runs and the real Task Scheduler would be
// touched; the install/uninstall round trip is exercised on Linux and macOS.
describe.skipIf(process.platform === "win32")("installScheduledTask (fake schtasks)", () => {
  it("writes script, launcher and xml, registers via /XML and starts the task", async () => {
    await withSchtasksStub({}, async ({ env, logPath }) => {
      const stdout = new PassThrough();
      let printed = "";
      stdout.on("data", (chunk) => {
        printed += String(chunk);
      });
      const programArguments = [
        "C:\\kolo\\node\\node.exe",
        "C:\\kolo\\lib\\dist\\entry.js",
        "gateway",
        "--port",
        "18789",
      ];
      const { scriptPath } = await installScheduledTask({
        env,
        stdout,
        programArguments,
        workingDirectory: "C:\\kolo\\lib",
        environment: { KOLO_HOME: "C:\\Users\\eval\\.kolo", KOLO_SERVICE_VERSION: "2026.10.16" },
      });
      const calls = await readCalls(logPath);
      const xmlPath = resolveTaskXmlPath(env);
      expect(calls[0]).toEqual(["/Query"]);
      expect(calls).toContainEqual(["/Create", "/F", "/TN", "KoLo Gateway", "/XML", xmlPath]);
      expect(calls).toContainEqual(["/Run", "/TN", "KoLo Gateway"]);
      expect(calls.some((c) => c.includes("/SC"))).toBe(false);

      const script = await fs.readFile(scriptPath, "utf8");
      expect(script).toContain("cd /d C:\\kolo\\lib");
      expect(script).toContain("set KOLO_HOME=C:\\Users\\eval\\.kolo");
      expect(script).toContain(
        "C:\\kolo\\node\\node.exe C:\\kolo\\lib\\dist\\entry.js gateway --port 18789",
      );
      const vbs = await fs.readFile(resolveTaskLauncherPath(env), "utf8");
      expect(vbs).toContain(scriptPath.replace(/"/g, '""'));
      const xmlBytes = await fs.readFile(xmlPath);
      expect(xmlBytes[0]).toBe(0xff);
      const xml = xmlBytes.subarray(2).toString("utf16le");
      expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
      expect(xml).toContain("<UserId>PC\\eval</UserId>");
      expect(xml).toContain(resolveTaskLauncherPath(env).replace(/\\/g, "\\"));
      expect(printed).toContain("Installed Scheduled Task");
      expect(printed).toContain("Task definition");

      // The service inspector still reads the command from gateway.cmd.
      const read = await readScheduledTaskCommand(env);
      expect(read?.programArguments).toEqual(programArguments);
      expect(read?.workingDirectory).toBe("C:\\kolo\\lib");
    });
  });

  it("falls back to the argument form when /XML is rejected", async () => {
    await withSchtasksStub({ rejectXml: true }, async ({ env, logPath }) => {
      const stdout = new PassThrough();
      stdout.resume();
      await installScheduledTask({
        env,
        stdout,
        programArguments: ["node.exe", "entry.js", "gateway"],
      });
      const calls = await readCalls(logPath);
      const xmlCall = calls.find((c) => c.includes("/XML"));
      expect(xmlCall).toBeDefined();
      const argCall = calls.find((c) => c.includes("/SC"));
      expect(argCall).toBeDefined();
      expect(argCall).toContain("ONLOGON");
      expect(argCall).toContain("/RU");
      const tr = argCall?.[argCall.indexOf("/TR") + 1] ?? "";
      expect(tr).toContain("wscript.exe //B //Nologo");
      expect(tr).toContain("gateway.vbs");
      expect(calls.at(-1)).toEqual(["/Run", "/TN", "KoLo Gateway"]);
    });
  });

  it("uninstall deletes the task and removes script, launcher and xml", async () => {
    await withSchtasksStub({}, async ({ env, logPath }) => {
      const stdout = new PassThrough();
      stdout.resume();
      await installScheduledTask({
        env,
        stdout,
        programArguments: ["node.exe", "entry.js", "gateway"],
      });
      await uninstallScheduledTask({ env, stdout });
      const calls = await readCalls(logPath);
      expect(calls).toContainEqual(["/Delete", "/F", "/TN", "KoLo Gateway"]);
      for (const file of [
        resolveTaskScriptPath(env),
        resolveTaskLauncherPath(env),
        resolveTaskXmlPath(env),
      ]) {
        await expect(fs.access(file)).rejects.toThrow();
      }
    });
  });
});
