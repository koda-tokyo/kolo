import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { GatewayServiceRuntime } from "./service-runtime.js";
import { colorize, isRich, theme } from "../terminal/theme.js";
import { formatGatewayServiceDescription, resolveGatewayWindowsTaskName } from "./constants.js";
import { resolveGatewayStateDir } from "./paths.js";
import { parseKeyValueOutput } from "./runtime-parse.js";

const execFileAsync = promisify(execFile);

const formatLine = (label: string, value: string) => {
  const rich = isRich();
  return `${colorize(rich, theme.muted, `${label}:`)} ${colorize(rich, theme.command, value)}`;
};

function resolveTaskName(env: Record<string, string | undefined>): string {
  const override = env.KOLO_WINDOWS_TASK_NAME?.trim();
  if (override) {
    return override;
  }
  return resolveGatewayWindowsTaskName(env.KOLO_PROFILE);
}

export function resolveTaskScriptPath(env: Record<string, string | undefined>): string {
  const override = env.KOLO_TASK_SCRIPT?.trim();
  if (override) {
    return override;
  }
  const scriptName = env.KOLO_TASK_SCRIPT_NAME?.trim() || "gateway.cmd";
  const stateDir = resolveGatewayStateDir(env);
  return path.join(stateDir, scriptName);
}

/** Hidden launcher (`gateway.vbs`) next to the task script: runs the .cmd with no console window. */
export function resolveTaskLauncherPath(env: Record<string, string | undefined>): string {
  const scriptPath = resolveTaskScriptPath(env);
  return scriptPath.replace(/\.cmd$/i, "") + ".vbs";
}

/** Task definition XML (`gateway.task.xml`) registered with `schtasks /Create /XML`. */
export function resolveTaskXmlPath(env: Record<string, string | undefined>): string {
  const scriptPath = resolveTaskScriptPath(env);
  return scriptPath.replace(/\.cmd$/i, "") + ".task.xml";
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** VBScript that starts the task script hidden (window style 0) and returns immediately. */
export function buildTaskLauncherVbs(scriptPath: string): string {
  const quoted = scriptPath.replace(/"/g, '""');
  return [
    "' KoLo gateway launcher: runs the task script without a console window.",
    'Set shell = CreateObject("WScript.Shell")',
    `shell.Run """${quoted}""", 0, False`,
    "",
  ].join("\r\n");
}

/**
 * Task Scheduler definition. Compared with `schtasks /Create /SC ONLOGON /TR`, this removes
 * the default 72 h execution limit (the gateway runs for weeks), restarts on failure, ignores
 * battery state, runs hidden and starts as soon as the user logs on after any reboot.
 */
export function buildTaskXml({
  description,
  launcherPath,
  userId,
}: {
  description?: string;
  launcherPath: string;
  userId?: string | null;
}): string {
  const userXml = userId ? `      <UserId>${xmlEscape(userId)}</UserId>\n` : "";
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    `    <Description>${xmlEscape(description ?? "KoLo Gateway")}</Description>`,
    "    <Author>KoLo</Author>",
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    userXml.replace(/\n$/, ""),
    "      <Delay>PT10S</Delay>",
    "    </LogonTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    userXml.replace(/\n$/, ""),
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <AllowHardTerminate>true</AllowHardTerminate>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    "    <Hidden>true</Hidden>",
    "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
    "    <WakeToRun>false</WakeToRun>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <Priority>7</Priority>",
    "    <RestartOnFailure>",
    "      <Interval>PT1M</Interval>",
    "      <Count>3</Count>",
    "    </RestartOnFailure>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    "      <Command>wscript.exe</Command>",
    `      <Arguments>//B //Nologo "${xmlEscape(launcherPath)}"</Arguments>`,
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    "",
  ]
    .filter((line) => line !== "")
    .join("\r\n")
    .concat("\r\n");
}

/** schtasks reads task XML as UTF-16LE with a BOM. */
export function encodeTaskXml(xml: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
}

function quoteCmdArg(value: string): string {
  if (!/[ \t"]/g.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function resolveTaskUser(env: Record<string, string | undefined>): string | null {
  const username = env.USERNAME || env.USER || env.LOGNAME;
  if (!username) {
    return null;
  }
  if (username.includes("\\")) {
    return username;
  }
  const domain = env.USERDOMAIN;
  if (domain) {
    return `${domain}\\${username}`;
  }
  return username;
}

function parseCommandLine(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let escapeNext = false;

  const chars = Array.from(value);
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    // Only `\"` is an escape (what quoteCmdArg writes); a bare backslash is a path separator.
    if (char === "\\" && chars[i + 1] === '"') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    args.push(current);
  }
  return args;
}

export async function readScheduledTaskCommand(env: Record<string, string | undefined>): Promise<{
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string>;
} | null> {
  const scriptPath = resolveTaskScriptPath(env);
  try {
    const content = await fs.readFile(scriptPath, "utf8");
    let workingDirectory = "";
    let commandLine = "";
    const environment: Record<string, string> = {};
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      if (line.startsWith("@echo")) {
        continue;
      }
      if (line.toLowerCase().startsWith("rem ")) {
        continue;
      }
      if (line.toLowerCase().startsWith("set ")) {
        const assignment = line.slice(4).trim();
        const index = assignment.indexOf("=");
        if (index > 0) {
          const key = assignment.slice(0, index).trim();
          const value = assignment.slice(index + 1).trim();
          if (key) {
            environment[key] = value;
          }
        }
        continue;
      }
      if (line.toLowerCase().startsWith("cd /d ")) {
        workingDirectory = line.slice("cd /d ".length).trim().replace(/^"|"$/g, "");
        continue;
      }
      commandLine = line;
      break;
    }
    if (!commandLine) {
      return null;
    }
    return {
      programArguments: parseCommandLine(commandLine),
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
    };
  } catch {
    return null;
  }
}

export type ScheduledTaskInfo = {
  status?: string;
  lastRunTime?: string;
  lastRunResult?: string;
};

export function parseSchtasksQuery(output: string): ScheduledTaskInfo {
  const entries = parseKeyValueOutput(output, ":");
  const info: ScheduledTaskInfo = {};
  const status = entries.status;
  if (status) {
    info.status = status;
  }
  const lastRunTime = entries["last run time"];
  if (lastRunTime) {
    info.lastRunTime = lastRunTime;
  }
  const lastRunResult = entries["last run result"];
  if (lastRunResult) {
    info.lastRunResult = lastRunResult;
  }
  return info;
}

function buildTaskScript({
  description,
  programArguments,
  workingDirectory,
  environment,
}: {
  description?: string;
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string | undefined>;
}): string {
  const lines: string[] = ["@echo off"];
  if (description?.trim()) {
    lines.push(`rem ${description.trim()}`);
  }
  if (workingDirectory) {
    lines.push(`cd /d ${quoteCmdArg(workingDirectory)}`);
  }
  if (environment) {
    for (const [key, value] of Object.entries(environment)) {
      if (!value) {
        continue;
      }
      lines.push(`set ${key}=${value}`);
    }
  }
  const command = programArguments.map(quoteCmdArg).join(" ");
  lines.push(command);
  return `${lines.join("\r\n")}\r\n`;
}

async function execSchtasks(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("schtasks", args, {
      encoding: "utf8",
      windowsHide: true,
    });
    return {
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
      code: 0,
    };
  } catch (error) {
    const e = error as {
      stdout?: unknown;
      stderr?: unknown;
      code?: unknown;
      message?: unknown;
    };
    return {
      stdout: typeof e.stdout === "string" ? e.stdout : "",
      stderr:
        typeof e.stderr === "string" ? e.stderr : typeof e.message === "string" ? e.message : "",
      code: typeof e.code === "number" ? e.code : 1,
    };
  }
}

async function assertSchtasksAvailable() {
  const res = await execSchtasks(["/Query"]);
  if (res.code === 0) {
    return;
  }
  const detail = res.stderr || res.stdout;
  throw new Error(`schtasks unavailable: ${detail || "unknown error"}`.trim());
}

export async function installScheduledTask({
  env,
  stdout,
  programArguments,
  workingDirectory,
  environment,
  description,
}: {
  env: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
  programArguments: string[];
  workingDirectory?: string;
  environment?: Record<string, string | undefined>;
  description?: string;
}): Promise<{ scriptPath: string }> {
  await assertSchtasksAvailable();
  const scriptPath = resolveTaskScriptPath(env);
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  const taskDescription =
    description ??
    formatGatewayServiceDescription({
      profile: env.KOLO_PROFILE,
      version: environment?.KOLO_SERVICE_VERSION ?? env.KOLO_SERVICE_VERSION,
    });
  const script = buildTaskScript({
    description: taskDescription,
    programArguments,
    workingDirectory,
    environment,
  });
  await fs.writeFile(scriptPath, script, "utf8");
  // Hidden launcher: the task runs wscript.exe -> gateway.vbs -> gateway.cmd with no console.
  const launcherPath = resolveTaskLauncherPath(env);
  await fs.writeFile(launcherPath, buildTaskLauncherVbs(scriptPath), "utf8");

  const taskName = resolveTaskName(env);
  const taskUser = resolveTaskUser(env);
  const xmlPath = resolveTaskXmlPath(env);
  await fs.writeFile(
    xmlPath,
    encodeTaskXml(buildTaskXml({ description: taskDescription, launcherPath, userId: taskUser })),
  );
  // Preferred: full definition (no execution time limit, restart on failure, hidden).
  let create = await execSchtasks(["/Create", "/F", "/TN", taskName, "/XML", xmlPath]);
  let registeredVia = "xml";
  if (create.code !== 0) {
    // Fallback: argument form (keeps the 72 h default limit; `kolo doctor` reports it).
    const quotedLauncher = quoteCmdArg(`wscript.exe //B //Nologo "${launcherPath}"`);
    const baseArgs = [
      "/Create",
      "/F",
      "/SC",
      "ONLOGON",
      "/RL",
      "LIMITED",
      "/TN",
      taskName,
      "/TR",
      quotedLauncher,
    ];
    create = await execSchtasks(taskUser ? [...baseArgs, "/RU", taskUser, "/NP", "/IT"] : baseArgs);
    if (create.code !== 0 && taskUser) {
      create = await execSchtasks(baseArgs);
    }
    registeredVia = "args";
  }
  if (create.code !== 0) {
    const detail = create.stderr || create.stdout;
    const hint = /access is denied/i.test(detail)
      ? " Run PowerShell as Administrator or rerun without installing the daemon."
      : "";
    throw new Error(`schtasks create failed: ${detail}${hint}`.trim());
  }

  await execSchtasks(["/Run", "/TN", taskName]);
  // Ensure we don't end up writing to a clack spinner line (wizards show progress without a newline).
  stdout.write("\n");
  stdout.write(`${formatLine("Installed Scheduled Task", taskName)}\n`);
  stdout.write(`${formatLine("Task script", scriptPath)}\n`);
  stdout.write(
    `${formatLine("Task definition", registeredVia === "xml" ? xmlPath : "schtasks arguments (no XML)")}\n`,
  );
  return { scriptPath };
}

export async function uninstallScheduledTask({
  env,
  stdout,
}: {
  env: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream;
}): Promise<void> {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(env);
  await execSchtasks(["/Delete", "/F", "/TN", taskName]);

  const scriptPath = resolveTaskScriptPath(env);
  try {
    await fs.unlink(scriptPath);
    stdout.write(`${formatLine("Removed task script", scriptPath)}\n`);
  } catch {
    stdout.write(`Task script not found at ${scriptPath}\n`);
  }
  for (const extra of [resolveTaskLauncherPath(env), resolveTaskXmlPath(env)]) {
    await fs.rm(extra, { force: true });
  }
}

function isTaskNotRunning(res: { stdout: string; stderr: string; code: number }): boolean {
  const detail = (res.stderr || res.stdout).toLowerCase();
  return detail.includes("not running");
}

export async function stopScheduledTask({
  stdout,
  env,
}: {
  stdout: NodeJS.WritableStream;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(env ?? (process.env as Record<string, string | undefined>));
  const res = await execSchtasks(["/End", "/TN", taskName]);
  if (res.code !== 0 && !isTaskNotRunning(res)) {
    throw new Error(`schtasks end failed: ${res.stderr || res.stdout}`.trim());
  }
  stdout.write(`${formatLine("Stopped Scheduled Task", taskName)}\n`);
}

export async function restartScheduledTask({
  stdout,
  env,
}: {
  stdout: NodeJS.WritableStream;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(env ?? (process.env as Record<string, string | undefined>));
  await execSchtasks(["/End", "/TN", taskName]);
  const res = await execSchtasks(["/Run", "/TN", taskName]);
  if (res.code !== 0) {
    throw new Error(`schtasks run failed: ${res.stderr || res.stdout}`.trim());
  }
  stdout.write(`${formatLine("Restarted Scheduled Task", taskName)}\n`);
}

export async function isScheduledTaskInstalled(args: {
  env?: Record<string, string | undefined>;
}): Promise<boolean> {
  await assertSchtasksAvailable();
  const taskName = resolveTaskName(args.env ?? (process.env as Record<string, string | undefined>));
  const res = await execSchtasks(["/Query", "/TN", taskName]);
  return res.code === 0;
}

export async function readScheduledTaskRuntime(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<GatewayServiceRuntime> {
  try {
    await assertSchtasksAvailable();
  } catch (err) {
    return {
      status: "unknown",
      detail: String(err),
    };
  }
  const taskName = resolveTaskName(env);
  const res = await execSchtasks(["/Query", "/TN", taskName, "/V", "/FO", "LIST"]);
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim();
    const missing = detail.toLowerCase().includes("cannot find the file");
    return {
      status: missing ? "stopped" : "unknown",
      detail: detail || undefined,
      missingUnit: missing,
    };
  }
  const parsed = parseSchtasksQuery(res.stdout || "");
  const statusRaw = parsed.status?.toLowerCase();
  const status = statusRaw === "running" ? "running" : statusRaw ? "stopped" : "unknown";
  return {
    status,
    state: parsed.status,
    lastRunTime: parsed.lastRunTime,
    lastRunResult: parsed.lastRunResult,
  };
}
