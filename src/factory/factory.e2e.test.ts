// End-to-end (KoLo 2.0, M15): a throwaway gateway (built dist/entry.js) pointed at a fake KIP
// engine runs one card from the inbox to ready: created through the API, run, followed over
// the WebSocket as factory.card events, its job and evidence read back, the Kanban page served,
// then the same board read through the CLI. `pnpm factory:check` runs this file; no network,
// no model, no API key.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { ProbeClient, waitFor } from "../continuity-suite/client.js";
import { startFakeProvider } from "../continuity-suite/fake-provider.js";
import { resolveGatewayEntry, ThrowawayGateway } from "../continuity-suite/throwaway.js";
import { PROTOCOL_VERSION } from "../gateway/protocol/schema/protocol-schemas.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasDist = (() => {
  try {
    resolveGatewayEntry();
    return true;
  } catch {
    return false;
  }
})();

type Card = {
  id: string;
  column: string;
  owner: string;
  engineTaskId: string | null;
  branch: string | null;
  jobIds: string[];
  evidenceIds: string[];
  runningJobId: string | null;
  pr: { url: string } | null;
  timeline?: Array<{ kind: string; by: string; text: string }>;
};

function frame(seq: number, type: string, data: Record<string, unknown>): string {
  const ev = { seq, ts: new Date().toISOString(), taskId: "001-goal", type, data };
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

/** A fake `kip-engine serve`: bearer token from a file, {task} envelopes, SSE with `event: end`. */
async function startFakeEngine(
  token: string,
): Promise<{ baseUrl: string; close: () => Promise<void>; created: number }> {
  const state = { created: 0 };
  const task = (status: string) => ({
    id: "001-goal",
    specId: "001-goal",
    goal: "Build the thing",
    title: "Build the thing",
    status,
    branch: "kip/001-goal",
    baseBranch: "main",
  });
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) {
      send(401, { error: "unauthorized" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/tasks") {
      req.resume();
      req.on("end", () => {
        state.created += 1;
        send(201, { task: task("created") });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/001-goal/run") {
      send(202, { task: task("spec"), running: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks/001-goal/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(frame(1, "status", { status: "spec" }));
      res.write(frame(2, "status", { status: "coding" }));
      res.write(frame(3, "tool", { toolName: "Write", toolCallId: "t1" }));
      res.write(frame(4, "status", { status: "qa" }));
      res.write(frame(5, "status", { status: "ready_to_merge" }));
      res.write(frame(6, "done", { status: "ready_to_merge" }));
      res.write("event: end\ndata: {}\n\n");
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/tasks/001-goal") {
      send(200, { task: task("ready_to_merge"), running: false });
      return;
    }
    if (req.method === "POST" && url.pathname === "/tasks/001-goal/cancel") {
      send(200, { cancelled: false, task: task("ready_to_merge") });
      return;
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  return {
    baseUrl: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    get created() {
      return state.created;
    },
  };
}

describe.skipIf(!hasDist)("factory end to end", () => {
  let provider: Awaited<ReturnType<typeof startFakeProvider>>;
  let engine: Awaited<ReturnType<typeof startFakeEngine>>;
  let gw: ThrowawayGateway;
  let client: ProbeClient;
  let repo = "";
  let cardId = "";
  let jobId = "";

  beforeAll(async () => {
    provider = await startFakeProvider();
    const home =
      process.env.KOLO_SMOKE_HOME?.trim() ||
      fs.mkdtempSync(path.join(os.tmpdir(), "kolo-fact-e2e-"));
    const port = process.env.KOLO_SMOKE_PORT
      ? Number.parseInt(process.env.KOLO_SMOKE_PORT, 10)
      : undefined;
    gw = await ThrowawayGateway.create({ home, port, providerBaseUrl: provider.baseUrl });
    const tokenFile = path.join(gw.home, "secrets", "kip-engine.token");
    fs.writeFileSync(tokenFile, "factory-e2e-engine-token\n", { mode: 0o600 });
    engine = await startFakeEngine("factory-e2e-engine-token");
    repo = path.join(gw.home, "repo");
    fs.mkdirSync(repo, { recursive: true });
    // The engine bridge and the board's default repository are plain config.
    const raw = JSON.parse(fs.readFileSync(gw.configPath, "utf8")) as Record<string, unknown>;
    raw.kipEngine = { enabled: true, baseUrl: engine.baseUrl, tokenFile };
    raw.factory = { defaultRepo: repo };
    fs.writeFileSync(gw.configPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    await gw.start();
    client = new ProbeClient(gw.baseUrl, gw.token);
  }, 120_000);

  afterAll(async () => {
    await gw?.destroy();
    await engine?.close();
    await provider?.close();
  });

  test(
    "a card runs from inbox to ready with live events, a job and evidence",
    { timeout: 90_000 },
    async () => {
      // Live events: subscribe before the run starts.
      const events: Array<{ kind: string; from?: string; to?: string }> = [];
      const ws = new WebSocket(`ws://127.0.0.1:${gw.port}`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
        ws.addEventListener("open", () => {
          ws.send(
            JSON.stringify({
              type: "req",
              id: "fact-connect",
              method: "connect",
              params: {
                minProtocol: PROTOCOL_VERSION,
                maxProtocol: PROTOCOL_VERSION,
                client: {
                  id: "kolo-probe",
                  version: "factory",
                  platform: process.platform,
                  mode: "probe",
                },
                role: "operator",
                scopes: ["operator.read"],
                auth: { token: gw.token },
              },
            }),
          );
        });
        ws.addEventListener("message", (ev) => {
          const f = JSON.parse(String(ev.data)) as {
            type: string;
            id?: string;
            ok?: boolean;
            event?: string;
            payload?: { kind: string; from?: string; to?: string };
          };
          if (f.type === "res" && f.id === "fact-connect") {
            clearTimeout(timer);
            if (f.ok) {
              resolve();
            } else {
              reject(new Error("ws connect refused"));
            }
          }
          if (f.type === "event" && f.event === "factory.card" && f.payload) {
            events.push({ kind: f.payload.kind, from: f.payload.from, to: f.payload.to });
          }
        });
        ws.addEventListener("error", () => reject(new Error("ws error")));
      });

      const created = await client.post<{ ok: boolean; card: Card }>("/api/factory/cards", {
        goal: "Build the thing",
        title: "Build the thing",
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      cardId = created.body.card.id;
      expect(created.body.card.owner).toBe(gw.agentId);
      expect(created.body.card.column).toBe("inbox");

      const run = await client.post<{ ok: boolean; jobId: string }>(
        `/api/factory/cards/${encodeURIComponent(cardId)}/run`,
        {},
      );
      expect(run.status, JSON.stringify(run.body)).toBe(200);
      jobId = run.body.jobId;

      const ready = await waitFor(
        async () => {
          const res = await client.get<{ card: Card; running: boolean }>(
            `/api/factory/cards/${encodeURIComponent(cardId)}`,
          );
          return res.body.card.column === "ready" && !res.body.running ? res.body.card : false;
        },
        { timeoutMs: 60_000, intervalMs: 500, what: "the card to reach ready" },
      );
      expect(engine.created).toBe(1);
      expect(ready.engineTaskId).toBe("001-goal");
      expect(ready.branch).toBe("kip/001-goal");
      expect(ready.jobIds).toEqual([jobId]);
      expect(ready.evidenceIds).toEqual([jobId]);
      expect(ready.pr).toBeNull();
      expect(ready.timeline?.map((e) => e.kind)).toContain("engine");
      expect(ready.timeline?.some((e) => e.kind === "pr" && e.text.includes("kip/001-goal"))).toBe(
        true,
      );

      await waitFor(() => events.filter((e) => e.kind === "card.moved").length >= 4 || false, {
        timeoutMs: 10_000,
        intervalMs: 200,
        what: "factory.card events on the WebSocket",
      });
      ws.close();
      expect(events.filter((e) => e.kind === "card.moved").map((e) => `${e.from}>${e.to}`)).toEqual(
        ["inbox>spec", "spec>build", "build>review", "review>ready"],
      );
      expect(events.some((e) => e.kind === "card.created")).toBe(true);

      const job = await client.get<{ job: { kind: string; status: string; agent: string } }>(
        `/api/jobs/${encodeURIComponent(jobId)}`,
      );
      expect(job.body.job).toMatchObject({
        kind: "factory",
        status: "succeeded",
        agent: gw.agentId,
      });
      const evidence = await client.get<{
        ok: boolean;
        summary: { status: string; signed: boolean; toolCalls: number; events: number };
      }>(`/api/jobs/${encodeURIComponent(jobId)}/evidence`);
      expect(evidence.status).toBe(200);
      expect(evidence.body.summary).toMatchObject({
        status: "succeeded",
        signed: true,
        toolCalls: 1,
      });
      expect(evidence.body.summary.events).toBeGreaterThanOrEqual(7);
      const view = await fetch(`${gw.baseUrl}/evidence/${encodeURIComponent(jobId)}`, {
        headers: { authorization: `Bearer ${gw.token}` },
      });
      expect(view.status).toBe(200);

      const boards = await client.get<{
        boards: Array<{ id: string; counts: Record<string, number> }>;
      }>("/api/factory/boards");
      expect(boards.body.boards[0]).toMatchObject({ id: "main", counts: { ready: 1 } });
    },
  );

  test("the Kanban page is served without a token and holds no data", async () => {
    const res = await fetch(`${gw.baseUrl}/factory`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>Factory</title>");
    expect(html).not.toContain(cardId);
    expect(html).not.toContain(gw.token);
    const unauth = await fetch(`${gw.baseUrl}/api/factory/boards`);
    expect(unauth.status).toBe(401);
  });

  test(
    "moves are audited and refused when illegal; the CLI reads the same board",
    { timeout: 60_000 },
    async () => {
      const bad = await client.post<{ ok: boolean; code: string }>(
        `/api/factory/cards/${encodeURIComponent(cardId)}/move`,
        { to: "inbox" },
      );
      expect(bad.status).toBe(409);
      expect(bad.body.code).toBe("transition");
      const merged = await client.post<{ ok: boolean; card: Card }>(
        `/api/factory/cards/${encodeURIComponent(cardId)}/move`,
        { to: "merged", reason: "merged by hand" },
      );
      expect(merged.status).toBe(200);
      expect(merged.body.card.column).toBe("merged");
      // The hash-chained audit log under KOLO_HOME/audit carries every factory transition.
      const auditDir = path.join(gw.home, "audit");
      const actions = fs
        .readdirSync(auditDir)
        .filter((f) => f.endsWith(".jsonl"))
        .flatMap((f) =>
          fs
            .readFileSync(path.join(auditDir, f), "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => (JSON.parse(line) as { action: string }).action),
        );
      expect(actions).toEqual(
        expect.arrayContaining([
          "factory.card.created",
          "factory.card.moved",
          "factory.card.run",
          "factory.engine.create",
        ]),
      );

      const env = { ...gw.env(), NO_COLOR: "1" };
      const kolo = (...args: string[]) =>
        spawnSync(process.execPath, [path.join(ROOT, "kolo.mjs"), ...args], {
          env,
          encoding: "utf8",
        });
      const boards = kolo("factory", "boards", "--json");
      expect(boards.status, boards.stderr).toBe(0);
      expect(JSON.parse(boards.stdout)).toMatchObject({
        boards: [{ id: "main", counts: { merged: 1 } }],
      });
      const show = kolo("factory", "show", cardId);
      expect(show.status, show.stderr).toBe(0);
      expect(show.stdout).toContain("column       merged");
      expect(show.stdout).toContain(`/evidence/${jobId}`);
      const cards = kolo("factory", "cards", "--column", "merged");
      expect(cards.status, cards.stderr).toBe(0);
      expect(cards.stdout).toContain("kip/001-goal");
      const refused = kolo("factory", "move", cardId, "inbox");
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("cannot move");
    },
  );
});
