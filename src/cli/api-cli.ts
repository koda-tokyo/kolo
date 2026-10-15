// `kurahi api …` — call the gateway's described API through the generated @kodasoken/kurahi-client (M4b).
//
//   kurahi api list [--ws] [--json]                 operations (or WebSocket methods/events)
//   kurahi api <operationId> [-p k=v]... [-b json|@file|@-] [--raw]
//   kurahi api ws <method> [json] [--expect-final] [--raw]
//
// The gateway is discovered like every other client: KOLO_HOME (or KOLO_STATE_DIR) ->
// run/gateway.lock for the port and secrets/gateway.token for the token; KOLO_GATEWAY_URL,
// KOLO_GATEWAY_PORT, KOLO_GATEWAY_TOKEN and KOLO_GATEWAY_TOKEN_FILE override. The token is
// never taken from argv. Exit codes: 0 ok, 1 HTTP / gateway error, 2 usage, 3 unreachable.
import type { Command } from "commander";
import {
  KoloApiError,
  KoloClient,
  KoloNetworkError,
  KoloWsError,
  getOperation,
  listOperations,
  wsEvents,
  wsMethods,
  type DiscoveredGateway,
  type KoloSocket,
} from "@kodasoken/kurahi-client";
import fs from "node:fs";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { VERSION } from "../version.js";

export const API_EXIT = { ok: 0, http: 1, usage: 2, unreachable: 3 } as const;

export type ApiCliOptions = {
  param?: string[];
  body?: string;
  raw?: boolean;
  url?: string;
  timeout?: string;
  json?: boolean;
  ws?: boolean;
  expectFinal?: boolean;
};

export type ApiCliDeps = {
  runtime?: RuntimeEnv;
  /** Builds the client (tests inject a mock fetch here). */
  createClient?: (opts: { baseUrl?: string; timeoutMs?: number }) => Promise<KoloClient>;
  readStdin?: () => string;
  readFile?: (file: string) => string;
};

class UsageError extends Error {}

function print(runtime: RuntimeEnv, value: unknown, raw: boolean | undefined): void {
  if (value === undefined) {
    return;
  }
  if (typeof value === "string") {
    runtime.log(value.endsWith("\n") ? value.slice(0, -1) : value);
    return;
  }
  if (value instanceof ArrayBuffer) {
    runtime.log(`<${value.byteLength} bytes>`);
    return;
  }
  runtime.log(raw ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}

function printError(runtime: RuntimeEnv, value: Record<string, unknown>, raw: boolean | undefined) {
  runtime.error(raw ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}

export function parseParams(
  pairs: readonly string[] | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const pair of pairs ?? []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw new UsageError(`--param expects k=v, got "${pair}"`);
    }
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1);
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/** `--body` / ws params: inline JSON, `@file` or `@-` (stdin). */
export function parseJsonArg(
  arg: string | undefined,
  deps: Pick<ApiCliDeps, "readStdin" | "readFile">,
  what: string,
): unknown {
  if (arg === undefined) {
    return undefined;
  }
  let text = arg;
  if (arg === "@-") {
    text = (deps.readStdin ?? (() => fs.readFileSync(0, "utf8")))();
  } else if (arg.startsWith("@")) {
    const file = arg.slice(1);
    try {
      text = (deps.readFile ?? ((f: string) => fs.readFileSync(f, "utf8")))(file);
    } catch (err) {
      throw new UsageError(`${what}: cannot read ${file} (${(err as Error).message})`);
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UsageError(`${what} is not valid JSON`);
  }
}

function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`--timeout expects milliseconds, got "${raw}"`);
  }
  return n;
}

async function defaultCreateClient(opts: { baseUrl?: string; timeoutMs?: number }) {
  return await KoloClient.local({ baseUrl: opts.baseUrl, timeoutMs: opts.timeoutMs });
}

function authLabel(security: readonly (readonly string[])[]): string {
  return security.length === 0 ? "none" : security.map((s) => s.join("+")).join("|");
}

export function runApiList(opts: ApiCliOptions, runtime: RuntimeEnv = defaultRuntime): void {
  if (opts.ws) {
    const data = { methods: [...wsMethods], events: [...wsEvents] };
    if (opts.json) {
      print(runtime, data, opts.raw);
      return;
    }
    runtime.log(`WebSocket methods (${data.methods.length}):`);
    runtime.log(data.methods.map((m) => `  ${m}`).join("\n"));
    runtime.log(`WebSocket events (${data.events.length}):`);
    runtime.log(data.events.map((e) => `  ${e}`).join("\n"));
    return;
  }
  const ops = listOperations();
  if (opts.json) {
    print(
      runtime,
      ops.map((o) => ({
        operationId: o.operationId,
        method: o.method,
        path: o.path,
        auth: o.security,
        params: o.params,
        body: o.body,
        summary: o.summary,
      })),
      opts.raw,
    );
    return;
  }
  const idW = Math.max(...ops.map((o) => o.operationId.length));
  const mW = Math.max(...ops.map((o) => o.method.length));
  const pW = Math.max(...ops.map((o) => o.path.length));
  const aW = Math.max(...ops.map((o) => authLabel(o.security).length));
  for (const o of ops) {
    runtime.log(
      `${o.operationId.padEnd(idW)}  ${o.method.padEnd(mW)}  ${o.path.padEnd(pW)}  ${authLabel(o.security).padEnd(aW)}  ${o.summary}`,
    );
  }
}

/**
 * Resolve a CLI target to an operationId: exact id, then case-insensitive id, then the
 * `get<Target>` shorthand (`health` -> getHealth, `metrics` -> getMetrics), then an exact path.
 */
export function resolveOperationId(target: string): string | undefined {
  if (getOperation(target)) {
    return target;
  }
  const ops = listOperations();
  const lower = target.toLowerCase();
  const byId = ops.find((o) => o.operationId.toLowerCase() === lower);
  if (byId) {
    return byId.operationId;
  }
  const getter = ops.find(
    (o) => o.operationId.toLowerCase() === `get${lower.replace(/[-_.]/g, "")}`,
  );
  if (getter) {
    return getter.operationId;
  }
  const byPath = ops.filter((o) => o.path === (target.startsWith("/") ? target : `/${target}`));
  return byPath.length === 1 ? byPath[0].operationId : undefined;
}

/** Run `kurahi api <operationId>`. Returns the exit code (does not exit). */
export async function runApiCall(
  operationId: string,
  opts: ApiCliOptions,
  deps: ApiCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  try {
    const resolved = resolveOperationId(operationId);
    if (!resolved) {
      throw new UsageError(`unknown operationId "${operationId}" (see \`kurahi api list\`)`);
    }
    const params = parseParams(opts.param);
    const body = parseJsonArg(opts.body, deps, "--body");
    const timeoutMs = parseTimeout(opts.timeout);
    const client = await (deps.createClient ?? defaultCreateClient)({
      baseUrl: opts.url,
      timeoutMs,
    });
    let res;
    try {
      res = await client.send(resolved, { params, body });
    } catch (err) {
      if (err instanceof TypeError) {
        throw new UsageError(err.message);
      }
      throw err;
    }
    if (!res.ok) {
      printError(
        runtime,
        { ok: false, operationId: res.operationId, status: res.status, error: res.data ?? null },
        opts.raw,
      );
      return API_EXIT.http;
    }
    print(runtime, res.data, opts.raw);
    return API_EXIT.ok;
  } catch (err) {
    return reportError(runtime, err, opts.raw);
  }
}

function reportError(runtime: RuntimeEnv, err: unknown, raw: boolean | undefined): number {
  if (err instanceof UsageError) {
    runtime.error(`kurahi api: ${err.message}`);
    return API_EXIT.usage;
  }
  if (err instanceof KoloNetworkError) {
    runtime.error(`kurahi api: gateway unreachable: ${err.message}`);
    return API_EXIT.unreachable;
  }
  if (err instanceof KoloApiError) {
    printError(
      runtime,
      { ok: false, operationId: err.operationId, status: err.status, error: err.body ?? null },
      raw,
    );
    return API_EXIT.http;
  }
  if (err instanceof KoloWsError) {
    printError(
      runtime,
      {
        ok: false,
        method: err.method,
        error: { code: err.code, message: err.message, details: err.details },
      },
      raw,
    );
    return API_EXIT.http;
  }
  const message = err instanceof Error ? err.message : String(err);
  runtime.error(`kurahi api: ${message}`);
  return /connect: socket (error|closed before hello-ok)|ECONNREFUSED/.test(message)
    ? API_EXIT.unreachable
    : API_EXIT.http;
}

/** Run `kurahi api ws <method> [json]`: one handshake, one call, close. */
export async function runApiWs(
  method: string | undefined,
  paramsArg: string | undefined,
  opts: ApiCliOptions,
  deps: ApiCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  let socket: KoloSocket | undefined;
  try {
    if (!method) {
      throw new UsageError("usage: kurahi api ws <method> [json] (see `kurahi api list --ws`)");
    }
    const params = parseJsonArg(paramsArg, deps, "ws params");
    const timeoutMs = parseTimeout(opts.timeout);
    const client = await (deps.createClient ?? defaultCreateClient)({
      baseUrl: opts.url,
      timeoutMs,
    });
    socket = await client.ws({
      client: { id: "cli", mode: "cli", version: VERSION, displayName: "kurahi api" },
      callTimeoutMs: timeoutMs,
    });
    const result = await socket.call(method, params, { expectFinal: opts.expectFinal });
    print(runtime, result ?? null, opts.raw);
    return API_EXIT.ok;
  } catch (err) {
    return reportError(runtime, err, opts.raw);
  } finally {
    socket?.close();
  }
}

/** Where `kurahi api` would connect (no token value, only its source). */
export function describeDiscovery(found: DiscoveredGateway): Record<string, unknown> {
  return {
    baseUrl: found.baseUrl,
    wsUrl: found.wsUrl,
    port: found.port,
    portSource: found.portSource,
    tokenSource: found.tokenSource,
    tokenFile: found.tokenFile,
    home: found.home,
  };
}

const collect = (value: string, previous: string[]) => [...previous, value];

export function registerApiCli(program: Command, deps: ApiCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  program
    .command("api")
    .description("Call the gateway API (OpenAPI operations and WebSocket methods)")
    .argument("[target]", "operationId, `list`, `ws` or `discover`")
    .argument("[args...]", "for `ws`: <method> [json]")
    .option(
      "-p, --param <k=v>",
      "Path/query/header parameter (repeatable)",
      collect,
      [] as string[],
    )
    .option("-b, --body <json>", "Request body: inline JSON, @file or @- for stdin")
    .option("--raw", "Compact JSON output", false)
    .option("--url <url>", "Gateway base URL (default: discovered from KOLO_HOME)")
    .option("--timeout <ms>", "Request timeout in milliseconds")
    .option("--json", "list: machine-readable output", false)
    .option("--ws", "list: WebSocket methods and events instead of HTTP operations", false)
    .option("--expect-final", 'ws: wait past an interim {status:"accepted"} answer', false)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  kurahi api list",
        "  kurahi api getHealth            (shorthand: kurahi api health)",
        "  kurahi api listAuditEvents -p limit=20 -p action=integrity.init",
        "  kurahi api getCovenant -p userId=u_123",
        '  kurahi api hookWake -b \'{"text":"ping"}\'',
        "  kurahi api ws health",
        "  kurahi api ws sessions.list '{\"limit\":5}'",
        "  kurahi api discover",
        "",
        "Exit codes: 0 ok, 1 HTTP or gateway error (error model on stderr), 2 usage, 3 unreachable.",
      ].join("\n"),
    )
    .action(async (target: string | undefined, args: string[], opts: ApiCliOptions) => {
      let code: number;
      if (!target || target === "list") {
        runApiList(opts, runtime);
        code = API_EXIT.ok;
      } else if (target === "ws") {
        code = await runApiWs(args[0], args[1], opts, deps);
      } else if (target === "discover") {
        const { discover } = await import("@kodasoken/kurahi-client");
        print(runtime, describeDiscovery(await discover()), opts.raw);
        code = API_EXIT.ok;
      } else {
        if (args.length > 0) {
          runtime.error(
            `kurahi api: unexpected arguments: ${args.join(" ")} (use -p k=v / -b json)`,
          );
          code = API_EXIT.usage;
        } else {
          code = await runApiCall(target, opts, deps);
        }
      }
      if (code !== API_EXIT.ok) {
        runtime.exit(code);
      }
    });
}
