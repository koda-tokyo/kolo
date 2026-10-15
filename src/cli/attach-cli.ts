// `kurahi attach …` — attach a terminal to a live session (KoLo 2.0, M3b).
//
//   kurahi attach --list [--agent id] [--json]           sessions the credential may see
//   kurahi attach <session|agent> [--follow] [--history N] [--duration ms] [--json]
//
// The target is resolved by the gateway (GET /api/sessions/{id}: session id, key, label or an
// agent id → its main session), then a WebSocket is opened as a client of that session with
// the credential discover() finds (owner token file, else the paired device credential), the
// last messages are replayed, and the `chat`/`agent` event stream of that session is printed
// as it happens. Lines typed on stdin are sent with chat.send; `--follow` is read-only. Every
// attached client receives the same stream. Exit codes: 0, 1 error, 2 usage, 3 unreachable.
import type { Command } from "commander";
import {
  KoloApiError,
  KoloClient,
  KoloNetworkError,
  KoloWsError,
  type KoloSocket,
} from "@kodasoken/kurahi-client";
import readline from "node:readline";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { renderTable } from "../terminal/table.js";
import { theme } from "../terminal/theme.js";
import {
  REASONING_THINKING_HEADER,
  reasoningDoneHeader,
  sanitizeReasoningText,
} from "../tui/reasoning-format.js";
import { VERSION } from "../version.js";
import { formatCliCommand } from "./command-format.js";

export const ATTACH_EXIT = { ok: 0, error: 1, usage: 2, unreachable: 3 } as const;

export type AttachCliOptions = {
  list?: boolean;
  follow?: boolean;
  agent?: string;
  history?: string;
  duration?: string;
  timeout?: string;
  url?: string;
  json?: boolean;
  verbose?: boolean;
};

export type AttachCliDeps = {
  runtime?: RuntimeEnv;
  createClient?: (opts: { baseUrl?: string }) => Promise<KoloClient>;
  /** Input lines (default: process.stdin). */
  stdin?: NodeJS.ReadableStream;
  isTTY?: boolean;
  now?: () => number;
};

export type SessionRow = {
  id: string;
  key: string;
  agent: string;
  kind: string;
  label?: string;
  displayName?: string;
  channel?: string;
  model?: string;
  started: string | null;
  lastActivity: string | null;
  clients: number;
  state: string;
};

class UsageError extends Error {}

/**
 * Client-side resolution over a discovered list (the gateway does the authoritative one):
 * session id, then key, then label, then agent id (its `:main` session, else the most recent).
 * Exported for tests and for callers that already hold a list.
 */
export function resolveAttachTarget(sessions: SessionRow[], target: string): SessionRow | null {
  const t = target.trim();
  if (!t) {
    return null;
  }
  const lower = t.toLowerCase();
  const byAgent = sessions.filter((s) => s.agent === lower);
  return (
    sessions.find((s) => s.id === t) ??
    sessions.find((s) => s.key === lower) ??
    sessions.find((s) => s.label?.toLowerCase() === lower) ??
    byAgent.find((s) => s.key.endsWith(":main")) ??
    byAgent[0] ??
    null
  );
}

function ago(iso: string | null, now: number): string {
  const t = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) {
    return "-";
  }
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export function renderSessionsTable(sessions: SessionRow[], now = Date.now()): string {
  return renderTable({
    width: Math.max(72, (process.stdout.columns ?? 120) - 1),
    columns: [
      { key: "Key", header: "Session", minWidth: 20, flex: true },
      { key: "Agent", header: "Agent", minWidth: 6 },
      { key: "Kind", header: "Kind", minWidth: 6 },
      { key: "Label", header: "Label", minWidth: 6, flex: true },
      { key: "State", header: "State", minWidth: 7 },
      { key: "Clients", header: "Clients", minWidth: 7 },
      { key: "Active", header: "Active", minWidth: 6 },
    ],
    rows: sessions.map((s) => ({
      Key: s.key,
      Agent: s.agent,
      Kind: s.kind,
      Label: s.label ?? s.displayName ?? "",
      State: s.state,
      Clients: String(s.clients),
      Active: ago(s.lastActivity, now),
    })),
  }).trimEnd();
}

function parseInt10(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`${name} expects a non-negative integer, got "${raw}"`);
  }
  return n;
}

function reportError(runtime: RuntimeEnv, err: unknown, json: boolean | undefined): number {
  if (err instanceof UsageError) {
    runtime.error(`kurahi attach: ${err.message}`);
    return ATTACH_EXIT.usage;
  }
  if (err instanceof KoloNetworkError) {
    runtime.error(
      `kurahi attach: gateway unreachable: ${err.message} (${formatCliCommand("kurahi gateway status")})`,
    );
    return ATTACH_EXIT.unreachable;
  }
  if (err instanceof KoloApiError) {
    const body = err.body as { error?: unknown } | undefined;
    const message =
      typeof body?.error === "string"
        ? body.error
        : ((body?.error as { message?: string } | undefined)?.message ?? `HTTP ${err.status}`);
    runtime.error(
      json
        ? JSON.stringify({ ok: false, status: err.status, error: message })
        : `kurahi attach: ${message} (HTTP ${err.status})`,
    );
    return ATTACH_EXIT.error;
  }
  if (err instanceof KoloWsError) {
    runtime.error(
      json
        ? JSON.stringify({
            ok: false,
            method: err.method,
            error: { code: err.code, message: err.message },
          })
        : `kurahi attach: ${err.message}`,
    );
    return ATTACH_EXIT.error;
  }
  const message = err instanceof Error ? err.message : String(err);
  runtime.error(`kurahi attach: ${message}`);
  return /socket (error|closed before hello-ok)|ECONNREFUSED/.test(message)
    ? ATTACH_EXIT.unreachable
    : ATTACH_EXIT.error;
}

async function defaultCreateClient(opts: { baseUrl?: string }) {
  return await KoloClient.local({ baseUrl: opts.baseUrl });
}

/** `kurahi attach --list`. Returns the exit code. */
export async function runAttachList(opts: AttachCliOptions, deps: AttachCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  try {
    const client = await (deps.createClient ?? defaultCreateClient)({ baseUrl: opts.url });
    const result = await client.listSessions(opts.agent ? { agent: opts.agent } : {});
    const sessions = result.sessions as SessionRow[];
    if (opts.json) {
      runtime.log(JSON.stringify({ sessions }, null, 2));
      return ATTACH_EXIT.ok;
    }
    if (sessions.length === 0) {
      runtime.log(theme.muted("No sessions."));
      return ATTACH_EXIT.ok;
    }
    runtime.log(renderSessionsTable(sessions, (deps.now ?? Date.now)()));
    return ATTACH_EXIT.ok;
  } catch (err) {
    return reportError(runtime, err, opts.json);
  }
}

type ChatEvent = {
  runId?: string;
  sessionKey?: string;
  state?: "delta" | "final" | "error";
  message?: { role?: string; content?: Array<{ type?: string; text?: string }> };
  errorMessage?: string;
  reasoning?: { text?: string; state?: string; startedAt?: number; durationMs?: number };
};

/** Lines of reasoning `kurahi attach` replays from history per message. */
const HISTORY_REASONING_LINES = 20;

/** A finished reasoning block as attach prints it from history: header, then dimmed lines. */
export function formatHistoryReasoning(text: string, durationMs?: number): string[] {
  const lines = sanitizeReasoningText(text).trim().split("\n");
  const shown = lines.slice(0, HISTORY_REASONING_LINES).map((l) => theme.muted(`  ${l}`));
  const more = lines.length - HISTORY_REASONING_LINES;
  if (more > 0) {
    shown.push(theme.muted(`  … ${more} more lines`));
  }
  return [theme.muted(reasoningDoneHeader(durationMs)), ...shown];
}

type ChannelInboundEvent = {
  channel: string;
  sessionKey?: string;
  sender?: { id?: string; name?: string; role?: string };
  text: string;
  attachments?: Array<{ path: string }>;
};

type AgentEvent = {
  runId?: string;
  sessionKey?: string;
  stream?: string;
  data?: Record<string, unknown>;
};

function textOf(message: ChatEvent["message"]): string {
  return (message?.content ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("");
}

/** Prints a session's stream: cumulative deltas become incremental output. */
export function createStreamPrinter(
  runtime: RuntimeEnv,
  opts: { verbose?: boolean; json?: boolean },
) {
  const printed = new Map<string, number>();
  // Per run: reasoning characters printed, the block's startedAt, and whether its end is shown.
  const reasoningPrinted = new Map<
    string,
    { chars: number; startedAt?: number; done: boolean; answered: boolean }
  >();
  const write = (s: string) => {
    if (s) {
      process.stdout.write(s);
    }
  };
  // Reasoning streams dimmed under a "Thinking" header; when it ends, "Thought for Ns" closes
  // the block and the answer follows on its own line.
  const printReasoning = (runId: string, evt: ChatEvent) => {
    const r = evt.reasoning;
    const text = typeof r?.text === "string" ? sanitizeReasoningText(r.text) : "";
    if (!text) {
      return;
    }
    let state = reasoningPrinted.get(runId);
    if (state && r?.startedAt !== undefined && state.startedAt !== r.startedAt) {
      // A new message of the same run thinks: its answer text starts from zero again.
      if (!state.done || (printed.get(runId) ?? 0) > 0) {
        write("\n");
      }
      printed.delete(runId);
      state = undefined;
    }
    if (!state) {
      if ((printed.get(runId) ?? 0) > 0) {
        // Reasoning after the answer began (interleaved): do not split the answer.
        return;
      }
      state = { chars: 0, startedAt: r?.startedAt, done: false, answered: false };
      reasoningPrinted.set(runId, state);
      write(`${theme.muted(REASONING_THINKING_HEADER)}\n  `);
    }
    if (state.done) {
      return;
    }
    if (text.length > state.chars) {
      write(theme.muted(text.slice(state.chars).replace(/\n/g, "\n  ")));
      state.chars = text.length;
    }
    if (r?.state === "done") {
      state.done = true;
      write(`\n${theme.muted(reasoningDoneHeader(r.durationMs))}\n`);
    }
  };
  return {
    chat(evt: ChatEvent) {
      if (opts.json) {
        runtime.log(JSON.stringify({ event: "chat", ...evt }));
        return;
      }
      const runId = evt.runId ?? "run";
      if (evt.state === "delta" || evt.state === "final") {
        printReasoning(runId, evt);
        const text = textOf(evt.message);
        const thinking = reasoningPrinted.get(runId);
        if (thinking && !thinking.done && text.trim()) {
          // The answer began without an explicit end: close the block first.
          thinking.done = true;
          write(`\n${theme.muted(reasoningDoneHeader(evt.reasoning?.durationMs))}\n`);
        }
        const seen = printed.get(runId) ?? 0;
        if (text.length > seen) {
          write(text.slice(seen));
          printed.set(runId, text.length);
        }
        if (evt.state === "final") {
          if ((printed.get(runId) ?? 0) > 0) {
            write("\n");
          }
          printed.delete(runId);
          reasoningPrinted.delete(runId);
        }
        return;
      }
      if (evt.state === "error") {
        printed.delete(runId);
        reasoningPrinted.delete(runId);
        runtime.error(theme.error(`[error] ${evt.errorMessage ?? "run failed"}`));
      }
    },
    channelInbound(evt: ChannelInboundEvent) {
      if (opts.json) {
        runtime.log(JSON.stringify({ event: "channel.inbound", ...evt }));
        return;
      }
      const who = evt.sender?.name ?? evt.sender?.id ?? "?";
      const files = evt.attachments?.length ? ` [${evt.attachments.length} file(s)]` : "";
      runtime.log(`${theme.muted(`[${evt.channel} ${who}]`)} ${evt.text.trimEnd()}${files}`);
    },
    agent(evt: AgentEvent) {
      if (opts.json) {
        runtime.log(JSON.stringify({ event: "agent", ...evt }));
        return;
      }
      if (evt.stream === "tool" && opts.verbose) {
        const name = typeof evt.data?.name === "string" ? evt.data.name : "tool";
        const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
        runtime.log(theme.muted(`[tool] ${name}${phase ? ` ${phase}` : ""}`));
      } else if (evt.stream === "lifecycle" && opts.verbose) {
        const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
        runtime.log(theme.muted(`[run ${phase}]`));
      }
    },
    /** True while a run started by this client has unprinted/unfinished output. */
    get pending() {
      return printed.size > 0;
    },
  };
}

/** `kurahi attach <target>`. Returns the exit code. */
export async function runAttach(
  target: string | undefined,
  opts: AttachCliOptions,
  deps: AttachCliDeps = {},
): Promise<number> {
  const runtime = deps.runtime ?? defaultRuntime;
  let socket: KoloSocket | undefined;
  let key = "";
  try {
    if (!target?.trim()) {
      throw new UsageError("usage: kurahi attach <session|agent> | kurahi attach --list");
    }
    const history = parseInt10(opts.history, "--history", 20);
    const durationMs = parseInt10(opts.duration, "--duration", 0);
    const timeoutMs = parseInt10(opts.timeout, "--timeout", 600_000);
    const client = await (deps.createClient ?? defaultCreateClient)({ baseUrl: opts.url });
    const found = await client.getSession({ id: target.trim() });
    const session = found.session as SessionRow;
    key = session.key;

    socket = await client.ws({
      client: { id: "cli", mode: "cli", version: VERSION, displayName: "kurahi attach" },
      callTimeoutMs: 30_000,
    });
    const mode = opts.follow ? "follow" : "interact";
    const attached = (await socket.call("session.attach", { key, mode })) as {
      session: SessionRow & { attachments: unknown[] };
    };
    const live = attached.session;
    if (opts.json) {
      runtime.log(JSON.stringify({ event: "attached", mode, session: live }));
    } else {
      runtime.log(
        `${theme.success("Attached")} ${theme.command(live.key)} ${theme.muted(
          `(agent ${live.agent}, ${live.state}, ${live.clients} client${live.clients === 1 ? "" : "s"}, ${mode})`,
        )}`,
      );
    }

    const printer = createStreamPrinter(runtime, { verbose: opts.verbose, json: opts.json });
    if (history > 0) {
      const hist = (await socket.call("chat.history", { sessionKey: key, limit: history })) as {
        messages?: Array<{ role?: string; content?: unknown }>;
      };
      for (const m of hist.messages ?? []) {
        const thinking = Array.isArray(m.content)
          ? (m.content as Array<{ type?: string; thinking?: string }>)
              .map((p) =>
                p?.type === "thinking" && typeof p.thinking === "string" ? p.thinking : "",
              )
              .filter(Boolean)
              .join("\n")
          : "";
        if (thinking.trim() && m.role === "assistant") {
          if (opts.json) {
            runtime.log(JSON.stringify({ event: "history", role: m.role, reasoning: thinking }));
          } else {
            for (const line of formatHistoryReasoning(thinking)) {
              runtime.log(line);
            }
          }
        }
        const text = Array.isArray(m.content)
          ? (m.content as Array<{ type?: string; text?: string }>)
              .map((p) => (typeof p?.text === "string" ? p.text : ""))
              .join("")
          : typeof m.content === "string"
            ? m.content
            : "";
        if (!text.trim()) {
          continue;
        }
        if (opts.json) {
          runtime.log(JSON.stringify({ event: "history", role: m.role, text }));
        } else {
          runtime.log(`${theme.muted(`${m.role ?? "?"}>`)} ${text.trimEnd()}`);
        }
      }
      if (!opts.json && (hist.messages?.length ?? 0) > 0) {
        runtime.log(theme.muted("--"));
      }
    }

    socket.on("chat", (payload) => {
      const evt = payload as ChatEvent;
      if (evt.sessionKey?.toLowerCase() === key) {
        printer.chat(evt);
      }
    });
    socket.on("channel.inbound", (payload) => {
      const evt = payload as ChannelInboundEvent;
      if (evt.sessionKey?.toLowerCase() === key) {
        printer.channelInbound(evt);
      }
    });
    socket.on("agent", (payload) => {
      const evt = payload as AgentEvent;
      if (evt.sessionKey?.toLowerCase() === key) {
        printer.agent(evt);
      }
    });

    // Leave: detach (audited), close. Resolved by EOF, /quit, --duration or the socket closing.
    let leave!: () => void;
    const left = new Promise<void>((resolve) => {
      leave = () => resolve();
    });
    void socket.closed.then(() => leave());
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    if (durationMs > 0) {
      timers.push(setTimeout(leave, durationMs));
    }

    if (!opts.follow) {
      const input = deps.stdin ?? process.stdin;
      const rl = readline.createInterface({ input, terminal: false });
      let sends = Promise.resolve();
      rl.on("line", (line) => {
        const text = line.trim();
        if (!text) {
          return;
        }
        if (text === "/quit" || text === "/exit" || text === "/detach") {
          rl.close();
          return;
        }
        sends = sends.then(async () => {
          try {
            await socket?.call("chat.send", {
              sessionKey: key,
              message: text,
              idempotencyKey: `attach-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            });
          } catch (err) {
            runtime.error(`kurahi attach: send failed: ${(err as Error).message}`);
          }
        });
      });
      rl.on("close", () => {
        // Drain: let the last turn finish before leaving, bounded by --timeout.
        void sends.then(() => {
          const deadline = Date.now() + timeoutMs;
          const poll = () => {
            if (!printer.pending || Date.now() > deadline) {
              leave();
              return;
            }
            timers.push(setTimeout(poll, 100));
          };
          // Give the gateway a moment to open the run before checking for pending output.
          timers.push(setTimeout(poll, 300));
        });
      });
    }

    await left;
    for (const t of timers) {
      clearTimeout(t);
    }
    try {
      await socket.call("session.detach", { key }, { timeoutMs: 3000 });
    } catch {
      // The socket may already be gone; the gateway detaches on close anyway.
    }
    if (!opts.json) {
      runtime.log(theme.muted(`Detached ${key}`));
    }
    return ATTACH_EXIT.ok;
  } catch (err) {
    return reportError(runtime, err, opts.json);
  } finally {
    socket?.close();
  }
}

export function registerAttachCli(program: Command, deps: AttachCliDeps = {}) {
  const runtime = deps.runtime ?? defaultRuntime;
  program
    .command("attach")
    .description("Attach this terminal to a live session (stream events, send input)")
    .argument("[target]", "session id, session key, label or agent id")
    .option("--list", "List sessions this credential may see", false)
    .option("--agent <id>", "list: only this agent's sessions")
    .option("--follow", "Read-only: stream without sending input", false)
    .option("--history <n>", "Replay the last n messages first (default 20)")
    .option("--duration <ms>", "Leave after this many milliseconds (0 = until EOF)")
    .option("--timeout <ms>", "After EOF, wait up to this long for the last turn (default 600000)")
    .option("--url <baseUrl>", "Gateway base URL (default: discovered from KOLO_HOME)")
    .option("--verbose", "Print tool and lifecycle events", false)
    .option("--json", "JSON lines output", false)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  kurahi attach --list",
        "  kurahi attach alice                 (the agent's main session)",
        "  kurahi attach agent:alice:main --follow",
        '  echo "status?" | kurahi attach ops  (send one line, print the reply, leave)',
        "",
        "Type /quit (or Ctrl-D) to detach. Exit codes: 0 ok, 1 error, 2 usage, 3 unreachable.",
      ].join("\n"),
    )
    .action(async (target: string | undefined, opts: AttachCliOptions) => {
      const code = opts.list
        ? await runAttachList(opts, deps)
        : await runAttach(target, opts, deps);
      if (code !== ATTACH_EXIT.ok) {
        runtime.exit(code);
      }
    });
}
