import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { EvidenceRecorder } from "../evidence/recorder.js";
import { verifyEvidenceBundle } from "../evidence/verify.js";
import { loadOrCreateDeviceIdentity } from "../infra/device-identity.js";
import { createEvidenceHttpHandlers } from "./http-evidence.js";
import { setHttpPrincipal } from "./pair-auth.js";

type Captured = { status: number; body: string; headers: Record<string, string> };

function fakeRes(): { res: ServerResponse; captured: () => Captured } {
  let status = 0;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    end: (chunk?: string) => {
      body = chunk ?? "";
    },
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
  } as unknown as ServerResponse;
  return { res, captured: () => ({ status, body, headers }) };
}

function fakeReq(body = ""): IncomingMessage {
  const req = (async function* () {
    if (body) {
      yield Buffer.from(body);
    }
  })() as unknown as IncomingMessage;
  return req;
}

describe("evidence HTTP handlers", () => {
  let home = "";
  let env: NodeJS.ProcessEnv;
  let handlers: ReturnType<typeof createEvidenceHttpHandlers>;

  async function call(
    name: keyof typeof handlers,
    id: string,
    opts: {
      query?: string;
      body?: string;
      principal?: Parameters<typeof setHttpPrincipal>[1];
    } = {},
  ) {
    const { res, captured } = fakeRes();
    const req = fakeReq(opts.body);
    if (opts.principal) {
      setHttpPrincipal(req, opts.principal);
    }
    await handlers[name](req, res, {
      url: new URL(`/x${opts.query ?? ""}`, "http://127.0.0.1"),
      params: { id },
    });
    const c = captured();
    return { ...c, json: () => JSON.parse(c.body) as Record<string, unknown> };
  }

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-ev-http-"));
    env = { ...process.env, KOLO_HOME: home, KOLO_STATE_DIR: home };
    handlers = createEvidenceHttpHandlers({ gatewayVersion: "test", env });
    const idn = loadOrCreateDeviceIdentity(path.join(home, "identity", "continuity-signing.json"));
    const key = { privateKeyPem: idn.privateKeyPem, publicKeyPem: idn.publicKeyPem };
    const done = new EvidenceRecorder(
      {
        id: "job-done",
        agent: "alice",
        sessionKey: "agent:alice:main",
        kind: "agent",
        startedAt: new Date().toISOString(),
      },
      { env, key },
    );
    done.start({ prompt: "p" });
    done.toolStart({ toolCallId: "t", name: "read", args: { path: "a" } });
    done.toolEnd({
      toolCallId: "t",
      name: "read",
      result: "<script>alert(1)</script>",
      isError: false,
    });
    done.finish({ status: "succeeded", steps: 1, toolCalls: 1, endedAt: new Date().toISOString() });
    const live = new EvidenceRecorder(
      {
        id: "job-live",
        agent: "bob",
        sessionKey: "agent:bob:main",
        kind: "agent",
        startedAt: new Date().toISOString(),
      },
      { env, key },
    );
    live.start({ prompt: "p" });
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("summary and manifest; null manifest while running; 404 for unknown and unsafe ids", async () => {
    const done = await call("getJobEvidence", "job-done");
    expect(done.status).toBe(200);
    const body = done.json();
    expect(body.ok).toBe(true);
    expect(body.summary).toMatchObject({
      jobId: "job-done",
      status: "succeeded",
      toolCalls: 1,
      signed: true,
    });
    expect((body.manifest as { signer: { alg: string } }).signer.alg).toBe("ed25519");
    expect(done.headers["cache-control"]).toBe("no-store");
    const live = await call("getJobEvidence", "job-live");
    expect(live.json()).toMatchObject({ ok: true, manifest: null });
    expect((live.json().summary as { status: string }).status).toBe("running");
    expect((await call("getJobEvidence", "nope")).status).toBe(404);
    expect((await call("getJobEvidence", "../x")).status).toBe(404);
  });

  test("events page with from/limit and validation", async () => {
    const all = await call("listJobEvidenceEvents", "job-done");
    expect(all.json()).toMatchObject({ ok: true, from: 1, count: 4, total: 4, next: null });
    const page = await call("listJobEvidenceEvents", "job-done", { query: "?from=2&limit=2" });
    const b = page.json();
    expect(b).toMatchObject({ from: 2, count: 2, total: 4, next: 4 });
    expect((b.events as Array<{ seq: number }>).map((e) => e.seq)).toEqual([2, 3]);
    expect((await call("listJobEvidenceEvents", "job-done", { query: "?from=0" })).status).toBe(
      400,
    );
    expect((await call("listJobEvidenceEvents", "job-done", { query: "?limit=5000" })).status).toBe(
      400,
    );
  });

  test("a pair credential restricted to other sessions gets 404", async () => {
    const restricted = {
      kind: "pair",
      scope: "attach",
      sessions: ["agent:carol:*"],
    } as unknown as Parameters<typeof setHttpPrincipal>[1];
    expect((await call("getJobEvidence", "job-done", { principal: restricted })).status).toBe(404);
    const allowed = {
      kind: "pair",
      scope: "attach",
      sessions: ["agent:alice:*"],
    } as unknown as Parameters<typeof setHttpPrincipal>[1];
    expect((await call("getJobEvidence", "job-done", { principal: allowed })).status).toBe(200);
  });

  test("export writes a verifiable zip under the state dir; 409 while running; bad body 400", async () => {
    const res = await call("exportJobEvidence", "job-done", { body: "{}" });
    expect(res.status).toBe(200);
    const body = res.json();
    expect(String(body.path).startsWith(path.join(home, "evidence-exports"))).toBe(true);
    expect(body.format).toBe("zip");
    expect((await verifyEvidenceBundle(String(body.path))).ok).toBe(true);
    const dir = await call("exportJobEvidence", "job-done", { body: '{"format":"dir"}' });
    expect(dir.json().format).toBe("dir");
    expect((await call("exportJobEvidence", "job-done", { body: '{"format":"tar"}' })).status).toBe(
      400,
    );
    expect((await call("exportJobEvidence", "job-done", { body: "[1]" })).status).toBe(400);
    expect((await call("exportJobEvidence", "job-live", { body: "" })).status).toBe(409);
  });

  test("HTML view escapes content and sets a strict CSP", async () => {
    const res = await call("getEvidenceView", "job-done");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.body).toContain("Evidence for job <code>job-done</code>");
    expect(res.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(res.body).not.toContain("<script>");
    expect(res.body).toContain("after this step:");
    expect((await call("getEvidenceView", "nope")).status).toBe(404);
  });
});
