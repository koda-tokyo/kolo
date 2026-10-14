// Gateway client for the continuity probes (KoLo 2.0, M11b): plain HTTP with the owner
// credential and a minimal WebSocket request/response for the few methods that have no HTTP
// route (config.get/apply, sessions.reset). Every response body is recorded (capped) so the
// leak scan can prove that no secret crossed the public API.
import { PROTOCOL_VERSION } from "../gateway/protocol/schema/protocol-schemas.js";

export type GatewayResponse<T = Record<string, unknown>> = {
  status: number;
  body: T;
  text: string;
};

export type WsResult = { ok: boolean; payload?: unknown; error?: unknown };

const RECORD_CAP_BYTES = 256 * 1024;
const RECORD_MAX_ENTRIES = 400;

export class ProbeClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly recorded: Array<{ where: string; text: string }> = [];
  /** Requests that hit the gateway's per-IP rate limit and were retried after Retry-After. */
  throttled = 0;
  timeoutMs = 15_000;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  record(where: string, text: string): void {
    if (this.recorded.length >= RECORD_MAX_ENTRIES) {
      this.recorded.shift();
    }
    this.recorded.push({ where, text: text.slice(0, RECORD_CAP_BYTES) });
  }

  async request<T = Record<string, unknown>>(
    method: "GET" | "POST",
    pathname: string,
    opts: {
      body?: unknown;
      headers?: Record<string, string>;
      token?: string | null;
      timeoutMs?: number;
    } = {},
  ): Promise<GatewayResponse<T>> {
    const token = opts.token === undefined ? this.token : opts.token;
    const headers: Record<string, string> = { ...opts.headers };
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? this.timeoutMs),
    };
    if (method === "POST" && opts.body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    let res = await fetch(`${this.baseUrl}${pathname}`, init);
    // The gateway rate-limits every IP (429 + Retry-After). A probe is never in a hurry: wait
    // once for the window to clear instead of reporting a false failure.
    if (res.status === 429) {
      const retryAfterMs = Math.min(
        65_000,
        Math.max(1000, Number(res.headers.get("retry-after") ?? "5") * 1000),
      );
      this.throttled += 1;
      await res.text().catch(() => "");
      await new Promise((r) => setTimeout(r, retryAfterMs));
      res = await fetch(`${this.baseUrl}${pathname}`, init);
    }
    const text = await res.text();
    this.record(`${method} ${pathname}`, text);
    let body: T;
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = {} as T;
    }
    return { status: res.status, body, text };
  }

  get<T = Record<string, unknown>>(pathname: string, opts?: Parameters<ProbeClient["request"]>[2]) {
    return this.request<T>("GET", pathname, opts);
  }

  post<T = Record<string, unknown>>(
    pathname: string,
    body: unknown,
    opts?: Parameters<ProbeClient["request"]>[2],
  ) {
    return this.request<T>("POST", pathname, { ...opts, body });
  }

  /** One WebSocket request: connect handshake, the method, close. */
  async ws(
    method: string,
    params: unknown = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<WsResult> {
    const wsUrl = this.baseUrl.replace(/^http/, "ws");
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    return await new Promise<WsResult>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`ws ${method}: no answer within ${timeoutMs} ms`));
      }, timeoutMs);
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // already closed
        }
        fn();
      };
      socket.addEventListener("open", () => {
        socket.send(
          JSON.stringify({
            type: "req",
            id: "connect",
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: "kolo-probe",
                version: "continuity",
                platform: process.platform,
                mode: "probe",
              },
              auth: { token: this.token },
            },
          }),
        );
      });
      socket.addEventListener("message", (ev) => {
        let frame: { type?: string; id?: string; ok?: boolean; payload?: unknown; error?: unknown };
        try {
          frame = JSON.parse(String(ev.data)) as typeof frame;
        } catch {
          return;
        }
        if (frame.type !== "res") {
          return;
        }
        if (frame.id === "connect") {
          if (!frame.ok) {
            finish(() =>
              reject(
                new Error(`ws connect rejected: ${JSON.stringify(frame.error).slice(0, 200)}`),
              ),
            );
            return;
          }
          socket.send(JSON.stringify({ type: "req", id: "call", method, params }));
          return;
        }
        if (frame.id === "call") {
          const text = JSON.stringify(frame.payload ?? frame.error ?? null);
          this.record(`ws ${method}`, text);
          finish(() =>
            resolve({ ok: Boolean(frame.ok), payload: frame.payload, error: frame.error }),
          );
        }
      });
      socket.addEventListener("error", () =>
        finish(() => reject(new Error(`ws ${method}: socket error`))),
      );
    });
  }
}

/** Poll until `fn` returns a value or the deadline passes; every wait has a bound. */
export async function waitFor<T>(
  fn: () => Promise<T | undefined | false> | T | undefined | false,
  opts: { timeoutMs: number; intervalMs?: number; what: string },
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value !== undefined && value !== false) {
        return value;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 500));
  }
  throw new Error(
    `${opts.what}: not satisfied within ${opts.timeoutMs} ms${lastError ? ` (${lastError})` : ""}`,
  );
}
