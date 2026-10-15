import {
  deviceConnectPayload,
  generateDeviceKey,
  pairProofPayload,
  signWithDeviceKey,
} from "@kodasoken/kurahi-client";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import { flushAudit } from "../audit/index.js";
import { emitAgentEvent, registerAgentRunContext } from "../infra/agent-events.js";
import { onAuditEvent, type AuditEvent } from "../security/audit-log.js";
import { setCredentialStoreForTest } from "./pair-store.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { resetSessionAttachRegistryForTest } from "./session-attach.js";
// Gateway round trip for session discovery and attach (M3b): discover over HTTP and WS, attach
// two clients to one session and see the same event stream, allowlist enforced for a restricted
// credential (list filtered, get 404, events withheld, calls refused), detach audited.
// The mocks module comes first so the config mock (session store path) applies to everything.
import { testState } from "./test-helpers.mocks.js";
import {
  connectOk,
  getFreePort,
  installGatewayTestHooks,
  rpcReq,
  startGatewayServer,
  writeSessionStore,
} from "./test-helpers.server.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let ownerToken = "";
const audit: AuditEvent[] = [];
let stopAudit = () => {};
const MAIN_KEY = "agent:main:main";
const OPS_KEY = "agent:main:ops";
let storePath = "";

// The harness clears testState before every test; the store path must be re-applied.
beforeEach(() => {
  testState.sessionStorePath = storePath;
});

beforeAll(async () => {
  delete process.env.KOLO_GATEWAY_TOKEN;
  delete process.env.KOLO_GATEWAY_PASSWORD;
  setCredentialStoreForTest(null);
  resetSessionAttachRegistryForTest();
  stopAudit = onAuditEvent((e) => audit.push(e));
  port = await getFreePort();
  server = await startGatewayServer(port, { bind: "loopback" });
  ownerToken = (testState.gatewayAuth as { token?: string } | undefined)?.token ?? "";
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kolo-sessions-m3b-"));
  storePath = path.join(dir, "sessions.json");
  const now = Date.now();
  await writeSessionStore({
    storePath,
    entries: {
      main: { sessionId: "sid-main", updatedAt: now, label: "primary" },
      ops: { sessionId: "sid-ops", updatedAt: now - 60_000, label: "ops" },
    },
  });
});

afterAll(async () => {
  stopAudit();
  await flushAudit();
  await server?.close();
  setCredentialStoreForTest(null);
  resetSessionAttachRegistryForTest();
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const rawText = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.from(data as Buffer).toString("utf8");

async function call(p: string, init: RequestInit & { token?: string; body?: unknown } = {}) {
  const { token, body, ...rest } = init;
  return await fetch(url(p), {
    ...rest,
    method: rest.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Row = {
  id: string;
  key: string;
  agent: string;
  label?: string;
  clients: number;
  state: string;
};

async function listWith(token: string, query = ""): Promise<Row[]> {
  const res = await call(`/api/sessions${query}`, { token });
  expect(res.status).toBe(200);
  return (await json(res)).sessions as Row[];
}

/** Pair an attach device restricted to `sessions` and return its access token + key. */
async function pairRestricted(sessions: string[]) {
  const key = await generateDeviceKey();
  const made = await json(
    await call("/api/pair/invite", {
      token: ownerToken,
      body: { scope: "attach", sessions, label: "restricted" },
    }),
  );
  const nonce = (await json(await call("/api/pair/nonce"))).nonce as string;
  const code = made.code as string;
  const issued = await json(
    await call("/api/pair/redeem", {
      body: {
        code,
        deviceKeyPub: key.publicKey,
        deviceName: "restricted-device",
        nonce,
        signature: await signWithDeviceKey(
          key.privateKeyPem,
          await pairProofPayload("redeem", nonce, code),
        ),
      },
    }),
  );
  expect(issued.ok).toBe(true);
  return { key, accessToken: issued.accessToken as string, invitation: made.invitation };
}

type Frame = { type: string; id?: string; ok?: boolean; event?: string; payload?: unknown };

/** Open a socket and collect every event frame it receives. */
async function openOwner() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const events: Frame[] = [];
  ws.on("message", (data) => {
    const frame = JSON.parse(rawText(data)) as Frame;
    if (frame.type === "event") {
      events.push(frame);
    }
  });
  await new Promise<void>((resolve) => ws.once("open", resolve));
  await connectOk(ws, { token: ownerToken });
  return { ws, events };
}

async function openPaired(key: Awaited<ReturnType<typeof generateDeviceKey>>, accessToken: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const events: Frame[] = [];
  let nonce = "";
  const gotNonce = new Promise<void>((resolve) => {
    ws.on("message", (data) => {
      const frame = JSON.parse(rawText(data)) as Frame;
      if (frame.type === "event" && frame.event === "connect.challenge") {
        nonce = (frame.payload as { nonce: string }).nonce;
        resolve();
        return;
      }
      if (frame.type === "event") {
        events.push(frame);
      }
    });
  });
  await new Promise<void>((resolve) => ws.once("open", resolve));
  await gotNonce;
  const signedAt = Date.now();
  const payload = deviceConnectPayload({
    deviceId: key.fingerprint,
    clientId: "kolo-probe",
    clientMode: "probe",
    role: "operator",
    scopes: [],
    signedAtMs: signedAt,
    token: accessToken,
    nonce,
  });
  const hello = await rpcReq(ws, "connect", {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: { id: "kolo-probe", version: "test", platform: "test", mode: "probe" },
    role: "operator",
    scopes: [],
    auth: { token: accessToken },
    device: {
      id: key.fingerprint,
      publicKey: key.publicKey,
      signature: await signWithDeviceKey(key.privateKeyPem, payload),
      signedAt,
      nonce,
    },
  });
  expect(hello.ok).toBe(true);
  return { ws, events };
}

const closeAll = async (...sockets: WebSocket[]) => {
  await Promise.all(
    sockets.map(
      (ws) =>
        new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          ws.once("close", () => resolve());
          ws.close();
        }),
    ),
  );
};

const waitFor = async (test: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) {
      throw new Error("timeout");
    }
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("session discovery over HTTP (M3b)", () => {
  it("needs at least the attach scope and lists every session for the owner", async () => {
    expect((await call("/api/sessions")).status).toBe(401);
    const rows = await listWith(ownerToken);
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining([MAIN_KEY, OPS_KEY]));
    const main = rows.find((r) => r.key === MAIN_KEY)!;
    expect(main).toMatchObject({ id: "sid-main", agent: "main", label: "primary", clients: 0 });
    expect(["running", "idle"]).toContain(main.state);
    expect(typeof main.lastActivity).toBe("string");
    // Filters: by agent, by search.
    expect((await listWith(ownerToken, "?agent=nobody")).length).toBe(0);
    expect((await listWith(ownerToken, "?search=ops")).map((r) => r.key)).toEqual([OPS_KEY]);
    expect((await call("/api/sessions?limit=zero", { token: ownerToken })).status).toBe(400);
  });

  it("resolves one session by id, key, label or agent id", async () => {
    for (const target of ["sid-ops", OPS_KEY, "ops"]) {
      const res = await call(`/api/sessions/${encodeURIComponent(target)}`, { token: ownerToken });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.session).toMatchObject({ key: OPS_KEY, attachments: [] });
    }
    const byAgent = await json(await call("/api/sessions/main", { token: ownerToken }));
    expect((byAgent.session as Row).key).toBe(MAIN_KEY);
    expect((await call("/api/sessions/nope", { token: ownerToken })).status).toBe(404);
  });

  it("an observe credential is refused (403); an attach credential with an allowlist sees only its sessions", async () => {
    const observe = await generateDeviceKey();
    const inv = await json(
      await call("/api/pair/invite", { token: ownerToken, body: { scope: "observe" } }),
    );
    const n = (await json(await call("/api/pair/nonce"))).nonce as string;
    const issued = await json(
      await call("/api/pair/redeem", {
        body: {
          code: inv.code,
          deviceKeyPub: observe.publicKey,
          nonce: n,
          signature: await signWithDeviceKey(
            observe.privateKeyPem,
            await pairProofPayload("redeem", n, inv.code as string),
          ),
        },
      }),
    );
    expect((await call("/api/sessions", { token: issued.accessToken as string })).status).toBe(403);

    const restricted = await pairRestricted(["label:ops"]);
    expect(restricted.invitation).toMatchObject({ sessions: ["label:ops"] });
    const rows = await listWith(restricted.accessToken);
    expect(rows.map((r) => r.key)).toEqual([OPS_KEY]);
    expect(
      (await call(`/api/sessions/${MAIN_KEY}`, { token: restricted.accessToken })).status,
    ).toBe(404);
    expect((await call("/api/sessions/ops", { token: restricted.accessToken })).status).toBe(200);
    const me = await json(await call("/api/pair/me", { token: restricted.accessToken }));
    expect(me.principal).toMatchObject({ scope: "attach", sessions: ["label:ops"] });
    const invalid = await call("/api/pair/invite", {
      token: ownerToken,
      body: { scope: "attach", sessions: "agent:*" },
    });
    expect(invalid.status).toBe(400);
  });
});

describe("attach over WebSocket (M3b)", () => {
  it("two clients attach to one session, both receive the same events, detach is audited", async () => {
    const a = await openOwner();
    const b = await openOwner();
    const attachedA = await rpcReq<{
      attached: boolean;
      session: Row & { attachments: unknown[] };
    }>(a.ws, "session.attach", { key: MAIN_KEY });
    expect(attachedA.ok).toBe(true);
    expect(attachedA.payload?.attached).toBe(true);
    expect(attachedA.payload?.session.clients).toBe(1);
    const attachedB = await rpcReq<{ session: Row }>(b.ws, "session.attach", {
      key: "primary",
      mode: "follow",
    });
    expect(attachedB.ok).toBe(true);
    expect(attachedB.payload?.session.key).toBe(MAIN_KEY);
    expect(attachedB.payload?.session.clients).toBe(2);

    // Discovery reflects both attachments.
    const detail = await json(await call(`/api/sessions/${MAIN_KEY}`, { token: ownerToken }));
    const session = detail.session as Row & { attachments: Array<{ mode: string }> };
    expect(session.clients).toBe(2);
    expect(session.attachments.map((x) => x.mode).toSorted()).toEqual(["follow", "interact"]);
    const discovered = await rpcReq<{ sessions: Row[] }>(a.ws, "sessions.discover", {});
    expect(discovered.ok).toBe(true);
    expect(discovered.payload?.sessions.find((s) => s.key === MAIN_KEY)?.clients).toBe(2);

    // One run on that session: both sockets see the same agent + chat frames.
    registerAgentRunContext("run-1", { sessionKey: MAIN_KEY });
    emitAgentEvent({
      runId: "run-1",
      stream: "assistant",
      sessionKey: MAIN_KEY,
      data: { text: "hi" },
    });
    emitAgentEvent({
      runId: "run-1",
      stream: "lifecycle",
      sessionKey: MAIN_KEY,
      data: { phase: "end" },
    });
    const pick = (events: Frame[]) =>
      events
        .filter((f) => f.event === "agent" || f.event === "chat")
        .map((f) => ({
          event: f.event,
          runId: (f.payload as { runId: string }).runId,
          sessionKey: (f.payload as { sessionKey?: string }).sessionKey,
          seq: (f.payload as { seq?: number }).seq,
          state: (f.payload as { state?: string }).state,
        }));
    await waitFor(() => pick(a.events).length >= 4 && pick(b.events).length >= 4);
    expect(pick(a.events)).toEqual(pick(b.events));
    expect(pick(a.events).every((e) => e.runId === "run-1" && e.sessionKey === MAIN_KEY)).toBe(
      true,
    );
    expect(pick(a.events).some((e) => e.event === "chat" && e.state === "final")).toBe(true);

    // Explicit detach, then a socket close: both audited, counts go back to zero.
    const detached = await rpcReq<{ detached: string[] }>(a.ws, "session.detach", {
      key: MAIN_KEY,
    });
    expect(detached.payload?.detached).toEqual([MAIN_KEY]);
    b.ws.close();
    await waitFor(
      () => audit.filter((e) => e.action === "session.detach" && e.scope === MAIN_KEY).length >= 2,
    );
    const detaches = audit.filter((e) => e.action === "session.detach" && e.scope === MAIN_KEY);
    expect(detaches.map((e) => e.detail?.reason).toSorted()).toEqual(["detach", "disconnect"]);
    expect(
      audit.filter((e) => e.action === "session.attach" && e.outcome === "allowed").length,
    ).toBe(2);
    const after = await json(await call(`/api/sessions/${MAIN_KEY}`, { token: ownerToken }));
    expect((after.session as Row).clients).toBe(0);
    await closeAll(a.ws);
  });

  it("a messaging pipe attaches by channel + target and lands on the conversation's session", async () => {
    const a = await openOwner();
    const res = await rpcReq<{ session: Row }>(a.ws, "session.attach", {
      channel: "whatsapp",
      to: "+15551234567",
      mode: "pipe",
    });
    expect(res.ok).toBe(true);
    // Direct chats route to the agent's main session under the default session scope.
    expect(res.payload?.session.key.startsWith("agent:main:")).toBe(true);
    expect((await listWith(ownerToken)).some((r) => r.key === res.payload?.session.key)).toBe(true);
    const pipeAttach = audit.find(
      (e) => e.action === "session.attach" && e.detail?.mode === "pipe" && e.outcome === "allowed",
    );
    expect(pipeAttach?.scope).toBe(res.payload?.session.key);
    expect((await rpcReq(a.ws, "session.attach", { channel: "whatsapp" })).ok).toBe(false);
    await closeAll(a.ws);
  });

  it("a restricted credential cannot attach to, call into, or receive events of other sessions", async () => {
    const restricted = await pairRestricted(["agent:main:ops"]);
    const r = await openPaired(restricted.key, restricted.accessToken);
    const owner = await openOwner();

    const denied = await rpcReq(r.ws, "session.attach", { key: MAIN_KEY });
    expect(denied.ok).toBe(false);
    expect(denied.error?.message).toContain("No session found");
    expect(
      audit.some(
        (e) =>
          e.action === "session.attach" &&
          e.outcome === "denied" &&
          e.device === restricted.key.fingerprint,
      ),
    ).toBe(true);
    const history = await rpcReq(r.ws, "chat.history", { sessionKey: MAIN_KEY });
    expect(history.ok).toBe(false);
    expect(history.error?.message).toContain("not allowed");
    const allowed = await rpcReq<{ session: Row }>(r.ws, "session.attach", { key: OPS_KEY });
    expect(allowed.ok).toBe(true);
    const discovered = await rpcReq<{ sessions: Row[] }>(r.ws, "sessions.discover", {});
    expect(discovered.payload?.sessions.map((s) => s.key)).toEqual([OPS_KEY]);

    // Events of the main session reach the owner but not the restricted socket; ops events do.
    registerAgentRunContext("run-main", { sessionKey: MAIN_KEY });
    emitAgentEvent({
      runId: "run-main",
      stream: "assistant",
      sessionKey: MAIN_KEY,
      data: { text: "secret" },
    });
    registerAgentRunContext("run-ops", { sessionKey: OPS_KEY });
    emitAgentEvent({
      runId: "run-ops",
      stream: "assistant",
      sessionKey: OPS_KEY,
      data: { text: "ops" },
    });
    const runIds = (events: Frame[]) =>
      events.filter((f) => f.event === "agent").map((f) => (f.payload as { runId: string }).runId);
    await waitFor(
      () => runIds(owner.events).includes("run-ops") && runIds(r.events).includes("run-ops"),
    );
    expect(runIds(owner.events)).toEqual(expect.arrayContaining(["run-main", "run-ops"]));
    expect(runIds(r.events)).not.toContain("run-main");
    expect(JSON.stringify(r.events)).not.toContain("secret");
    await closeAll(r.ws, owner.ws);
    await waitFor(() =>
      audit.some(
        (e) =>
          e.action === "session.detach" && e.scope === OPS_KEY && e.detail?.reason === "disconnect",
      ),
    );
  });

  it("documents the session routes and WS methods with their minimum scope", async () => {
    const doc = await json(await call("/doc", { token: ownerToken }));
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/api/sessions"].get["x-kolo-min-scope"]).toBe("attach");
    expect(paths["/api/sessions/{id}"].get["x-kolo-min-scope"]).toBe("attach");
    const ws = doc["x-kolo-websocket"] as { methods: Array<{ name: string; params?: unknown }> };
    for (const name of ["sessions.discover", "session.attach", "session.detach"]) {
      expect(ws.methods.find((m) => m.name === name)?.params).toBeTruthy();
    }
  });
});
