// `kolo mcp …` — MCP client servers (KoLo 2.0, M6).
//
//   kolo mcp list [--json]                         configured servers (+ live state when a gateway answers)
//   kolo mcp add <id> --stdio <command> [-- args]  add a stdio server
//   kolo mcp add <id> --url <http(s)://…>          add a streamable-HTTP server
//        [--header K=V] [--env K=V] [--cwd dir] [--allow glob] [--timeout ms] [--disabled]
//   kolo mcp remove <id>
//   kolo mcp test <id> [--json]                    connect once, list tools/resources/prompts, exit 0/1
//
// `add`/`remove` edit `mcp.servers` in kolo.json through the config writer (secret refs are
// restored on write). `test` connects in-process: no gateway needed. A header value given as
// `$secret:<name>` is stored as a `{"$secret": "<name>"}` reference, never the value.
import type { Command } from "commander";
import { KoloClient } from "@kodasoken/kolo-client";
import type { McpServerConfig } from "../config/types.mcp.js";
import type { McpServerStatus } from "../mcp/client/connection.js";
import { loadConfig, readConfigFileSnapshot, writeConfigFile } from "../config/config.js";
import { probeMcpServer } from "../mcp/client/manager.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import { formatCliCommand } from "./command-format.js";

export const MCP_EXIT = { ok: 0, error: 1, usage: 2 } as const;

class UsageError extends Error {}

const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

type McpCliDeps = {
  runtime?: RuntimeEnv;
  probe?: typeof probeMcpServer;
  /** Live state from a running gateway; undefined when none answers. */
  liveStatus?: () => Promise<McpServerStatus[] | undefined>;
};

export function parseKeyValue(
  raw: readonly string[] | undefined,
  flag: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of raw ?? []) {
    const idx = entry.indexOf("=");
    if (idx <= 0) {
      throw new UsageError(`${flag} expects KEY=VALUE; got "${entry}"`);
    }
    out[entry.slice(0, idx).trim()] = entry.slice(idx + 1);
  }
  return out;
}

/** `$secret:<name>` → secret reference object; anything else stays a plain string. */
export function headerValue(value: string): string | { $secret: string } {
  const m = /^\$secret:([A-Za-z0-9][A-Za-z0-9_.-]*)$/.exec(value.trim());
  return m ? { $secret: m[1] } : value;
}

export function buildServerConfig(opts: {
  stdio?: string;
  url?: string;
  args?: string[];
  header?: string[];
  env?: string[];
  cwd?: string;
  allow?: string[];
  timeout?: string;
  disabled?: boolean;
}): McpServerConfig {
  if (Boolean(opts.stdio) === Boolean(opts.url)) {
    throw new UsageError("give exactly one of --stdio <command> or --url <url>");
  }
  const server: McpServerConfig = opts.stdio
    ? { transport: "stdio", command: opts.stdio, ...(opts.args?.length ? { args: opts.args } : {}) }
    : { transport: "http", url: opts.url };
  if (opts.url && !/^https?:\/\//i.test(opts.url)) {
    throw new UsageError("--url must start with http:// or https://");
  }
  const env = parseKeyValue(opts.env, "--env");
  if (Object.keys(env).length > 0) {
    if (server.transport !== "stdio") {
      throw new UsageError("--env applies to stdio servers only");
    }
    server.env = env;
  }
  const headers = parseKeyValue(opts.header, "--header");
  if (Object.keys(headers).length > 0) {
    if (server.transport !== "http") {
      throw new UsageError("--header applies to http servers only");
    }
    // Secret refs are objects at rest; the config type sees resolved strings at load time.
    server.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, headerValue(v)]),
    ) as Record<string, string>;
  }
  if (opts.cwd) {
    server.cwd = opts.cwd;
  }
  if (opts.allow?.length) {
    server.allowTools = opts.allow
      .flatMap((a) => a.split(","))
      .map((a) => a.trim())
      .filter(Boolean);
  }
  if (opts.timeout !== undefined) {
    const n = Number.parseInt(opts.timeout, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new UsageError("--timeout expects milliseconds");
    }
    server.timeoutMs = n;
  }
  if (opts.disabled) {
    server.enabled = false;
  }
  return server;
}

function assertId(id: string): string {
  const value = id.trim();
  if (!SERVER_ID.test(value)) {
    throw new UsageError("server id: lowercase letters, digits, _ or -, up to 64 characters");
  }
  return value;
}

async function loadSnapshotOrExit(runtime: RuntimeEnv) {
  const snapshot = await readConfigFileSnapshot();
  if (!snapshot.valid) {
    runtime.error(`Config invalid at ${snapshot.path}.`);
    for (const issue of snapshot.issues) {
      runtime.error(`- ${issue.path || "<root>"}: ${issue.message}`);
    }
    runtime.exit(MCP_EXIT.error);
  }
  return snapshot;
}

function exitWith(runtime: RuntimeEnv, err: unknown, json: boolean | undefined): never {
  const usage = err instanceof UsageError;
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    runtime.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    runtime.error(theme.error(message));
  }
  runtime.exit(usage ? MCP_EXIT.usage : MCP_EXIT.error);
  throw err;
}

function summarizeTools(status: McpServerStatus): string {
  const exposed = status.tools.filter((t) => t.exposed).length;
  return `${exposed}/${status.tools.length}`;
}

async function defaultLiveStatus(): Promise<McpServerStatus[] | undefined> {
  try {
    const client = await KoloClient.local({});
    const res = (await client.listMcpServers()) as { servers?: McpServerStatus[] };
    return res.servers;
  } catch {
    return undefined;
  }
}

export function registerMcpCli(program: Command, deps: McpCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  const probe = deps.probe ?? probeMcpServer;
  const liveStatus = deps.liveStatus ?? defaultLiveStatus;

  const cmd = program
    .command("mcp")
    .description("MCP servers this gateway connects to (tools surface as mcp:<server>:<tool>)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Example:")} ${formatCliCommand(
          "kolo mcp add docs --stdio npx -- -y @modelcontextprotocol/server-filesystem ./docs",
        )}\n${theme.muted("Policy:")} exec-like tools (run, shell, write, delete …) stay hidden unless --allow names them.\n`,
    );

  cmd
    .command("list")
    .description("Configured servers, with live state when a gateway is running")
    .option("--json", "Print JSON", false)
    .action(async (opts: { json?: boolean }) => {
      try {
        const cfg = loadConfig();
        const servers = cfg.mcp?.servers ?? {};
        const live = await liveStatus();
        const liveById = new Map((live ?? []).map((s) => [s.id, s]));
        const rows = Object.entries(servers).map(([id, server]) => {
          const status = liveById.get(id);
          return {
            id,
            transport: server.transport,
            target:
              server.transport === "stdio"
                ? [server.command ?? "", ...(server.args ?? [])].join(" ")
                : (server.url ?? ""),
            enabled: server.enabled === false ? "no" : "yes",
            state: status?.state ?? (live ? "unknown" : "-"),
            tools: status ? summarizeTools(status) : "-",
            allow: (server.allowTools ?? []).join(",") || "-",
          };
        });
        if (opts.json) {
          runtime.log(
            JSON.stringify(
              { ok: true, gateway: live !== undefined, servers: rows, live: live ?? [] },
              null,
              2,
            ),
          );
          return;
        }
        if (rows.length === 0) {
          runtime.log(
            `No MCP servers configured. Add one with ${formatCliCommand("kolo mcp add")}.`,
          );
          return;
        }
        runtime.log(
          renderTable({
            columns: [
              { key: "id", header: "ID" },
              { key: "transport", header: "TRANSPORT" },
              { key: "target", header: "TARGET", flex: true },
              { key: "enabled", header: "ENABLED" },
              { key: "state", header: "STATE" },
              { key: "tools", header: "TOOLS" },
              { key: "allow", header: "ALLOW" },
            ],
            rows,
          }),
        );
        if (!live) {
          runtime.log(theme.muted("(no gateway answered; STATE/TOOLS need a running gateway)"));
        }
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });

  cmd
    .command("add <id> [args...]")
    .description("Add or replace a server (args after -- go to a stdio command)")
    .option("--stdio <command>", "Spawn this executable (stdio transport)")
    .option("--url <url>", "Streamable-HTTP endpoint")
    .option("--header <kv>", "HTTP header KEY=VALUE or KEY=$secret:<name>; repeatable", collect, [])
    .option("--env <kv>", "Child environment KEY=VALUE; repeatable", collect, [])
    .option("--cwd <dir>", "Working directory for the child")
    .option("--allow <globs>", "Tool allowlist globs (comma-separated; repeatable)", collect, [])
    .option("--timeout <ms>", "Per-request timeout in ms")
    .option("--disabled", "Store it disabled", false)
    .option("--json", "Print JSON", false)
    .action(
      async (
        idRaw: string,
        args: string[],
        opts: {
          stdio?: string;
          url?: string;
          header: string[];
          env: string[];
          cwd?: string;
          allow: string[];
          timeout?: string;
          disabled: boolean;
          json?: boolean;
        },
      ) => {
        try {
          const id = assertId(idRaw);
          const server = buildServerConfig({ ...opts, args });
          const snapshot = await loadSnapshotOrExit(runtime);
          const next = snapshot.config as Record<string, unknown>;
          const mcp = (next.mcp && typeof next.mcp === "object" ? next.mcp : {}) as {
            servers?: Record<string, unknown>;
          };
          mcp.servers = { ...(mcp.servers ?? {}), [id]: server };
          next.mcp = mcp;
          await writeConfigFile(next);
          if (opts.json) {
            runtime.log(JSON.stringify({ ok: true, id, server }, null, 2));
            return;
          }
          runtime.log(
            `Added MCP server ${theme.accent(id)} (${server.transport}). Restart the gateway to connect; ` +
              `${formatCliCommand(`kolo mcp test ${id}`)} probes it now.`,
          );
        } catch (err) {
          exitWith(runtime, err, opts.json);
        }
      },
    );

  cmd
    .command("remove <id>")
    .description("Remove a server from the config")
    .option("--json", "Print JSON", false)
    .action(async (idRaw: string, opts: { json?: boolean }) => {
      try {
        const id = assertId(idRaw);
        const snapshot = await loadSnapshotOrExit(runtime);
        const next = snapshot.config as Record<string, unknown>;
        const mcp = (next.mcp && typeof next.mcp === "object" ? next.mcp : {}) as {
          servers?: Record<string, unknown>;
        };
        if (!mcp.servers || !(id in mcp.servers)) {
          throw new UsageError(`no MCP server "${id}" in config`);
        }
        const { [id]: _removed, ...rest } = mcp.servers;
        mcp.servers = rest;
        next.mcp = mcp;
        await writeConfigFile(next);
        if (opts.json) {
          runtime.log(JSON.stringify({ ok: true, id }, null, 2));
          return;
        }
        runtime.log(`Removed MCP server ${theme.accent(id)}. Restart the gateway to apply.`);
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });

  cmd
    .command("test <id>")
    .description("Connect once (no gateway needed), list tools/resources/prompts")
    .option("--json", "Print JSON", false)
    .action(async (idRaw: string, opts: { json?: boolean }) => {
      try {
        const id = assertId(idRaw);
        const cfg = loadConfig();
        const server = cfg.mcp?.servers?.[id];
        if (!server) {
          throw new UsageError(`no MCP server "${id}" in config`);
        }
        const status = await probe(id, server);
        const ok = status.state === "ready";
        if (opts.json) {
          runtime.log(JSON.stringify({ ok, ...status }, null, 2));
        } else if (!ok) {
          runtime.error(theme.error(`${id}: ${status.lastError ?? status.state}`));
        } else {
          runtime.log(
            `${theme.success("ok")} ${id}: ${status.serverName ?? "server"} ${status.serverVersion ?? ""}`.trim(),
          );
          runtime.log(
            renderTable({
              columns: [
                { key: "tool", header: "TOOL", flex: true },
                { key: "exposed", header: "EXPOSED" },
                { key: "why", header: "NOTE" },
              ],
              rows: status.tools.map((t) => ({
                tool: t.name,
                exposed: t.exposed ? "yes" : "no",
                why: t.reason ?? (t.execLike ? "exec-like (allowed)" : ""),
              })),
            }),
          );
          runtime.log(
            theme.muted(
              `${status.resources.length} resource(s), ${status.prompts.length} prompt(s) (read-only inventory)`,
            ),
          );
        }
        if (!ok) {
          runtime.exit(MCP_EXIT.error);
        }
      } catch (err) {
        exitWith(runtime, err, opts.json);
      }
    });
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
