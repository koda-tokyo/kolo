// KIP headless engine client (KoLo 2.0, M5b/M15b): the loopback HTTP + SSE calls shared by the
// `kip_engine_task` tool and the factory runner. Nothing runs at import time; the token file is
// read per call so a rotated token is picked up without a restart.
//
//   POST /tasks {project|projectPath, goal, profile?, run?} → {id, status, …} or {task: {…}}
//   GET  /tasks/:id                                         → {id, status, …} or {task, running}
//   POST /tasks/:id/run · /cancel · /merge
//   GET  /tasks/:id/events                                  → text/event-stream
import fs from "node:fs/promises";

export type SseEvent = { event?: string; id?: string; data: string };

export function parseSseFrames(buffer: string): { frames: SseEvent[]; rest: string } {
  const frames: SseEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    let event: string | undefined;
    let id: string | undefined;
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line.startsWith("id:")) {
        id = line.slice(3).trim();
      }
    }
    if (event !== undefined || dataLines.length > 0) {
      frames.push({ event, id, data: dataLines.join("\n") });
    }
  }
  return { frames, rest };
}

export function parseJsonLoose(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The engine answers `{task: {…}}` (kip-engine serve) or a flat task; both are accepted. */
export function unwrapTask(body: Record<string, unknown>): Record<string, unknown> {
  const task = body.task;
  return task && typeof task === "object" ? (task as Record<string, unknown>) : body;
}

export class KipEngineTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KipEngineTokenError";
  }
}

export async function readEngineToken(tokenFile: string | undefined): Promise<string | undefined> {
  if (!tokenFile) {
    return undefined;
  }
  let token: string;
  try {
    token = (await fs.readFile(tokenFile, "utf8")).trim();
  } catch (err) {
    throw new KipEngineTokenError(`cannot read engine token file (${String(err)})`);
  }
  if (!token) {
    throw new KipEngineTokenError("engine token file is empty");
  }
  return token;
}

export type KipEngineClientOptions = {
  /** Loopback base URL of the engine, no trailing slash. */
  baseUrl: string;
  tokenFile?: string;
  fetchImpl?: typeof fetch;
};

export type EngineStreamEvent = {
  /** SSE event name (status, phase, log, tool, progress, error, done, end, …). */
  type: string;
  /** Parsed `data:` payload (the engine sends {seq, ts, taskId, type, data}). */
  payload: Record<string, unknown>;
  /** Engine task status carried by this event, when any. */
  status?: string;
  summary?: string;
  seq?: number;
};

/** Status and summary of an engine event, whichever shape the engine used. */
export function readEventState(payload: Record<string, unknown>): {
  status?: string;
  summary?: string;
} {
  const inner =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {};
  const status =
    typeof inner.status === "string"
      ? inner.status
      : typeof payload.status === "string"
        ? payload.status
        : undefined;
  const summary =
    typeof inner.summary === "string" && inner.summary
      ? inner.summary
      : typeof payload.summary === "string" && payload.summary
        ? payload.summary
        : undefined;
  return { status, summary };
}

export function createKipEngineClient(opts: KipEngineClientOptions) {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;

  const request = async (path: string, init?: RequestInit): Promise<Response> => {
    const token = await readEngineToken(opts.tokenFile);
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetchImpl(`${baseUrl}${path}`, { ...init, headers });
  };

  const json = async (path: string, init?: RequestInit) => {
    const res = await request(path, init);
    const body = parseJsonLoose(await res.text());
    return { ok: res.ok, status: res.status, body };
  };

  return {
    baseUrl,
    request,
    createTask: (body: Record<string, unknown>, signal?: AbortSignal) =>
      json("/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }),
    getTask: (id: string, signal?: AbortSignal) =>
      json(`/tasks/${encodeURIComponent(id)}`, { signal }),
    runTask: (id: string, signal?: AbortSignal) =>
      json(`/tasks/${encodeURIComponent(id)}/run`, { method: "POST", signal }),
    cancelTask: (id: string) => json(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
    mergeTask: (id: string, body: Record<string, unknown> = {}) =>
      json(`/tasks/${encodeURIComponent(id)}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    /**
     * Follow a task's event stream until a terminal status, `event: end`, the cap, or the
     * signal. Resolves with the last status seen; throws when the connection breaks.
     */
    streamEvents: async (
      id: string,
      handlers: {
        signal?: AbortSignal;
        afterSeq?: number;
        maxEvents?: number;
        isTerminal: (status: string) => boolean;
        onEvent: (event: EngineStreamEvent) => void;
      },
    ): Promise<{ status?: string; summary?: string; events: number }> => {
      const query = handlers.afterSeq ? `?after=${handlers.afterSeq}` : "";
      const res = await request(`/tasks/${encodeURIComponent(id)}/events${query}`, {
        headers: { Accept: "text/event-stream" },
        signal: handlers.signal,
      });
      let status: string | undefined;
      let summary: string | undefined;
      let events = 0;
      if (!res.ok || !res.body) {
        return { status, summary, events };
      }
      const max = handlers.maxEvents ?? 10_000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          if (frame.event === "end") {
            done = true;
            break;
          }
          const payload = parseJsonLoose(frame.data);
          const state = readEventState(payload);
          const type = frame.event ?? (typeof payload.type === "string" ? payload.type : "message");
          events += 1;
          if (state.status) {
            status = state.status;
          }
          if (state.summary) {
            summary = state.summary;
          }
          const seq =
            typeof payload.seq === "number"
              ? payload.seq
              : frame.id
                ? Number.parseInt(frame.id, 10) || undefined
                : undefined;
          handlers.onEvent({ type, payload, status: state.status, summary: state.summary, seq });
          if ((status && handlers.isTerminal(status)) || events >= max) {
            done = true;
            break;
          }
        }
      }
      await reader.cancel().catch(() => {});
      return { status, summary, events };
    },
  };
}

export type KipEngineClient = ReturnType<typeof createKipEngineClient>;
