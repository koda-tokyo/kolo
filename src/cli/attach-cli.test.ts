import { KoloClient, KoloNetworkError } from "@kodasoken/kurahi-client";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import {
  ATTACH_EXIT,
  createStreamPrinter,
  resolveAttachTarget,
  runAttach,
  runAttachList,
  type SessionRow,
} from "./attach-cli.js";

const rows: SessionRow[] = [
  {
    id: "sid-1",
    key: "agent:atlas:main",
    agent: "atlas",
    kind: "direct",
    started: null,
    lastActivity: "2026-10-13T00:00:00.000Z",
    clients: 1,
    state: "idle",
  },
  {
    id: "sid-2",
    key: "agent:atlas:ops",
    agent: "atlas",
    kind: "direct",
    label: "Ops",
    started: null,
    lastActivity: null,
    clients: 0,
    state: "running",
  },
  {
    id: "sid-3",
    key: "agent:iris:whatsapp:+1555",
    agent: "iris",
    kind: "direct",
    started: null,
    lastActivity: null,
    clients: 0,
    state: "idle",
  },
];

function runtime() {
  return { log: vi.fn(), error: vi.fn(), exit: vi.fn() } as unknown as RuntimeEnv & {
    log: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    exit: ReturnType<typeof vi.fn>;
  };
}

describe("kurahi attach: target resolution", () => {
  it("resolves by id, key, label, then agent (main session first)", () => {
    expect(resolveAttachTarget(rows, "sid-2")?.key).toBe("agent:atlas:ops");
    expect(resolveAttachTarget(rows, "AGENT:ATLAS:OPS")?.id).toBe("sid-2");
    expect(resolveAttachTarget(rows, "ops")?.id).toBe("sid-2");
    expect(resolveAttachTarget(rows, "atlas")?.key).toBe("agent:atlas:main");
    expect(resolveAttachTarget(rows, "iris")?.key).toBe("agent:iris:whatsapp:+1555");
    expect(resolveAttachTarget(rows, "nobody")).toBeNull();
    expect(resolveAttachTarget(rows, "  ")).toBeNull();
  });
});

describe("kurahi attach --list", () => {
  it("prints the sessions the gateway returns (JSON and table)", async () => {
    const rt = runtime();
    const client = { listSessions: vi.fn(async () => ({ ok: true, sessions: rows })) };
    const deps = { runtime: rt, createClient: async () => client as unknown as KoloClient };
    expect(await runAttachList({ json: true }, deps)).toBe(ATTACH_EXIT.ok);
    expect(JSON.parse(rt.log.mock.calls[0][0] as string).sessions).toHaveLength(3);
    const rt2 = runtime();
    expect(await runAttachList({ agent: "atlas" }, { ...deps, runtime: rt2 })).toBe(ATTACH_EXIT.ok);
    expect(client.listSessions).toHaveBeenLastCalledWith({ agent: "atlas" });
    expect(String(rt2.log.mock.calls[0][0])).toContain("agent:atlas:main");
  });

  it("exits 3 when the gateway is unreachable", async () => {
    const rt = runtime();
    const code = await runAttachList(
      {},
      {
        runtime: rt,
        createClient: async () => {
          throw new KoloNetworkError(
            "listSessions",
            "GET http://127.0.0.1:1/api/sessions: refused",
          );
        },
      },
    );
    expect(code).toBe(ATTACH_EXIT.unreachable);
    expect(String(rt.error.mock.calls[0][0])).toContain("unreachable");
  });
});

describe("kurahi attach <target>", () => {
  it("attaches through the gateway, replays history, sends stdin lines and detaches", async () => {
    const rt = runtime();
    const calls: Array<{ method: string; params: unknown }> = [];
    const handlers = new Map<string, (payload: unknown) => void>();
    let resolveClosed!: (v: { code: number; reason: string }) => void;
    const socket = {
      hello: {},
      call: vi.fn(async (method: string, params: unknown) => {
        calls.push({ method, params });
        if (method === "session.attach") {
          return { ok: true, attached: true, session: { ...rows[0], clients: 2, attachments: [] } };
        }
        if (method === "chat.history") {
          return {
            messages: [{ role: "user", content: [{ type: "text", text: "earlier" }] }],
          };
        }
        if (method === "chat.send") {
          // Simulate the gateway streaming the reply to this (and every other) attached client.
          const chat = handlers.get("chat");
          chat?.({
            runId: "r1",
            sessionKey: "agent:atlas:main",
            state: "delta",
            message: { content: [{ type: "text", text: "hel" }] },
          });
          chat?.({
            runId: "r1",
            sessionKey: "agent:atlas:main",
            state: "final",
            message: { content: [{ type: "text", text: "hello" }] },
          });
          return { runId: "r1", status: "started" };
        }
        if (method === "session.detach") {
          return { ok: true, detached: ["agent:atlas:main"] };
        }
        return {};
      }),
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      }),
      close: vi.fn(() => resolveClosed({ code: 1000, reason: "client close" })),
      closed: new Promise<{ code: number; reason: string }>((r) => (resolveClosed = r)),
    };
    const client = {
      getSession: vi.fn(async () => ({ ok: true, session: rows[0] })),
      ws: vi.fn(async () => socket),
    };
    const stdin = new PassThrough();
    const run = runAttach(
      "atlas",
      { history: "5", timeout: "2000" },
      { runtime: rt, createClient: async () => client as unknown as KoloClient, stdin },
    );
    stdin.write("status?\n");
    stdin.end();
    expect(await run).toBe(ATTACH_EXIT.ok);

    expect(client.getSession).toHaveBeenCalledWith({ id: "atlas" });
    expect(calls.map((c) => c.method)).toEqual([
      "session.attach",
      "chat.history",
      "chat.send",
      "session.detach",
    ]);
    expect(calls[0].params).toEqual({ key: "agent:atlas:main", mode: "interact" });
    expect((calls[2].params as { message: string }).message).toBe("status?");
    const out = rt.log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Attached");
    expect(out).toContain("earlier");
    expect(out).toContain("Detached agent:atlas:main");
    expect(socket.close).toHaveBeenCalled();
  });

  it("--follow attaches read-only and leaves after --duration", async () => {
    const rt = runtime();
    const socket = {
      hello: {},
      call: vi.fn(async (method: string) =>
        method === "session.attach"
          ? { ok: true, attached: true, session: { ...rows[1], attachments: [] } }
          : { ok: true, detached: [] },
      ),
      on: vi.fn(() => () => {}),
      close: vi.fn(),
      closed: new Promise<{ code: number; reason: string }>(() => {}),
    };
    const client = {
      getSession: vi.fn(async () => ({ ok: true, session: rows[1] })),
      ws: vi.fn(async () => socket),
    };
    const code = await runAttach(
      "sid-2",
      { follow: true, duration: "50", history: "0", json: true },
      { runtime: rt, createClient: async () => client as unknown as KoloClient },
    );
    expect(code).toBe(ATTACH_EXIT.ok);
    expect(socket.call).toHaveBeenCalledWith("session.attach", {
      key: "agent:atlas:ops",
      mode: "follow",
    });
    expect(socket.call).not.toHaveBeenCalledWith("chat.history", expect.anything());
    expect(JSON.parse(rt.log.mock.calls[0][0] as string).event).toBe("attached");
  });

  it("is a usage error without a target and exit 1 when the session is unknown", async () => {
    const rt = runtime();
    expect(await runAttach(undefined, {}, { runtime: rt })).toBe(ATTACH_EXIT.usage);
    const { KoloApiError } = await import("@kodasoken/kurahi-client");
    const client = {
      getSession: vi.fn(async () => {
        throw new KoloApiError(
          "getSession",
          404,
          { ok: false, error: "No session found: zz" },
          new Headers(),
        );
      }),
    };
    const rt2 = runtime();
    expect(
      await runAttach(
        "zz",
        {},
        { runtime: rt2, createClient: async () => client as unknown as KoloClient },
      ),
    ).toBe(ATTACH_EXIT.error);
    expect(String(rt2.error.mock.calls[0][0])).toContain("No session found: zz");
  });
});

describe("stream printer", () => {
  it("turns cumulative deltas into incremental output and ends the line on final", () => {
    const rt = runtime();
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
      chunks.push(String(s));
      return true;
    }) as typeof process.stdout.write);
    try {
      const p = createStreamPrinter(rt, {});
      p.chat({ runId: "r", state: "delta", message: { content: [{ text: "ab" }] } });
      expect(p.pending).toBe(true);
      p.chat({ runId: "r", state: "delta", message: { content: [{ text: "abcd" }] } });
      p.chat({ runId: "r", state: "final", message: { content: [{ text: "abcdef" }] } });
      expect(chunks.join("|")).toBe("ab|cd|ef|\n");
      expect(p.pending).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("stream printer reasoning", () => {
  // oxlint-disable-next-line no-control-regex
  const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

  it("prints reasoning dimmed under the same header as the TUI, then the answer", () => {
    const rt = runtime();
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
      chunks.push(String(s));
      return true;
    }) as typeof process.stdout.write);
    try {
      const p = createStreamPrinter(rt, {});
      const r = (text: string, state: string, durationMs?: number) => ({
        text,
        state,
        startedAt: 1,
        durationMs,
      });
      p.chat({
        runId: "r",
        state: "delta",
        message: { content: [{ text: "" }] },
        reasoning: r("Check the", "streaming"),
      });
      p.chat({
        runId: "r",
        state: "delta",
        message: { content: [{ text: "" }] },
        reasoning: r("Check the config.\nThen answer.", "done", 12_000),
      });
      p.chat({
        runId: "r",
        state: "final",
        message: { content: [{ text: "Port 18789." }] },
        reasoning: r("Check the config.\nThen answer.", "done", 12_000),
      });
      const out = strip(chunks.join(""));
      expect(out).toBe(
        "Thinking\n  Check the config.\n  Then answer.\nThought for 12s\nPort 18789.\n",
      );
      // Dimmed: every reasoning chunk carries an escape sequence when colours are on.
      expect(chunks.some((c) => c.includes("Thinking"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("formats reasoning from history with the finished header", async () => {
    const { formatHistoryReasoning } = await import("./attach-cli.js");
    const lines = formatHistoryReasoning("one\ntwo\u001b[2J", 2_000).map(strip);
    expect(lines).toEqual(["Thought for 2s", "  one", "  two"]);
  });
});
