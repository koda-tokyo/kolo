import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSnapshotLimits, SnapshotStore } from "../snapshots/store.js";
import { GATEWAY_ROUTES } from "./http-routes.js";
import { createSnapshotsHttpHandlers } from "./http-snapshots.js";
import { HTTP_ROUTE_MIN_SCOPE } from "./scopes.js";

const audits: Array<Record<string, unknown>> = [];
vi.mock("../audit/index.js", () => ({
  auditSafe: (input: Record<string, unknown>) => {
    audits.push(input);
  },
}));
vi.mock("../config/config.js", () => ({ loadConfig: () => ({}) }));
vi.mock("./pair-auth.js", () => ({ getHttpPrincipal: () => ({ kind: "owner" }) }));
vi.mock("./session-discovery.js", () => ({
  allowlistOf: () => undefined,
  findSession: ({ target }: { target: string }) =>
    target === "sid-main" || target === "agent:main:main"
      ? { id: "sid-main", key: "agent:main:main", agent: "main", attachments: [] }
      : null,
}));

function makeReq(method: string, body?: unknown): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  return Object.assign(stream, {
    method,
    url: "/",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: "",
    headers,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string) {
      res.body = chunk ?? "";
    },
  };
  return res as typeof res & ServerResponse;
}

const ctx = (id: string) => ({
  url: new URL(`http://gateway/api/sessions/${id}/snapshots`),
  params: { id },
});
const parse = (res: { body: string }) => JSON.parse(res.body) as Record<string, unknown>;

describe("snapshot routes are registered", () => {
  it("declares list and restore with attach scope", () => {
    const byId = new Map(GATEWAY_ROUTES.map((route) => [route.operationId, route]));
    const list = byId.get("listSnapshots");
    const restore = byId.get("restoreSnapshot");
    expect(list?.method).toBe("GET");
    expect(list?.path).toBe("/api/sessions/{id}/snapshots");
    expect(restore?.method).toBe("POST");
    expect(restore?.path).toBe("/api/sessions/{id}/snapshots/restore");
    for (const route of [list, restore]) {
      expect(route?.auth).toEqual(["gateway-token", "pair-credential"]);
      expect(route?.minScope).toBe("attach");
    }
    expect(HTTP_ROUTE_MIN_SCOPE.listSnapshots).toBe("attach");
    expect(HTTP_ROUTE_MIN_SCOPE.restoreSnapshot).toBe("attach");
  });
});

describe("snapshots HTTP API", () => {
  let home = "";
  let work = "";
  let store: SnapshotStore;
  let handlers: ReturnType<typeof createSnapshotsHttpHandlers>;
  const file = () => path.join(work, "a.txt");

  beforeEach(() => {
    audits.length = 0;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-snap-http-home-"));
    work = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-snap-http-work-"));
    store = new SnapshotStore("agent:main:main", resolveSnapshotLimits(), home);
    handlers = createSnapshotsHttpHandlers({ storeFor: () => store });
  });
  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it("lists, undoes, redoes and restores, auditing each restore", async () => {
    fs.writeFileSync(file(), "v1");
    const first = store.record("write", [file()]);
    fs.writeFileSync(file(), "v2");
    store.record("edit", [file()]);
    fs.writeFileSync(file(), "v3");

    let res = makeRes();
    handlers.listSnapshots(makeReq("GET"), res, ctx("sid-main"));
    let body = parse(res);
    expect(res.statusCode).toBe(200);
    expect(body.session).toBe("agent:main:main");
    expect(body.cursor).toBe(2);
    const snapshots = body.snapshots as Array<Record<string, unknown>>;
    expect(snapshots.map((s) => s.applied)).toEqual([true, true]);
    expect((snapshots[0].files as Array<{ path: string }>)[0].path).toBe(file());
    expect(res.headers["cache-control"]).toBe("no-store");

    res = makeRes();
    await handlers.restoreSnapshot(makeReq("POST", {}), res, ctx("sid-main"));
    body = parse(res);
    expect(res.statusCode).toBe(200);
    expect(body.action).toBe("undo");
    expect(body.cursor).toBe(1);
    expect(fs.readFileSync(file(), "utf8")).toBe("v2");
    expect(audits.at(-1)).toMatchObject({
      action: "session.snapshot_restore",
      outcome: "ok",
      scope: "agent:main:main",
      identity: "owner",
      source: "gateway.snapshots",
    });

    res = makeRes();
    await handlers.restoreSnapshot(makeReq("POST", { action: "redo" }), res, ctx("sid-main"));
    expect(parse(res).cursor).toBe(2);
    expect(fs.readFileSync(file(), "utf8")).toBe("v3");

    res = makeRes();
    await handlers.restoreSnapshot(makeReq("POST", { id: first!.id }), res, ctx("sid-main"));
    body = parse(res);
    expect(body.action).toBe("restore");
    expect((body.steps as unknown[]).length).toBe(2);
    expect(fs.readFileSync(file(), "utf8")).toBe("v1");

    res = makeRes();
    await handlers.restoreSnapshot(makeReq("POST", { action: "undo" }), res, ctx("sid-main"));
    expect(res.statusCode).toBe(409);
    expect(parse(res).error).toBe("nothing to undo");
    expect(audits.at(-1)).toMatchObject({ outcome: "failed" });
  });

  it("answers 404 for unknown sessions and 400 for bad bodies", async () => {
    let res = makeRes();
    handlers.listSnapshots(makeReq("GET"), res, ctx("nope"));
    expect(res.statusCode).toBe(404);
    res = makeRes();
    await handlers.restoreSnapshot(makeReq("POST", { action: "sideways" }), res, ctx("sid-main"));
    expect(res.statusCode).toBe(400);
    res = makeRes();
    await handlers.restoreSnapshot(makeReq("POST", ["x"]), res, ctx("sid-main"));
    expect(res.statusCode).toBe(400);
    expect(audits).toEqual([]);
  });
});
