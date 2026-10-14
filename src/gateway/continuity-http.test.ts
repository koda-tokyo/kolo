import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { appendAudit, flushAudit, resolveAuditDir } from "../audit/audit-log.js";
import { verifyManifest } from "../continuity-suite/manifest.js";
import { createContinuityHttpHandlers, findAuditEntry } from "./continuity-http.js";

type Captured = { status: number; body: Record<string, unknown> };

function fakeRes(): { res: ServerResponse; captured: () => Captured } {
  let status = 0;
  let body = "";
  const res = {
    setHeader: () => {},
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
  return { res, captured: () => ({ status, body: JSON.parse(body) as Record<string, unknown> }) };
}

async function call(
  handler: ReturnType<typeof createContinuityHttpHandlers>[keyof ReturnType<
    typeof createContinuityHttpHandlers
  >],
  url: string,
): Promise<Captured> {
  const { res, captured } = fakeRes();
  await handler({} as IncomingMessage, res, { url: new URL(url, "http://127.0.0.1"), params: {} });
  return captured();
}

describe("continuity HTTP handlers", () => {
  let home = "";
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "kolo-cont-http-"));
    for (const k of ["KOLO_HOME", "KOLO_STATE_DIR", "KOLO_SHARED_HOME", "KOLO_CONFIG_PATH"]) {
      saved[k] = process.env[k];
    }
    process.env.KOLO_HOME = home;
    process.env.KOLO_STATE_DIR = home;
    process.env.KOLO_SHARED_HOME = home;
    process.env.KOLO_CONFIG_PATH = path.join(home, "kolo.json");
    fs.writeFileSync(
      path.join(home, "kolo.json"),
      JSON.stringify({ agents: { list: [{ id: "alice", default: true }] } }),
    );
    const ws = path.join(home, "workspace", "memory");
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(home, "workspace", "IDENTITY.md"), "- Name: Alice\n");
    fs.writeFileSync(
      path.join(ws, "facts.md"),
      "The harbour redesign codename is Blue Heron.\nLunch is at noon.\n",
    );
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("getContinuityManifest returns a verifiable manifest and rejects unknown agents", async () => {
    const h = createContinuityHttpHandlers({ gatewayVersion: "test" });
    const ok = await call(h.getContinuityManifest, "/api/continuity/manifest?agent=alice");
    expect(ok.status).toBe(200);
    const manifest = (ok.body as { manifest: Parameters<typeof verifyManifest>[0] }).manifest;
    expect(manifest.resident).toBe("alice");
    expect(manifest.gatewayVersion).toBe("test");
    expect(verifyManifest(manifest).ok).toBe(true);
    expect(JSON.stringify(ok.body)).not.toContain("PRIVATE KEY");
    const missing = await call(h.getContinuityManifest, "/api/continuity/manifest?agent=nobody");
    expect(missing.status).toBe(404);
    const bad = await call(h.getContinuityManifest, "/api/continuity/manifest?agent=../x");
    expect(bad.status).toBe(404);
  });

  test("recallMemory finds the seeded fact and validates its inputs", async () => {
    const h = createContinuityHttpHandlers();
    const hit = await call(
      h.recallMemory,
      "/api/memory/recall?agent=alice&q=harbour+redesign+codename",
    );
    expect(hit.status).toBe(200);
    const hits = (hit.body as { hits: Array<{ snippet: string; path: string; score: number }> })
      .hits;
    expect(hits[0]).toMatchObject({ path: "memory/facts.md", score: 3 });
    expect(hits[0].snippet).toContain("Blue Heron");
    expect((await call(h.recallMemory, "/api/memory/recall?agent=alice")).status).toBe(400);
    expect((await call(h.recallMemory, "/api/memory/recall?agent=alice&q=x&limit=0")).status).toBe(
      400,
    );
    expect((await call(h.recallMemory, "/api/memory/recall?agent=zed&q=x")).status).toBe(404);
  });

  test("getAuditChain reports the head and anchors on a seq", async () => {
    await appendAudit({ identity: "t", action: "a.one", outcome: "ok", source: "test" });
    await appendAudit({ identity: "t", action: "a.two", outcome: "ok", source: "test" });
    await flushAudit();
    const h = createContinuityHttpHandlers();
    const chain = await call(h.getAuditChain, "/api/audit/chain?seq=1");
    expect(chain.status).toBe(200);
    expect(chain.body).toMatchObject({ ok: true, verified: true, entries: 2, lastSeq: 2 });
    const head = chain.body.head as { seq: number; hash: string };
    const anchor = chain.body.anchor as { seq: number; hash: string };
    expect(head.seq).toBe(2);
    expect(anchor.seq).toBe(1);
    expect(findAuditEntry(resolveAuditDir(), 1)?.hash).toBe(anchor.hash);
    expect(findAuditEntry(resolveAuditDir(), 99)).toBeNull();
    expect((await call(h.getAuditChain, "/api/audit/chain?seq=0")).status).toBe(400);
    const missing = await call(h.getAuditChain, "/api/audit/chain?seq=50");
    expect(missing.body.anchor).toBeNull();
  });
});
