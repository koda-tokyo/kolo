// Gateway round trip for scoped pairing (M3a): invite → redeem → scoped HTTP calls → refresh →
// reuse revokes the family; WS connect with a pairing token and a signed device challenge.
import {
  deviceConnectPayload,
  generateDeviceKey,
  pairProofPayload,
  signWithDeviceKey,
} from "@kodasoken/kolo-client";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RawData, WebSocket } from "ws";
import { flushAudit } from "../audit/index.js";
import { onAuditEvent, type AuditEvent } from "../security/audit-log.js";
import { setCredentialStoreForTest } from "./pair-store.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";
import { testState } from "./test-helpers.mocks.js";
import { getFreePort, installGatewayTestHooks, startGatewayServer } from "./test-helpers.server.js";

installGatewayTestHooks({ scope: "suite" });

let server: Awaited<ReturnType<typeof startGatewayServer>>;
let port = 0;
let ownerToken = "";
const audit: AuditEvent[] = [];
let stopAudit = () => {};

beforeAll(async () => {
  delete process.env.KOLO_GATEWAY_TOKEN;
  delete process.env.KOLO_GATEWAY_PASSWORD;
  setCredentialStoreForTest(null);
  stopAudit = onAuditEvent((e) => audit.push(e));
  port = await getFreePort();
  server = await startGatewayServer(port, { bind: "loopback" });
  ownerToken = (testState.gatewayAuth as { token?: string } | undefined)?.token ?? "";
});

afterAll(async () => {
  stopAudit();
  await flushAudit();
  await server?.close();
  setCredentialStoreForTest(null);
});

const url = (p: string) => `http://127.0.0.1:${port}${p}`;
const rawText = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.from(data as Buffer).toString("utf8");
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

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

async function invite(scope: string, token = ownerToken, extra: Record<string, unknown> = {}) {
  const res = await call("/api/pair/invite", { token, body: { scope, ...extra } });
  return { status: res.status, body: await json(res) };
}

async function nonce() {
  const body = await json(await call("/api/pair/nonce"));
  return body.nonce as string;
}

async function redeem(
  code: string,
  key: Awaited<ReturnType<typeof generateDeviceKey>>,
  name = "test-device",
) {
  const n = await nonce();
  const res = await call("/api/pair/redeem", {
    body: {
      code,
      deviceKeyPub: key.publicKey,
      deviceName: name,
      nonce: n,
      signature: await signWithDeviceKey(
        key.privateKeyPem,
        await pairProofPayload("redeem", n, code),
      ),
    },
  });
  return { status: res.status, body: await json(res) };
}

async function refresh(refreshToken: string, key: Awaited<ReturnType<typeof generateDeviceKey>>) {
  const n = await nonce();
  const res = await call("/api/pair/refresh", {
    body: {
      refreshToken,
      nonce: n,
      signature: await signWithDeviceKey(
        key.privateKeyPem,
        await pairProofPayload("refresh", n, refreshToken),
      ),
    },
  });
  return { status: res.status, body: await json(res) };
}

describe("pairing over HTTP (M3a)", () => {
  it("only an owner/admin can mint invitations; the code is shown once and never stored", async () => {
    expect((await call("/api/pair/invite", { body: { scope: "attach" } })).status).toBe(401);
    expect(
      (await call("/api/pair/invite", { token: "nope", body: { scope: "attach" } })).status,
    ).toBe(401);
    const bad = await invite("owner");
    expect(bad.status).toBe(400);
    const made = await invite("attach", ownerToken, { label: "ci", ttlMinutes: 5 });
    expect(made.status).toBe(201);
    expect(String(made.body.code)).toMatch(/^kpi_/);
    expect(made.body.invitation).toMatchObject({
      scope: "attach",
      label: "ci",
      autoApprove: true,
      status: "pending",
    });
    const list = await json(await call("/api/pair/invitations", { token: ownerToken }));
    expect(JSON.stringify(list)).not.toContain(String(made.body.code));
    expect(
      (list.invitations as Array<{ id: string }>).some(
        (i) => i.id === (made.body.invitation as { id: string }).id,
      ),
    ).toBe(true);
    const stateFile = path.join(process.env.KOLO_STATE_DIR ?? "", "secrets", "credentials.json");
    expect(fs.existsSync(stateFile)).toBe(true);
    expect(fs.readFileSync(stateFile, "utf8")).not.toContain(String(made.body.code));
    if (process.platform !== "win32") {
      expect(fs.statSync(stateFile).mode & 0o777).toBe(0o600);
    }
  });

  it("invite → redeem → attach-scope route → refresh → reuse revokes the family", async () => {
    const key = await generateDeviceKey();
    const made = await invite("attach");
    const code = made.body.code as string;

    // Bad proof is refused and the invitation stays usable.
    const thief = await generateDeviceKey();
    const n = await nonce();
    const forged = await call("/api/pair/redeem", {
      body: {
        code,
        deviceKeyPub: key.publicKey,
        nonce: n,
        signature: await signWithDeviceKey(
          thief.privateKeyPem,
          await pairProofPayload("redeem", n, code),
        ),
      },
    });
    expect(forged.status).toBe(401);
    expect(await json(forged)).toMatchObject({ ok: false, error: "invalid_signature" });

    const issued = await redeem(code, key);
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({
      ok: true,
      device: { fingerprint: key.fingerprint, scope: "attach", status: "approved" },
    });
    const access0 = issued.body.accessToken as string;
    const refresh0 = issued.body.refreshToken as string;
    expect(access0).toMatch(/^kpa_/);
    expect((await redeem(code, await generateDeviceKey())).body).toMatchObject({
      error: "code_used",
    });

    // observe-level route, attach-level route, admin-level route.
    const me = await json(await call("/api/pair/me", { token: access0 }));
    expect(me).toMatchObject({
      ok: true,
      principal: { kind: "pair", scope: "attach", fingerprint: key.fingerprint },
    });
    expect((await call("/metrics", { token: access0 })).status).toBe(200);
    // /tools/invoke is attach-scoped: the gate passes, the body is then rejected (400, not 401/403).
    const tools = await call("/tools/invoke", { token: access0, body: {} });
    expect(tools.status).toBe(400);
    const denied = await call("/api/pair/invite", { token: access0, body: { scope: "observe" } });
    expect(denied.status).toBe(403);
    expect((await call("/api/admin/status", { token: access0 })).status).toBe(403);
    expect((await call("/api/pair/devices", { token: access0 })).status).toBe(403);
    expect(await json(denied)).toMatchObject({ error: { type: "forbidden" } });

    // Rotate.
    const rotated = await refresh(refresh0, key);
    expect(rotated.status).toBe(200);
    const access1 = rotated.body.accessToken as string;
    const refresh1 = rotated.body.refreshToken as string;
    expect(rotated.body.generation).toBe(1);
    expect((await call("/api/pair/me", { token: access0 })).status).toBe(401);
    expect((await call("/api/pair/me", { token: access1 })).status).toBe(200);

    // Reuse of the retired refresh token: family revoked, both tokens dead, audited.
    const reuse = await refresh(refresh0, key);
    expect(reuse.status).toBe(401);
    expect(reuse.body).toMatchObject({ ok: false, error: "reuse_detected" });
    expect((await call("/api/pair/me", { token: access1 })).status).toBe(401);
    expect((await refresh(refresh1, key)).body).toMatchObject({ error: "family_revoked" });
    expect(
      audit.some((e) => e.action === "pair.reuse_detected" && e.device === key.fingerprint),
    ).toBe(true);
    for (const action of ["pair.invite", "pair.redeem", "pair.refresh"]) {
      expect(audit.some((e) => e.action === action && e.outcome === "allowed")).toBe(true);
    }
  });

  it("an admin credential can mint invitations but never above its own scope; owner can revoke it", async () => {
    const key = await generateDeviceKey();
    const made = await invite("admin");
    const issued = await redeem(made.body.code as string, key, "admin-phone");
    const access = issued.body.accessToken as string;
    expect((await invite("admin", access)).status).toBe(201);
    expect((await invite("observe", access)).status).toBe(201);
    const devices = await json(await call("/api/pair/devices", { token: access }));
    expect(
      (devices.devices as Array<{ fingerprint: string; name: string }>).some(
        (d) => d.fingerprint === key.fingerprint && d.name === "admin-phone",
      ),
    ).toBe(true);
    expect(JSON.stringify(devices)).not.toContain("privateKey");

    const revoked = await call(`/api/pair/devices/${key.fingerprint}/revoke`, {
      token: ownerToken,
      body: {},
    });
    expect(revoked.status).toBe(200);
    expect((await call("/api/pair/me", { token: access })).status).toBe(401);
    expect(
      (await call(`/api/pair/devices/${key.fingerprint}/revoke`, { token: ownerToken, body: {} }))
        .status,
    ).toBe(404);
    expect(audit.some((e) => e.action === "pair.revoke" && e.device === key.fingerprint)).toBe(
      true,
    );
  });

  it("without auto-approve the device stays pending until `approve`", async () => {
    const key = await generateDeviceKey();
    const made = await invite("observe", ownerToken, { autoApprove: false });
    const issued = await redeem(made.body.code as string, key);
    expect(issued.body.device).toMatchObject({ status: "pending" });
    const access = issued.body.accessToken as string;
    expect((await call("/api/pair/me", { token: access })).status).toBe(401);
    expect(
      (await call(`/api/pair/devices/${key.fingerprint}/approve`, { token: ownerToken, body: {} }))
        .status,
    ).toBe(200);
    expect((await call("/api/pair/me", { token: access })).status).toBe(200);
    expect(audit.some((e) => e.action === "pair.approve" && e.device === key.fingerprint)).toBe(
      true,
    );
  });

  it("documents the pairing routes with their minimum scope", async () => {
    const doc = await json(await call("/doc", { token: ownerToken }));
    const paths = doc.paths as Record<string, Record<string, Record<string, unknown>>>;
    expect(paths["/api/pair/invite"].post["x-kolo-min-scope"]).toBe("admin");
    expect(paths["/api/pair/me"].get["x-kolo-min-scope"]).toBe("observe");
    expect(paths["/tools/invoke"].post["x-kolo-min-scope"]).toBe("attach");
    expect(paths["/api/pair/redeem"].post.security).toEqual([]);
    const schemes = (doc.components as { securitySchemes: Record<string, unknown> })
      .securitySchemes;
    expect(schemes.pairToken).toBeTruthy();
    const ws = doc["x-kolo-websocket"] as { methods: Array<{ name: string }> };
    expect(ws.methods.some((m) => m.name === "pair.redeem")).toBe(true);
  });
});

describe("pairing over WebSocket (M3a)", () => {
  type Frame = {
    type: string;
    id?: string;
    ok?: boolean;
    event?: string;
    payload?: unknown;
    error?: { code?: string; message?: string };
  };

  async function openSigned(
    key: Awaited<ReturnType<typeof generateDeviceKey>>,
    accessToken: string,
    opts: { nonce?: boolean; fingerprint?: string } = {},
  ) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: Frame[] = [];
    const waiters: Array<{ test: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
    ws.on("message", (data) => {
      const frame = JSON.parse(rawText(data)) as Frame;
      frames.push(frame);
      for (const w of waiters.slice()) {
        if (w.test(frame)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(frame);
        }
      }
    });
    const next = (test: (f: Frame) => boolean, timeoutMs = 5000) =>
      new Promise<Frame>((resolve, reject) => {
        const hit = frames.find(test);
        if (hit) {
          resolve(hit);
          return;
        }
        const timer = setTimeout(() => reject(new Error("ws frame timeout")), timeoutMs);
        waiters.push({
          test,
          resolve: (f) => {
            clearTimeout(timer);
            resolve(f);
          },
        });
      });
    await new Promise<void>((resolve) => ws.once("open", resolve));
    const challenge = await next((f) => f.type === "event" && f.event === "connect.challenge");
    const serverNonce = (challenge.payload as { nonce: string }).nonce;
    const nonce = opts.nonce === false ? undefined : serverNonce;
    const deviceId = opts.fingerprint ?? key.fingerprint;
    const signedAt = Date.now();
    const payload = deviceConnectPayload({
      deviceId,
      clientId: "kolo-probe",
      clientMode: "probe",
      role: "operator",
      scopes: [],
      signedAtMs: signedAt,
      token: accessToken,
      nonce: nonce ?? null,
    });
    let id = 0;
    const send = (method: string, params?: unknown) => {
      const reqId = `r${++id}`;
      ws.send(JSON.stringify({ type: "req", id: reqId, method, params }));
      return next((f) => f.type === "res" && f.id === reqId);
    };
    ws.send(
      JSON.stringify({
        type: "req",
        id: "connect",
        method: "connect",
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: { id: "kolo-probe", version: "test", platform: "test", mode: "probe" },
          role: "operator",
          scopes: [],
          auth: { token: accessToken },
          device: {
            id: deviceId,
            publicKey: key.publicKey,
            signature: await signWithDeviceKey(key.privateKeyPem, payload),
            signedAt,
            ...(nonce ? { nonce } : {}),
          },
        },
      }),
    );
    const hello = await next((f) => f.type === "res" && f.id === "connect");
    return { ws, hello, send };
  }

  it("connect with a pairing token needs the bound device key and the server nonce; scope matrix and revocation apply per request", async () => {
    const key = await generateDeviceKey();
    const made = await invite("attach");
    const issued = await redeem(made.body.code as string, key, "ws-device");
    const access = issued.body.accessToken as string;

    // No nonce: refused even on loopback (the proof is the point).
    const noNonce = await openSigned(key, access, { nonce: false });
    expect(noNonce.hello.ok).toBe(false);
    expect(noNonce.hello.error?.message).toContain("nonce");
    noNonce.ws.close();

    // Another device key presenting the token: refused.
    const other = await generateDeviceKey();
    const mismatch = await openSigned(other, access);
    expect(mismatch.hello.ok).toBe(false);
    expect(mismatch.hello.error?.message).toContain("device_mismatch");
    mismatch.ws.close();
    expect(audit.some((e) => e.action === "pair.connect" && e.outcome === "denied")).toBe(true);

    const session = await openSigned(key, access);
    expect(session.hello.ok).toBe(true);
    const helloPayload = session.hello.payload as { type: string; auth?: unknown };
    expect(helloPayload.type).toBe("hello-ok");
    // No legacy device token is minted for a pairing credential.
    expect(helloPayload.auth).toBeUndefined();

    const health = await session.send("health");
    expect(health.ok).toBe(true);
    const me = await session.send("pair.me");
    expect(me.ok).toBe(true);
    expect(me.payload).toMatchObject({
      kind: "pair",
      scope: "attach",
      fingerprint: key.fingerprint,
    });
    const config = await session.send("config.get");
    expect(config.ok).toBe(false);
    expect(config.error?.message).toContain("missing scope: admin");
    const mint = await session.send("pair.invite", { scope: "observe" });
    expect(mint.ok).toBe(false);

    // Revoke from the owner side: the open socket loses access on its next request.
    expect(
      (await call(`/api/pair/devices/${key.fingerprint}/revoke`, { token: ownerToken, body: {} }))
        .status,
    ).toBe(200);
    const after = await session.send("health");
    expect(after.ok).toBe(false);
    expect(after.error?.code).toBe("NOT_PAIRED");
    session.ws.close();
    expect(
      audit.some(
        (e) =>
          e.action === "pair.connect" && e.outcome === "allowed" && e.device === key.fingerprint,
      ),
    ).toBe(true);
  });

  it("an owner socket can redeem an invitation for another device key (pair.redeem)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const frames: Frame[] = [];
    ws.on("message", (d) => frames.push(JSON.parse(rawText(d)) as Frame));
    const wait = (id: string) =>
      new Promise<Frame>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), 5000);
        const poll = () => {
          const f = frames.find((x) => x.type === "res" && x.id === id);
          if (f) {
            clearTimeout(t);
            resolve(f);
          } else {
            setTimeout(poll, 10);
          }
        };
        poll();
      });
    await new Promise<void>((resolve) => ws.once("open", resolve));
    ws.send(
      JSON.stringify({
        type: "req",
        id: "c",
        method: "connect",
        params: {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: { id: "kolo-probe", version: "test", platform: "test", mode: "probe" },
          auth: { token: ownerToken },
        },
      }),
    );
    expect((await wait("c")).ok).toBe(true);
    ws.send(
      JSON.stringify({
        type: "req",
        id: "i",
        method: "pair.invite",
        params: { scope: "observe", label: "via-ws" },
      }),
    );
    const inv = await wait("i");
    expect(inv.ok).toBe(true);
    const code = (inv.payload as { code: string }).code;
    ws.send(JSON.stringify({ type: "req", id: "n", method: "pair.nonce", params: {} }));
    const n = ((await wait("n")).payload as { nonce: string }).nonce;
    const key = await generateDeviceKey();
    ws.send(
      JSON.stringify({
        type: "req",
        id: "r",
        method: "pair.redeem",
        params: {
          code,
          deviceKeyPub: key.publicKey,
          deviceName: "ws-paired",
          nonce: n,
          signature: await signWithDeviceKey(
            key.privateKeyPem,
            await pairProofPayload("redeem", n, code),
          ),
        },
      }),
    );
    const red = await wait("r");
    expect(red.ok).toBe(true);
    const cred = red.payload as { accessToken: string; device: { scope: string } };
    expect(cred.device.scope).toBe("observe");
    expect((await call("/api/pair/me", { token: cred.accessToken })).status).toBe(200);
    ws.send(JSON.stringify({ type: "req", id: "d", method: "pair.devices", params: {} }));
    const devs = (await wait("d")).payload as { devices: Array<{ name: string }> };
    expect(devs.devices.some((d) => d.name === "ws-paired")).toBe(true);
    ws.close();
  });
});
