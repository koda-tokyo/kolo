import { KoloClient } from "@kodasoken/kolo-client";
import { describe, expect, it } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import {
  FACTORY_EXIT,
  runFactoryBoards,
  runFactoryCancel,
  runFactoryCards,
  runFactoryCreate,
  runFactoryMove,
  runFactoryRun,
  runFactoryShow,
} from "./factory-cli.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const runtime: RuntimeEnv = {
    log: (...a: unknown[]) => void out.push(a.join(" ")),
    error: (...a: unknown[]) => void err.push(a.join(" ")),
    exit: (code: number) => {
      throw new Error(`exit ${code}`);
    },
  };
  return { out, err, runtime };
}

function clientWith(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new KoloClient({
    baseUrl: "http://127.0.0.1:18861",
    token: "tok",
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  });
  return { calls, createClient: async () => client };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const card = {
  id: "11111111-2222-3333-4444-555555555555",
  boardId: "main",
  title: "Add a /health endpoint",
  goal: "Add a /health endpoint",
  repo: "/srv/app",
  owner: "alice",
  column: "ready",
  updatedAt: "2026-10-14T00:00:00.000Z",
  engineTaskId: "001-add-a-health-endpoint",
  branch: "kip/001-add-a-health-endpoint",
  jobIds: ["job-1"],
  evidenceIds: ["job-1"],
  pr: { url: "https://example.invalid/alice/app/pull/7", number: 7, branch: "kip/001" },
  policy: { autoMerge: false },
  runningJobId: null,
  summary: "Built the thing",
  error: null,
  timeline: [
    { seq: 1, ts: "2026-10-14T00:00:00.000Z", kind: "created", by: "alice", text: "Card created." },
  ],
};

describe("kolo factory", () => {
  it("prints boards as a table and as JSON", async () => {
    const { createClient } = clientWith(() =>
      json(200, {
        ok: true,
        boards: [{ id: "main", name: "main", repo: null, counts: { inbox: 2, ready: 1 } }],
      }),
    );
    const c = capture();
    expect(await runFactoryBoards({}, { runtime: c.runtime, createClient })).toBe(FACTORY_EXIT.ok);
    expect(c.out.join("\n")).toContain("main");
    expect(c.out.join("\n")).toMatch(/inbox/);
    const j = capture();
    await runFactoryBoards({ json: true }, { runtime: j.runtime, createClient });
    expect(JSON.parse(j.out.join("\n"))).toMatchObject({ boards: [{ id: "main" }] });
  });

  it("lists cards with filters and validates the column", async () => {
    const { calls, createClient } = clientWith(() => json(200, { ok: true, cards: [card] }));
    const c = capture();
    expect(
      await runFactoryCards(
        { column: "ready", board: "main" },
        { runtime: c.runtime, createClient },
      ),
    ).toBe(FACTORY_EXIT.ok);
    expect(calls[0].url).toContain("/api/factory/cards?");
    expect(calls[0].url).toContain("column=ready");
    expect(calls[0].url).toContain("board=main");
    expect(c.out.join("\n")).toContain("pull/7");
    const u = capture();
    expect(await runFactoryCards({ column: "done" }, { runtime: u.runtime, createClient })).toBe(
      FACTORY_EXIT.usage,
    );
  });

  it("creates, shows, moves, runs and cancels through the typed operations", async () => {
    const { calls, createClient } = clientWith((url, init) => {
      if (url.endsWith("/api/factory/cards") && init.method === "POST") {
        return json(200, { ok: true, card, jobId: "job-1" });
      }
      if (url.endsWith("/move")) {
        return json(200, { ok: true, card: { ...card, column: "merged" } });
      }
      if (url.endsWith("/run")) {
        return json(200, { ok: true, jobId: "job-2", card });
      }
      if (url.endsWith("/cancel")) {
        return json(200, { ok: true, jobId: "job-2" });
      }
      return json(200, { ok: true, card, running: false });
    });
    const c = capture();
    expect(
      await runFactoryCreate(
        { goal: "Add a /health endpoint", repo: "/srv/app", run: true, autoMerge: true },
        { runtime: c.runtime, createClient },
      ),
    ).toBe(FACTORY_EXIT.ok);
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      goal: "Add a /health endpoint",
      repo: "/srv/app",
      autoMerge: true,
      run: true,
    });
    expect(c.out.join("\n")).toContain("job          job-1");
    expect(c.out.join("\n")).toContain("/evidence/job-1");

    const s = capture();
    expect(await runFactoryShow(card.id, {}, { runtime: s.runtime, createClient })).toBe(
      FACTORY_EXIT.ok,
    );
    expect(s.out.join("\n")).toContain("timeline     1 entries");
    expect(s.out.join("\n")).toContain("created");

    const m = capture();
    expect(
      await runFactoryMove(
        card.id,
        "merged",
        { reason: "PR merged" },
        { runtime: m.runtime, createClient },
      ),
    ).toBe(FACTORY_EXIT.ok);
    expect(m.out.join("\n")).toContain("moved to merged");
    expect(await runFactoryMove(card.id, "done", {}, { runtime: m.runtime, createClient })).toBe(
      FACTORY_EXIT.usage,
    );

    const r = capture();
    expect(
      await runFactoryRun(card.id, { merge: true }, { runtime: r.runtime, createClient }),
    ).toBe(FACTORY_EXIT.ok);
    expect(r.out.join("\n")).toContain("job          job-2");
    const k = capture();
    expect(await runFactoryCancel(card.id, {}, { runtime: k.runtime, createClient })).toBe(
      FACTORY_EXIT.ok,
    );
    expect(k.out.join("\n")).toContain("cancel requested");
    expect(await runFactoryCreate({}, { runtime: k.runtime, createClient })).toBe(
      FACTORY_EXIT.usage,
    );
    expect(await runFactoryShow("", {}, { runtime: k.runtime, createClient })).toBe(
      FACTORY_EXIT.usage,
    );
  });

  it("maps gateway refusals, forbidden and unreachable to exit codes", async () => {
    const refused = clientWith(() =>
      json(409, { ok: false, error: "card x is ready", code: "column" }),
    );
    const a = capture();
    expect(
      await runFactoryRun("x", {}, { runtime: a.runtime, createClient: refused.createClient }),
    ).toBe(FACTORY_EXIT.failed);
    expect(a.err[0]).toContain("card x is ready");

    const forbidden = clientWith(() => json(403, { error: { message: "Forbidden" } }));
    const b = capture();
    expect(
      await runFactoryMove(
        "x",
        "spec",
        {},
        { runtime: b.runtime, createClient: forbidden.createClient },
      ),
    ).toBe(FACTORY_EXIT.auth);
    expect(b.err[0]).toContain("forbidden");

    const down = clientWith(() => {
      throw new TypeError("fetch failed");
    });
    const d = capture();
    expect(
      await runFactoryBoards({}, { runtime: d.runtime, createClient: down.createClient }),
    ).toBe(FACTORY_EXIT.unreachable);
  });
});
