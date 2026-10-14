// SPDX-License-Identifier: MIT
// WebSocket helper: opens the gateway socket, performs the `connect` handshake and exposes
// call(method, params) / on(event). Method and event names come from the spec's
// x-kolo-websocket extension (src/generated/websocket.ts).
import type { ConnectParams, HelloOk } from "./generated/types.js";
import {
  WS_HANDSHAKE_METHOD,
  WS_PROTOCOL_VERSION,
  type WsEvent,
  type WsEventMap,
  type WsMethod,
  type WsMethodMap,
} from "./generated/websocket.js";
import { type DeviceKey, deviceConnectPayload, signWithDeviceKey } from "./pair.js";

/** The subset of the WHATWG WebSocket the helper uses (global in Node 22+, browsers, Bun). */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (ev: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", listener: (ev: unknown) => void): void;
}

export type WebSocketCtor = new (url: string) => WebSocketLike;

export type ConnectClientInfo = ConnectParams["client"];

export type KoloWsOptions = {
  /** ws://host:port/ of the gateway. */
  url: string;
  /** Gateway token (auth.token in ConnectParams). */
  token?: string;
  /** Gateway password (password auth mode). */
  password?: string;
  /** Client identity sent in the handshake. Default: id "gateway-client", mode "backend". */
  client?: Partial<ConnectClientInfo>;
  role?: string;
  scopes?: string[];
  /**
   * Device key (M3a): the handshake waits for the gateway's `connect.challenge` nonce and
   * sends a signed `device` block, which a pairing access token requires. Node only.
   */
  device?: DeviceKey;
  /** How long to wait for connect.challenge before connecting without a nonce (ms). Default 3000. */
  challengeTimeoutMs?: number;
  /** Handshake timeout (ms). Default 10 000. */
  connectTimeoutMs?: number;
  /** Default per-call timeout (ms). Default 30 000; 0 disables. */
  callTimeoutMs?: number;
  /** Injectable constructor (tests). Default globalThis.WebSocket. */
  WebSocket?: WebSocketCtor;
};

export type CallOptions = {
  timeoutMs?: number;
  /** Keep waiting past an interim `{status:"accepted"}` answer for the final one. */
  expectFinal?: boolean;
};

export type WsErrorInfo = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
};

/** A `res` frame with ok:false, or the socket closing under a pending call. */
export class KoloWsError extends Error {
  readonly name = "KoloWsError";
  readonly code: string;
  readonly details?: unknown;
  readonly retryable?: boolean;
  readonly retryAfterMs?: number;
  constructor(
    readonly method: string,
    info: WsErrorInfo,
  ) {
    super(`${method}: ${info.code}: ${info.message}`);
    this.code = info.code;
    this.details = info.details;
    this.retryable = info.retryable;
    this.retryAfterMs = info.retryAfterMs;
  }
}

type Pending = {
  method: string;
  expectFinal: boolean;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type AnyHandler = (payload: unknown, event: string) => void;

export interface KoloSocket {
  /** The hello-ok payload of the handshake (server version, features, snapshot, policy). */
  readonly hello: HelloOk;
  call<M extends WsMethod>(
    method: M,
    params?: WsMethodMap[M]["params"],
    options?: CallOptions,
  ): Promise<WsMethodMap[M]["result"]>;
  call(method: string, params?: unknown, options?: CallOptions): Promise<unknown>;
  on<E extends WsEvent>(event: E, handler: (payload: WsEventMap[E], event: E) => void): () => void;
  on(event: "*" | (string & {}), handler: AnyHandler): () => void;
  close(code?: number, reason?: string): void;
  /** Resolves when the socket closes. */
  readonly closed: Promise<{ code: number; reason: string }>;
}

const OPEN = 1;

function randomId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return c?.randomUUID
    ? c.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function platformName(): string {
  const p = (globalThis as { process?: { platform?: string } }).process?.platform;
  return typeof p === "string" && p ? p : "web";
}

/** Open a socket to the gateway and complete the `connect` handshake. */
export function connectWs(options: KoloWsOptions): Promise<KoloSocket> {
  const Ctor = options.WebSocket ?? (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (typeof Ctor !== "function") {
    return Promise.reject(
      new TypeError("connectWs: no WebSocket available; pass options.WebSocket"),
    );
  }
  const socket = new Ctor(options.url);
  const pending = new Map<string, Pending>();
  const handlers = new Map<string, Set<AnyHandler>>();
  const callTimeoutMs = options.callTimeoutMs ?? 30_000;
  const connectId = `connect-${randomId()}`;
  let resolveClosed!: (v: { code: number; reason: string }) => void;
  const closed = new Promise<{ code: number; reason: string }>((r) => (resolveClosed = r));

  const failAll = (err: Error) => {
    for (const [id, p] of pending) {
      if (p.timer) {
        clearTimeout(p.timer);
      }
      pending.delete(id);
      p.reject(err);
    }
  };

  const emit = (event: string, payload: unknown) => {
    for (const key of [event, "*"]) {
      for (const h of handlers.get(key) ?? []) {
        try {
          h(payload, event);
        } catch {
          // A failing listener must not break frame dispatch.
        }
      }
    }
  };

  return new Promise<KoloSocket>((resolve, reject) => {
    let settled = false;
    const handshakeTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close(1000, "handshake timeout");
        reject(new Error(`connect: no hello-ok within ${options.connectTimeoutMs ?? 10_000} ms`));
      }
    }, options.connectTimeoutMs ?? 10_000);

    const api: KoloSocket = {
      get hello() {
        return hello;
      },
      call(method: string, params?: unknown, callOptions: CallOptions = {}) {
        if (method === WS_HANDSHAKE_METHOD) {
          return Promise.reject(
            new TypeError("connect is the handshake; it is sent by connectWs()"),
          );
        }
        if (socket.readyState !== OPEN) {
          return Promise.reject(
            new KoloWsError(method, { code: "NOT_CONNECTED", message: "socket is not open" }),
          );
        }
        const id = randomId();
        return new Promise<unknown>((res, rej) => {
          const entry: Pending = {
            method,
            expectFinal: callOptions.expectFinal === true,
            resolve: res,
            reject: rej,
          };
          const t = callOptions.timeoutMs ?? callTimeoutMs;
          if (t > 0) {
            entry.timer = setTimeout(() => {
              pending.delete(id);
              rej(
                new KoloWsError(method, { code: "TIMEOUT", message: `no response within ${t} ms` }),
              );
            }, t);
          }
          pending.set(id, entry);
          socket.send(
            JSON.stringify({
              type: "req",
              id,
              method,
              ...(params === undefined ? {} : { params }),
            }),
          );
        });
      },
      on(event: string, handler: AnyHandler) {
        let set = handlers.get(event);
        if (!set) {
          set = new Set();
          handlers.set(event, set);
        }
        set.add(handler);
        return () => set.delete(handler);
      },
      close(code = 1000, reason = "client close") {
        socket.close(code, reason);
      },
      closed,
    } as KoloSocket;
    let hello!: HelloOk;

    let challengeNonce: string | undefined;
    let challengeWaiter: ((nonce: string | undefined) => void) | undefined;

    const sendConnect = async () => {
      const client: ConnectClientInfo = {
        id: "gateway-client",
        version: "0.0.0",
        platform: platformName(),
        mode: "backend",
        ...options.client,
      } as ConnectClientInfo;
      const role = options.role ?? (options.device ? "operator" : undefined);
      const scopes = options.scopes;
      let device: ConnectParams["device"];
      if (options.device) {
        const nonce =
          challengeNonce ??
          (await new Promise<string | undefined>((res) => {
            challengeWaiter = res;
            setTimeout(() => res(undefined), options.challengeTimeoutMs ?? 3000);
          }));
        const signedAtMs = Date.now();
        const payload = deviceConnectPayload({
          deviceId: options.device.fingerprint,
          clientId: client.id,
          clientMode: client.mode,
          role: role ?? "operator",
          scopes: scopes ?? [],
          signedAtMs,
          token: options.token ?? null,
          nonce: nonce ?? null,
        });
        device = {
          id: options.device.fingerprint,
          publicKey: options.device.publicKey,
          signature: await signWithDeviceKey(options.device.privateKeyPem, payload),
          signedAt: signedAtMs,
          ...(nonce ? { nonce } : {}),
        };
      }
      const params: ConnectParams = {
        minProtocol: WS_PROTOCOL_VERSION,
        maxProtocol: WS_PROTOCOL_VERSION,
        client,
        ...(role ? { role } : {}),
        ...(scopes ? { scopes } : {}),
        ...(device ? { device } : {}),
        ...(options.token || options.password
          ? {
              auth: {
                ...(options.token ? { token: options.token } : {}),
                ...(options.password ? { password: options.password } : {}),
              },
            }
          : {}),
      };
      socket.send(
        JSON.stringify({ type: "req", id: connectId, method: WS_HANDSHAKE_METHOD, params }),
      );
    };

    socket.addEventListener("open", () => {
      void sendConnect().catch((err) => {
        if (!settled) {
          settled = true;
          clearTimeout(handshakeTimer);
          socket.close(1000, "connect failed");
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });

    socket.addEventListener("message", (ev) => {
      let frame: {
        type?: string;
        id?: string;
        ok?: boolean;
        payload?: unknown;
        error?: WsErrorInfo;
        event?: string;
      };
      try {
        frame = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as typeof frame;
      } catch {
        return;
      }
      if (frame.type === "event" && typeof frame.event === "string") {
        if (frame.event === "connect.challenge") {
          const nonce = (frame.payload as { nonce?: unknown } | undefined)?.nonce;
          if (typeof nonce === "string") {
            challengeNonce = nonce;
            challengeWaiter?.(nonce);
          }
        }
        emit(frame.event, frame.payload);
        return;
      }
      if (frame.type !== "res" || typeof frame.id !== "string") {
        return;
      }
      if (frame.id === connectId) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(handshakeTimer);
        const payload = frame.payload as HelloOk | undefined;
        if (frame.ok && payload?.type === "hello-ok") {
          hello = payload;
          resolve(api);
        } else {
          reject(
            new KoloWsError(
              WS_HANDSHAKE_METHOD,
              frame.error ?? { code: "HANDSHAKE_FAILED", message: "no hello-ok" },
            ),
          );
          socket.close(1000, "handshake failed");
        }
        return;
      }
      const p = pending.get(frame.id);
      if (!p) {
        return;
      }
      const status = (frame.payload as { status?: unknown } | undefined)?.status;
      if (frame.ok && p.expectFinal && status === "accepted") {
        return;
      }
      pending.delete(frame.id);
      if (p.timer) {
        clearTimeout(p.timer);
      }
      if (frame.ok) {
        p.resolve(frame.payload);
      } else {
        p.reject(
          new KoloWsError(p.method, frame.error ?? { code: "UNKNOWN", message: "request failed" }),
        );
      }
    });

    socket.addEventListener("close", (ev) => {
      clearTimeout(handshakeTimer);
      const info = { code: ev?.code ?? 1006, reason: ev?.reason ?? "" };
      failAll(
        new KoloWsError("socket", {
          code: "CLOSED",
          message: `socket closed (${info.code} ${info.reason})`.trim(),
        }),
      );
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `connect: socket closed before hello-ok (${info.code}${info.reason ? ` ${info.reason}` : ""})`,
          ),
        );
      }
      resolveClosed(info);
    });

    socket.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        clearTimeout(handshakeTimer);
        reject(new Error(`connect: socket error (${options.url})`));
      }
    });
  });
}
